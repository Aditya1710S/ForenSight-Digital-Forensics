'use strict';
const fs = require('fs');
const path = require('path');

const PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const IMAGE_BRANDS = ['heic', 'heix', 'hevc', 'avif', 'mif1', 'msf1'];
const EXT_FORMAT = { '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.webp': 'webp', '.mp4': 'mp4', '.mov': 'mov', '.webm': 'webm' };

/** Identify a file by its magic bytes. Returns null for unsupported signatures. */
async function detectType(filePath) {
  const fd = await fs.promises.open(filePath, 'r');
  const b = Buffer.alloc(32);
  let n = 0;
  try { ({ bytesRead: n } = await fd.read(b, 0, 32, 0)); } finally { await fd.close(); }
  if (n < 12) return null;
  const a = (s, e) => b.toString('latin1', s, e);
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return { category: 'image', format: 'jpeg', mime: 'image/jpeg', ext: '.jpg' };
  if (b.subarray(0, 8).equals(PNG)) return { category: 'image', format: 'png', mime: 'image/png', ext: '.png' };
  if (a(0, 4) === 'RIFF' && a(8, 12) === 'WEBP') return { category: 'image', format: 'webp', mime: 'image/webp', ext: '.webp' };
  if (a(4, 8) === 'ftyp') {
    const brand = a(8, 12);
    if (IMAGE_BRANDS.includes(brand)) return null;
    if (brand === 'qt  ') return { category: 'video', format: 'mov', mime: 'video/quicktime', ext: '.mov' };
    return { category: 'video', format: 'mp4', mime: 'video/mp4', ext: '.mp4' };
  }
  if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return { category: 'video', format: 'webm', mime: 'video/webm', ext: '.webm' };
  return null;
}

const declaredFormat = originalName => EXT_FORMAT[path.extname(String(originalName)).toLowerCase()] || null;
const declaredCategory = originalName => { const f = declaredFormat(originalName); return f ? (['jpeg', 'png', 'webp'].includes(f) ? 'image' : 'video') : null; };

module.exports = { detectType, declaredFormat, declaredCategory };
