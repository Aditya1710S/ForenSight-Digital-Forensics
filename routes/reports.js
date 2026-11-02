'use strict';
const express = require('express');
const { asyncHandler, HttpError } = require('../utils/errors');
const { requireId } = require('../utils/ids');
const { getDb } = require('../database/init');
const reports = require('../services/reportService');
const evidenceService = require('../services/evidenceService');
const audit = require('../services/auditService');

const router = express.Router();
const fmt = req => { const f = String(req.query.format || 'pdf').toLowerCase(); if (!['pdf', 'json'].includes(f)) throw new HttpError(400, 'format must be pdf or json.', 'validation_error'); return f; };
function send(res, f, name, payload) {
  if (f === 'json') { res.attachment(`${name}.json`); res.type('application/json').send(JSON.stringify(payload, null, 2)); }
  else { res.attachment(`${name}.pdf`); res.type('application/pdf').send(payload); }
}

router.get('/reports/case/:caseId', asyncHandler(async (req, res) => {
  const id = requireId('CASE', req.params.caseId, 'case id'); const f = fmt(req);
  const payload = f === 'json' ? reports.caseJson(id) : await reports.casePdf(id);
  audit.record({ caseId: id, type: 'report.exported', description: `Case report exported (${f.toUpperCase()}).` });
  send(res, f, `case-report-${id}`, payload);
}));

router.get('/evidence/:id/report', asyncHandler(async (req, res) => {
  const ev = evidenceService.getEvidence(requireId('EVD', req.params.id, 'evidence id')); const f = fmt(req);
  const payload = f === 'json' ? reports.evidenceJson(ev) : await reports.evidencePdf(ev);
  audit.record({ caseId: ev.case_id, evidenceId: ev.id, type: 'report.exported', description: `Evidence report exported (${f.toUpperCase()}).` });
  send(res, f, `evidence-report-${ev.id}`, payload);
}));

router.get('/verifications/:id/report', asyncHandler(async (req, res) => {
  const id = requireId('VER', req.params.id, 'verification id'); const f = fmt(req);
  const j = reports.verificationJson(id);
  const payload = f === 'json' ? j : await reports.verificationPdf(id);
  audit.record({ caseId: j.evidence.case_id, evidenceId: j.evidence.id, type: 'report.exported', description: `Integrity verification report ${id} exported (${f.toUpperCase()}).` });
  send(res, f, `verification-report-${id}`, payload);
}));

module.exports = router;
