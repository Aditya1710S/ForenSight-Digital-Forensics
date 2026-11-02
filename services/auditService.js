'use strict';
const crypto = require('crypto');
const { getDb } = require('../database/init');
const { newId } = require('../utils/ids');
const { likeTerm } = require('../utils/validate');
const settings = require('./settingsService');

const GENESIS = '0'.repeat(64);
const canonical = e => JSON.stringify([e.event_id, e.case_id, e.evidence_id, e.event_type, e.timestamp, e.actor, e.description, e.status]);
const hashOf = (prev, e) => crypto.createHash('sha256').update(prev + '|' + canonical(e)).digest('hex');

/** Append one event. node:sqlite is synchronous, so the read-last-hash/insert pair cannot interleave. */
function record({ caseId = null, evidenceId = null, type, description, status = 'success', actor }) {
  const db = getDb();
  const e = {
    event_id: newId('AUD'), case_id: caseId, evidence_id: evidenceId, event_type: type,
    timestamp: new Date().toISOString(), actor: actor || settings.getActor(),
    description: String(description).slice(0, 1000), status
  };
  db.exec('BEGIN IMMEDIATE');
  try {
    const last = db.prepare('SELECT event_hash FROM audit_events ORDER BY seq DESC LIMIT 1').get();
    const prev = last ? last.event_hash : GENESIS;
    const hash = hashOf(prev, e);
    db.prepare(`INSERT INTO audit_events(event_id,case_id,evidence_id,event_type,timestamp,actor,description,status,prev_hash,event_hash)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(e.event_id, e.case_id, e.evidence_id, e.event_type, e.timestamp, e.actor, e.description, e.status, prev, hash);
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  return e;
}

function list({ offset = 0, pageSize = 25, type, caseId, evidenceId, q } = {}) {
  const where = []; const p = [];
  if (type) { where.push('event_type = ?'); p.push(type); }
  if (caseId) { where.push('case_id = ?'); p.push(caseId); }
  if (evidenceId) { where.push('evidence_id = ?'); p.push(evidenceId); }
  if (q) { where.push("(description LIKE ? ESCAPE '\\' OR actor LIKE ? ESCAPE '\\' OR event_id LIKE ? ESCAPE '\\')"); const t = likeTerm(q); p.push(t, t, t); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const db = getDb();
  const total = db.prepare(`SELECT COUNT(*) c FROM audit_events ${w}`).get(...p).c;
  const items = db.prepare(`SELECT seq,event_id,case_id,evidence_id,event_type,timestamp,actor,description,status,event_hash
    FROM audit_events ${w} ORDER BY seq DESC LIMIT ? OFFSET ?`).all(...p, pageSize, offset);
  return { items, total };
}

function forEntity({ caseId, evidenceId, limit = 200 }) {
  const db = getDb();
  if (evidenceId) return db.prepare('SELECT event_id,case_id,evidence_id,event_type,timestamp,actor,description,status FROM audit_events WHERE evidence_id = ? ORDER BY seq ASC LIMIT ?').all(evidenceId, limit);
  return db.prepare('SELECT event_id,case_id,evidence_id,event_type,timestamp,actor,description,status FROM audit_events WHERE case_id = ? ORDER BY seq ASC LIMIT ?').all(caseId, limit);
}

/** Recompute the whole hash chain. Detects edits made outside the application, not a rewrite of the entire chain. */
function verifyChain() {
  const rows = getDb().prepare('SELECT * FROM audit_events ORDER BY seq ASC').all();
  let prev = GENESIS;
  for (const r of rows) {
    if (r.prev_hash !== prev || hashOf(prev, r) !== r.event_hash) {
      return { valid: false, checked: rows.length, brokenAtSeq: r.seq, brokenEventId: r.event_id };
    }
    prev = r.event_hash;
  }
  return { valid: true, checked: rows.length, headHash: prev };
}

module.exports = { record, list, forEntity, verifyChain, GENESIS };
