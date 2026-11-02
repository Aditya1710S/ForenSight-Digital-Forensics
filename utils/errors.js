'use strict';
class HttpError extends Error {
  constructor(status, message, code = 'error', details) {
    super(message);
    this.status = status; this.code = code; this.details = details;
  }
}
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ok = (res, data, status = 200) => res.status(status).json({ ok: true, data });
module.exports = { HttpError, asyncHandler, ok };
