'use strict';
const express = require('express');
const fs = require('fs');
const config = require('../config');
const { getDb } = require('../database/init');
const { asyncHandler, ok, HttpError } = require('../utils/errors');
const { requireId } = require('../utils/ids');
const { isSha256Hex } = require('../services/hashService');
const evidenceService = require('../services/evidenceService');
const imageService = require('../services/imageService');
const videoService = require('../services/videoService');
const audit = require('../services/auditService');
const settings = require('../services/settingsService');

const router = express.Router();
const ev = req => evidenceService.getEvidence(requireId('EVD', req.params.id, 'evidence id'));
const rmQuiet = p => fs.promises.unlink(p).catch(() => {});

router.post('/evidence/:id/analyze', asyncHandler(async (req, res) => {
  const e = ev(req);
  ok(res, await evidenceService.analyze(e));
}));

router.get('/evidence/:id/analysis', asyncHandler(async (req, res) => {
  const e = ev(req);
  ok(res, { evidence: evidenceService.publicEvidence(e), analysis: evidenceService.latestAnalysis(e.id), artifacts: evidenceService.listArtifacts(e.id).map(evidenceService.publicArtifact) });
}));

router.post('/evidence/:id/verify', asyncHandler(async (req, res) => {
  const e = ev(req);
  const provided = req.body && req.body.expectedHash;
  if (provided !== undefined && provided !== null && provided !== '' && !isSha256Hex(provided)) throw new HttpError(400, 'Provided hash must be a 64-character hexadecimal SHA-256 value.', 'validation_error', { expectedHash: 'Invalid SHA-256.' });
  ok(res, await evidenceService.verify(e, provided || null));
}));

router.get('/evidence/:id/verifications', asyncHandler(async (req, res) => {
  ok(res, evidenceService.listVerifications(ev(req).id, 100));
}));

router.get('/evidence/:id/artifacts', asyncHandler(async (req, res) => {
  ok(res, evidenceService.listArtifacts(ev(req).id).map(evidenceService.publicArtifact));
}));

async function toolGate() {
  const t = await videoService.checkTools();
  if (!t.ffmpeg.available || !t.ffprobe.available) throw new HttpError(503, 'FFmpeg/FFprobe are not available on this machine.', 'tool_unavailable', { guidance: videoService.SETUP_GUIDANCE });
}
async function videoDuration(e) {
  const a = evidenceService.latestAnalysis(e.id);
  let d = a && a.result && a.result.container && a.result.container.durationSeconds;
  if (!d) { const p = await videoService.probe(evidenceService.originalPath(e)); d = Number(p.format && p.format.duration); }
  if (!Number.isFinite(d) || d <= 0) throw new HttpError(422, 'The video duration could not be determined.', 'no_duration');
  return d;
}

router.post('/evidence/:id/video/frame', asyncHandler(async (req, res) => {
  const e = ev(req);
  if (e.category !== 'video') throw new HttpError(400, 'Frame extraction applies to video evidence only.', 'wrong_category');
  await toolGate();
  const ts = Number(req.body && req.body.timestamp);
  if (req.body.timestamp === '' || req.body.timestamp === null || !Number.isFinite(ts) || ts < 0) throw new HttpError(400, 'timestamp must be a number of seconds >= 0.', 'validation_error', { timestamp: 'Invalid timestamp.' });
  const dur = await videoDuration(e);
  if (ts > dur) throw new HttpError(400, `timestamp exceeds the video duration (${dur.toFixed(2)} s).`, 'validation_error', { timestamp: 'Beyond duration.' });
  const tmp = evidenceService.tmpName('.png');
  try {
    try { await videoService.extractFrame(evidenceService.originalPath(e), ts, tmp); }
    catch (err) { throw new HttpError(422, 'Frame extraction failed: ' + (String(err.message).startsWith('No frame') ? err.message : 'FFmpeg could not decode a frame at that time.'), 'extract_failed'); }
    const art = await evidenceService.createArtifact({ evidence: e, kind: 'video_frame', tmpPath: tmp, mime: 'image/png', params: { timestampSeconds: ts } });
    ok(res, evidenceService.publicArtifact(art), 201);
  } finally { await rmQuiet(tmp); }
}));

router.post('/evidence/:id/video/contact-sheet', asyncHandler(async (req, res) => {
  const e = ev(req);
  if (e.category !== 'video') throw new HttpError(400, 'Contact sheets apply to video evidence only.', 'wrong_category');
  await toolGate();
  const max = settings.getContactSheetMax();
  const count = parseInt(req.body && req.body.count, 10);
  if (!Number.isInteger(count) || count < 2 || count > max) throw new HttpError(400, `count must be an integer between 2 and ${max}.`, 'validation_error', { count: 'Out of range.' });
  const dur = await videoDuration(e);
  const tmp = evidenceService.tmpName('.png');
  try {
    try { await videoService.contactSheet(evidenceService.originalPath(e), dur, count, tmp); }
    catch { throw new HttpError(422, 'Contact sheet generation failed.', 'extract_failed'); }
    const art = await evidenceService.createArtifact({ evidence: e, kind: 'contact_sheet', tmpPath: tmp, mime: 'image/png', params: { frames: count } });
    ok(res, evidenceService.publicArtifact(art), 201);
  } finally { await rmQuiet(tmp); }
}));

router.post('/evidence/:id/image/derive', asyncHandler(async (req, res) => {
  const e = ev(req);
  if (e.category !== 'image') throw new HttpError(400, 'Derived copies apply to image evidence only.', 'wrong_category');
  const mode = req.body && req.body.mode;
  if (!imageService.DERIVE_MODES.includes(mode)) throw new HttpError(400, `mode must be one of: ${imageService.DERIVE_MODES.join(', ')}.`, 'validation_error');
  const tmp = evidenceService.tmpName('.png');
  try {
    try { await imageService.derive(evidenceService.originalPath(e), mode, tmp); }
    catch { throw new HttpError(422, 'The derived copy could not be generated.', 'derive_failed'); }
    const art = await evidenceService.createArtifact({ evidence: e, kind: 'image_' + mode, tmpPath: tmp, mime: 'image/png', params: { mode } });
    ok(res, evidenceService.publicArtifact(art), 201);
  } finally { await rmQuiet(tmp); }
}));

function sendArtifact(req, res, next, attachment) {
  const a = evidenceService.getArtifact(requireId('ART', req.params.id, 'artifact id'));
  const parent = evidenceService.getEvidence(a.evidence_id, { includeDeleted: true });
  if (attachment) { audit.record({ caseId: parent.case_id, evidenceId: parent.id, type: 'artifact.downloaded', description: `Derived artifact ${a.id} (${a.kind}) downloaded.` }); res.attachment(`${a.id}.png`); }
  else res.set('Content-Disposition', 'inline');
  res.type(a.mime_type); res.set('Cache-Control', 'private, max-age=0');
  res.sendFile(a.stored_filename, { root: config.storage.derived, dotfiles: 'deny' }, err => { if (err && !res.headersSent) next(new HttpError(404, 'The stored artifact is missing.', 'artifact_file_missing')); });
}
router.get('/artifacts/:id/download', (req, res, next) => { try { sendArtifact(req, res, next, true); } catch (e) { next(e); } });
router.get('/artifacts/:id/preview', (req, res, next) => { try { sendArtifact(req, res, next, false); } catch (e) { next(e); } });

module.exports = router;
