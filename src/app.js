import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { errorHandler } from './errorHandler.js';
import { createAffiliationRouter } from './affiliation/routes.js';
import { createReferralRouter } from './referrals/routes.js';
import { createGpmeRouter } from './gpme/routes.js';
import { createReportingRouter } from './reporting/routes.js';
import { createProgramRouter } from './programs/routes.js';

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
//   GPME (card 10) reads Program data and need categories from the
//   affiliationStore, the Program data store.
// - resolveIdentity(req) -> { userId } | null: supplied by the future Entra
//   sign-in. Without one, /api routes answer 401 (fail closed).
// - allowDemoGrants: honor DEMO permission grants. Defaults to false. Turning
//   it on also requires nodeEnv 'development' or 'test'; anything else,
//   including no nodeEnv, throws at start-up (PRD 16.1, 17.4).
// - nodeEnv: the validated NODE_ENV from loadConfig().
// - now: optional clock for reporting ("data as of"); tests inject it.
// - notifier: optional notification service
//   (src/notifications/notificationService.js). When given, a new-referral
//   notification starts after each referral commits (Task E). Without one,
//   no notification is sent. Production has none yet: it needs the
//   production store and the Microsoft Graph sender (see the README).
// - gpmeInterpreter: optional replacement for the describe-the-need
//   interpreter (Task D). Without one, the rule-based interpreter is used.
//   It is independent of the notifier.
//
// Fixed 404. Nothing from the request is repeated in the response.
function notFound(req, res) {
  res.set('Cache-Control', 'no-store');
  res.status(404).json({ error: 'Not Found' });
}

export function createApp({ affiliationStore, referralStore, resolveIdentity, allowDemoGrants = false, nodeEnv, now, notifier = null, gpmeInterpreter } = {}) {
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
    createReferralRouter({ store: referralStore, resolveIdentity, allowDemoGrants, nodeEnv, notifier }),
  );

  app.use('/api/reports', createReportingRouter({ store: referralStore, resolveIdentity, now }));

  // Program maintenance writes need the transactional store (one Azure SQL
  // store will serve as every store in production).
  app.use(
    '/api/program-management',
    createProgramRouter({ store: referralStore, resolveIdentity, allowDemoGrants, nodeEnv }),
  );

  app.use(
    '/api/gpme',
    createGpmeRouter({ store: affiliationStore, resolveIdentity, interpreter: gpmeInterpreter }),
  );

  app.use(
    '/api',
    createAffiliationRouter({ store: affiliationStore, resolveIdentity }),
  );

  app.use(express.static(publicDir));

  // Any other path or method, under /api or not: a fixed JSON 404.
  // Express's built-in page would echo the requested path back and is not
  // marked no-store (PRD 5.5, 10.4, 15.4).
  app.use(notFound);

  // Must be registered last. Express's default handler includes stack
  // traces when NODE_ENV is not 'production' (PRD 15.4), so we replace it.
  app.use(errorHandler);

  return app;
}
