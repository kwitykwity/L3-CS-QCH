import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

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

  // Generic error response. Per PRD 15.4, errors must never leak stack traces;
  // Express's default handler includes them when NODE_ENV is not 'production'.
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  });

  return app;
}
