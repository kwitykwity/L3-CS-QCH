// P0 timing metrics (Trello card 13; Final Technical PRD 12.3, 12.4, 12.5,
// 12.6, 12.8). Pure calculations over a cohort's timing facts, so they can
// be checked with known-answer tests.
//
// PRD 12.4 (TEAM PRODUCT / REPORTING DECISIONS):
// - Time to First Response = first valid receiving response timestamp
//   (Accepted or Not Appropriate) minus successful referral creation
//   timestamp. Awaiting referrals have no completed duration. Later
//   correction does not rewrite the original first-response timestamp.
// - Time to Recorded Service = first valid RESULTED_IN_SERVICE recorded
//   timestamp minus creation timestamp. Only referrals that reached
//   RESULTED_IN_SERVICE participate. Average = sum / count; Median = middle
//   qualifying duration when ordered. Zero qualifying referrals = N/A.
// - The creation timestamp anchors the cohort (the caller passes only the
//   referrals created in the period and scope).
//
// Decisions the PRD leaves open, each in ONE place below so the team can
// change them without touching anything else. Each needs Team Lead
// confirmation (see the PR):
// D1 Time to First Response reports BOTH average and median. The PRD names
//    the metric but not the statistic; both is the superset.
// D2 Median of an even count is the mean of the two middle durations (the
//    standard statistical median).
// D3 A referral counts for Time to Recorded Service only if its CURRENT
//    outcome is RESULTED_IN_SERVICE ("first valid ... timestamp"; authorized
//    corrections change current-state reporting, PRD 6.2, 12.4). It is
//    measured from first_resulted_in_service_at, which corrections never
//    rewrite, so a correction away and back keeps the original time.
// D4 Durations are exact milliseconds of elapsed time (UTC instants, so a
//    daylight-saving change never adds or removes an hour). The server does
//    not round; the screen chooses how to show hours or days (PRD 12.5
//    allows presentation transforms).

export const TIMING_DECISIONS = Object.freeze({
  firstResponseStatistics: ['AVERAGE', 'MEDIAN'],      // D1
  evenMedian: 'MEAN_OF_MIDDLE_TWO',                   // D2
  recordedServiceQualifies: 'CURRENTLY_RESULTED',     // D3
  unit: 'MILLISECONDS',                               // D4
});

const ms = (iso) => Date.parse(iso);

// D2: the median of a list of numbers, or null for an empty list.
export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function average(values) {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

// One metric's result. `N/A` (not 0) when nothing qualifies (PRD 12.4,
// 12.6). `pendingCount` = referrals in the cohort that may still qualify
// later (not yet a completed duration), shown for transparency (PRD 12.8).
function summarize(durations, pendingCount) {
  const empty = durations.length === 0;
  return {
    status: empty ? 'N/A' : 'OK',
    qualifyingCount: durations.length,
    pendingCount,
    averageMs: average(durations),
    medianMs: median(durations),
  };
}

// facts: [{ createdAt, firstRespondedAt, decision, firstResultedInServiceAt,
//           serviceOutcome }] for one cohort.
export function computeTimingMetrics(facts) {
  const firstResponse = [];
  let awaiting = 0;
  const recordedService = [];
  let outcomePending = 0;

  for (const f of facts) {
    const created = ms(f.createdAt);

    if (f.firstRespondedAt) firstResponse.push(ms(f.firstRespondedAt) - created);
    else awaiting += 1;

    if (f.serviceOutcome === 'RESULTED_IN_SERVICE' && f.firstResultedInServiceAt) {       // D3
      recordedService.push(ms(f.firstResultedInServiceAt) - created);
    } else if (f.decision === 'ACCEPTED' && f.serviceOutcome === 'NOT_RECORDED') {
      // "Accepted, outcome still unknown: remains open for outcome
      // tracking" (PRD 6.2). Pending, never counted as a duration.
      outcomePending += 1;
    }
  }

  return {
    cohortSize: facts.length,
    timeToFirstResponse: summarize(firstResponse, awaiting),
    timeToRecordedService: summarize(recordedService, outcomePending),
    unit: TIMING_DECISIONS.unit,
  };
}
