// Reporting journey through the integrated app (Trello: "Testing:
// Reporting browser journeys", API part; Final Technical PRD 12.2 to 12.7,
// 17.6). The browser part waits for the Reporting UI; it will check the
// SAME KNOWN_ANSWERS on screen (reportingFixture.js).
//
// Covered: every period type, organization / Program / Department scope
// (including Department history after a Program moves), known answers for
// all three reports, Zero vs No Data vs Pending vs Unknown vs error,
// partial periods ("data as of"), and future-date refusal.
// All data is SYNTHETIC.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { AS_OF, IDS, KNOWN_ANSWERS, USERS, buildReportingWorld } from './reportingFixture.js';

const REPORTS = ['total-referrals', 'timing-metrics', 'referral-activity'];

// Averages can carry floating-point noise (sum / count); compare closely.
function assertTiming(actual, expected, label) {
  const { averageMs, ...rest } = expected;
  const { averageMs: got, ...gotRest } = actual;
  assert.deepEqual(gotRest, rest, label);
  if (averageMs === null) assert.equal(got, null, `${label} average`);
  else assert.ok(Math.abs(got - averageMs) < 1e-6, `${label} average ${got} != ${averageMs}`);
}

let world;
before(async () => {
  world = await buildReportingWorld();
});

describe('known answers: every period type, organization-wide (PRD 12.2, 12.4, 17.6)', () => {
  for (const [name, expected] of Object.entries(KNOWN_ANSWERS)) {
    test(`${name}: all three reports agree with the hand-worked answers`, async () => {
      const [total, timing, activity] = await Promise.all(REPORTS.map((r) => world.report(r, expected.query)));
      for (const res of [total, timing, activity]) {
        assert.equal(res.status, 200, `${res.req.path}: ${JSON.stringify(res.body)}`);
        assert.equal(res.headers['cache-control'], 'no-store');
        assert.equal(res.body.partial, expected.partial, `${res.req.path} partial`);
        assert.equal(res.body.asOf, AS_OF);
        assert.deepEqual(res.body.scope, { type: 'ORGANIZATION' });
        const { label, ...periodWithoutLabel } = expected.period;
        assert.deepEqual(label === undefined ? { ...res.body.period, label: undefined } : res.body.period,
          label === undefined ? { ...periodWithoutLabel, label: undefined } : expected.period, `${res.req.path} period`);
      }

      assert.equal(total.body.value, expected.total, 'Total Referrals');
      assert.equal(timing.body.cohortSize, expected.total, 'timing cohort = the same referrals');
      assert.equal(activity.body.summary.totalReferrals, expected.total, 'activity total = Total Referrals');

      assertTiming(timing.body.timeToFirstResponse, expected.timeToFirstResponse, 'Time to First Response');
      assertTiming(timing.body.timeToRecordedService, expected.timeToRecordedService, 'Time to Recorded Service');
      assert.deepEqual(activity.body.summary, expected.summary, 'activity summary');
    });
  }
});

describe('Zero vs No Data vs Pending vs Unknown vs error (PRD 12.6)', () => {
  test('an empty period is a real zero count, and every rate and time is "no data", never 0', async () => {
    const q = KNOWN_ANSWERS.EMPTY_JUNE.query;
    const total = await world.report('total-referrals', q);
    const timing = await world.report('timing-metrics', q);
    const activity = await world.report('referral-activity', q);
    assert.equal(total.body.value, 0);
    for (const t of [timing.body.timeToFirstResponse, timing.body.timeToRecordedService]) {
      assert.equal(t.status, 'N/A');
      assert.equal(t.averageMs, null);
      assert.equal(t.medianMs, null);
    }
    for (const r of ['acceptanceRate', 'notAppropriateRate', 'resultedInServiceRate']) {
      assert.equal(activity.body.summary[r].state, 'NO_DATA');
      assert.equal(activity.body.summary[r].value, null);
    }
    assert.deepEqual([activity.body.programs, activity.body.departments], [[], []]);
  });

  test('nothing decided yet is PENDING, not 0% (August: one referral awaiting a response)', async () => {
    const { body } = await world.report('referral-activity', KNOWN_ANSWERS.AUGUST.query);
    assert.equal(body.summary.acceptanceRate.state, 'PENDING');
    assert.equal(body.summary.acceptanceRate.value, null);
    const timing = await world.report('timing-metrics', KNOWN_ANSWERS.AUGUST.query);
    assert.deepEqual([timing.body.timeToFirstResponse.status, timing.body.timeToFirstResponse.pendingCount], ['N/A', 1]);
  });

  test('a real 0% is CALCULATED (September: the only outcome was corrected to Did Not Result)', async () => {
    const { body } = await world.report('referral-activity', KNOWN_ANSWERS.SEPTEMBER.query);
    assert.deepEqual(body.summary.resultedInServiceRate, { numerator: 0, denominator: 1, value: 0, state: 'CALCULATED' });
  });

  test('an unknown Program or Department is refused as Unknown, never reported as zero', async () => {
    for (const report of REPORTS) {
      for (const [query, field] of [[{ programId: '999' }, 'programId'], [{ departmentId: '999' }, 'departmentId']]) {
        const res = await world.report(report, { period: 'YEARLY', ...query });
        assert.equal(res.status, 400, `${report} ${field}`);
        assert.deepEqual(res.body.fields, [field]);
        assert.equal(res.body.value, undefined);
        assert.equal(res.body.summary, undefined);
        assert.equal(res.body.timeToFirstResponse, undefined);
      }
    }
  });

  test('a technical failure is an error with no numbers, never a zero', async () => {
    const saved = {
      countReferrals: world.store.countReferrals,
      listTimingFacts: world.store.listTimingFacts,
      aggregateReferrals: world.store.aggregateReferrals,
    };
    const fail = async () => { throw new Error('synthetic store failure'); };
    Object.assign(world.store, { countReferrals: fail, listTimingFacts: fail, aggregateReferrals: fail });
    const silenced = console.error;
    console.error = () => {};
    try {
      for (const report of REPORTS) {
        const res = await world.report(report, { period: 'MONTHLY' });
        assert.equal(res.status, 500, report);
        assert.deepEqual(res.body, { error: 'Internal Server Error' });
        assert.equal(res.headers['cache-control'], 'no-store');
      }
    } finally {
      console.error = silenced;
      Object.assign(world.store, saved);
    }
  });
});

describe('partial periods: "data as of" (PRD 12.6, wireframes)', () => {
  test('a period still in progress is partial; a finished one is not; both name the as-of time', async () => {
    for (const report of REPORTS) {
      const current = await world.report(report, KNOWN_ANSWERS.OCTOBER.query);
      const finished = await world.report(report, KNOWN_ANSWERS.Q1.query);
      assert.deepEqual([current.body.partial, finished.body.partial], [true, false], report);
      assert.equal(current.body.asOf, AS_OF);
    }
  });

  test('the same period is partial before its last instant and complete after it (New York time)', async () => {
    const q = KNOWN_ANSWERS.Q1.query;
    const inProgress = await world.report('total-referrals', q, { asOf: '2026-10-01T03:59:59.000Z' }); // Sep 30 23:59:59 EDT
    const done = await world.report('total-referrals', q, { asOf: '2026-10-01T04:00:00.000Z' });       // Oct 1 00:00 EDT
    assert.deepEqual([inProgress.body.partial, done.body.partial], [true, false]);
  });

  test('with no date, the report is for today in New York', async () => {
    const res = await world.report('referral-activity', { period: 'MONTHLY' });
    assert.equal(res.body.period.label, '2026-10');
    assert.equal(res.body.summary.totalReferrals, KNOWN_ANSWERS.OCTOBER.total);
  });
});

describe('future and out-of-range dates are refused, never reported (PRD 12.6)', () => {
  test('tomorrow in New York is refused by every report and every period type; today is fine', async () => {
    for (const report of REPORTS) {
      for (const period of ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']) {
        const tomorrow = await world.report(report, { period, date: '2026-10-25' });
        assert.equal(tomorrow.status, 400, `${report} ${period}`);
        assert.equal(tomorrow.body.code, 'INVALID_REQUEST');
        assert.deepEqual(tomorrow.body.fields, ['date']);
        const today = await world.report(report, { period, date: '2026-10-24' });
        assert.equal(today.status, 200, `${report} ${period} today`);
      }
    }
  });

  test('"tomorrow" follows New York midnight, not UTC (Oct 24 23:30 EDT is already Oct 25 in UTC)', async () => {
    const lateEvening = { asOf: '2026-10-25T03:30:00.000Z' };
    assert.equal((await world.report('total-referrals', { period: 'MONTHLY', date: '2026-10-25' }, lateEvening)).status, 400);
    assert.equal((await world.report('total-referrals', { period: 'MONTHLY', date: '2026-10-24' }, lateEvening)).status, 200);
  });

  test('far-future and pre-2000 dates are refused too', async () => {
    for (const report of REPORTS) {
      for (const date of ['2030-01-01', '9999-12-31', '1999-12-31']) {
        const res = await world.report(report, { period: 'MONTHLY', date });
        assert.equal(res.status, 400, `${report} ${date}`);
        assert.deepEqual(res.body.fields, ['date']);
      }
    }
  });
});

describe('scope: Program and Department, with history (PRD 12.4, 12.7)', () => {
  test('Program scope counts referrals made OR received by it, each once, in every report', async () => {
    const q = { period: 'YEARLY', date: '2026-10-24', programId: String(IDS.P12) };
    const total = await world.report('total-referrals', q);
    const timing = await world.report('timing-metrics', q);
    const activity = await world.report('referral-activity', q);
    // Made by P12: A3 A4 A7. Received by P12: A1 A2 A8 A9. Union = 7.
    assert.equal(total.body.value, 7);
    assert.deepEqual(total.body.scope, { type: 'PROGRAM', programId: IDS.P12 });
    assert.equal(timing.body.cohortSize, 7);
    // First (h): A1 2, A2 4, A3 1, A4 24, A7 1, A9 3 -> sorted 1 1 2 3 4 24,
    // median (2 + 3) / 2 = 2.5, average 35 / 6; awaiting A8.
    assertTiming(timing.body.timeToFirstResponse, { status: 'OK', qualifyingCount: 6, pendingCount: 1, averageMs: (35 / 6) * 3600000, medianMs: 2.5 * 3600000 }, 'P12 first response');
    // Reached Resulted: A1 72, A7 24 -> median 48, average 48; pending A4, A9.
    assertTiming(timing.body.timeToRecordedService, { status: 'OK', qualifyingCount: 2, pendingCount: 2, averageMs: 48 * 3600000, medianMs: 48 * 3600000 }, 'P12 recorded service');
    assert.equal(activity.body.summary.totalReferrals, 7);
    assert.deepEqual([activity.body.summary.made, activity.body.summary.received], [3, 4]);
    assert.deepEqual(activity.body.summary.acceptanceRate, { numerator: 3, denominator: 3, value: 100, state: 'CALCULATED' });
    assert.deepEqual(activity.body.summary.resultedInServiceRate, { numerator: 1, denominator: 2, value: 50, state: 'CALCULATED' });
  });

  test('Department scope uses the Department at creation: moving Program 12 later changes no past count', async () => {
    const year = { period: 'YEARLY', date: '2026-10-24' };
    // D2 (P12, P13 at creation): every referral except A5 (P10 -> P11) = 8.
    // If the CURRENT Department were used, D2 would be only A4, A6 = 2.
    // D1 (P10, P11): every referral except A4 (P12 -> P13) = 8, not 9.
    const d1 = await world.report('total-referrals', { ...year, departmentId: String(IDS.D1) });
    const d2 = await world.report('total-referrals', { ...year, departmentId: String(IDS.D2) });
    assert.deepEqual([d1.body.value, d2.body.value], [8, 8]);
    for (const report of ['timing-metrics', 'referral-activity']) {
      const r1 = await world.report(report, { ...year, departmentId: String(IDS.D1) });
      const r2 = await world.report(report, { ...year, departmentId: String(IDS.D2) });
      const size = (b) => b.cohortSize ?? b.summary.totalReferrals;
      assert.deepEqual([size(r1.body), size(r2.body)], [8, 8], report);
    }
    assert.equal((await world.store.getProgram(IDS.P12)).departmentId, IDS.D1, 'the Program really did move');
  });

  test('Program and Department breakdowns (organization-wide year)', async () => {
    const { body } = await world.report('referral-activity', KNOWN_ANSWERS.YEAR.query);
    const pick = (row) => ({
      made: row.made, received: row.received, accepted: row.accepted, notAppropriate: row.notAppropriate,
      awaitingResponse: row.awaitingResponse, acceptance: [row.acceptanceRate.value, row.acceptanceRate.state],
      resulted: [row.resultedInServiceRate.value, row.resultedInServiceRate.state],
    });
    assert.deepEqual(Object.fromEntries(body.programs.map((p) => [p.programId, pick(p)])), {
      // P10 made A1 A2 A5 A6 A8 A9; received A7 (accepted, resulted).
      10: { made: 6, received: 1, accepted: 1, notAppropriate: 0, awaitingResponse: 0, acceptance: [100, 'CALCULATED'], resulted: [100, 'CALCULATED'] },
      // P11 received A3 (not appropriate) and A5 (awaiting): 0%, and no outcome possible.
      11: { made: 0, received: 2, accepted: 0, notAppropriate: 1, awaitingResponse: 1, acceptance: [0, 'CALCULATED'], resulted: [null, 'NO_DATA'] },
      // P12 made A3 A4 A7; received A1 A2 A8 A9.
      12: { made: 3, received: 4, accepted: 3, notAppropriate: 0, awaitingResponse: 1, acceptance: [100, 'CALCULATED'], resulted: [50, 'CALCULATED'] },
      // P13 received A4 (no outcome yet) and A6 (Did Not, after correction).
      13: { made: 0, received: 2, accepted: 2, notAppropriate: 0, awaitingResponse: 0, acceptance: [100, 'CALCULATED'], resulted: [0, 'CALCULATED'] },
    });
    assert.deepEqual(Object.fromEntries(body.departments.map((d) => [d.departmentId, pick(d)])), {
      // D1 made 6 (by P10); received 3 (A3, A5 by P11; A7 by P10).
      1: { made: 6, received: 3, accepted: 1, notAppropriate: 1, awaitingResponse: 1, acceptance: [50, 'CALCULATED'], resulted: [100, 'CALCULATED'] },
      // D2 made 3 (by P12, its Department at the time); received 6.
      2: { made: 3, received: 6, accepted: 5, notAppropriate: 0, awaitingResponse: 1, acceptance: [100, 'CALCULATED'], resulted: [33.33, 'CALCULATED'] },
    });
    // Department totals add up to the organization: made 6 + 3 = 9, received 3 + 6 = 9.
    assert.equal(body.departments.reduce((n, d) => n + d.made, 0), body.summary.made);
    assert.equal(body.departments.reduce((n, d) => n + d.received, 0), body.summary.received);
  });
});

describe('access and privacy (PRD 3.5, 12.1)', () => {
  test('any active user sees the aggregate reports; inactive users do not', async () => {
    for (const report of REPORTS) {
      for (const userId of [USERS.NO_GRANTS, USERS.WORKER_FAMILY, USERS.RECEIVER, USERS.ORG_ADMIN]) {
        assert.equal((await world.report(report, { period: 'YEARLY' }, { userId })).status, 200, `${report} ${userId}`);
      }
      assert.equal((await world.report(report, { period: 'YEARLY' }, { userId: USERS.INACTIVE })).status, 403, report);
    }
  });

  test('reports are aggregate only: no referral IDs, names or needs', async () => {
    for (const report of REPORTS) {
      const res = await world.report(report, KNOWN_ANSWERS.YEAR.query);
      assert.doesNotMatch(res.text, /Synthetic Person|Synthetic need|referralId|submissionId|contact/i, report);
      for (const id of Object.values(world.ids)) assert.ok(!res.text.includes(`"referralId":${id}`), report);
    }
  });
});
