// 'use strict';
// const config = require('./config');
// const { createApp } = require('./app');

// const app = createApp();
// (async () => {
//   if (config.demoMode) { try { await require('./database/demo').seedDemo(); console.log('DEMO_MODE: synthetic demo records are present.'); } catch (e) { console.error('Demo seed failed:', e.message); } }
//   const server = app.listen(config.port, config.host, () => {
//     console.log(`ForenSight running at http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
//     console.log('Intended for a trusted local environment. Handle evidence only with proper authorization.');
//     if (!['127.0.0.1', 'localhost', '::1'].includes(config.host)) console.warn('WARNING: HOST is not loopback. Do not expose this application publicly.');
//   });
//   server.requestTimeout = 10 * 60 * 1000;
//   const stop = () => server.close(() => process.exit(0));
//   process.on('SIGINT', stop); process.on('SIGTERM', stop);
// })();

'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');

const config = require('./config');
const { createApp } = require('./app');

const app = createApp();

// Public assets directory
const publicDir = path.join(__dirname, 'public');

// Vendor libraries
const vendorDir = path.join(publicDir, 'vendor');

// Check required frontend files
const requiredFiles = [
  path.join(vendorDir, 'chart.umd.js'),
  path.join(publicDir, 'js', 'app.js'),
  path.join(publicDir, 'index.html')
];

console.log('\nChecking frontend assets...');

requiredFiles.forEach(file => {
  if (fs.existsSync(file)) {
    console.log('OK:', path.relative(__dirname, file));
  } else {
    console.error('MISSING:', path.relative(__dirname, file));
  }
});

// Serve static frontend assets
// If createApp() already configures static serving,
// avoid adding duplicate middleware.
app.use(express.static(publicDir, {
  index: 'index.html',
  extensions: ['html'],
  maxAge: '1h',
  etag: true
}));

// Explicit Chart.js availability check
app.get('/api/health/charts', (req, res) => {
  const chartPath = path.join(vendorDir, 'chart.umd.js');

  res.json({
    success: fs.existsSync(chartPath),
    chartLibrary: 'Chart.js',
    installed: fs.existsSync(chartPath),
    url: '/vendor/chart.umd.js'
  });
});

let server;

async function startServer() {
  try {
    // Seed synthetic demo data only when enabled
    if (config.demoMode) {
      try {
        await require('./database/demo').seedDemo();
        console.log('DEMO_MODE: synthetic demo records are present.');
      } catch (error) {
        console.error('Demo seed failed:', error.message);
      }
    }

    server = app.listen(
      config.port,
      config.host,
      () => {
        const displayHost =
          config.host === '0.0.0.0' ? 'localhost' : config.host;

        console.log('\n================================');
        console.log(' ForenSight Digital Forensics');
        console.log('================================');
        console.log(`Dashboard: http://${displayHost}:${config.port}`);
        console.log(`Chart.js:  http://${displayHost}:${config.port}/vendor/chart.umd.js`);
        console.log(`Health:    http://${displayHost}:${config.port}/api/health/charts`);
        console.log('================================');
        console.log(
          'Intended for a trusted local environment.'
        );
        console.log(
          'Handle evidence only with proper authorization.'
        );

        if (
          !['127.0.0.1', 'localhost', '::1'].includes(config.host)
        ) {
          console.warn(
            'WARNING: HOST is not loopback. Do not expose this application publicly.'
          );
        }
      }
    );

    server.requestTimeout = 10 * 60 * 1000;

    server.on('error', error => {
      console.error('Server error:', error.message);
      process.exitCode = 1;
    });

  } catch (error) {
    console.error('Application startup failed:', error);
    process.exitCode = 1;
  }
}

// Graceful shutdown
function stopServer() {
  if (!server || !server.listening) {
    process.exit(0);
    return;
  }

  console.log('\nShutting down ForenSight...');

  server.close(() => {
    console.log('Server stopped successfully.');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGINT', stopServer);
process.on('SIGTERM', stopServer);

startServer();
