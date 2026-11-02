'use strict';
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { initDatabase } = require('./database/init');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { HttpError, ok } = require('./utils/errors');

function createApp() {
  config.ensureDirs();
  initDatabase();
  const app = express();
  app.disable('x-powered-by');

  // Local-only guard: reject unexpected Host headers (DNS-rebinding protection).
  const okHosts = new Set(['localhost', '127.0.0.1', '[::1]', ...config.allowedHosts]);
  app.use((req, res, next) => {
    const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
    if (!okHosts.has(host)) return res.status(403).json({ ok: false, error: { code: 'bad_host', message: 'Host not allowed.' } });
    next();
  });

  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], mediaSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], upgradeInsecureRequests: null } } }));
  app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false, message: { ok: false, error: { code: 'rate_limited', message: 'Too many requests. Please slow down.' } } }));
  app.use('/api/evidence/upload', rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: true, legacyHeaders: false, message: { ok: false, error: { code: 'rate_limited', message: 'Upload limit reached. Try again later.' } } }));
  app.use(express.json({ limit: '64kb' }));

  // CSRF-style protection for a cookie-less local app: block cross-site requests and require a custom header on state-changing calls.
  app.use('/api', (req, res, next) => {
    if (req.headers['sec-fetch-site'] === 'cross-site') return next(new HttpError(403, 'Cross-site requests are not allowed.', 'forbidden'));
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'ForenSight') return next(new HttpError(403, 'Missing X-Requested-With header.', 'forbidden'));
    next();
  });

  app.get('/api/health', async (req, res) => {
    const videoService = require('./services/videoService'); const metadataService = require('./services/metadataService');
    ok(res, { status: 'ok', time: new Date().toISOString(), database: 'ok', demoMode: config.demoMode, tools: { ...(await videoService.checkTools()), exiftool: await metadataService.exifToolStatus() } });
  });
  app.use('/api/cases', require('./routes/cases'));
  app.use('/api/evidence', require('./routes/evidence'));
  app.use('/api/audit', require('./routes/audit'));
  app.use('/api/settings', require('./routes/settings'));
  app.use('/api', require('./routes/analysis'));
  app.use('/api', require('./routes/reports'));
  app.use('/api', require('./routes/dashboard'));
  app.use('/api', notFound);

  // Front-end libraries are served from node_modules through two explicit routes (no CDN, no directory browsing).
  const vendor = (urlPath, rel) => app.get(urlPath, (req, res, next) => {
    let file; try { file = require.resolve(rel); } catch { return next(new HttpError(404, 'Vendor file not installed. Run npm install.', 'not_found')); }
    res.type('application/javascript').sendFile(file, { dotfiles: 'deny' });
  });
  app.get('/vendor/chart.umd.js', (req, res, next) => {
  const file = path.join(__dirname, 'public', 'vendor', 'chart.umd.js');

  if (!fs.existsSync(file)) {
    return next(new HttpError(
      404,
      'Chart.js vendor file not found.',
      'not_found'
    ));
  }

  res.type('application/javascript').sendFile(file);
});
  vendor('/vendor/lucide.min.js', 'lucide/dist/umd/lucide.min.js');

  // Only /public is static. /storage is never exposed.
  app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'deny', index: 'index.html', maxAge: 0 }));
  app.use((req, res, next) => (req.method === 'GET' && !req.path.startsWith('/api') ? res.sendFile(path.join(__dirname, 'public', 'index.html')) : next()));
  app.use(errorHandler);
  return app;
}
module.exports = { createApp };
