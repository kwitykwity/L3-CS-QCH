// P0 timing metrics (Trello card 13; PRD 12.3, 12.4, 12.5, 12.6, 12.8).
// Known-answer tests: every expected value below was worked out by hand
// from the PRD definitions (arithmetic shown), not by running the code.
// All data is SYNTHETIC.
//
// Reporting zone America/New_York: EDT (UTC-4) until Nov 1, 2026 2 AM,
// then EST (UTC-5). July 2026 (local) = [2026-07-01T04:00Z, 2026-08-01T04:00Z).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
import { createReferralService } from '../src/referrals/referralService.js';
import { createResponseService } from '../src/referrals/responseService.js';
import { createReportingService } from '../src/reporting/reportingService.js';
import { average, computeTimingMetrics, median, TIMING_DECISIONS } from '../src/reporting/timingMetrics.js';

const H = 3_600_000; // one hour in ms
const A = 100;       // affiliated with Program 10 (Department 1)
const B = 101;       // affiliated with Program 11 (Department 2)
const C = 102;       // affiliated with Program 12 (Department 2)
const RECEIVER = 200; // responds for Programs 10, 11, 12

let clock;
function build() {
  clock = new Date('2026-07-01T00:00:00.000Z');
  return createMemoryReferralStore({
    departments: [
      { departmentId: 1, name: 'Synthetic Dept A', lifecycleStatus: 'ACTIVE' },
      { departmentId: 2, name: 'Synthetic Dept B', lifecycleStatus: 'ACTIVE' },
    ],
    programs: [
      { programId: 10, departmentId: 1, name: 'Program Ten', site: null, lifecycleStatus: 'ACTIVE' },
      { programId: 11, departmentId: 2, name: 'Program Eleven', site: null, lifecycleStatus: 'ACTIVE' },
      { programId: 12, departmentId: 2, name: 'Program Twelve', site: null, lifecycleStatus: 'ACTIVE' },
    ],
    users: [
      { userId: A, isActive: true, currentProgramId: 10 },
      { userId: B, isActive: true, currentProgramId: 11 },
      { userId: C, isActive: true, currentProgramId: 12 },
      { userId: RECEIVER, isActive: true },
      { userId: 900, isActive: false },
    ],
    grants: [10, 11, 12].map((programId) => ({
      userId: RECEIVER, permission: 'RESPOND_TO_REFERRAL', scopeType: 'PROGRAM', programId, departmentId: null, grantSource: 'IN_APP',
    })),
    notAppropriateReasons: [{ reasonId: 2, code: 'PROGRAM_UNAVAILABLE', label: 'Program currently unavailable', displayOrder: 2 }],
  }, { now: () => clock });
}

// One referral with its lifecycle, each step stamped at an exact UTC instant.
// outcome: { firstResultedAt?, current: 'RESULTED_IN_SERVICE' | 'DID_NOT_RESULT_IN_SERVICE' | 'NOT_RECORDED' }
async function referral(store, { created, by = A, to = 11, responded, decision = 'ACCEPTED', outcome }) {
  clock = new Date(created);
  const r = await createReferralService({ store }).createDirectReferral(by, {
    submissionId: randomUUID(),
    receivingProgramId: to,
    participantName: 'Synthetic Person',
    contactMethod: 'NOT_AVAILABLE',
    referralContext: 'Synthetic need',
  });
  const id = r.referral.referralId;
  if (responded) {
    clock = new Date(responded);
    await createResponseService({ store }).respond(RECEIVER, id, decision === 'ACCEPTED' ? { decision } : { decision, reasonId: 2 });
  }
  if (outcome) {
    // Card 8 (#14) records outcomes; until it merges, set the stored fields
    // exactly as it would (first_resulted_in_service_at is never rewritten).
    store._setReferralState(id, {
      serviceOutcome: outcome.current,
      firstResultedInServiceAt: outcome.firstResultedAt ?? null,
      outcomeRecordedAt: outcome.current === 'NOT_RECORDED' ? null : (outcome.recordedAt ?? outcome.firstResultedAt ?? responded),
    });
  }
  return id;
}

const report = (store, query, asOf = '2026-10-19T00:00:00.000Z') =>
  createReportingService({ store, now: () => new Date(asOf) }).getTimingMetrics(query);
const JULY = { periodType: 'MONTHLY', date: { year: 2026, month: 7, day: 15 } };

// The main July 2026 cohort. Hours are elapsed time from creation.
async function july() {
  const store = build();
  // R1: responded +2 h, Resulted +72 h.
  await referral(store, { created: '2026-07-01T14:00:00Z', responded: '2026-07-01T16:00:00Z', outcome: { current: 'RESULTED_IN_SERVICE', firstResultedAt: '2026-07-04T14:00:00Z' } });
  // R2: responded +24 h, Resulted +240 h.
  await referral(store, { created: '2026-07-02T00:00:00Z', responded: '2026-07-03T00:00:00Z', outcome: { current: 'RESULTED_IN_SERVICE', firstResultedAt: '2026-07-12T00:00:00Z' } });
  // R3: Not Appropriate +0.5 h. No service outcome.
  await referral(store, { created: '2026-07-05T12:00:00Z', responded: '2026-07-05T12:30:00Z', decision: 'NOT_APPROPRIATE' });
  // R4: still Awaiting Response.
  await referral(store, { created: '2026-07-10T09:00:00Z' });
  // R5: responded +4 h, Did Not Result.
  await referral(store, { created: '2026-07-11T00:00:00Z', responded: '2026-07-11T04:00:00Z', outcome: { current: 'DID_NOT_RESULT_IN_SERVICE', recordedAt: '2026-07-14T00:00:00Z' } });
  // R6: responded +6 h; Resulted at +24 h, later CORRECTED to Did Not (D3: still counts, it reached Resulted).
  await referral(store, { created: '2026-07-15T00:00:00Z', responded: '2026-07-15T06:00:00Z', outcome: { current: 'DID_NOT_RESULT_IN_SERVICE', firstResultedAt: '2026-07-16T00:00:00Z' } });
  // R7: responded +1 h, Accepted, outcome not recorded yet (pending).
  await referral(store, { created: '2026-07-20T00:00:00Z', responded: '2026-07-20T01:00:00Z', outcome: { current: 'NOT_RECORDED' } });
  // R8: created Jun 30 23:00 EDT -> JUNE cohort, even though answered in July.
  await referral(store, { created: '2026-07-01T03:00:00Z', responded: '2026-07-01T05:00:00Z', outcome: { current: 'RESULTED_IN_SERVICE', firstResultedAt: '2026-07-02T03:00:00Z' } });
  // R9: created Jul 31 23:59:59 EDT -> JULY cohort; responded +5 h, Resulted +48 h (in August).
  await referral(store, { created: '2026-08-01T03:59:59Z', responded: '2026-08-01T08:59:59Z', outcome: { current: 'RESULTED_IN_SERVICE', firstResultedAt: '2026-08-03T03:59:59Z' } });
  // R10: created Aug 1 00:00 EDT -> AUGUST cohort.
  await referral(store, { created: '2026-08-01T04:00:00Z', responded: '2026-08-01T05:00:00Z' });
  return store;
}

describe('known answers: July 2026, organization-wide', () => {
  test('cohort = referrals CREATED in July (R1-R7, R9): 8', async () => {
    const result = await report(await july(), JULY);
    assert.equal(result.cohortSize, 8);
    assert.equal(result.metric, 'TIMING');
    assert.equal(result.unit, 'MILLISECONDS');
    assert.deepEqual(result.period, { type: 'MONTHLY', label: '2026-07', start: '2026-07-01', endExclusive: '2026-08-01', timeZone: 'America/New_York' });
  });

  test('Time to First Response: 7 responded; avg 153 h / 7; median 4 h; 1 awaiting', async () => {
    // Durations (h): R1 2, R2 24, R3 0.5, R5 4, R6 6, R7 1, R9 5.
    // Sorted: 0.5, 1, 2, 4, 5, 6, 24 -> median (4th of 7) = 4 h.
    // Sum = 0.5 + 1 + 2 + 4 + 5 + 6 + 24 = 42.5 h = 153,000,000 ms.
    // Average = 153,000,000 / 7 = 21,857,142.857... ms (about 6.07 h).
    const { timeToFirstResponse: t } = await report(await july(), JULY);
    assert.equal(t.status, 'OK');
    assert.equal(t.qualifyingCount, 7);
    assert.equal(t.pendingCount, 1, 'R4 is still awaiting');
    assert.equal(t.medianMs, 4 * H);
    assert.equal(t.averageMs, 153_000_000 / 7);
  });

  test('Time to Recorded Service: R1, R2, R6, R9 reached it; avg 96 h; median 60 h; 1 pending', async () => {
    // PRD 12.4: "Only referrals that reached RESULTED_IN_SERVICE participate."
    // Durations (h), from the FIRST Resulted time: R1 72, R2 240, R6 24
    // (later corrected to Did Not, still reached it), R9 48.
    // Sorted 24, 48, 72, 240 -> even count, D2 median = (48 + 72) / 2 = 60 h.
    // Average = (72 + 240 + 24 + 48) / 4 = 384 / 4 = 96 h = 345,600,000 ms.
    // Excluded: R3 Not Appropriate, R4 awaiting, R5 Did Not (never reached
    // Resulted), R7 not recorded yet (pending), R8 June cohort.
    const { timeToRecordedService: s } = await report(await july(), JULY);
    assert.equal(s.status, 'OK');
    assert.equal(s.qualifyingCount, 4);
    assert.equal(s.pendingCount, 1, 'R7: Accepted, outcome not recorded');
    assert.equal(s.medianMs, 60 * H);
    assert.equal(s.averageMs, 96 * H);
  });

  test('the cohort is anchored on creation: June and August get their own referrals', async () => {
    const store = await july();
    const june = await report(store, { periodType: 'MONTHLY', date: { year: 2026, month: 6, day: 1 } });
    // R8 only: responded +2 h, Resulted +24 h.
    assert.deepEqual([june.cohortSize, june.timeToFirstResponse.medianMs, june.timeToRecordedService.medianMs], [1, 2 * H, 24 * H]);
    const august = await report(store, { periodType: 'MONTHLY', date: { year: 2026, month: 8, day: 1 } });
    // R10 only: responded +1 h, no outcome -> Time to Recorded Service N/A.
    assert.deepEqual([august.cohortSize, august.timeToFirstResponse.averageMs, august.timeToRecordedService.status], [1, 1 * H, 'N/A']);
  });

  test('fiscal quarter FY2027 Q1 (Jul-Sep 2026) holds the July cohort plus R10', async () => {
    const q1 = await report(await july(), { periodType: 'QUARTERLY', date: { year: 2026, month: 9, day: 30 } });
    assert.equal(q1.period.label, 'FY2027 Q1');
    // First-response durations: July's 7 plus R10's 1 h = 8 values.
    // Sorted 0.5, 1, 1, 2, 4, 5, 6, 24 -> even count, D2 median = (2 + 4) / 2 = 3 h.
    // Sum 42.5 + 1 = 43.5 h -> average 43.5 / 8 = 5.4375 h.
    assert.equal(q1.timeToFirstResponse.qualifyingCount, 8);
    assert.equal(q1.timeToFirstResponse.medianMs, 3 * H);
    assert.equal(q1.timeToFirstResponse.averageMs, 5.4375 * H);
  });
});

describe('known answers: edge cases', () => {
  test('an empty cohort is N/A for both metrics, never 0', async () => {
    const result = await report(build(), JULY);
    assert.equal(result.cohortSize, 0);
    for (const m of [result.timeToFirstResponse, result.timeToRecordedService]) {
      assert.deepEqual(m, { status: 'N/A', qualifyingCount: 0, pendingCount: 0, averageMs: null, medianMs: null });
    }
  });

  test('a cohort where nobody has responded yet: N/A, with the pending count shown', async () => {
    const store = build();
    await referral(store, { created: '2026-07-02T12:00:00Z' });
    await referral(store, { created: '2026-07-03T12:00:00Z' });
    const { timeToFirstResponse: t, timeToRecordedService: s } = await report(store, JULY);
    assert.deepEqual([t.status, t.pendingCount, t.averageMs], ['N/A', 2, null]);
    assert.deepEqual([s.status, s.pendingCount], ['N/A', 0]);
  });

  test('even number of recorded-service durations: median is the mean of the middle two (D2)', async () => {
    const store = build();
    // Resulted after 1, 2, 4 and 10 hours. Sorted middle two: 2 and 4 -> 3 h.
    // Average (1 + 2 + 4 + 10) / 4 = 4.25 h.
    for (const [day, hours] of [[2, 1], [3, 2], [4, 4], [5, 10]]) {
      const created = `2026-07-0${day}T12:00:00Z`;
      const resulted = new Date(Date.parse(created) + hours * H).toISOString();
      await referral(store, { created, responded: created, outcome: { current: 'RESULTED_IN_SERVICE', firstResultedAt: resulted } });
    }
    const { timeToRecordedService: s } = await report(store, JULY);
    assert.equal(s.medianMs, 3 * H);
    assert.equal(s.averageMs, 4.25 * H);
  });

  test('a single qualifying referral: median = average = its duration', async () => {
    const store = build();
    await referral(store, { created: '2026-07-02T12:00:00Z', responded: '2026-07-02T13:30:00Z' });
    const { timeToFirstResponse: t } = await report(store, JULY);
    assert.deepEqual([t.medianMs, t.averageMs], [1.5 * H, 1.5 * H]);
  });

  test('durations are elapsed time across a daylight-saving change (D4)', async () => {
    const store = build();
    // Oct 31 12:00 EDT -> Nov 1 12:00 EST: a "one day" wall-clock gap that is 25 h elapsed.
    await referral(store, { created: '2026-10-31T16:00:00Z', responded: '2026-11-01T17:00:00Z' });
    const october = await report(store, { periodType: 'MONTHLY', date: { year: 2026, month: 10, day: 1 } });
    assert.equal(october.timeToFirstResponse.medianMs, 25 * H);
  });

  test('a correction away from Resulted, and back, keeps the referral counted from its ORIGINAL first-service time (PRD 12.4, D3)', async () => {
    const store = build();
    const id = await referral(store, { created: '2026-07-02T00:00:00Z', responded: '2026-07-02T01:00:00Z', outcome: { current: 'DID_NOT_RESULT_IN_SERVICE', firstResultedAt: '2026-07-03T00:00:00Z' } });
    const away = (await report(store, JULY)).timeToRecordedService;
    assert.deepEqual([away.status, away.qualifyingCount, away.pendingCount, away.medianMs], ['OK', 1, 0, 24 * H],
      'corrected to Did Not: it reached Resulted, so it still counts, from the first time');
    store._setReferralState(id, { serviceOutcome: 'RESULTED_IN_SERVICE', outcomeRecordedAt: '2026-07-20T00:00:00Z' });
    const back = (await report(store, JULY)).timeToRecordedService;
    assert.deepEqual([back.qualifyingCount, back.medianMs], [1, 24 * H], 'corrected back: counted once, from the first time, not the latest');
  });

  test('a referral that never reached Resulted is never counted, whatever else happened (D3)', async () => {
    const store = build();
    await referral(store, { created: '2026-07-02T00:00:00Z', responded: '2026-07-02T01:00:00Z', outcome: { current: 'DID_NOT_RESULT_IN_SERVICE', recordedAt: '2026-07-05T00:00:00Z' } });
    await referral(store, { created: '2026-07-03T00:00:00Z', responded: '2026-07-03T01:00:00Z', decision: 'NOT_APPROPRIATE' });
    const s = (await report(store, JULY)).timeToRecordedService;
    assert.deepEqual([s.status, s.qualifyingCount, s.pendingCount], ['N/A', 0, 0]);
  });

  test('a corrected decision does not change Time to First Response (first timestamp kept)', async () => {
    const store = build();
    const id = await referral(store, { created: '2026-07-02T00:00:00Z', responded: '2026-07-02T03:00:00Z', decision: 'NOT_APPROPRIATE' });
    store._setReferralState(id, { decision: 'ACCEPTED', notAppropriateReasonId: null });
    assert.equal((await report(store, JULY)).timeToFirstResponse.medianMs, 3 * H);
  });

  test('both decisions count as a first response (Accepted or Not Appropriate)', async () => {
    const store = build();
    await referral(store, { created: '2026-07-02T00:00:00Z', responded: '2026-07-02T02:00:00Z' });
    await referral(store, { created: '2026-07-03T00:00:00Z', responded: '2026-07-03T06:00:00Z', decision: 'NOT_APPROPRIATE' });
    const { timeToFirstResponse: t } = await report(store, JULY);
    assert.deepEqual([t.qualifyingCount, t.averageMs], [2, 4 * H]);
  });
});

describe('known answers: scope (same rules as Total Referrals, PRD 12.4)', () => {
  async function scoped() {
    const store = build();
    // A (Program 10, Dept 1) -> 11: responded +1 h.
    await referral(store, { created: '2026-07-02T00:00:00Z', by: A, to: 11, responded: '2026-07-02T01:00:00Z' });
    // B (Program 11, Dept 2) -> 12: responded +3 h.
    await referral(store, { created: '2026-07-03T00:00:00Z', by: B, to: 12, responded: '2026-07-03T03:00:00Z' });
    // C (Program 12, Dept 2) -> 10: responded +8 h.
    await referral(store, { created: '2026-07-04T00:00:00Z', by: C, to: 10, responded: '2026-07-04T08:00:00Z' });
    return store;
  }

  test('Program 11: referrals made OR received by it, counted once (1 h and 3 h)', async () => {
    const result = await report(await scoped(), { ...JULY, programId: 11 });
    assert.deepEqual(result.scope, { type: 'PROGRAM', programId: 11 });
    assert.deepEqual([result.cohortSize, result.timeToFirstResponse.averageMs, result.timeToFirstResponse.medianMs], [2, 2 * H, 2 * H]);
  });

  test('Department 1 (Program 10 made one, received one): 1 h and 8 h', async () => {
    const result = await report(await scoped(), { ...JULY, departmentId: 1 });
    assert.deepEqual([result.cohortSize, result.timeToFirstResponse.averageMs], [2, 4.5 * H]);
  });

  test('Department scope uses the Department stored at creation, not a later move', async () => {
    const store = await scoped();
    store._setProgramDepartment(10, 2); // Program 10 moves to Department 2 after the fact
    const result = await report(store, { ...JULY, departmentId: 1 });
    assert.equal(result.cohortSize, 2, 'history is not rewritten');
  });

  test('organization-wide: all three (1, 3, 8 h)', async () => {
    const result = await report(await scoped(), JULY);
    assert.deepEqual([result.cohortSize, result.timeToFirstResponse.medianMs, result.timeToFirstResponse.averageMs], [3, 3 * H, 4 * H]);
  });
});

describe('calculation helpers', () => {
  test('median and average (D2)', () => {
    assert.equal(median([]), null);
    assert.equal(average([]), null);
    assert.equal(median([5]), 5);
    assert.equal(median([9, 1, 5]), 5);
    assert.equal(median([4, 1, 3, 2]), 2.5);
    assert.equal(average([1, 2, 3, 4]), 2.5);
    assert.equal(median([3, 3, 3, 3]), 3, 'ties stay ties');
  });

  test('the four open decisions are named in one place', () => {
    assert.deepEqual(TIMING_DECISIONS, {
      firstResponseStatistics: ['AVERAGE', 'MEDIAN'],
      evenMedian: 'MEAN_OF_MIDDLE_TWO',
      recordedServiceQualifies: 'REACHED_RESULTED',
      unit: 'MILLISECONDS',
    });
  });

  test('a stored Resulted outcome without a first-service time is not counted (bad data never becomes a duration)', () => {
    const r = computeTimingMetrics([{ createdAt: '2026-07-01T00:00:00Z', firstRespondedAt: '2026-07-01T01:00:00Z', decision: 'ACCEPTED', serviceOutcome: 'RESULTED_IN_SERVICE', firstResultedInServiceAt: null }]);
    assert.equal(r.timeToRecordedService.status, 'N/A');
  });
});

describe('HTTP: GET /api/reports/timing-metrics', () => {
  const appFor = (store, userId) => createApp({
    referralStore: store, affiliationStore: store,
    resolveIdentity: () => (userId === null ? null : { userId }),
    now: () => new Date('2026-07-20T12:00:00.000Z'),
  });

  test('returns the July known answers, aggregate only, never cached', async () => {
    const store = await july();
    const res = await request(appFor(store, A)).get('/api/reports/timing-metrics?period=MONTHLY&date=2026-07-15');
    assert.equal(res.status, 200);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.body.timeToFirstResponse.medianMs, 4 * H);
    assert.equal(res.body.timeToRecordedService.averageMs, 96 * H);
    assert.equal(res.body.partial, true, 'July is still in progress at the injected "as of" time');
    assert.deepEqual(Object.keys(res.body).sort(),
      ['asOf', 'cohortSize', 'metric', 'partial', 'period', 'scope', 'timeToFirstResponse', 'timeToRecordedService', 'unit']);
    assert.ok(!/Synthetic Person|referralId|submissionId/.test(res.text), 'no per-referral data');
  });

  test('any active signed-in user may view it; none, unknown or inactive users may not (PRD 3.5)', async () => {
    const store = await july();
    assert.equal((await request(appFor(store, null)).get('/api/reports/timing-metrics?period=MONTHLY')).status, 401);
    assert.equal((await request(appFor(store, 777)).get('/api/reports/timing-metrics?period=MONTHLY')).status, 403);
    assert.equal((await request(appFor(store, 900)).get('/api/reports/timing-metrics?period=MONTHLY')).status, 403);
    assert.equal((await request(appFor(store, RECEIVER)).get('/api/reports/timing-metrics?period=MONTHLY')).status, 200);
  });

  test('filters are validated like Total Referrals; unknown scope is an error, not zero', async () => {
    const app = appFor(await july(), A);
    for (const q of ['', 'period=DAILY', 'period=MONTHLY&date=2026-02-30', 'period=MONTHLY&programId=11&departmentId=1',
      'period=MONTHLY&programId=999', 'period=MONTHLY&departmentId=0', 'period=MONTHLY&userId=1']) {
      const res = await request(app).get(`/api/reports/timing-metrics?${q}`);
      assert.equal(res.status, 400, q);
      assert.equal(res.headers['cache-control'], 'no-store');
    }
  });
});

// PR #26 re-review: a future date must be refused for Timing Metrics too,
// by the same shared resolver as Total Referrals, before any timing fact
// is read (PRD 12.6). Reporting zone America/New_York: EDT (UTC-4) until
// Nov 1, 2026, then EST (UTC-5).
describe('HTTP: future dates are refused before reading timing facts (PRD 12.6)', () => {
  const at = (store, nowIso) => createApp({
    referralStore: store, affiliationStore: store,
    resolveIdentity: () => ({ userId: A }),
    now: () => new Date(nowIso),
  });
  const timing = (store, query, nowIso) => request(at(store, nowIso)).get('/api/reports/timing-metrics').query(query);
  const watched = () => {
    const store = build();
    const reads = { count: 0 };
    const original = store.listTimingFacts.bind(store);
    store.listTimingFacts = async (...args) => { reads.count += 1; return original(...args); };
    return { store, reads };
  };

  test('every period type refuses tomorrow, a far-future date and the largest date, without reading facts', async () => {
    const { store, reads } = watched();
    for (const period of ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']) {
      for (const date of ['2026-10-19', '2030-01-01', '9999-12-31']) {
        const res = await timing(store, { period, date }, '2026-10-18T16:00:00.000Z'); // Oct 18, 12:00 EDT
        assert.equal(res.status, 400, `${period} ${date}`);
        assert.equal(res.body.code, 'INVALID_REQUEST');
        assert.deepEqual(res.body.fields, ['date']);
        assert.equal(res.body.timeToFirstResponse, undefined, 'no report');
        assert.equal(res.body.timeToRecordedService, undefined, 'no report');
        assert.equal(res.headers['cache-control'], 'no-store');
      }
    }
    assert.equal(reads.count, 0, 'timing facts were never read');
  });

  test('"today" follows New York midnight, in EDT and in EST', async () => {
    const { store, reads } = watched();
    for (const [before, midnight, today, tomorrow] of [
      ['2026-10-19T03:59:59.000Z', '2026-10-19T04:00:00.000Z', '2026-10-18', '2026-10-19'], // EDT
      ['2026-12-02T04:59:59.000Z', '2026-12-02T05:00:00.000Z', '2026-12-01', '2026-12-02'], // EST
    ]) {
      for (const period of ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']) {
        const current = await timing(store, { period, date: today }, before);
        assert.equal(current.status, 200, `${period} ${today} at ${before}`);
        assert.equal(current.body.partial, true);

        const readsBefore = reads.count;
        const future = await timing(store, { period, date: tomorrow }, before);
        assert.equal(future.status, 400, `${period} ${tomorrow} at ${before}`);
        assert.deepEqual(future.body.fields, ['date']);
        assert.equal(reads.count, readsBefore, 'refused before reading timing facts');

        const arrived = await timing(store, { period, date: tomorrow }, midnight);
        assert.equal(arrived.status, 200, `${period} ${tomorrow} at ${midnight}`);
      }
    }
  });

  test('with no date, "today" is the New York date (11:30 PM EDT on Oct 31 is still October)', async () => {
    // The UTC date is already Nov 1; New York is still Oct 31.
    const res = await timing(build(), { period: 'MONTHLY' }, '2026-11-01T03:30:00.000Z');
    assert.equal(res.status, 200);
    assert.equal(res.body.period.label, '2026-10');
  });

  test('Total Referrals and Timing Metrics accept and refuse exactly the same dates (one shared resolver)', async () => {
    const store = build();
    const nowIso = '2026-12-02T04:59:59.000Z'; // Dec 1, 23:59:59 EST
    for (const period of ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']) {
      for (const date of ['2026-07-01', '2026-12-01', '2026-12-02', '2027-01-01', '2026-02-30', 'tomorrow']) {
        const a = await request(at(store, nowIso)).get('/api/reports/total-referrals').query({ period, date });
        const b = await timing(store, { period, date }, nowIso);
        assert.equal(a.status, b.status, `${period} ${date}`);
        assert.deepEqual(a.body.fields, b.body.fields, `${period} ${date}`);
        if (a.status === 200) assert.deepEqual(a.body.period, b.body.period);
      }
    }
  });
});
