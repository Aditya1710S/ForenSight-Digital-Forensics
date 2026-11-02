'use strict';
const crypto = require('crypto');
const { HttpError } = require('./errors');

const newId = prefix => `${prefix}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
const randomName = (ext = '') => crypto.randomBytes(24).toString('hex') + ext;
const STORED_RE = /^[a-f0-9]{48}\.(jpg|png|webp|mp4|mov|webm)$/;

function requireId(prefix, value, label = 'id') {
  if (typeof value !== 'string' || !new RegExp(`^${prefix}-[0-9A-F]{12}$`).test(value)) {
    throw new HttpError(400, `Invalid ${label}.`, 'invalid_id');
  }
  return value;
}
module.exports = { newId, randomName, requireId, STORED_RE };
