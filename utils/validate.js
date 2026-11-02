'use strict';
const { HttpError } = require('./errors');

const STATUSES = ['Open', 'In Progress', 'Closed'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
const clean = v => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();

function validateCase(body, { partial = false } = {}) {
  const errors = {}; const out = {};
  const b = body && typeof body === 'object' ? body : {};
  const has = k => b[k] !== undefined;
  if (!partial || has('title')) {
    const v = clean(b.title);
    if (v.length < 3 || v.length > 120) errors.title = 'Title must be 3-120 characters.'; else out.title = v;
  }
  if (!partial || has('description')) {
    const v = clean(b.description);
    if (v.length > 2000) errors.description = 'Description must be at most 2000 characters.'; else out.description = v;
  }
  if (has('investigator') || !partial) {
    const v = clean(b.investigator);
    if (v && !/^[\p{L}\p{N} ._@-]{2,60}$/u.test(v)) errors.investigator = 'Investigator must be 2-60 characters (letters, numbers, space, . _ @ -).';
    else if (v) out.investigator = v;
  }
  if (!partial || has('status')) {
    const v = b.status === undefined ? 'Open' : b.status;
    if (!STATUSES.includes(v)) errors.status = `Status must be one of: ${STATUSES.join(', ')}.`; else out.status = v;
  }
  if (!partial || has('priority')) {
    const v = b.priority === undefined ? 'Medium' : b.priority;
    if (!PRIORITIES.includes(v)) errors.priority = `Priority must be one of: ${PRIORITIES.join(', ')}.`; else out.priority = v;
  }
  if (Object.keys(errors).length) throw new HttpError(400, 'Validation failed.', 'validation_error', errors);
  return out;
}

function pageParams(q, { defSize = 10, maxSize = 100 } = {}) {
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, parseInt(q.pageSize, 10) || defSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

const likeTerm = s => '%' + clean(s).slice(0, 100).replace(/[\\%_]/g, m => '\\' + m) + '%';

function safeFilename(name) {
  const base = String(name || 'file').split(/[\\/]/).pop();
  const c = clean(base).replace(/[<>:"|?*]/g, '_').slice(0, 200);
  return c || 'file';
}

module.exports = { validateCase, pageParams, likeTerm, clean, safeFilename, STATUSES, PRIORITIES };
