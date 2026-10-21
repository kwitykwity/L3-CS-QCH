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
//   GET  /api/referrals/not-appropriate-reasons      configured active reasons
//   POST /api/referrals/:referralId/response
//        { "decision": "ACCEPTED" } or
//        { "decision": "NOT_APPROPRIATE", "reasonId": n, "explanation"?: "..." }
//        200 { status: "RESPONDED", referral } | 403 | 404 | 409 ALREADY_RESPONDED
//   POST /api/referrals/:referralId/outcome                (RECORD_OUTCOME)
//        { "outcome": "RESULTED_IN_SERVICE" | "DID_NOT_RESULT_IN_SERVICE" }
//        200 { status: "OUTCOME_RECORDED", referral } | 403 | 404
//        409 OUTCOME_NOT_ALLOWED (not Accepted) | OUTCOME_ALREADY_RECORDED
//   POST /api/referrals/:referralId/outcome/correction     (CORRECT_OUTCOME)
//        { "outcome": "NOT_RECORDED" | "RESULTED_IN_SERVICE" |
//                     "DID_NOT_RESULT_IN_SERVICE", "version": "..." }
//   POST /api/referrals/:referralId/response/correction    (UPDATE_RECEIVED_REFERRAL)
//        { "decision": ..., "reasonId"?, "explanation"?, "version": "..." }
//        Corrections: 200 { status: "CORRECTED", referral } | 403 | 404
//        409 REFERRAL_CHANGED { current } when `version` is stale (PRD 9.4)
//        409 NO_CHANGE | OUTCOME_RECORDED | OUTCOME_NOT_RECORDED | NOT_RESPONDED
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
import { createResponseService } from './responseService.js';
import { createOutcomeService } from './outcomeService.js';
import { STAGES } from './stage.js';
import { MAX_BODY_BYTES } from './validateReferral.js';
import { decodeCursor } from './cursor.js';
import { assertDemoGrantsAllowed } from '../authorization/referralAccess.js';

const POSITIVE_INT = /^[1-9][0-9]{0,15}$/;

// A positive integer that JavaScript represents exactly, or null. Larger
// values would be rounded to a different ID (Number.MAX_SAFE_INTEGER).
function toId(text) {
  if (typeof text !== 'string' || !POSITIVE_INT.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) ? id : null;
}

// Validates query parameters against an allowlist (PRD 10.3). Identity,
// roles, membership or user IDs can never arrive this way (PRD 3.2).
// An unknown parameter is refused without echoing its name, which is
// arbitrary request content (PRD 10.4, 15.4).
function readQuery(query, allowed) {
  if (Object.keys(query).some((key) => !allowed.includes(key))) throw referralErrors.unexpectedField();

  const result = {};
  if ('programId' in query) {
    const programId = toId(query.programId);
    if (programId === null) throw referralErrors.invalidRequest(['programId']);
    result.programId = programId;
  }
  if ('stage' in query) {
    if (!STAGES.includes(query.stage)) throw referralErrors.invalidRequest(['stage']);
    result.stage = query.stage;
  }
  if ('cursor' in query) {
    const after = decodeCursor(query.cursor);
    if (!after) throw referralErrors.invalidRequest(['cursor']);
    result.after = after;
  }
  return result;
}

// allowDemoGrants: honor DEMO receiving grants. Defaults to false, and is
// refused at start-up unless nodeEnv is 'development' or 'test', so
// production and unknown environments fail closed (PRD 16.1, 17.4).
export function createReferralRouter({ store, resolveIdentity, allowDemoGrants = false, nodeEnv }) {
  assertDemoGrantsAllowed(allowDemoGrants, nodeEnv);
  const router = express.Router();
  const service = store ? createReferralService({ store }) : null;
  const queries = store ? createReferralQueryService({ store, allowDemoGrants }) : null;
  const responses = store ? createResponseService({ store, allowDemoGrants }) : null;
  const outcomes = store ? createOutcomeService({ store, allowDemoGrants }) : null;

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
    res.json(await queries.listReceived(req.userId, readQuery(req.query, ['programId', 'stage', 'cursor'])));
  });

  router.get('/sent', async (req, res) => {
    res.json(await queries.listSent(req.userId, readQuery(req.query, ['stage', 'cursor'])));
  });

  router.get('/not-appropriate-reasons', async (req, res) => {
    readQuery(req.query, []);
    res.json(await responses.listReasons(req.userId));
  });

  router.post('/:referralId/response', async (req, res) => {
    readQuery(req.query, []);
    const referralId = toId(req.params.referralId);
    if (referralId === null) throw referralErrors.referralNotFound();
    res.json(await responses.respond(req.userId, referralId, req.body, {
      correlationId: req.correlationId,
    }));
  });

  // One handler shape for every state-changing action on a referral: no
  // query parameters, safe-integer ID, server-derived user (PRD 3.2, 10.3).
  const action = (run) => async (req, res) => {
    readQuery(req.query, []);
    const referralId = toId(req.params.referralId);
    if (referralId === null) throw referralErrors.referralNotFound();
    res.json(await run(req.userId, referralId, req.body, { correlationId: req.correlationId }));
  };

  router.post('/:referralId/outcome', action((...a) => outcomes.recordOutcome(...a)));
  router.post('/:referralId/outcome/correction', action((...a) => outcomes.correctOutcome(...a)));
  router.post('/:referralId/response/correction', action((...a) => outcomes.correctResponse(...a)));

  router.get('/:referralId', async (req, res) => {
    readQuery(req.query, []);
    const referralId = toId(req.params.referralId);
    if (referralId === null) throw referralErrors.referralNotFound();
    res.json(await queries.getReferral(req.userId, referralId));
  });

  // Known domain errors return their status and stable code. Anything else
  // goes to the app's hardened error handler, which logs only safe metadata.
  router.use((err, req, res, next) => {
    if (err instanceof ReferralError || err instanceof AffiliationError) {
      const body = { error: err.message, code: err.code };
      if (err.fields) body.fields = err.fields;
      if (err.current) body.current = err.current;
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
