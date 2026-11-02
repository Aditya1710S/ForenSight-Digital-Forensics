'use strict';
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
try { process.loadEnvFile(path.join(root, '.env')); } catch { /* no .env file: use defaults */ }

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
const base = path.resolve(root, process.env.STORAGE_DIR || 'storage');
const dbRaw = process.env.DB_PATH || 'database/forensight.db';

const config = {
  root,
  host: process.env.HOST || '127.0.0.1',
  port: num(process.env.PORT, 3000),
  allowedHosts: (process.env.ALLOWED_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  maxUploadBytes: num(process.env.MAX_UPLOAD_MB, 100) * 1024 * 1024,
  demoMode: String(process.env.DEMO_MODE).toLowerCase() === 'true',
  defaultActor: process.env.DEFAULT_ACTOR || 'local-investigator',
  dbPath: dbRaw === ':memory:' ? dbRaw : path.resolve(root, dbRaw),
  storage: {
    base,
    originals: path.join(base, 'originals'),
    derived: path.join(base, 'derived'),
    temporary: path.join(base, 'temporary')
  },
  tools: {
    ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg',
    ffprobe: process.env.FFPROBE_PATH || 'ffprobe',
    exiftool: process.env.EXIFTOOL_PATH || 'exiftool'
  },
  limits: {
    processTimeoutMs: num(process.env.PROCESS_TIMEOUT_MS, 60000),
    maxConcurrentJobs: num(process.env.MAX_CONCURRENT_JOBS, 2),
    maxContactSheetFrames: num(process.env.MAX_CONTACT_SHEET_FRAMES, 12),
    maxDerivedBytes: 50 * 1024 * 1024,
    maxToolOutputBytes: 8 * 1024 * 1024
  },
  allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.mov', '.webm'],
  allowedMimes: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']
};

config.ensureDirs = () => {
  for (const d of Object.values(config.storage)) fs.mkdirSync(d, { recursive: true });
  if (config.dbPath !== ':memory:') fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
};

module.exports = config;
