'use strict';
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const config = require('../config');
const { randomName } = require('../utils/ids');
const { HttpError } = require('../utils/errors');
const { detectType, declaredCategory } = require('../utils/fileSignature');
const imageService = require('../services/imageService');
const videoService = require('../services/videoService');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.storage.temporary),
  filename: (req, file, cb) => cb(null, randomName('.upload')) // never trust the client filename
});

const upload = multer({
  storage, defParamCharset: 'utf8',
  limits: { fileSize: config.maxUploadBytes, files: 1, fields: 10, fieldSize: 10 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!config.allowedExtensions.includes(ext)) return cb(new HttpError(415, 'Unsupported file type. Allowed: JPG, JPEG, PNG, WebP, MP4, MOV, WebM.', 'unsupported_type'));
    if (!config.allowedMimes.includes(file.mimetype)) return cb(new HttpError(415, 'Unsupported MIME type for this upload.', 'unsupported_mime'));
    cb(null, true);
  }
});

const discard = p => p && fs.promises.unlink(p).catch(() => {});

/** After multer: verify magic bytes and that a real parser accepts the file. Sets req.detected. */
async function validateUploadedFile(req, res, next) {
  const f = req.file;
  try {
    if (!f) throw new HttpError(400, 'No file was uploaded (use the multipart field "file").', 'no_file');
    if (f.size === 0) throw new HttpError(422, 'The uploaded file is empty.', 'empty_file');
    const detected = await detectType(f.path);
    if (!detected) throw new HttpError(415, 'The file content is not a supported JPG, PNG, WebP, MP4, MOV or WebM file (signature check failed).', 'bad_signature');
    const declared = declaredCategory(f.originalname);
    if (declared && declared !== detected.category) throw new HttpError(422, `The file extension says ${declared} but the content is ${detected.category}.`, 'category_mismatch');
    const parsed = detected.category === 'image' ? await imageService.verifyParsable(f.path) : await videoService.verifyParsable(f.path);
    if (!parsed.ok) throw new HttpError(422, parsed.message || 'The file is malformed and could not be parsed.', 'malformed_file');
    req.detected = detected; req.parseSkipped = !!parsed.skipped;
    next();
  } catch (e) { await discard(f && f.path); next(e); }
}

module.exports = { upload, validateUploadedFile, discard };
