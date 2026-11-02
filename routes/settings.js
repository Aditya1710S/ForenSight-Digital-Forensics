'use strict';
const express = require('express');
const config = require('../config');
const { asyncHandler, ok, HttpError } = require('../utils/errors');
const settings = require('../services/settingsService');
const audit = require('../services/auditService');
const videoService = require('../services/videoService');
const metadataService = require('../services/metadataService');

const router = express.Router();

async function snapshot() {
  return {
    investigatorAlias: settings.getActor(),
    contactSheetMaxFrames: settings.getContactSheetMax(),
    readOnly: { maxUploadMb: Math.round(config.maxUploadBytes / 1048576), demoMode: config.demoMode, allowedExtensions: config.allowedExtensions, processTimeoutMs: config.limits.processTimeoutMs, maxConcurrentJobs: config.limits.maxConcurrentJobs, contactSheetHardLimit: config.limits.maxContactSheetFrames },
    tools: { ...(await videoService.checkTools()), exiftool: await metadataService.exifToolStatus() }
  };
}

router.get('/', asyncHandler(async (req, res) => ok(res, await snapshot())));

router.put('/', asyncHandler(async (req, res) => {
  const b = req.body || {}; const errors = {}; const changes = [];
  if (b.investigatorAlias !== undefined) {
    const v = String(b.investigatorAlias).trim();
    if (!/^[\p{L}\p{N} ._@-]{2,60}$/u.test(v)) errors.investigatorAlias = 'Alias must be 2-60 characters (letters, numbers, space, . _ @ -).';
    else changes.push(['investigator_alias', v]);
  }
  if (b.contactSheetMaxFrames !== undefined) {
    const n = Number(b.contactSheetMaxFrames);
    if (!Number.isInteger(n) || n < 2 || n > config.limits.maxContactSheetFrames) errors.contactSheetMaxFrames = `Must be an integer from 2 to ${config.limits.maxContactSheetFrames}.`;
    else changes.push(['contact_sheet_max_frames', n]);
  }
  if (Object.keys(errors).length) throw new HttpError(400, 'Validation failed.', 'validation_error', errors);
  if (!changes.length) throw new HttpError(400, 'No settings supplied.', 'validation_error');
  changes.forEach(([k, v]) => settings.set(k, v));
  audit.record({ type: 'settings.updated', description: `Settings updated: ${changes.map(c => c[0]).join(', ')}.` });
  ok(res, await snapshot());
}));

module.exports = router;
