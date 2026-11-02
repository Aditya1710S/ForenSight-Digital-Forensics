'use strict';
const h = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const hasSharp = h.has('sharp');
const hasPdfkit = h.has('pdfkit');
const config = require('../config');
config.ensureDirs();
const { initDatabase, getDb } = require('../database/init');
initDatabase();

const hashService = require('../services/hashService');
const audit = require('../services/auditService');
const { detectType } = require('../utils/fileSignature');
const { validateCase } = require('../utils/validate');
const { requireId, newId } = require('../utils/ids');
const metadataService = require('../services/metadataService');

const tmp = n => path.join(h.dir, n);
function newCase() {
  const id = newId('CASE'); const now = new Date().toISOString();
  getDb().prepare('INSERT INTO cases(id,title,description,investigator,status,priority,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id, 'Unit test case', '', 'tester', 'Open', 'Low', now, now);
  return id;
}

test('SHA-256 of known input matches the published test vector', async () => {
  fs.writeFileSync(tmp('abc.txt'), 'abc');
  assert.equal(await hashService.sha256File(tmp('abc.txt')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.ok(hashService.isSha256Hex('a'.repeat(64)));
  assert.ok(!hashService.isSha256Hex('xyz'));
  assert.ok(hashService.equalHex('A'.repeat(64), 'a'.repeat(64)));
});

test('ID validation rejects malformed identifiers', () => {
  assert.throws(() => requireId('EVD', '../etc/passwd'), /Invalid/);
  assert.throws(() => requireId('CASE', 'CASE-123'), /Invalid/);
  assert.equal(requireId('CASE', newId('CASE')).startsWith('CASE-'), true);
});

test('case validation enforces fields and enums', () => {
  assert.throws(() => validateCase({ title: 'x' }), e => e.status === 400 && !!e.details.title);
  assert.throws(() => validateCase({ title: 'Valid title', status: 'Bogus' }), e => !!e.details.status);
  const v = validateCase({ title: '  Valid title ', priority: 'High' });
  assert.equal(v.title, 'Valid title'); assert.equal(v.status, 'Open');
});

test('audit log: events are recorded, chain verifies, and edits/deletes are blocked', () => {
  const c = newCase();
  audit.record({ caseId: c, type: 'case.created', description: 'one' });
  audit.record({ caseId: c, type: 'case.updated', description: 'two' });
  assert.equal(audit.list({ caseId: c }).total, 2);
  assert.equal(audit.verifyChain().valid, true);
  assert.throws(() => getDb().prepare("UPDATE audit_events SET description='x'").run(), /append-only/);
  assert.throws(() => getDb().prepare('DELETE FROM audit_events').run(), /append-only/);
});

test('audit chain detects out-of-band tampering', () => {
  const db = getDb();
  db.exec('DROP TRIGGER audit_events_no_update');
  db.prepare("UPDATE audit_events SET description = 'tampered' WHERE seq = (SELECT MIN(seq) FROM audit_events)").run();
  const r = audit.verifyChain();
  assert.equal(r.valid, false); assert.ok(r.brokenAtSeq);
  db.exec("UPDATE audit_events SET description='one' WHERE seq=(SELECT MIN(seq) FROM audit_events)"); // restore for later tests
  db.exec("CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;");
  assert.equal(audit.verifyChain().valid, true);
});

test('file signature detection (supported and unsupported)', { skip: !hasSharp }, async () => {
  await h.makeJpeg(tmp('a.jpg')); await h.makePng(tmp('a.png'));
  assert.equal((await detectType(tmp('a.jpg'))).format, 'jpeg');
  assert.equal((await detectType(tmp('a.png'))).format, 'png');
  fs.writeFileSync(tmp('fake.jpg'), 'this is not an image at all, just text');
  assert.equal(await detectType(tmp('fake.jpg')), null);
  fs.writeFileSync(tmp('x.exe'), Buffer.concat([Buffer.from('MZ'), Buffer.alloc(40)]));
  assert.equal(await detectType(tmp('x.exe')), null);
});

test('built-in EXIF parser reads Make/Model/Software from a synthetic JPEG', { skip: !hasSharp }, async () => {
  const sharp = require('sharp');
  await h.makeJpeg(tmp('exif.jpg'));
  const meta = await sharp(tmp('exif.jpg')).metadata();
  const parsed = metadataService.parseExif(meta.exif);
  assert.equal(parsed.Make, 'TestCam'); assert.equal(parsed.Model, 'Synthetic-1'); assert.equal(parsed.Software, 'ForenSight Tests');
  assert.equal(metadataService.parseExif(Buffer.from('garbage')), null);
});

test('ingest -> analyze -> verify MATCH -> tamper -> MISMATCH -> missing -> ERROR (image)', { skip: !hasSharp }, async () => {
  const evidenceService = require('../services/evidenceService');
  const caseId = newCase();
  await h.makeJpeg(tmp('ev.jpg'));
  const before = fs.readFileSync(tmp('ev.jpg'));
  const ev = await evidenceService.ingest({ tempPath: tmp('ev.jpg'), originalName: 'ev.jpg', declaredExt: '.jpg', declaredFormat: 'jpeg', detected: { category: 'image', format: 'jpeg', mime: 'image/jpeg', ext: '.jpg' }, caseId, actor: 'tester' });
  assert.equal(ev.sha256, hashService.isSha256Hex(ev.sha256) && require('crypto').createHash('sha256').update(before).digest('hex'));
  assert.notEqual(ev.stored_filename, 'ev.jpg');

  const a = await evidenceService.analyze(ev, 'tester');
  assert.equal(a.result.validation.status, 'valid');
  assert.equal(a.result.file.width, 200);
  assert.equal(a.result.metadata.camera.make, 'TestCam');
  assert.equal(a.result.metadata.gps, null);
  assert.ok(a.result.indicators.length > 0);
  // original is untouched by analysis
  const orig = evidenceService.originalPath(ev);
  assert.equal(await hashService.sha256File(orig), ev.sha256);

  const m = await evidenceService.verify(ev, null, 'tester');
  assert.equal(m.status, 'MATCH');
  const prov = await evidenceService.verify(ev, 'f'.repeat(64), 'tester');
  assert.equal(prov.status, 'MATCH'); assert.equal(prov.provided_matches_recorded, 0);

  // derived artifact is linked, hashed, and does not alter the original
  const imageService = require('../services/imageService');
  const out = evidenceService.tmpName('.png');
  await imageService.derive(orig, 'grayscale', out);
  const art = await evidenceService.createArtifact({ evidence: ev, kind: 'image_grayscale', tmpPath: out, mime: 'image/png', params: { mode: 'grayscale' } });
  assert.equal(art.evidence_id, ev.id); assert.ok(hashService.isSha256Hex(art.sha256));
  assert.equal(await hashService.sha256File(orig), ev.sha256);

  // deliberately altered copy -> MISMATCH
  fs.chmodSync(orig, 0o644); fs.appendFileSync(orig, Buffer.from([0]));
  const mm = await evidenceService.verify(ev, null, 'tester');
  assert.equal(mm.status, 'MISMATCH'); assert.notEqual(mm.calculated_hash, mm.expected_hash);
  // indicators flag trailing data after the JPEG EOI marker
  const a2 = await evidenceService.analyze(ev, 'tester');
  assert.ok(a2.result.indicators.some(i => i.code === 'jpeg_trailing_data'));

  // missing file -> ERROR, never a false MATCH
  fs.unlinkSync(orig);
  const er = await evidenceService.verify(ev, null, 'tester');
  assert.equal(er.status, 'ERROR'); assert.equal(er.calculated_hash, null); assert.match(er.error_message, /missing/);
  assert.ok(audit.list({ evidenceId: ev.id }).items.some(e => e.event_type === 'integrity.verified'));
});

test('image without metadata yields an Informational (not Error) indicator', { skip: !hasSharp }, async () => {
  const evidenceService = require('../services/evidenceService');
  const caseId = newCase();
  await h.makeJpeg(tmp('noexif.jpg'), { exif: false });
  const ev = await evidenceService.ingest({ tempPath: tmp('noexif.jpg'), originalName: 'noexif.jpg', declaredExt: '.jpg', declaredFormat: 'jpeg', detected: { category: 'image', format: 'jpeg', mime: 'image/jpeg', ext: '.jpg' }, caseId });
  const a = await evidenceService.analyze(ev);
  const ind = a.result.indicators.find(i => i.code === 'no_metadata');
  assert.ok(ind); assert.equal(ind.level, 'Informational');
  assert.ok(!a.result.indicators.some(i => i.level === 'Error'));
});

test('corrupt image is rejected by the parser check', { skip: !hasSharp }, async () => {
  const imageService = require('../services/imageService');
  fs.writeFileSync(tmp('bad.jpg'), Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(64, 7)]));
  assert.equal((await imageService.verifyParsable(tmp('bad.jpg'))).ok, false);
});

test('video: ffprobe metadata + frame extraction + hash (requires FFmpeg)', { skip: !(hasSharp && h.hasFfmpeg()) }, async () => {
  const evidenceService = require('../services/evidenceService'); const videoService = require('../services/videoService');
  const caseId = newCase();
  h.makeMp4(tmp('v.mp4'));
  assert.equal((await videoService.verifyParsable(tmp('v.mp4'))).ok, true);
  const ev = await evidenceService.ingest({ tempPath: tmp('v.mp4'), originalName: 'v.mp4', declaredExt: '.mp4', declaredFormat: 'mp4', detected: { category: 'video', format: 'mp4', mime: 'video/mp4', ext: '.mp4' }, caseId });
  const a = await evidenceService.analyze(ev);
  assert.equal(a.result.video.width, 320); assert.equal(a.result.video.height, 240); assert.equal(a.result.video.codec, 'h264');
  assert.ok(a.result.container.durationSeconds > 2.5);
  const out = evidenceService.tmpName('.png');
  await videoService.extractFrame(evidenceService.originalPath(ev), 1.5, out);
  const art = await evidenceService.createArtifact({ evidence: ev, kind: 'video_frame', tmpPath: out, mime: 'image/png', params: { timestampSeconds: 1.5 } });
  assert.ok(hashService.isSha256Hex(art.sha256)); assert.equal(fs.existsSync(out), false);
  assert.equal(await hashService.sha256File(evidenceService.originalPath(ev)), ev.sha256);
  const sheet = evidenceService.tmpName('.png');
  await videoService.contactSheet(evidenceService.originalPath(ev), a.result.container.durationSeconds, 4, sheet);
  assert.ok(fs.statSync(sheet).size > 0);
  fs.writeFileSync(tmp('notvideo.mp4'), Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom'), Buffer.alloc(64, 1)]));
  assert.equal((await videoService.verifyParsable(tmp('notvideo.mp4'))).ok, false);
});

test('PDF reports are generated (requires pdfkit)', { skip: !(hasSharp && hasPdfkit) }, async () => {
  const evidenceService = require('../services/evidenceService'); const reports = require('../services/reportService');
  const caseId = newCase(); await h.makeJpeg(tmp('r.jpg'));
  const ev = await evidenceService.ingest({ tempPath: tmp('r.jpg'), originalName: 'r.jpg', declaredExt: '.jpg', declaredFormat: 'jpeg', detected: { category: 'image', format: 'jpeg', mime: 'image/jpeg', ext: '.jpg' }, caseId });
  await evidenceService.analyze(ev); const v = await evidenceService.verify(ev);
  for (const buf of [await reports.evidencePdf(ev), await reports.casePdf(caseId), await reports.verificationPdf(v.id)]) {
    assert.equal(buf.subarray(0, 5).toString(), '%PDF-'); assert.ok(buf.length > 1000);
  }
  const j = reports.evidenceJson(ev);
  assert.ok(!JSON.stringify(j).includes(ev.stored_filename), 'JSON export must not expose internal storage names');
  assert.match(j.scope, /not a legally certified/);
});
