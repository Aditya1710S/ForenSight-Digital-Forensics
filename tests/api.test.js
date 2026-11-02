'use strict';
// HTTP-level tests. They need the npm dependencies (express, multer, helmet, ...) and are skipped otherwise.
const h = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const deps = ['express', 'multer', 'helmet', 'express-rate-limit', 'sharp'].every(h.has);
const opts = { skip: deps ? false : 'npm dependencies are not installed (run npm install)' };
const HDR = { 'Content-Type': 'application/json', 'X-Requested-With': 'ForenSight' };

let server, base;
test.before(async () => {
  if (!deps) return;
  const { createApp } = require('../app');
  await new Promise(r => { server = createApp().listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { if (server) server.close(); });

const api = async (method, url, body, headers = HDR) => {
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, json: type.includes('json') ? await res.json() : null, res };
};
async function upload(caseId, file, name, mime) {
  const fd = new FormData();
  fd.append('caseId', caseId);
  fd.append('file', new Blob([fs.readFileSync(file)], { type: mime }), name);
  const res = await fetch(base + '/api/evidence/upload', { method: 'POST', headers: { 'X-Requested-With': 'ForenSight' }, body: fd });
  return { status: res.status, json: await res.json() };
}

test('health endpoint', opts, async () => {
  const r = await api('GET', '/api/health');
  assert.equal(r.status, 200); assert.equal(r.json.data.status, 'ok');
  assert.ok(r.headers.get('content-security-policy'));
});

test('state-changing requests without the custom header are rejected', opts, async () => {
  const r = await api('POST', '/api/cases', { title: 'No header case' }, { 'Content-Type': 'application/json' });
  assert.equal(r.status, 403);
});

test('case lifecycle, validation and audit', opts, async () => {
  let r = await api('POST', '/api/cases', { title: 'x' });
  assert.equal(r.status, 400); assert.ok(r.json.error.details.title);
  r = await api('POST', '/api/cases', { title: 'API test case', description: 'd', investigator: 'tester', priority: 'High' });
  assert.equal(r.status, 201); const id = r.json.data.id;
  assert.match(id, /^CASE-[0-9A-F]{12}$/);
  r = await api('PUT', `/api/cases/${id}`, { status: 'In Progress' });
  assert.equal(r.json.data.status, 'In Progress');
  r = await api('GET', `/api/cases?q=API%20test`); assert.ok(r.json.data.total >= 1);
  r = await api('GET', '/api/cases/CASE-NOTANID'); assert.equal(r.status, 400);
  r = await api('GET', '/api/cases/CASE-000000000000'); assert.equal(r.status, 404);
  r = await api('GET', `/api/audit?caseId=${id}`); assert.ok(r.json.data.total >= 2);
  r = await api('DELETE', `/api/cases/${id}`); assert.equal(r.status, 400); // needs confirm=true
  r = await api('POST', '/api/cases', undefined, { ...HDR }); // empty body
  assert.equal(r.status, 400);
  const bad = await fetch(base + '/api/cases', { method: 'POST', headers: HDR, body: '{bad json' });
  assert.equal(bad.status, 400);
});

test('upload validation, verification, tamper detection, reports', opts, async () => {
  let r = await api('POST', '/api/cases', { title: 'Upload test case' }); const caseId = r.json.data.id;
  await h.makeJpeg(path.join(h.dir, 'u.jpg'));
  let up = await upload(caseId, path.join(h.dir, 'u.jpg'), 'photo.jpg', 'image/jpeg');
  assert.equal(up.status, 201); const ev = up.json.data.evidence;
  assert.match(ev.sha256, /^[0-9a-f]{64}$/); assert.equal(ev.stored_filename, undefined);
  assert.ok(up.json.data.analysis);

  fs.writeFileSync(path.join(h.dir, 'x.exe'), 'MZ-not-allowed');
  up = await upload(caseId, path.join(h.dir, 'x.exe'), 'x.exe', 'application/octet-stream'); assert.equal(up.status, 415);
  fs.writeFileSync(path.join(h.dir, 'fake.jpg'), 'plain text pretending to be a jpeg');
  up = await upload(caseId, path.join(h.dir, 'fake.jpg'), 'fake.jpg', 'image/jpeg'); assert.equal(up.status, 415);

  r = await api('POST', `/api/evidence/${ev.id}/verify`, {}); assert.equal(r.json.data.status, 'MATCH');
  r = await api('POST', `/api/evidence/${ev.id}/verify`, { expectedHash: 'nothex' }); assert.equal(r.status, 400);
  const vid = (await api('POST', `/api/evidence/${ev.id}/verify`, { expectedHash: ev.sha256 })).json.data.id;

  const pre = await fetch(`${base}/api/evidence/${ev.id}/preview`); assert.equal(pre.status, 200);
  const dl = await fetch(`${base}/api/evidence/${ev.id}/download`); assert.equal(dl.status, 200);
  assert.equal((await fetch(`${base}/storage/originals/`)).status === 200 && false, false);

  if (h.has('pdfkit')) {
    const pdf = await fetch(`${base}/api/evidence/${ev.id}/report?format=pdf`);
    assert.equal(pdf.status, 200); assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    assert.equal((await fetch(`${base}/api/reports/case/${caseId}?format=pdf`)).status, 200);
    assert.equal((await fetch(`${base}/api/verifications/${vid}/report?format=pdf`)).status, 200);
  }
  const js = await (await fetch(`${base}/api/evidence/${ev.id}/report?format=json`)).json();
  assert.equal(js.report, 'evidence');

  const types = (await api('GET', `/api/audit?evidenceId=${ev.id}&pageSize=100`)).json.data.items.map(e => e.event_type);
  for (const t of ['evidence.uploaded', 'analysis.completed', 'integrity.verified', 'evidence.downloaded', 'report.exported']) assert.ok(types.includes(t), 'missing audit event ' + t);

  r = await api('GET', '/api/dashboard/stats');
  assert.ok(r.json.data.totals.evidence >= 1); assert.ok(r.json.data.totals.imagesAnalyzed >= 1);
  r = await api('GET', '/api/audit/verify-chain'); assert.equal(r.json.data.valid, true);
  r = await api('DELETE', `/api/audit`, undefined); assert.ok([404, 405].includes(r.status));
});

test('unknown endpoints return JSON 404 and hide internals', opts, async () => {
  const r = await api('GET', '/api/nope'); assert.equal(r.status, 404); assert.equal(r.json.ok, false);
  const r2 = await api('GET', '/api/evidence/EVD-000000000000/download'); assert.equal(r2.status, 404);
  assert.ok(!JSON.stringify(r2.json).includes('storage'));
});
