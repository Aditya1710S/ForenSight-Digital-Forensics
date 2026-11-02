'use strict';
const fs = require('fs');
const sharp = require('sharp');
const metadataService = require('./metadataService');

const open = p => sharp(p, { failOn: 'error' });

/** Confirms a real image parser can decode the file. Used at upload time. */
async function verifyParsable(filePath) {
  try { const m = await open(filePath).metadata(); await open(filePath).stats(); return { ok: !!(m.width && m.height) }; }
  catch (e) { return { ok: false, message: 'The image could not be decoded by the image parser.' }; }
}

async function tailBytes(filePath, n = 1024 * 1024) {
  const { size } = await fs.promises.stat(filePath);
  const len = Math.min(size, n);
  const fd = await fs.promises.open(filePath, 'r');
  try { const b = Buffer.alloc(len); await fd.read(b, 0, len, size - len); return { buf: b, len, size }; } finally { await fd.close(); }
}

async function structuralIndicators(filePath, format) {
  const out = [];
  try {
    const { buf, len } = await tailBytes(filePath);
    if (format === 'jpeg') {
      const i = buf.lastIndexOf(Buffer.from([0xFF, 0xD9]));
      if (i === -1) out.push({ level: 'Warning', code: 'jpeg_no_eoi', title: 'No JPEG end-of-image marker in the last 1 MB', explanation: 'The file may be truncated or have a large trailer. Some parsers still decode it.' });
      else if (len - (i + 2) > 0) out.push({ level: 'Warning', code: 'jpeg_trailing_data', title: `${len - (i + 2)} byte(s) follow the final JPEG end-of-image marker`, explanation: 'Extra bytes can be harmless (camera trailers, thumbnails) or appended data. This is an indicator for review, not proof of manipulation.' });
    } else if (format === 'png') {
      const i = buf.lastIndexOf(Buffer.from('IEND', 'latin1'));
      if (i === -1) out.push({ level: 'Warning', code: 'png_no_iend', title: 'No PNG IEND chunk in the last 1 MB', explanation: 'The file may be truncated or have a large trailer.' });
      else if (len - (i + 8) > 0) out.push({ level: 'Warning', code: 'png_trailing_data', title: `${len - (i + 8)} byte(s) follow the PNG IEND chunk`, explanation: 'Data after IEND is ignored by decoders. It can be benign or appended content; review further.' });
    }
  } catch { out.push({ level: 'Informational', code: 'structure_unchecked', title: 'Structural tail check could not be performed', explanation: 'The stored file could not be read for the structural check.' }); }
  return out;
}

async function analyze(filePath, evidence) {
  const indicators = [];
  const result = {
    kind: 'image',
    validation: { status: 'valid', parser: 'sharp', message: 'Decoded successfully by the image parser.' },
    file: { format: evidence.detected_format, mime: evidence.mime_type, sizeBytes: evidence.size_bytes, sha256: evidence.sha256 },
    image: null, metadata: null, indicators,
    limitations: 'Indicators are preliminary and heuristic. Missing or unusual metadata is common for legitimate files and is not proof of manipulation.'
  };
  let meta = {};
  try {
    meta = await open(filePath).metadata();
    await open(filePath).stats();
    result.file.width = meta.width; result.file.height = meta.height; result.file.parserFormat = meta.format;
    result.image = { colourSpace: meta.space, channels: meta.channels, bitDepth: meta.depth, density: meta.density || null, hasAlpha: !!meta.hasAlpha, orientation: meta.orientation || null, hasExifBlock: !!meta.exif, hasIccProfile: !!meta.icc, isProgressive: !!meta.isProgressive };
  } catch (e) {
    result.validation = { status: 'invalid', parser: 'sharp', message: 'The image parser reported an error while decoding this file.' };
    indicators.push({ level: 'Error', code: 'decode_failed', title: 'Image could not be fully decoded', explanation: 'The parser failed. The file may be corrupt, truncated or not a standard image.' });
  }
  if (meta.format && meta.format !== evidence.detected_format && !(meta.format === 'jpeg' && evidence.detected_format === 'jpeg')) {
    indicators.push({ level: 'Warning', code: 'parser_format_mismatch', title: `Parser reports "${meta.format}" but the signature says "${evidence.detected_format}"`, explanation: 'Format detection disagrees between layers.' });
  }
  if (evidence.format_mismatch) indicators.push({ level: 'Warning', code: 'extension_mismatch', title: 'File extension does not match the detected format', explanation: `The uploaded filename suggested ${evidence.declared_ext || 'a different type'} but the content is ${evidence.detected_format}. Extensions are easy to change and are not trusted.` });

  result.metadata = await metadataService.extract(filePath, meta);
  const m = result.metadata;
  if (m.status === 'none_found') indicators.push({ level: 'Informational', code: 'no_metadata', title: 'No embedded metadata found', explanation: 'Many legitimate images (screenshots, messaging apps, social platforms) carry no EXIF. This does not indicate tampering.' });
  if (m.status === 'error') indicators.push({ level: 'Warning', code: 'metadata_error', title: 'Metadata extraction reported an error', explanation: m.message || 'Metadata could not be read.' });
  if (m.software) indicators.push({ level: 'Informational', code: 'software_tag', title: `Software tag present: ${m.software}`, explanation: 'The Software field names the application that last wrote metadata. Editing software and camera firmware both appear here; the value is unverified.' });
  if (m.gps) indicators.push({ level: 'Informational', code: 'gps_present', title: 'GPS coordinates are embedded in this file', explanation: 'Shown only because they exist in the file. They are self-reported by the device or software and may be wrong or altered. Nothing was sent to any external service.' });
  const dO = metadataService.parseExifDate(m.dates.original), dM = metadataService.parseExifDate(m.dates.modified), dC = metadataService.parseExifDate(m.dates.created);
  if (dO && dM && dM < dO) indicators.push({ level: 'Warning', code: 'date_order', title: 'Modify date is earlier than original capture date', explanation: 'Metadata timestamps are inconsistent. This can come from clock errors or editing tools.' });
  if (dO && dC && Math.abs(dC - dO) > 24 * 3600 * 1000) indicators.push({ level: 'Informational', code: 'date_gap', title: 'Create date and original date differ by more than a day', explanation: 'May be benign (scanned or imported files).' });
  const now = Date.now() + 24 * 3600 * 1000;
  if ([dO, dM, dC].some(d => d && d > now)) indicators.push({ level: 'Warning', code: 'future_date', title: 'A metadata timestamp lies in the future', explanation: 'Compared against the server clock. Could be a device clock or timezone issue.' });
  indicators.push(...await structuralIndicators(filePath, evidence.detected_format));
  if (!indicators.some(i => i.level !== 'Informational')) indicators.push({ level: 'Informational', code: 'no_findings', title: 'No warnings from the available checks', explanation: 'This does not establish authenticity. Only a limited set of checks is performed.' });
  return result;
}

/** Writes a derived copy (never touches the original). Modes are for visual inspection only. */
async function derive(filePath, mode, outPath) {
  let img = open(filePath);
  if (mode === 'preview') img = img.resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true });
  else if (mode === 'grayscale') img = img.grayscale();
  else if (mode === 'contrast') img = img.normalise();
  else throw new Error('unknown derive mode');
  await img.png().toFile(outPath);
}
const DERIVE_MODES = ['preview', 'grayscale', 'contrast'];

module.exports = { analyze, derive, verifyParsable, DERIVE_MODES };
