'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// Isolated storage + in-memory database for every test file (set BEFORE requiring app modules).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forensight-test-'));
process.env.STORAGE_DIR = path.join(dir, 'storage');
process.env.DB_PATH = ':memory:';
process.env.DEMO_MODE = 'false';

const has = m => { try { require.resolve(m); return true; } catch { return false; } };
const hasFfmpeg = () => { try { execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } };

async function makeJpeg(file, { exif = true } = {}) {
  const sharp = require('sharp');
  let img = sharp({ create: { width: 200, height: 120, channels: 3, background: { r: 200, g: 80, b: 40 } } });
  if (exif) img = img.withExif({ IFD0: { Make: 'TestCam', Model: 'Synthetic-1', Software: 'ForenSight Tests' } });
  await img.jpeg().toFile(file);
  return file;
}
async function makePng(file) {
  await require('sharp')({ create: { width: 64, height: 64, channels: 3, background: '#336699' } }).png().toFile(file);
  return file;
}
function makeMp4(file) {
  execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x240:rate=10', '-pix_fmt', 'yuv420p', '-y', file], { stdio: 'ignore' });
  return file;
}
module.exports = { dir, has, hasFfmpeg, makeJpeg, makePng, makeMp4 };
