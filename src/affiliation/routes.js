// HTTP routes for Program listing and staff Program affiliation.
//
//   GET /api/programs          active Programs available for selection
//   GET /api/me/affiliation    -> { status, program, version }
//   PUT /api/me/affiliation    body: { "programId": <integer>, "version": "<from GET>" }
//       200 { status, program, version }   saved (new version)
//       409 { code: "AFFILIATION_CHANGED", current }  stale version; nothing saved
//
// Access boundary (PRD 3.1-3.3), checked on every route here:
// 1. Authentication: `resolveIdentity(req)` says WHO is calling. The future
//    Entra sign-in (or non-production demo sign-in) provides it. It does
//    NOT by itself prove current application access. Without it: 401.
// 2. Application access: the identity must map to an existing, ACTIVE
//    QCH Connect user record. Otherwise 403 USER_NOT_ACTIVE, before any
//    data is returned. The services re-check this as well.
// User IDs in the URL, query, or body are never read.

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

  // Application access: an existing, active user record (see header).
  router.use(OWN_PATHS, async (req, res, next) => {
    const user = await store.getUser(req.userId);
    if (!user || !user.isActive) return next(errors.userNotActive());
    next();
  });

  // None of these routes takes query parameters. Anything there is refused
  // with a fixed error that never repeats the parameter (PRD 10.3, 10.4).
  router.use(OWN_PATHS, (req, res, next) => {
    if (Object.keys(req.query).length > 0) return next(errors.invalidRequest());
    next();
  });

  // Small bound: the only accepted body is { programId, version } (PRD 10.7).
  router.use(OWN_PATHS, express.json({ limit: '1kb' }));

  router.get('/programs', async (req, res) => {
    res.json({ programs: await service.listActivePrograms(req.userId) });
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
      const body = { error: err.message, code: err.code };
      if (err.current) body.current = err.current; // the caller's own affiliation only
      return res.status(err.status).json(body);
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
