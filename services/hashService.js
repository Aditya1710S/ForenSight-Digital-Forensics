'use strict';
const crypto = require('crypto');
const fs = require('fs');

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(filePath);
    s.on('error', reject);
    s.on('data', d => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
  });
}
const isSha256Hex = v => typeof v === 'string' && /^[a-fA-F0-9]{64}$/.test(v);
function equalHex(a, b) {
  if (!isSha256Hex(a) || !isSha256Hex(b)) return false;
  return crypto.timingSafeEqual(Buffer.from(a.toLowerCase(), 'hex'), Buffer.from(b.toLowerCase(), 'hex'));
}
module.exports = { sha256File, isSha256Hex, equalHex };
