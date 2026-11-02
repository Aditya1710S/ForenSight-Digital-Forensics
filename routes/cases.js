'use strict';
const express = require('express');
const { getDb } = require('../database/init');
const { asyncHandler, ok, HttpError } = require('../utils/errors');
const { newId, requireId } = require('../utils/ids');
const { validateCase, pageParams, likeTerm, STATUSES, PRIORITIES } = require('../utils/validate');
const audit = require('../services/auditService');
const settings = require('../services/settingsService');
const evidenceService = require('../services/evidenceService');

const router = express.Router();
const iso = () => new Date().toISOString();

function findCase(id) {
  requireId('CASE', id, 'case id');
  const c = getDb().prepare('SELECT * FROM cases WHERE id = ?').get(id);
  if (!c || c.deleted_at) throw new HttpError(404, 'Case not found.', 'not_found');
  return c;
}

router.get('/', asyncHandler(async (req, res) => {
  const { page, pageSize, offset } = pageParams(req.query);
  const where = ['c.deleted_at IS NULL']; const p = [];
  if (req.query.status) { if (!STATUSES.includes(req.query.status)) throw new HttpError(400, 'Invalid status filter.', 'validation_error'); where.push('c.status = ?'); p.push(req.query.status); }
  if (req.query.priority) { if (!PRIORITIES.includes(req.query.priority)) throw new HttpError(400, 'Invalid priority filter.', 'validation_error'); where.push('c.priority = ?'); p.push(req.query.priority); }
  if (req.query.q) { const t = likeTerm(req.query.q); where.push("(c.title LIKE ? ESCAPE '\\' OR c.id LIKE ? ESCAPE '\\' OR c.investigator LIKE ? ESCAPE '\\' OR c.description LIKE ? ESCAPE '\\')"); p.push(t, t, t, t); }
  const w = 'WHERE ' + where.join(' AND ');
  const db = getDb();
  const total = db.prepare(`SELECT COUNT(*) c FROM cases c ${w}`).get(...p).c;
  const items = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM evidence e WHERE e.case_id = c.id AND e.deleted_at IS NULL) AS evidence_count
    FROM cases c ${w} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`).all(...p, pageSize, offset);
  ok(res, { items, total, page, pageSize });
}));

router.post('/', asyncHandler(async (req, res) => {
  const v = validateCase(req.body);
  const id = newId('CASE'); const now = iso();
  const investigator = v.investigator || settings.getActor();
  getDb().prepare('INSERT INTO cases(id,title,description,investigator,status,priority,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(id, v.title, v.description || '', investigator, v.status, v.priority, now, now);
  audit.record({ caseId: id, type: 'case.created', description: `Case "${v.title}" created (priority ${v.priority}).` });
  ok(res, findCase(id), 201);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const c = findCase(req.params.id);
  const evidence = getDb().prepare('SELECT * FROM evidence WHERE case_id = ? AND deleted_at IS NULL ORDER BY created_at DESC').all(c.id).map(evidenceService.publicEvidence);
  ok(res, { ...c, evidence, recentAudit: audit.list({ caseId: c.id, pageSize: 15 }).items });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const c = findCase(req.params.id);
  const v = validateCase(req.body, { partial: true });
  if (!Object.keys(v).length) throw new HttpError(400, 'No updatable fields supplied.', 'validation_error');
  const changed = Object.keys(v).filter(k => String(v[k]) !== String(c[k]));
  if (changed.length) {
    const next = { ...c, ...v };
    getDb().prepare('UPDATE cases SET title=?, description=?, investigator=?, status=?, priority=?, updated_at=? WHERE id=?')
      .run(next.title, next.description, next.investigator, next.status, next.priority, iso(), c.id);
    const statusNote = changed.includes('status') ? ` Status: ${c.status} -> ${v.status}.` : '';
    audit.record({ caseId: c.id, type: 'case.updated', description: `Case updated (fields: ${changed.join(', ')}).${statusNote}` });
  }
  ok(res, findCase(c.id));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const c = findCase(req.params.id);
  if (req.query.confirm !== 'true') throw new HttpError(400, 'Deleting a case requires explicit confirmation (confirm=true).', 'confirmation_required');
  const now = iso(); const db = getDb();
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE evidence SET deleted_at = ?, updated_at = ? WHERE case_id = ? AND deleted_at IS NULL').run(now, now, c.id);
    db.prepare('UPDATE cases SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, c.id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  audit.record({ caseId: c.id, type: 'case.archived', description: `Case "${c.title}" archived (soft-deleted) together with its evidence records. Files and audit history are retained.` });
  ok(res, { id: c.id, archived: true });
}));

module.exports = router;
