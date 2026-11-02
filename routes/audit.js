'use strict';
const express = require('express');
const { asyncHandler, ok } = require('../utils/errors');
const { pageParams } = require('../utils/validate');
const { requireId } = require('../utils/ids');
const audit = require('../services/auditService');
const { getDb } = require('../database/init');

const router = express.Router();
// Read-only by design: there is no PUT/PATCH/DELETE for audit events.
router.get('/', asyncHandler(async (req, res) => {
  const { page, pageSize, offset } = pageParams(req.query, { defSize: 25 });
  const caseId = req.query.caseId ? requireId('CASE', req.query.caseId, 'case id') : undefined;
  const evidenceId = req.query.evidenceId ? requireId('EVD', req.query.evidenceId, 'evidence id') : undefined;
  const type = req.query.type ? String(req.query.type).slice(0, 60) : undefined;
  const r = audit.list({ offset, pageSize, type, caseId, evidenceId, q: req.query.q });
  ok(res, { ...r, page, pageSize });
}));
router.get('/types', asyncHandler(async (req, res) => ok(res, getDb().prepare('SELECT DISTINCT event_type FROM audit_events ORDER BY event_type').all().map(r => r.event_type))));
router.get('/verify-chain', asyncHandler(async (req, res) => ok(res, audit.verifyChain())));
module.exports = router;
