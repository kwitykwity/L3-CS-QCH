import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { errorHandler } from './errorHandler.js';

const publicDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
);

export function createApp() {
  const app = express();

  // Don't advertise the framework or its version.
  app.disable('x-powered-by');

  // Availability only. No config, no secrets, no version, no environment.
  app.get('/health', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.status(200).json({ status: 'ok' });
  });

  app.use(express.static(publicDir));

  // Must be registered last. Express's default handler includes stack
  // traces when NODE_ENV is not 'production' (PRD 15.4), so we replace it.
  app.use(errorHandler);

  return app;
}
