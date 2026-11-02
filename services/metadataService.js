'use strict';
const { execFile } = require('child_process');
const config = require('../config');

const NOISE = new Set(['SourceFile', 'Directory', 'FileName', 'FilePermissions', 'FileAccessDate', 'FileCreateDate', 'FileModifyDate', 'FileInodeChangeDate', 'ExifToolVersion']);
let exifToolState = null;

function runExifTool(args) {
  return new Promise((resolve, reject) => {
    execFile(config.tools.exiftool, args, { timeout: config.limits.processTimeoutMs, maxBuffer: config.limits.maxToolOutputBytes, windowsHide: true },
      (err, stdout) => err ? reject(err) : resolve(stdout));
  });
}

async function exifToolStatus() {
  if (exifToolState && Date.now() - exifToolState.at < 30000) return exifToolState.value;
  let value;
  try { value = { available: true, version: (await runExifTool(['-ver'])).trim() }; }
  catch { value = { available: false, version: null }; }
  exifToolState = { at: Date.now(), value };
  return value;
}

// ---- Minimal built-in EXIF reader (fallback when ExifTool is not installed) ----
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
function parseExif(buf) {
  try {
    const off = buf.subarray(0, 6).toString('latin1') === 'Exif\0\0' ? 6 : 0;
    const t = buf.subarray(off);
    const order = t.toString('latin1', 0, 2);
    if (order !== 'II' && order !== 'MM') return null;
    const le = order === 'II';
    const u16 = o => le ? t.readUInt16LE(o) : t.readUInt16BE(o);
    const u32 = o => le ? t.readUInt32LE(o) : t.readUInt32BE(o);
    const readVal = (type, cnt, o) => {
      if (type === 2) return t.toString('latin1', o, o + cnt).replace(/\0+$/, '');
      const vals = [];
      for (let i = 0; i < Math.min(cnt, 16); i++) {
        if (type === 3) vals.push(u16(o + i * 2));
        else if (type === 4) vals.push(u32(o + i * 4));
        else if (type === 5) { const d = u32(o + i * 8 + 4); vals.push(d ? u32(o + i * 8) / d : 0); }
        else vals.push(t[o + i]);
      }
      return vals.length === 1 ? vals[0] : vals;
    };
    const readIfd = o => {
      const out = {}; const n = Math.min(u16(o), 200);
      for (let i = 0; i < n; i++) {
        const e = o + 2 + i * 12;
        const tag = u16(e), type = u16(e + 2), cnt = u32(e + 4);
        const size = (TYPE_SIZE[type] || 1) * cnt;
        const vo = size > 4 ? u32(e + 8) : e + 8;
        if (vo + size > t.length) continue;
        out[tag] = readVal(type, cnt, vo);
      }
      return out;
    };
    const ifd0 = readIfd(u32(4));
    const exif = ifd0[0x8769] ? readIfd(ifd0[0x8769]) : {};
    const gps = ifd0[0x8825] ? readIfd(ifd0[0x8825]) : {};
    const out = { Make: ifd0[0x10F], Model: ifd0[0x110], Software: ifd0[0x131], ModifyDate: ifd0[0x132], DateTimeOriginal: exif[0x9003], CreateDate: exif[0x9004] };
    const dms = (v, ref) => {
      if (!Array.isArray(v) || v.length < 3) return null;
      const d = v[0] + v[1] / 60 + v[2] / 3600;
      return ref === 'S' || ref === 'W' ? -d : d;
    };
    const lat = dms(gps[2], gps[1]); const lon = dms(gps[4], gps[3]);
    if (lat !== null && lon !== null) { out.GPSLatitude = lat; out.GPSLongitude = lon; }
    for (const k of Object.keys(out)) if (out[k] === undefined || out[k] === '') delete out[k];
    return out;
  } catch { return null; }
}

const str = v => String(v).slice(0, 500);
const parseExifDate = s => {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(s || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
};

/** Returns a normalised metadata block. Missing metadata is a normal outcome, not evidence of tampering. */
async function extract(filePath, sharpMeta = {}) {
  let raw = null; let source = 'none'; let status = 'none_found'; let message = null;
  const tool = await exifToolStatus();
  if (tool.available) {
    try {
      const out = await runExifTool(['-j', '-n', filePath]);
      raw = JSON.parse(out)[0] || {};
      for (const k of Object.keys(raw)) if (NOISE.has(k)) delete raw[k];
      source = 'exiftool';
    } catch (e) { status = 'error'; message = 'ExifTool failed: ' + (e.killed ? 'timed out' : 'could not read the file'); }
  }
  if (!raw && sharpMeta.exif) {
    raw = parseExif(sharpMeta.exif);
    if (raw) source = 'builtin-exif';
    if (!tool.available) message = 'ExifTool not installed: used the limited built-in EXIF reader (IFD0/Exif/GPS basics only).';
  } else if (!raw && !tool.available) {
    message = 'ExifTool not installed and no EXIF block was found by the built-in reader.';
  }

  const fields = {};
  if (raw) for (const [k, v] of Object.entries(raw)) if (v !== null && typeof v !== 'object') fields[k] = str(v);
  const hasData = Object.keys(fields).length > 0;
  if (hasData) status = 'extracted';
  else if (status !== 'error') status = tool.available || sharpMeta.exif ? 'none_found' : 'none_found';

  const lat = Number(raw && raw.GPSLatitude), lon = Number(raw && raw.GPSLongitude);
  const gps = raw && raw.GPSLatitude !== undefined && raw.GPSLongitude !== undefined && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
    ? { latitude: lat, longitude: lon } : null;
  return {
    status, source, message, exifToolAvailable: tool.available, fields,
    camera: { make: fields.Make || null, model: fields.Model || null },
    dates: { original: fields.DateTimeOriginal || null, created: fields.CreateDate || null, modified: fields.ModifyDate || null },
    software: fields.Software || null, gps
  };
}

module.exports = { extract, exifToolStatus, parseExif, parseExifDate };
