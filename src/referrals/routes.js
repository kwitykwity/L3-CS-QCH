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
// Identity comes only from resolveIdentity(req) (PRD 3.2). Without it,
// every route answers 401 (fail closed).

import { randomUUID } from 'node:crypto';
import express from 'express';
import { AffiliationError } from '../affiliation/errors.js';
import { ReferralError, referralErrors } from './errors.js';
import { createReferralService } from './referralService.js';

export function createReferralRouter({ store, resolveIdentity }) {
  const router = express.Router();
  const service = store ? createReferralService({ store }) : null;

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

  // Bounded body (PRD 10.7): the largest valid referral is well under this.
  router.use(express.json({ limit: '16kb' }));

  router.post('/', async (req, res) => {
    const result = await service.createDirectReferral(req.userId, req.body, {
      correlationId: req.correlationId,
    });
    res.status(result.status === 'RECEIVED' ? 201 : 200).json(result);
  });

  router.get('/submissions/:submissionId', async (req, res) => {
    res.json(await service.checkSubmission(req.userId, req.params.submissionId));
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
