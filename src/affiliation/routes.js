// HTTP routes for Program listing and staff Program affiliation.
//
//   GET /api/programs          active Programs available for selection
//   GET /api/me/affiliation    the signed-in user's current affiliation
//   PUT /api/me/affiliation    body: { "programId": <integer> }
//
// Identity comes only from `resolveIdentity(req)`, which the future Entra
// sign-in (or the non-production demo sign-in) will provide. Until one is
// configured it returns null and every route answers 401 (fail closed,
// PRD 3.2, 18.5). User IDs in the URL, query, or body are never read.

import express from 'express';
import { AffiliationError, errors } from './errors.js';
import { createAffiliationService } from './affiliationService.js';

export function createAffiliationRouter({ store, resolveIdentity }) {
  const router = express.Router();
  const service = store ? createAffiliationService({ store }) : null;

  // This router is mounted at /api alongside other routers, so its
  // middleware is limited to its own paths. Otherwise its sign-in check
  // and 1kb body limit would run on every /api request.
  const OWN_PATHS = ['/programs', '/me/affiliation'];

  // Protected responses must not be cached (PRD 5.5).
  router.use(OWN_PATHS, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.use(OWN_PATHS, (req, res, next) => {
    const identity = resolveIdentity ? resolveIdentity(req) : null;
    if (!identity || !Number.isSafeInteger(identity.userId)) {
      return next(errors.notAuthenticated());
    }
    if (!service) return next(errors.storeUnavailable());
    req.userId = identity.userId;
    next();
  });

  // Small bound: the only accepted body is { programId } (PRD 10.7).
  router.use(OWN_PATHS, express.json({ limit: '1kb' }));

  router.get('/programs', async (req, res) => {
    res.json({ programs: await service.listActivePrograms() });
  });

  router.get('/me/affiliation', async (req, res) => {
    res.json(await service.getAffiliation(req.userId));
  });

  router.put('/me/affiliation', async (req, res) => {
    res.json(await service.setAffiliation(req.userId, req.body));
  });

  // Known domain errors return their status and stable code. Anything else
  // falls through to the app's hardened error handler.
  router.use((err, req, res, next) => {
    if (err instanceof AffiliationError) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    // Malformed JSON from the body parser is a client error with no detail.
    if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
      const e = errors.invalidRequest();
      return res.status(e.status).json({ error: e.message, code: e.code });
    }
    return next(err);
  });

  return router;
}
