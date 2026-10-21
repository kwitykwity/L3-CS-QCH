// Server-side reporting (PRD 12.5). Numbers are calculated here from the
// store, never in the browser. Responses are aggregate only: no referral
// IDs, names, contact details, or per-person data (PRD 12.1, 12.3).

import { referralErrors } from '../referrals/errors.js';
import { PERIOD_TYPES, REPORTING_TIME_ZONE, periodContaining, localDateOf, parseDateText, isoDate } from './periods.js';
import { computeTimingMetrics } from './timingMetrics.js';

// Reporting starts at this date; earlier dates are refused (QCH Connect
// has no data before it, and it keeps date math in a safe range).
export const EARLIEST_REPORT_DATE = Object.freeze({ year: 2000, month: 1, day: 1 });

const dayNumber = ({ year, month, day }) => Date.UTC(year, month - 1, day);

// The one reporting-date rule every report uses (PRD 12.2, 12.6). Returns
// the local (America/New_York) calendar date to report on: the given date,
// or today. Refuses, as 400 INVALID_REQUEST on `date`:
// - a date after today in New York. A future date is not evidence of zero
//   activity, and a timing report for it would only be "N/A", even when its
//   period has already started. Compares New York calendar dates, never
//   the UTC date.
// - a date before EARLIEST_REPORT_DATE.
export function resolveReportDay(date, asOf) {
  const today = localDateOf(asOf);
  const day = date ?? today;
  if (dayNumber(day) > dayNumber(today) || dayNumber(day) < dayNumber(EARLIEST_REPORT_DATE)) {
    throw referralErrors.invalidRequest(['date']);
  }
  return day;
}

// Shared by EVERY report (Total Referrals, Timing Metrics, Referral
// Activity), so they can't drift apart: validates the period, applies the
// one date rule, resolves the period, checks the scope, and builds the
// response context ("data as of"). All of it happens before any referral
// data is read.
export async function resolveReportQuery(store, asOf, { periodType, date, programId, departmentId }) {
  if (!PERIOD_TYPES.includes(periodType)) throw referralErrors.invalidRequest(['period']);
  const day = resolveReportDay(date, asOf);
  const period = periodContaining(periodType, day);
  // An unknown Program or Department is "Unknown", not "Zero" (PRD 12.6).
  if (programId !== undefined && !(await store.getProgram(programId))) throw referralErrors.invalidRequest(['programId']);
  if (departmentId !== undefined && !(await store.getDepartment(departmentId))) throw referralErrors.invalidRequest(['departmentId']);
  return {
    cohort: { from: period.start.toISOString(), to: period.end.toISOString(), programId, departmentId },
    context: {
      period: {
        type: period.periodType,
        label: period.label,
        start: period.startDate,
        endExclusive: period.endDate,
        timeZone: REPORTING_TIME_ZONE,
      },
      scope: programId !== undefined ? { type: 'PROGRAM', programId }
        : departmentId !== undefined ? { type: 'DEPARTMENT', departmentId }
          : { type: 'ORGANIZATION' },
      partial: asOf < period.end,
      asOf: asOf.toISOString(),
    },
  };
}

export function createReportingService({ store, now = () => new Date() }) {
  const resolve = (query) => resolveReportQuery(store, now(), query);

  return {
    // Total Referrals (PRD 12.4): committed referrals whose ORIGINAL
    // submission timestamp falls in the period and the aggregate scope,
    // each counted once. Later responses, outcomes, corrections and
    // resends never add or move a count: a new referral after "Not
    // appropriate" is a new submission and is counted separately.
    //
    // query: { periodType, date?, programId?, departmentId? } (already
    // validated by the route). Scope is organization-wide unless a Program
    // or Department is given; then it is referrals MADE OR RECEIVED by that
    // Program/Department, counted once. Department scope uses the
    // Department stored on the referral at creation (historical context).
    async getTotalReferrals(query) {
      const { cohort, context } = await resolve(query);
      return { metric: 'TOTAL_REFERRALS', value: await store.countReferrals(cohort), ...context };
    },

    // Time to First Response; Average and Median Time to Recorded Service
    // (PRD 12.3, 12.4; card 13). Same cohort and scope as Total Referrals:
    // referrals CREATED in the period, so a later response or outcome
    // matures its original cohort and never moves it (PRD 12.4). Durations
    // in milliseconds; "N/A" when nothing qualifies. See timingMetrics.js
    // for the definitions and the decisions awaiting confirmation.
    async getTimingMetrics(query) {
      const { cohort, context } = await resolve(query);
      const facts = await store.listTimingFacts(cohort);
      return { metric: 'TIMING', ...computeTimingMetrics(facts), ...context };
    },
  };
}

export { parseDateText, isoDate };
