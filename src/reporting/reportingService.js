// Server-side reporting (PRD 12.5). Numbers are calculated here from the
// store, never in the browser. Responses are aggregate only: no referral
// IDs, names, contact details, or per-person data (PRD 12.1, 12.3).

import { referralErrors } from '../referrals/errors.js';
import { PERIOD_TYPES, REPORTING_TIME_ZONE, periodContaining, localDateOf, parseDateText, isoDate } from './periods.js';
import { computeTimingMetrics } from './timingMetrics.js';

export function createReportingService({ store, now = () => new Date() }) {
  // Shared by every metric: the period, its scope, and "data as of".
  async function resolve({ periodType, date, programId, departmentId }) {
    if (!PERIOD_TYPES.includes(periodType)) throw referralErrors.invalidRequest(['period']);
    const asOf = now();
    const period = periodContaining(periodType, date ?? localDateOf(asOf));
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
    async getTotalReferrals({ periodType, date, programId, departmentId }) {
      if (!PERIOD_TYPES.includes(periodType)) throw referralErrors.invalidRequest(['period']);
      const asOf = now();
      const today = localDateOf(asOf);
      const day = date ?? today;
      // A future reporting date is not evidence of zero activity (PRD 12.6).
      // Compare calendar dates in New York, not the UTC calendar date.
      if (Date.UTC(day.year, day.month - 1, day.day)
          > Date.UTC(today.year, today.month - 1, today.day)) {
        throw referralErrors.invalidRequest(['date']);
      }
      const period = periodContaining(periodType, day);

      // An unknown Program or Department is "Unknown", not "Zero" (PRD 12.6).
      if (programId !== undefined && !(await store.getProgram(programId))) throw referralErrors.invalidRequest(['programId']);
      if (departmentId !== undefined && !(await store.getDepartment(departmentId))) throw referralErrors.invalidRequest(['departmentId']);

      const totalReferrals = await store.countReferrals({
        from: period.start.toISOString(),
        to: period.end.toISOString(),
        programId,
        departmentId,
      });

      return {
        metric: 'TOTAL_REFERRALS',
        value: totalReferrals,
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
        // Partial period: "data as of" (wireframes).
        partial: asOf < period.end,
        asOf: asOf.toISOString(),
      };
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
