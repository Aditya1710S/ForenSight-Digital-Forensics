'use strict';
const { getDb } = require('../database/init');
const audit = require('./auditService');
const evidenceService = require('./evidenceService');
const { HttpError } = require('../utils/errors');

const APP = 'ForenSight';
const SCOPE = 'Scope and limitations: this report is produced by an automated local tool. SHA-256 hashes show byte-level consistency with the value recorded at ingestion (assuming the baseline record was not itself compromised); they do not prove authenticity, origin or legal admissibility. Extracted metadata is self-reported by the file and can be edited. Heuristic indicators are preliminary and do not prove manipulation. The investigator alias is self-declared and not verified. The audit log is application-level and is not a legally certified chain of custody.';

const clean = (v, max = 1200) => (v === null || v === undefined || v === '' ? '-' : String(v)).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, max);

function getCase(id) {
  const c = getDb().prepare('SELECT * FROM cases WHERE id = ?').get(id);
  if (!c) throw new HttpError(404, 'Case not found.', 'not_found');
  return c;
}

function evidenceBundle(ev) {
  const a = evidenceService.latestAnalysis(ev.id);
  return {
    evidence: evidenceService.publicEvidence(ev),
    analysis: a,
    verifications: evidenceService.listVerifications(ev.id, 20),
    artifacts: evidenceService.listArtifacts(ev.id).map(evidenceService.publicArtifact),
    custody: audit.forEntity({ evidenceId: ev.id })
  };
}
const wrapJson = (kind, body) => ({ application: APP, report: kind, generatedAtUtc: new Date().toISOString(), scope: SCOPE, ...body });

function evidenceJson(ev) { return wrapJson('evidence', evidenceBundle(ev)); }
function caseJson(caseId) {
  const c = getCase(caseId);
  const evs = getDb().prepare('SELECT * FROM evidence WHERE case_id = ? AND deleted_at IS NULL ORDER BY created_at').all(caseId);
  return wrapJson('case', { case: c, evidence: evs.map(evidenceBundle), custody: audit.forEntity({ caseId }) });
}
function verificationJson(verId) {
  const v = getDb().prepare('SELECT * FROM integrity_verifications WHERE id = ?').get(verId);
  if (!v) throw new HttpError(404, 'Verification not found.', 'not_found');
  const ev = evidenceService.getEvidence(v.evidence_id, { includeDeleted: true });
  return wrapJson('integrity_verification', { verification: v, evidence: evidenceService.publicEvidence(ev) });
}

// ---------- PDF ----------
function buildPdf(title, draw) {
  const PDFDocument = require('pdfkit');
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true, info: { Title: title, Author: APP, Producer: APP } });
    const chunks = [];
    doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const ui = {
      h1: t => { doc.font('Helvetica-Bold').fontSize(20).fillColor('#0B2545').text(clean(t)); doc.moveDown(0.3); },
      h2: t => { doc.moveDown(0.8); doc.font('Helvetica-Bold').fontSize(13).fillColor('#13315C').text(clean(t)); doc.moveTo(50, doc.y + 2).lineTo(545, doc.y + 2).strokeColor('#8DA9C4').stroke(); doc.moveDown(0.5); },
      tag: t => { doc.font('Helvetica-Oblique').fontSize(9).fillColor('#555').text(clean(t)); doc.moveDown(0.3); },
      kv: (k, v) => { doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#111').text(clean(k) + ': ', { continued: true }).font('Helvetica').text(clean(v)); },
      p: t => { doc.font('Helvetica').fontSize(9.5).fillColor('#222').text(clean(t, 3000)); doc.moveDown(0.3); },
      mono: t => { doc.font('Courier').fontSize(8.5).fillColor('#222').text(clean(t)); },
      gap: () => doc.moveDown(0.5)
    };
    try { draw(ui, doc); } catch (e) { reject(e); return; }
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      const m = doc.page.margins.bottom; doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(8).fillColor('#777').text(`${APP} - ${clean(title, 80)} - Page ${i + 1} of ${range.count}`, 50, doc.page.height - 35, { align: 'center', width: doc.page.width - 100, lineBreak: false });
      doc.page.margins.bottom = m;
    }
    doc.end();
  });
}

const header = (ui, title, caseObj) => {
  ui.h1(`${APP} - ${title}`);
  ui.kv('Report generated (UTC)', new Date().toISOString());
  if (caseObj) { ui.kv('Case ID', caseObj.id); ui.kv('Case title', caseObj.title); }
};

function drawEvidence(ui, b, caseObj) {
  const e = b.evidence;
  ui.h2('Evidence record');
  ui.tag('VERIFIED FACTS - values calculated or recorded by this system');
  ui.kv('Evidence ID', e.id); ui.kv('Original filename', e.original_filename); ui.kv('Category', e.category);
  ui.kv('Detected format', `${e.detected_format} (${e.mime_type})`); ui.kv('File size (bytes)', e.size_bytes);
  ui.kv('Recorded SHA-256', e.sha256); ui.kv('Ingested (UTC)', e.created_at); ui.kv('Uploaded by (self-declared alias)', e.uploaded_by);
  if (e.format_mismatch) ui.kv('Notice', 'File extension did not match the detected format.');
  if (e.is_demo) ui.kv('Notice', 'DEMONSTRATION RECORD - synthetic, not genuine evidence.');
  const v = b.verifications[0];
  ui.h2('Integrity verification');
  if (!v) ui.p('No verification has been performed for this evidence.');
  else { ui.kv('Latest result', v.status); ui.kv('Verified (UTC)', v.verified_at); ui.kv('Expected', v.expected_hash); ui.kv('Calculated', v.calculated_hash); if (v.error_message) ui.kv('Error', v.error_message); }
  const a = b.analysis && b.analysis.result;
  ui.h2('Analysis summary');
  if (!a) ui.p('No analysis has been run.');
  else {
    ui.kv('Analysis status', `${b.analysis.status} (${b.analysis.createdAt})`);
    ui.kv('Parser validation', `${a.validation.status} - ${a.validation.message}`);
    if (a.file.width) ui.kv('Dimensions', `${a.file.width} x ${a.file.height}`);
    if (a.container) { ui.kv('Container', a.container.formatName); ui.kv('Duration (s)', a.container.durationSeconds); }
    if (a.video) { ui.kv('Video codec', a.video.codec); ui.kv('Frame rate', a.video.frameRate); ui.kv('Resolution', `${a.video.width} x ${a.video.height}`); }
    if (a.audio) ui.kv('Audio codec', a.audio.codec);
    ui.h2('Extracted metadata');
    ui.tag('EXTRACTED METADATA - reported by the file itself; unverified and editable');
    const f = (a.metadata && a.metadata.fields) || (a.creation && a.creation.tags) || {};
    const keys = Object.keys(f).slice(0, 40);
    if (!keys.length) ui.p('No embedded metadata was extracted (this is common and not evidence of tampering).');
    keys.forEach(k => ui.kv(k, f[k]));
    if (a.metadata && a.metadata.gps) ui.kv('GPS (present in file)', `${a.metadata.gps.latitude}, ${a.metadata.gps.longitude}`);
    ui.h2('Heuristic indicators');
    ui.tag('HEURISTIC INDICATORS - preliminary, not proof of manipulation');
    (a.indicators || []).forEach(i => ui.p(`[${i.level}] ${i.title} - ${i.explanation}`));
    if (a.setupGuidance) ui.p('Parser limitation: ' + a.setupGuidance);
  }
  ui.h2('Derived artifacts');
  if (!b.artifacts.length) ui.p('None.');
  b.artifacts.forEach(x => { ui.kv(`${x.id} (${x.kind})`, `derived from ${e.id}, ${x.size_bytes} bytes, SHA-256 ${x.sha256}`); });
  ui.h2('Analyst notes');
  ui.tag('ANALYST-ENTERED NOTES - not verified by the system');
  ui.p(e.notes || 'No notes entered.');
  ui.h2('Chain-of-custody events (application log)');
  b.custody.forEach(c => ui.mono(`${c.timestamp}  ${c.event_type}  [${c.actor}]  ${c.description}`));
}

async function evidencePdf(ev) {
  const b = evidenceBundle(ev);
  const c = getCase(ev.case_id);
  return buildPdf('Evidence Report', (ui) => { header(ui, 'Evidence Report', c); drawEvidence(ui, b, c); ui.h2('Scope and limitations'); ui.p(SCOPE); });
}

async function casePdf(caseId) {
  const c = getCase(caseId);
  const evs = getDb().prepare('SELECT * FROM evidence WHERE case_id = ? AND deleted_at IS NULL ORDER BY created_at').all(caseId);
  return buildPdf('Case Report', (ui, doc) => {
    header(ui, 'Case Report', c);
    ui.h2('Case details');
    ui.kv('Status', c.status); ui.kv('Priority', c.priority); ui.kv('Investigator (self-declared)', c.investigator);
    ui.kv('Created (UTC)', c.created_at); ui.kv('Updated (UTC)', c.updated_at); if (c.is_demo) ui.kv('Notice', 'DEMONSTRATION CASE - synthetic data.');
    ui.p(c.description || 'No description.');
    ui.h2(`Evidence items (${evs.length})`);
    if (!evs.length) ui.p('No evidence attached.');
    evs.forEach(e => ui.kv(e.id, `${e.original_filename} | ${e.category} | ${e.size_bytes} bytes | SHA-256 ${e.sha256}`));
    evs.forEach(e => { doc.addPage(); drawEvidence(ui, evidenceBundle(e), c); });
    doc.addPage(); ui.h2('Case chain-of-custody events (application log)');
    audit.forEntity({ caseId }).forEach(x => ui.mono(`${x.timestamp}  ${x.event_type}  [${x.actor}]  ${x.description}`));
    ui.h2('Scope and limitations'); ui.p(SCOPE);
  });
}

async function verificationPdf(verId) {
  const j = verificationJson(verId); const v = j.verification; const e = j.evidence;
  return buildPdf('Integrity Verification Report', ui => {
    header(ui, 'Integrity Verification Report');
    ui.h2('Result'); ui.kv('Result', v.status); ui.kv('Verification ID', v.id); ui.kv('Verified (UTC)', v.verified_at); ui.kv('Verified by (self-declared alias)', v.verified_by);
    ui.h2('Evidence'); ui.kv('Evidence ID', e.id); ui.kv('Case ID', e.case_id); ui.kv('Original filename', e.original_filename);
    ui.h2('Hashes'); ui.kv('Expected (recorded at ingestion)', v.expected_hash); ui.kv('Calculated now', v.calculated_hash);
    if (v.provided_hash) { ui.kv('User-provided', v.provided_hash); ui.kv('Provided matches recorded', v.provided_matches_recorded ? 'Yes' : 'No'); }
    if (v.error_message) ui.kv('Error', v.error_message);
    ui.p('A MATCH indicates byte-level consistency with the recorded hash, assuming the baseline hash and records were not themselves compromised.');
    ui.h2('Scope and limitations'); ui.p(SCOPE);
  });
}

module.exports = { evidenceJson, caseJson, verificationJson, evidencePdf, casePdf, verificationPdf, SCOPE, getCase };
