// Referral activity report, Trello card 12 (P0 reporting breadth).
// Final Technical PRD 12.3, 12.4, 12.6, 12.7. Replaces PR #29, building on
// the card 9 reporting foundation (periods, access rule, routes).
//
// One report = one consistent read (store.aggregateReferrals), so the
// total, the summary, and every breakdown come from the same data
// (PRD 12.7: "computed together as one server-side result").
//
// Canonical definitions (PRD 12.4). The cohort is referrals CREATED in
// the period; later responses and outcomes mature the cohort but never
// move a referral to another period.
//   Acceptance Rate        = ACCEPTED / (ACCEPTED + NOT_APPROPRIATE)
//   Not Appropriate %      = NOT_APPROPRIATE / (ACCEPTED + NOT_APPROPRIATE)
//   Resulted in Service %  = RESULTED_IN_SERVICE / (RESULTED_IN_SERVICE + DID_NOT_RESULT_IN_SERVICE)
//   Awaiting Response      = current AWAITING_RESPONSE count
//   Made / Received by Program: original referring / receiving Program.
//   Department Made / Received: the Department each Program had at
//   referral creation (historical context, never rewritten).
// Decision and outcome metrics are receiving-side.
//
// Truth states (PRD 12.6). A rate is
//   CALCULATED  when its denominator is above zero,
//   PENDING     when it is zero but some referrals could still count
//               (awaiting a response, or accepted with no outcome yet),
//   NO_DATA     when there is nothing to calculate from.
// A rate never shows 0% for "nothing decided yet" (PRD 12.4 "N/A").
// A date after today is refused rather than reported as zero
// (resolveReportQuery, shared by every report).
//
// Aggregate only: counts, rates, and Program/Department names. Never
// referral IDs, participant data, or anything per person (PRD 12.1, 12.7).

import { resolveReportQuery } from './reportingService.js';

const RECEIVED_KEYS = ['accepted', 'notAppropriate', 'awaiting', 'resultedInService', 'didNotResultInService', 'acceptedNotRecorded'];

export function ratio(numerator, denominator, pending) {
  if (denominator > 0) {
    return { numerator, denominator, value: Math.round((numerator / denominator) * 10000) / 100, state: 'CALCULATED' };
  }
  return { numerator, denominator, value: null, state: pending > 0 ? 'PENDING' : 'NO_DATA' };
}

const emptyCounts = () => ({ made: 0, received: 0, ...Object.fromEntries(RECEIVED_KEYS.map((k) => [k, 0])) });

function addRow(counts, row) {
  if (row.role === 'MADE') {
    counts.made += row.referralCount;
  } else {
    counts.received += row.referralCount;
    for (const k of RECEIVED_KEYS) counts[k] += row[k];
  }
}

// Counts -> the metrics the report shows.
export function metricsFor(c) {
  const decided = c.accepted + c.notAppropriate;
  const recorded = c.resultedInService + c.didNotResultInService;
  return {
    made: c.made,
    received: c.received,
    accepted: c.accepted,
    notAppropriate: c.notAppropriate,
    awaitingResponse: c.awaiting,
    resultedInService: c.resultedInService,
    didNotResultInService: c.didNotResultInService,
    acceptanceRate: ratio(c.accepted, decided, c.awaiting),
    notAppropriateRate: ratio(c.notAppropriate, decided, c.awaiting),
    resultedInServiceRate: ratio(c.resultedInService, recorded, c.acceptedNotRecorded),
  };
}

export function createReferralActivityService({ store, now = () => new Date() }) {
  async function nameOf(kind, id) {
    const row = kind === 'program' ? await store.getProgram(id) : await store.getDepartment(id);
    return row?.name ?? null;
  }

  return {
    // query: { periodType, date?, programId?, departmentId? }, already
    // shape-checked by the route (same query as total-referrals).
    async getReferralActivity(query) {
      // The same setup every report uses: one date rule (no date after
      // today in New York, none before 2000), period, scope check, and
      // "data as of" (PRD 12.6).
      const { cohort, context } = await resolveReportQuery(store, now(), query);
      const { totalReferrals, rows } = await store.aggregateReferrals(cohort);

      // Programs group by Program identity (a Program that changed
      // Department is still one Program); Departments group by the
      // Department stored on each referral at creation.
      const summary = emptyCounts();
      const byProgram = new Map();
      const byDepartment = new Map();
      for (const row of rows) {
        addRow(summary, row);
        if (!byProgram.has(row.programId)) byProgram.set(row.programId, emptyCounts());
        addRow(byProgram.get(row.programId), row);
        if (!byDepartment.has(row.departmentId)) byDepartment.set(row.departmentId, emptyCounts());
        addRow(byDepartment.get(row.departmentId), row);
      }

      const programs = [];
      for (const [id, counts] of [...byProgram].sort((a, b) => a[0] - b[0])) {
        programs.push({ programId: id, name: await nameOf('program', id), ...metricsFor(counts) });
      }
      const departments = [];
      for (const [id, counts] of [...byDepartment].sort((a, b) => a[0] - b[0])) {
        departments.push({ departmentId: id, name: await nameOf('department', id), ...metricsFor(counts) });
      }

      return {
        metric: 'REFERRAL_ACTIVITY',
        summary: { totalReferrals, ...metricsFor(summary) },
        programs,
        departments,
        ...context,
      };
    },
  };
}
