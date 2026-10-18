// HTTP routes for Direct Referral creation.
//
//   POST /api/referrals
//       body: { submissionId, receivingProgramId, referringProgramId?,
//               participantName, contactMethod, contactValue?,
//               participantZip?, referralContext, notes? }
//       201 { status: "RECEIVED", referral }          new referral committed
//       200 { status: "ALREADY_RECEIVED", referral }  same Submission ID retried
//
//   GET /api/referrals/submissions/:submissionId
//       Safe check after an unconfirmed submission (PRD 7.4).
//       200 { status: "RECEIVED", referral } or { status: "NOT_RECEIVED" }
//
// The browser maps these to the locked PRD 7.4 messages ("Referral
// received !", "Referral already received. Do not resend !", ...).
//
//   GET /api/referrals/received?programId=&stage=   receiving queue
//   GET /api/referrals/sent?stage=                   my submitted referrals
//   GET /api/referrals/:referralId                   one referral (creator or
//                                                    authorized receiver; else 404)
//   stage: AWAITING_RESPONSE | ACCEPTED_OUTCOME_PENDING | COMPLETE
//   Query parameters are allowlisted; anything else (e.g. userId) -> 400.
//
// Identity comes only from resolveIdentity(req) (PRD 3.2). Without it,
// every route answers 401 (fail closed).

import { randomUUID } from 'node:crypto';
import express from 'express';
import { AffiliationError } from '../affiliation/errors.js';
import { ReferralError, referralErrors } from './errors.js';
import { createReferralService } from './referralService.js';
import { createReferralQueryService } from './referralQueryService.js';
import { STAGES } from './stage.js';
import { MAX_BODY_BYTES } from './validateReferral.js';

const POSITIVE_INT = /^[1-9][0-9]{0,15}$/;

// Validates query parameters against an allowlist (PRD 10.3). Identity,
// roles, membership or user IDs can never arrive this way (PRD 3.2).
function readQuery(query, allowed) {
  const unknown = Object.keys(query).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw referralErrors.invalidRequest(unknown.sort());

  const result = {};
  if ('programId' in query) {
    if (typeof query.programId !== 'string' || !POSITIVE_INT.test(query.programId)) {
      throw referralErrors.invalidRequest(['programId']);
    }
    result.programId = Number(query.programId);
  }
  if ('stage' in query) {
    if (!STAGES.includes(query.stage)) throw referralErrors.invalidRequest(['stage']);
    result.stage = query.stage;
  }
  return result;
}

// allowDemoGrants: honor DEMO receiving grants. Only the local synthetic
// dev server sets this; it defaults to false so production fails closed
// (PRD 16.1, 17.4).
export function createReferralRouter({ store, resolveIdentity, allowDemoGrants = false }) {
  const router = express.Router();
  const service = store ? createReferralService({ store }) : null;
  const queries = store ? createReferralQueryService({ store, allowDemoGrants }) : null;

  // Protected responses must not be cached (PRD 5.5).
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.use((req, res, next) => {
    const identity = resolveIdentity ? resolveIdentity(req) : null;
    if (!identity || !Number.isSafeInteger(identity.userId)) {
      return next(referralErrors.notAuthenticated());
    }
    if (!service) return next(referralErrors.storeUnavailable());
    req.userId = identity.userId;
    // Non-sensitive ID linking this request to its audit event (PRD 10.6).
    req.correlationId = randomUUID();
    next();
  });

  // Bounded body (PRD 10.7), derived from the field limits so that every
  // referral the validator accepts also fits here, in any encoding.
  router.use(express.json({ limit: MAX_BODY_BYTES }));

  router.post('/', async (req, res) => {
    const result = await service.createDirectReferral(req.userId, req.body, {
      correlationId: req.correlationId,
    });
    res.status(result.status === 'RECEIVED' ? 201 : 200).json(result);
  });

  router.get('/submissions/:submissionId', async (req, res) => {
    res.json(await service.checkSubmission(req.userId, req.params.submissionId));
  });

  router.get('/received', async (req, res) => {
    res.json(await queries.listReceived(req.userId, readQuery(req.query, ['programId', 'stage'])));
  });

  router.get('/sent', async (req, res) => {
    res.json(await queries.listSent(req.userId, readQuery(req.query, ['stage'])));
  });

  router.get('/:referralId', async (req, res) => {
    readQuery(req.query, []);
    if (!POSITIVE_INT.test(req.params.referralId)) throw referralErrors.referralNotFound();
    res.json(await queries.getReferral(req.userId, Number(req.params.referralId)));
  });

  // Known domain errors return their status and stable code. Anything else
  // goes to the app's hardened error handler, which logs only safe metadata.
  router.use((err, req, res, next) => {
    if (err instanceof ReferralError || err instanceof AffiliationError) {
      const body = { error: err.message, code: err.code };
      if (err.fields) body.fields = err.fields;
      return res.status(err.status).json(body);
    }
    if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
      const e = referralErrors.invalidRequest();
      return res.status(e.status).json({ error: e.message, code: e.code });
    }
    return next(err);
  });

  return router;
}
