'use strict';
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getDb } = require('../database/init');
const { newId, randomName, STORED_RE } = require('../utils/ids');
const { HttpError } = require('../utils/errors');
const { sha256File, equalHex } = require('./hashService');
const audit = require('./auditService');
const settings = require('./settingsService');
const imageService = require('./imageService');
const videoService = require('./videoService');

const iso = () => new Date().toISOString();

async function moveFile(src, dest) {
  try { await fs.promises.rename(src, dest); }
  catch (e) { if (e.code !== 'EXDEV') throw e; await fs.promises.copyFile(src, dest, fs.constants.COPYFILE_EXCL); await fs.promises.unlink(src); }
}
const readOnly = p => fs.promises.chmod(p, 0o444).catch(() => {});

const publicEvidence = r => { if (!r) return r; const { stored_filename, ...rest } = r; return rest; };
const publicArtifact = r => { if (!r) return r; const { stored_filename, params_json, ...rest } = r; return { ...rest, params: JSON.parse(params_json || '{}') }; };

function getEvidence(id, { includeDeleted = false } = {}) {
  const row = getDb().prepare('SELECT * FROM evidence WHERE id = ?').get(id);
  if (!row || (row.deleted_at && !includeDeleted)) throw new HttpError(404, 'Evidence not found.', 'not_found');
  return row;
}
function originalPath(ev) {
  if (!STORED_RE.test(ev.stored_filename)) throw new HttpError(500, 'Evidence record is invalid.', 'invalid_record');
  return path.join(config.storage.originals, ev.stored_filename);
}

/** Moves a validated temp upload into the vault, hashes it, records it. The original is never modified afterwards. */
async function ingest({ tempPath, originalName, declaredExt, detected, caseId, notes = '', actor, isDemo = 0, declaredFormat }) {
  const sha256 = await sha256File(tempPath);
  const { size } = await fs.promises.stat(tempPath);
  const stored = randomName(detected.ext);
  const dest = path.join(config.storage.originals, stored);
  await moveFile(tempPath, dest);
  await readOnly(dest);
  const id = newId('EVD'); const now = iso(); const by = actor || settings.getActor();
  const mismatch = declaredFormat && declaredFormat !== detected.format ? 1 : 0;
  try {
    getDb().prepare(`INSERT INTO evidence(id,case_id,original_filename,stored_filename,category,mime_type,detected_format,declared_ext,format_mismatch,size_bytes,sha256,notes,is_demo,uploaded_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, caseId, originalName, stored, detected.category, detected.mime, detected.format, declaredExt || null, mismatch, size, sha256, notes, isDemo, by, now, now);
  } catch (e) { await fs.promises.chmod(dest, 0o666).catch(() => {}); await fs.promises.unlink(dest).catch(() => {}); throw e; }
  audit.record({ caseId, evidenceId: id, type: 'evidence.uploaded', actor: by, description: `Evidence "${originalName}" ingested (${detected.format}, ${size} bytes). SHA-256 recorded: ${sha256}.` });
  return getEvidence(id);
}

function latestAnalysis(evidenceId) {
  const r = getDb().prepare('SELECT * FROM analysis_results WHERE evidence_id = ? ORDER BY id DESC LIMIT 1').get(evidenceId);
  return r ? { id: r.id, status: r.status, createdAt: r.created_at, analyzedBy: r.analyzed_by, result: JSON.parse(r.result_json) } : null;
}

async function analyze(ev, actor) {
  const p = originalPath(ev);
  if (!fs.existsSync(p)) throw new HttpError(404, 'The stored evidence file is missing.', 'evidence_file_missing');
  const result = ev.category === 'image' ? await imageService.analyze(p, ev) : await videoService.analyze(p, ev);
  const status = result.validation.status === 'invalid' ? 'failed' : (result.validation.status === 'unknown' ? 'partial' : 'completed');
  const by = actor || settings.getActor();
  getDb().prepare('INSERT INTO analysis_results(evidence_id,analysis_type,status,result_json,analyzed_by,created_at) VALUES(?,?,?,?,?,?)')
    .run(ev.id, ev.category, status, JSON.stringify(result), by, iso());
  const mstat = result.metadata && result.metadata.status;
  audit.record({ caseId: ev.case_id, evidenceId: ev.id, type: 'metadata.extracted', actor: by, status: mstat === 'error' ? 'error' : 'success', description: `Metadata extraction status: ${mstat || 'n/a'}.` });
  audit.record({ caseId: ev.case_id, evidenceId: ev.id, type: 'analysis.completed', actor: by, status: status === 'failed' ? 'error' : 'success', description: `${ev.category} analysis ${status}; ${result.indicators.length} indicator(s).` });
  return latestAnalysis(ev.id);
}

async function verify(ev, providedHash, actor) {
  const by = actor || settings.getActor();
  let status; let calculated = null; let errorMessage = null;
  try {
    calculated = await sha256File(originalPath(ev));
    status = equalHex(calculated, ev.sha256) ? 'MATCH' : 'MISMATCH';
  } catch (e) {
    status = 'ERROR';
    errorMessage = e.code === 'ENOENT' ? 'The stored evidence file is missing.' : (e instanceof HttpError ? e.message : 'The stored evidence file could not be read.');
  }
  const provided = providedHash ? providedHash.toLowerCase() : null;
  const providedMatches = provided ? (equalHex(provided, ev.sha256) ? 1 : 0) : null;
  const id = newId('VER'); const at = iso();
  getDb().prepare(`INSERT INTO integrity_verifications(id,evidence_id,status,expected_hash,calculated_hash,provided_hash,provided_matches_recorded,error_message,verified_by,verified_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, ev.id, status, ev.sha256, calculated, provided, providedMatches, errorMessage, by, at);
  audit.record({ caseId: ev.case_id, evidenceId: ev.id, type: 'integrity.verified', actor: by, status: status === 'MATCH' ? 'success' : (status === 'MISMATCH' ? 'warning' : 'error'),
    description: `Integrity verification ${status}${errorMessage ? ' (' + errorMessage + ')' : ''}${provided ? `; user-provided hash ${providedMatches ? 'matches' : 'does not match'} recorded hash` : ''}.` });
  return getDb().prepare('SELECT * FROM integrity_verifications WHERE id = ?').get(id);
}

/** Registers a derived file (frame, contact sheet, converted copy). tmpPath is moved into derived storage. */
async function createArtifact({ evidence, kind, tmpPath, mime, params = {}, actor }) {
  const sha256 = await sha256File(tmpPath);
  const { size } = await fs.promises.stat(tmpPath);
  const stored = randomName('.png');
  await moveFile(tmpPath, path.join(config.storage.derived, stored));
  const id = newId('ART'); const by = actor || settings.getActor();
  getDb().prepare('INSERT INTO derived_artifacts(id,evidence_id,kind,stored_filename,mime_type,size_bytes,sha256,params_json,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(id, evidence.id, kind, stored, mime, size, sha256, JSON.stringify(params), by, iso());
  audit.record({ caseId: evidence.case_id, evidenceId: evidence.id, type: 'artifact.created', actor: by, description: `Derived artifact ${id} (${kind}) created from ${evidence.id}. Derived SHA-256: ${sha256}.` });
  return getArtifact(id);
}
function getArtifact(id) {
  const r = getDb().prepare('SELECT * FROM derived_artifacts WHERE id = ?').get(id);
  if (!r) throw new HttpError(404, 'Artifact not found.', 'not_found');
  return r;
}
const listArtifacts = evidenceId => getDb().prepare('SELECT * FROM derived_artifacts WHERE evidence_id = ? ORDER BY created_at DESC').all(evidenceId);
const listVerifications = (evidenceId, limit = 50) => getDb().prepare('SELECT * FROM integrity_verifications WHERE evidence_id = ? ORDER BY rowid DESC LIMIT ?').all(evidenceId, limit);
const tmpName = ext => path.join(config.storage.temporary, randomName(ext));

module.exports = { ingest, getEvidence, originalPath, analyze, latestAnalysis, verify, createArtifact, getArtifact, listArtifacts, listVerifications, publicEvidence, publicArtifact, tmpName };


/** Moves a validated temp upload into the vault, hashes it, records it. */
async function ingest({
  tempPath,
  originalName,
  declaredExt,
  detected,
  caseId,
  notes = '',
  actor,
  isDemo = 0,
  declaredFormat
}) {
  // 1. Calculate SHA-256 from original uploaded file bytes.
  const sha256 = await sha256File(tempPath);

  // 2. Identify the current investigator.
  const by = actor || settings.getActor();

  // 3. Check whether this exact file already exists.
  // Include archived evidence too, to preserve forensic history.
  const existing = getDb().prepare(`
    SELECT id, case_id, original_filename, deleted_at
    FROM evidence
    WHERE sha256 = ?
    ORDER BY created_at ASC
    LIMIT 1
  `).get(sha256);

  // 4. Reject duplicate before moving or saving the new file.
  if (existing) {
    audit.record({
      caseId,
      evidenceId: existing.id,
      type: 'evidence.duplicate_detected',
      actor: by,
      status: 'warning',
      description:
        `Duplicate upload rejected: "${originalName}". ` +
        `SHA-256 matches existing evidence ${existing.id}.`
    });

    throw new HttpError(
      409,
      `Duplicate evidence detected. This file already exists as ${existing.id}.`,
      'duplicate_evidence',
      {
        existingEvidenceId: existing.id,
        existingFilename: existing.original_filename,
        existingCaseId: existing.case_id,
        archived: Boolean(existing.deleted_at),
        sha256
      }
    );
  }

  // 5. Continue normal evidence ingestion.
  const { size } = await fs.promises.stat(tempPath);
  const stored = randomName(detected.ext);
  const dest = path.join(config.storage.originals, stored);

  await moveFile(tempPath, dest);
  await readOnly(dest);

  const id = newId('EVD');
  const now = iso();
  const mismatch =
    declaredFormat && declaredFormat !== detected.format ? 1 : 0;

  try {
    getDb().prepare(`
      INSERT INTO evidence(
        id, case_id, original_filename, stored_filename,
        category, mime_type, detected_format, declared_ext,
        format_mismatch, size_bytes, sha256, notes,
        is_demo, uploaded_by, created_at, updated_at
      )
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, caseId, originalName, stored,
      detected.category, detected.mime, detected.format,
      declaredExt || null, mismatch, size, sha256,
      notes, isDemo, by, now, now
    );
  } catch (e) {
    await fs.promises.chmod(dest, 0o666).catch(() => {});
    await fs.promises.unlink(dest).catch(() => {});
    throw e;
  }

  audit.record({
    caseId,
    evidenceId: id,
    type: 'evidence.uploaded',
    actor: by,
    description:
      `Evidence "${originalName}" ingested (${detected.format}, ${size} bytes). SHA-256 recorded: ${sha256}.`
  });

  return getEvidence(id);
}
