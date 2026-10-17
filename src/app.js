import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { errorHandler } from './errorHandler.js';
import { createAffiliationRouter } from './affiliation/routes.js';
import { createReferralRouter } from './referrals/routes.js';

const publicDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
);

// Optional dependencies:
// - affiliationStore: the Program/affiliation data store (see
//   src/affiliation/memoryStore.js for the contract). No Azure SQL store
//   exists yet; without one, /api routes answer 503.
// - referralStore: the referral data store (see
//   src/referrals/memoryReferralStore.js for the contract). In production
//   one Azure SQL store will serve as both stores.
// - resolveIdentity(req) -> { userId } | null: supplied by the future Entra
//   sign-in. Without one, /api routes answer 401 (fail closed).
// - allowDemoGrants: honor DEMO permission grants. Defaults to false, so
//   demo access fails closed unless a non-production caller turns it on.
export function createApp({ affiliationStore, referralStore, resolveIdentity, allowDemoGrants = false } = {}) {
  const app = express();

  // Don't advertise the framework or its version.
  app.disable('x-powered-by');

  // Availability only. No config, no secrets, no version, no environment.
  app.get('/health', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.status(200).json({ status: 'ok' });
  });

  app.use(
    '/api/referrals',
    createReferralRouter({ store: referralStore, resolveIdentity, allowDemoGrants }),
  );

  app.use(
    '/api',
    createAffiliationRouter({ store: affiliationStore, resolveIdentity }),
  );

  app.use(express.static(publicDir));

  // Must be registered last. Express's default handler includes stack
  // traces when NODE_ENV is not 'production' (PRD 15.4), so we replace it.
  app.use(errorHandler);

  return app;
}
