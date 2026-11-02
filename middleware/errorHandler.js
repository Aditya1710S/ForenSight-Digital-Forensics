'use strict';
const multer = require('multer');
const { HttpError } = require('../utils/errors');

const notFound = (req, res) => res.status(404).json({ ok: false, error: { code: 'not_found', message: 'Endpoint not found.' } });

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = 500, code = 'internal_error', message = 'An internal error occurred.', details;
  if (err instanceof HttpError) { ({ status, code, message, details } = err); }
  else if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400; code = 'upload_error';
    message = err.code === 'LIMIT_FILE_SIZE' ? 'The file exceeds the maximum upload size.' : 'The upload request was malformed.';
  } else if (err && err.type === 'entity.parse.failed') { status = 400; code = 'invalid_json'; message = 'Request body is not valid JSON.'; }
  else if (err && err.type === 'entity.too.large') { status = 413; code = 'payload_too_large'; message = 'Request body is too large.'; }
  else if (err && /SQLITE_CONSTRAINT|constraint failed/i.test(String(err.message))) { status = 409; code = 'constraint_error'; message = 'The request conflicts with existing data.'; }
  if (status >= 500) console.error(`[error] ${req.method} ${req.path}: ${err && err.message}`); // message only: no stack to clients
  if (res.headersSent) return;
  res.status(status).json({ ok: false, error: { code, message, ...(details ? { details } : {}) } });
}
module.exports = { errorHandler, notFound };
