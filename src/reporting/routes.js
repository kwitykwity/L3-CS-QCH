// GET /api/reports/total-referrals?period=&date=&programId=&departmentId=
//   period: WEEKLY | MONTHLY | QUARTERLY | YEARLY (required)
//   date: YYYY-MM-DD, any day inside the wanted period (default: today,
//         America/New_York)
//   programId | departmentId: optional scope, not both
// 200 { metric, value, period, scope, partial, asOf } - aggregate only.
//
// GET /api/reports/referral-activity?period=&date=&programId=&departmentId=
//   Same query rules. Card 12: summary, Program and Department breakdowns
//   (made, received, accepted, not appropriate, awaiting, resulted in
//   service, and their rates). A period that has not started, or a date
//   before 2000-01-01, is a 400 on `date`.
// 200 { metric, period, scope, summary, programs, departments, partial, asOf }
//
// Any signed-in user may view aggregate reporting (PRD 3.5, 3.6). Identity
// comes only from resolveIdentity(req); without it every route answers 401.
// Query parameters are allowlisted; anything else -> 400 (PRD 10.3).

import express from 'express';
import { AffiliationError, errors as affiliationErrors } from '../affiliation/errors.js';
import { ReferralError, referralErrors } from '../referrals/errors.js';
import { createReportingService } from './reportingService.js';
import { createReferralActivityService } from './referralActivityService.js';
import { PERIOD_TYPES, parseDateText } from './periods.js';

const POSITIVE_INT = /^[1-9][0-9]{0,15}$/;
const toId = (text) => {
  if (typeof text !== 'string' || !POSITIVE_INT.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : null;
};

function readQuery(query) {
  const allowed = ['period', 'date', 'programId', 'departmentId'];
  if (Object.keys(query).some((k) => !allowed.includes(k))) throw referralErrors.unexpectedField();
  if (!PERIOD_TYPES.includes(query.period)) throw referralErrors.invalidRequest(['period']);
  const result = { periodType: query.period };
  if ('date' in query) {
    const date = parseDateText(query.date);
    if (!date) throw referralErrors.invalidRequest(['date']);
    result.date = date;
  }
  if ('programId' in query && 'departmentId' in query) throw referralErrors.invalidRequest(['programId', 'departmentId']);
  if ('programId' in query) {
    const id = toId(query.programId);
    if (id === null) throw referralErrors.invalidRequest(['programId']);
    result.programId = id;
  }
  if ('departmentId' in query) {
    const id = toId(query.departmentId);
    if (id === null) throw referralErrors.invalidRequest(['departmentId']);
    result.departmentId = id;
  }
  return result;
}

export function createReportingRouter({ store, resolveIdentity, now }) {
  const router = express.Router();
  const service = store ? createReportingService({ store, now }) : null;
  const activity = store ? createReferralActivityService({ store, now }) : null;

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.use(async (req, res, next) => {
    const identity = resolveIdentity ? resolveIdentity(req) : null;
    if (!identity || !Number.isSafeInteger(identity.userId) || identity.userId <= 0) {
      return next(referralErrors.notAuthenticated());
    }
    if (!service) return next(referralErrors.storeUnavailable());

    const user = await store.getUser(identity.userId);
    if (!user || !user.isActive) return next(affiliationErrors.userNotActive());
    next();
  });

  router.get('/total-referrals', async (req, res) => {
    res.json(await service.getTotalReferrals(readQuery(req.query)));
  });

  router.get('/referral-activity', async (req, res) => {
    res.json(await activity.getReferralActivity(readQuery(req.query)));
  });

  router.use((err, req, res, next) => {
    if (err instanceof ReferralError || err instanceof AffiliationError) {
      const body = { error: err.message, code: err.code };
      if (err.fields) body.fields = err.fields;
      return res.status(err.status).json(body);
    }
    return next(err);
  });

  return router;
}
