'use strict';
const express = require('express');
const { getDb } = require('../database/init');
const { asyncHandler, ok } = require('../utils/errors');
const { likeTerm } = require('../utils/validate');
const audit = require('../services/auditService');
const evidenceService = require('../services/evidenceService');

const router = express.Router();

router.get('/dashboard/stats', asyncHandler(async (req, res) => {
  const db = getDb(); const one = (sql, ...p) => db.prepare(sql).get(...p).c;
  const live = 'e.deleted_at IS NULL AND c.deleted_at IS NULL';
  const analyzed = cat => one(`SELECT COUNT(DISTINCT a.evidence_id) c FROM analysis_results a JOIN evidence e ON e.id=a.evidence_id JOIN cases c ON c.id=e.case_id WHERE ${live} AND e.category=?`, cat);
  const typeRows = db.prepare(`SELECT e.category, COUNT(*) c FROM evidence e JOIN cases c ON c.id=e.case_id WHERE ${live} GROUP BY e.category`).all();
  const integ = { MATCH: 0, MISMATCH: 0, ERROR: 0 };
  db.prepare(`SELECT v.status, COUNT(*) c FROM integrity_verifications v WHERE v.rowid = (SELECT MAX(rowid) FROM integrity_verifications WHERE evidence_id = v.evidence_id) GROUP BY v.status`).all().forEach(r => { integ[r.status] = r.c; });
  const since = new Date(Date.now() - 13 * 86400000); since.setUTCHours(0, 0, 0, 0);
  const rows = db.prepare(`SELECT substr(timestamp,1,10) d, event_type t, COUNT(*) c FROM audit_events WHERE timestamp >= ? AND event_type IN ('evidence.uploaded','analysis.completed','integrity.verified') GROUP BY d, t`).all(since.toISOString());
  const days = Array.from({ length: 14 }, (_, i) => new Date(since.getTime() + i * 86400000).toISOString().slice(0, 10));
  const series = t => days.map(d => (rows.find(r => r.d === d && r.t === t) || { c: 0 }).c);
  const day = new Date(Date.now() - 86400000).toISOString();
  ok(res, {
    totals: {
      cases: one('SELECT COUNT(*) c FROM cases WHERE deleted_at IS NULL'),
      evidence: one(`SELECT COUNT(*) c FROM evidence e JOIN cases c ON c.id=e.case_id WHERE ${live}`),
      imagesAnalyzed: analyzed('image'), videosAnalyzed: analyzed('video'),
      eventsLast24h: one('SELECT COUNT(*) c FROM audit_events WHERE timestamp >= ?', day)
    },
    integrity: integ,
    evidenceByType: { image: (typeRows.find(r => r.category === 'image') || { c: 0 }).c, video: (typeRows.find(r => r.category === 'video') || { c: 0 }).c },
    activity: { days, uploads: series('evidence.uploaded'), analyses: series('analysis.completed'), verifications: series('integrity.verified') },
    recentCases: db.prepare('SELECT id,title,status,priority,is_demo,updated_at FROM cases WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 5').all(),
    recentEvidence: db.prepare(`SELECT e.id,e.original_filename,e.category,e.size_bytes,e.case_id,e.is_demo,e.created_at FROM evidence e JOIN cases c ON c.id=e.case_id WHERE ${live} ORDER BY e.created_at DESC LIMIT 5`).all(),
    recentAudit: audit.list({ pageSize: 6 }).items
  });
}));

router.get('/dashboard/activity', asyncHandler(async (req, res) => ok(res, audit.list({ pageSize: 10 }).items)));

router.get('/search', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return ok(res, { cases: [], evidence: [] });
  const t = likeTerm(q); const db = getDb();
  ok(res, {
    cases: db.prepare("SELECT id,title,status FROM cases WHERE deleted_at IS NULL AND (title LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\') ORDER BY updated_at DESC LIMIT 5").all(t, t),
    evidence: db.prepare("SELECT e.id,e.original_filename,e.category FROM evidence e JOIN cases c ON c.id=e.case_id WHERE e.deleted_at IS NULL AND c.deleted_at IS NULL AND (e.original_filename LIKE ? ESCAPE '\\' OR e.id LIKE ? ESCAPE '\\' OR e.sha256 LIKE ? ESCAPE '\\') LIMIT 5").all(t, t, t)
  });
}));

module.exports = router;
