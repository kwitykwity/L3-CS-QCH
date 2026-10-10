'use strict';

const path = require('node:path');
const express = require('express');
const healthRouter = require('./routes/health');

/**
 * Build the Express application. Kept separate from server.js so tests can
 * import it without opening a fixed port.
 *
 * Authorization is intentionally not implemented here. When the QCH
 * authorization matrix is confirmed, it is added as middleware/services
 * registered between the headers middleware and the routes below.
 */
function createApp() {
  const app = express();

  app.disable('x-powered-by');

  // Protected responses must not land in shared/public caches (PRD 5.5).
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.use('/health', healthRouter);
  app.use(express.static(path.join(__dirname, '..', 'public')));

  return app;
}

module.exports = { createApp };
