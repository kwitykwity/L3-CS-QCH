// HTTP routes for the Guided Program Matching Engine (Trello card 10).
//
//   GET  /api/gpme/need-categories
//        200 { needCategories: [{ needCategoryId, name }] }
//
//   POST /api/gpme/match
//        body: { needCategoryIds: [<id>, ...], ageRange?: { min, max },
//                participantZip?: "<5 digits>" }
//        200 { status: "RESULTS" | "NO_PLAUSIBLE_MATCH", ruleVersion,
//              plausible: [...], possible: [...], notCheckedForNeedCount }
//        503 { status: "UNABLE_TO_MATCH", ruleVersion }  technical failure
//
// Why POST for a read: the inputs (age range, ZIP, need) describe a
// participant, so they must never go in a URL or query string (PRD 5.5).
// The request changes nothing and stores nothing (PRD 5.3).
//
// Identity comes only from resolveIdentity(req) (PRD 3.2). Without it,
// every route answers 401 (fail closed). An inactive or unknown user gets
// 403 before any data is returned.

import express from 'express';
import { AffiliationError } from '../affiliation/errors.js';
import { GpmeError, gpmeErrors } from './errors.js';
import { createGpmeService } from './gpmeService.js';
import { MATCH_STATUS } from './matchPrograms.js';
import { MAX_BODY_BYTES } from './validateMatchRequest.js';

export function createGpmeRouter({ store, resolveIdentity }) {
  const router = express.Router();
  const service = store ? createGpmeService({ store }) : null;

  // Protected responses must not be cached (PRD 5.5).
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.use((req, res, next) => {
    const identity = resolveIdentity ? resolveIdentity(req) : null;
    if (!identity || !Number.isSafeInteger(identity.userId)) {
      return next(gpmeErrors.notAuthenticated());
    }
    if (!service) return next(gpmeErrors.storeUnavailable());
    req.userId = identity.userId;
    next();
  });

  router.use(express.json({ limit: MAX_BODY_BYTES }));

  router.get('/need-categories', async (req, res) => {
    res.json({ needCategories: await service.listNeedCategories(req.userId) });
  });

  router.post('/match', async (req, res) => {
    const result = await service.match(req.userId, req.body);
    res.status(result.status === MATCH_STATUS.UNABLE_TO_MATCH ? 503 : 200).json(result);
  });

  router.use((err, req, res, next) => {
    if (err instanceof GpmeError || err instanceof AffiliationError) {
      const body = { error: err.message, code: err.code };
      if (err.fields) body.fields = err.fields;
      return res.status(err.status).json(body);
    }
    if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
      const e = gpmeErrors.invalidRequest();
      return res.status(e.status).json({ error: e.message, code: e.code });
    }
    return next(err);
  });

  return router;
}
