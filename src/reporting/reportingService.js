// Server-side reporting (PRD 12.5). Numbers are calculated here from the
// store, never in the browser. Responses are aggregate only: no referral
// IDs, names, contact details, or per-person data (PRD 12.1, 12.3).

import { referralErrors } from '../referrals/errors.js';
import { PERIOD_TYPES, REPORTING_TIME_ZONE, periodContaining, localDateOf, parseDateText, isoDate } from './periods.js';

// Reporting starts at this date; earlier dates are refused (QCH Connect
// has no data before it, and it keeps date math in a safe range).
export const EARLIEST_REPORT_DATE = Object.freeze({ year: 2000, month: 1, day: 1 });

const dayNumber = ({ year, month, day }) => Date.UTC(year, month - 1, day);

// The one reporting-date rule every report uses (PRD 12.2, 12.6). Returns
// the local (America/New_York) calendar date to report on: the given date,
// or today. Refuses, as 400 INVALID_REQUEST on `date`:
// - a date after today in New York. A future date is not evidence of zero
//   activity, even when its period has already started. Compares New York
//   calendar dates, never the UTC date.
// - a date before EARLIEST_REPORT_DATE.
export function resolveReportDay(date, asOf) {
  const today = localDateOf(asOf);
  const day = date ?? today;
  if (dayNumber(day) > dayNumber(today) || dayNumber(day) < dayNumber(EARLIEST_REPORT_DATE)) {
    throw referralErrors.invalidRequest(['date']);
  }
  return day;
}

export function createReportingService({ store, now = () => new Date() }) {
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
      const day = resolveReportDay(date, asOf);
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
  };
}

export { parseDateText, isoDate };
