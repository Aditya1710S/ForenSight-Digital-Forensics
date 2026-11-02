'use strict';
const express = require('express');
const fs = require('fs');
const { getDb } = require('../database/init');
const config = require('../config');
const { asyncHandler, ok, HttpError } = require('../utils/errors');
const { requireId } = require('../utils/ids');
const { pageParams, likeTerm, clean, safeFilename } = require('../utils/validate');
const { upload, validateUploadedFile, discard } = require('../middleware/uploadValidation');
const { declaredFormat } = require('../utils/fileSignature');
const evidenceService = require('../services/evidenceService');
const audit = require('../services/auditService');
const path = require('path');

const router = express.Router();
const SORTS = { created_at: 'e.created_at', original_filename: 'e.original_filename', size_bytes: 'e.size_bytes', category: 'e.category' };

router.get('/', asyncHandler(async (req, res) => {
  const { page, pageSize, offset } = pageParams(req.query);
  const where = ['e.deleted_at IS NULL', 'c.deleted_at IS NULL']; const p = [];
  if (req.query.caseId) { requireId('CASE', req.query.caseId, 'case id'); where.push('e.case_id = ?'); p.push(req.query.caseId); }
  if (req.query.type) { if (!['image', 'video'].includes(req.query.type)) throw new HttpError(400, 'Invalid type filter.', 'validation_error'); where.push('e.category = ?'); p.push(req.query.type); }
  if (req.query.q) { const t = likeTerm(req.query.q); where.push("(e.original_filename LIKE ? ESCAPE '\\' OR e.id LIKE ? ESCAPE '\\' OR e.sha256 LIKE ? ESCAPE '\\')"); p.push(t, t, t); }
  const sort = SORTS[req.query.sort] || SORTS.created_at; const dir = req.query.order === 'asc' ? 'ASC' : 'DESC';
  const w = 'WHERE ' + where.join(' AND ');
  const db = getDb();
  const total = db.prepare(`SELECT COUNT(*) c FROM evidence e JOIN cases c ON c.id = e.case_id ${w}`).get(...p).c;
  const items = db.prepare(`SELECT e.*, c.title AS case_title,
      (SELECT status FROM integrity_verifications v WHERE v.evidence_id = e.id ORDER BY v.rowid DESC LIMIT 1) AS last_verification,
      (SELECT COUNT(*) FROM analysis_results a WHERE a.evidence_id = e.id) AS analysis_count
    FROM evidence e JOIN cases c ON c.id = e.case_id ${w} ORDER BY ${sort} ${dir} LIMIT ? OFFSET ?`).all(...p, pageSize, offset).map(evidenceService.publicEvidence);
  ok(res, { items, total, page, pageSize });
}));

router.post('/upload', upload.single('file'), validateUploadedFile, asyncHandler(async (req, res) => {
  const tempPath = req.file.path;
  try {
    const caseId = requireId('CASE', req.body.caseId, 'case id');
    const c = getDb().prepare('SELECT * FROM cases WHERE id = ?').get(caseId);
    if (!c || c.deleted_at) throw new HttpError(404, 'Selected case not found.', 'not_found');
    if (c.status === 'Closed') throw new HttpError(409, 'This case is Closed. Re-open it before adding evidence.', 'case_closed');
    const notes = clean(req.body.notes).slice(0, 2000);
    const originalName = safeFilename(req.file.originalname);
    const ev = await evidenceService.ingest({
      tempPath, originalName, declaredExt: path.extname(originalName).toLowerCase(), declaredFormat: declaredFormat(originalName),
      detected: req.detected, caseId, notes
    });
    let analysis = null; let analysisError = null;
    try { analysis = await evidenceService.analyze(ev); } catch (e) { analysisError = e instanceof HttpError ? e.message : 'Automatic analysis failed.'; }
    ok(res, { evidence: evidenceService.publicEvidence(ev), analysis, analysisError, parserSkipped: req.parseSkipped }, 201);
  } catch (e) { await discard(tempPath); throw e; }
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const ev = evidenceService.getEvidence(requireId('EVD', req.params.id, 'evidence id'));
  const c = getDb().prepare('SELECT id,title,status FROM cases WHERE id = ?').get(ev.case_id);
  ok(res, { evidence: evidenceService.publicEvidence(ev), case: c, analysis: evidenceService.latestAnalysis(ev.id),
    verifications: evidenceService.listVerifications(ev.id, 10), artifacts: evidenceService.listArtifacts(ev.id).map(evidenceService.publicArtifact) });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const ev = evidenceService.getEvidence(requireId('EVD', req.params.id, 'evidence id'));
  if (typeof req.body.notes !== 'string') throw new HttpError(400, 'Only "notes" (string) can be updated.', 'validation_error');
  const notes = clean(req.body.notes);
  if (notes.length > 2000) throw new HttpError(400, 'Notes must be at most 2000 characters.', 'validation_error', { notes: 'Too long.' });
  getDb().prepare('UPDATE evidence SET notes = ?, updated_at = ? WHERE id = ?').run(notes, new Date().toISOString(), ev.id);
  audit.record({ caseId: ev.case_id, evidenceId: ev.id, type: 'evidence.updated', description: 'Analyst notes updated.' });
  ok(res, evidenceService.publicEvidence(evidenceService.getEvidence(ev.id)));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const ev = evidenceService.getEvidence(requireId('EVD', req.params.id, 'evidence id'));
  if (req.query.confirm !== 'true') throw new HttpError(400, 'Archiving evidence requires explicit confirmation (confirm=true).', 'confirmation_required');
  const now = new Date().toISOString();
  getDb().prepare('UPDATE evidence SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, ev.id);
  audit.record({ caseId: ev.case_id, evidenceId: ev.id, type: 'evidence.archived', description: `Evidence "${ev.original_filename}" archived (soft-deleted). The stored file and its history are retained.` });
  ok(res, { id: ev.id, archived: true });
}));

function sendStored(res, root, storedName, mime, next) {
  res.type(mime); res.set('Cache-Control', 'private, max-age=0');
  res.sendFile(storedName, { root, dotfiles: 'deny', acceptRanges: true }, err => { if (err && !res.headersSent) next(new HttpError(404, 'The stored file is missing.', 'evidence_file_missing')); });
}

router.get('/:id/preview', asyncHandler(async (req, res, next) => {
  const ev = evidenceService.getEvidence(requireId('EVD', req.params.id, 'evidence id'));
  evidenceService.originalPath(ev);
  res.set('Content-Disposition', 'inline');
  sendStored(res, config.storage.originals, ev.stored_filename, ev.mime_type, next);
}));

router.get('/:id/download', asyncHandler(async (req, res, next) => {
  const ev = evidenceService.getEvidence(requireId('EVD', req.params.id, 'evidence id'));
  const p = evidenceService.originalPath(ev);
  if (!fs.existsSync(p)) throw new HttpError(404, 'The stored evidence file is missing.', 'evidence_file_missing');
  audit.record({ caseId: ev.case_id, evidenceId: ev.id, type: 'evidence.downloaded', description: `Original evidence "${ev.original_filename}" downloaded.` });
  res.attachment(ev.original_filename);
  sendStored(res, config.storage.originals, ev.stored_filename, ev.mime_type, next);
}));

module.exports = router;
