// Referral activity report (Trello card 12, PRD 12.3, 12.4, 12.6, 12.7).
// Replaces PR #29. All data is SYNTHETIC.
//
// Every referral below is created, answered, given an outcome, and
// corrected through the real services (card 7 responses, card 8 outcomes
// and corrections), and every expected number was worked out by hand from
// the PRD 12.4 definitions, not by running the code under test.
//
// Programs: 10 (Dept 1), 11 (Dept 2), 12 (Dept 2).
// Report: MONTHLY, October 2026 (America/New_York), viewed Oct 20, 2026.
//
//   #  made by -> received by   decision         outcome
//   1  P10 -> P11                ACCEPTED         RESULTED_IN_SERVICE
//   2  P10 -> P11                ACCEPTED         DID_NOT_RESULT_IN_SERVICE
//   3  P10 -> P11                ACCEPTED         NOT_RECORDED
//   4  P10 -> P11                NOT_APPROPRIATE  -
//   5  P11 -> P12                awaiting         -
//   6  P12 -> P10                NOT_APPROPRIATE  -
//   7  P12 -> P11                awaiting         -
//   plus one just before October and one just after (never counted).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
import { createReferralService } from '../src/referrals/referralService.js';
import { createResponseService } from '../src/referrals/responseService.js';
import { createOutcomeService } from '../src/referrals/outcomeService.js';
import { createReferralQueryService } from '../src/referrals/referralQueryService.js';
import { createReferralActivityService, ratio } from '../src/reporting/referralActivityService.js';

const A = 100; // affiliated with Program 10
const B = 101; // affiliated with Program 11
const C = 102; // affiliated with Program 12
const R10 = 110; const R11 = 111; const R12 = 112; // receiving staff
const NOW = '2026-10-20T16:00:00.000Z';
const MARKER = 'SyntheticMarkerPhi';

const g = (userId, permission, programId) => ({
  userId, permission, scopeType: 'PROGRAM', programId, departmentId: null, grantSource: 'IN_APP',
});

let clock;
function build() {
  clock = new Date('2026-09-01T12:00:00.000Z');
  return createMemoryReferralStore({
    departments: [
      { departmentId: 1, name: 'Synthetic Dept A', lifecycleStatus: 'ACTIVE' },
      { departmentId: 2, name: 'Synthetic Dept B', lifecycleStatus: 'ACTIVE' },
    ],
    programs: [
      { programId: 10, departmentId: 1, name: 'Synthetic Program Ten', site: null, lifecycleStatus: 'ACTIVE' },
      { programId: 11, departmentId: 2, name: 'Synthetic Program Eleven', site: null, lifecycleStatus: 'ACTIVE' },
      { programId: 12, departmentId: 2, name: 'Synthetic Program Twelve', site: null, lifecycleStatus: 'ACTIVE' },
    ],
    users: [
      { userId: A, isActive: true, currentProgramId: 10 },
      { userId: B, isActive: true, currentProgramId: 11 },
      { userId: C, isActive: true, currentProgramId: 12 },
      { userId: R10, isActive: true }, { userId: R11, isActive: true }, { userId: R12, isActive: true },
    ],
    grants: [
      ...[[R10, 10], [R11, 11], [R12, 12]].flatMap(([u, p]) => [
        'VIEW_RECEIVED_REFERRAL', 'RESPOND_TO_REFERRAL', 'RECORD_OUTCOME', 'CORRECT_OUTCOME', 'UPDATE_RECEIVED_REFERRAL',
      ].map((permission) => g(u, permission, p))),
    ],
    notAppropriateReasons: [{ reasonId: 1, code: 'PROGRAM_CRITERIA_NOT_MET', label: 'Program criteria not met', displayOrder: 1 }],
  }, { now: () => clock });
}

const RECEIVER = { 10: R10, 11: R11, 12: R12 };

async function send(store, isoUtc, userId, to, decision = null, outcome = null) {
  clock = new Date(isoUtc);
  const { referral } = await createReferralService({ store }).createDirectReferral(userId, {
    submissionId: randomUUID(),
    receivingProgramId: to,
    participantName: 'Synthetic Person',
    contactMethod: 'PHONE_CALL',
    contactValue: '555-010-0147',
    referralContext: 'Synthetic need',
  });
  if (decision) {
    await createResponseService({ store }).respond(RECEIVER[to], referral.referralId,
      decision === 'ACCEPTED' ? { decision } : { decision, reasonId: 1 });
  }
  if (outcome) await createOutcomeService({ store }).recordOutcome(RECEIVER[to], referral.referralId, { outcome });
  return referral.referralId;
}

// The current version of a referral, as its receiving Program sees it.
async function versionOf(store, referralId, receivingProgramId) {
  const { referral } = await createReferralQueryService({ store }).getReferral(RECEIVER[receivingProgramId], referralId);
  return referral.version;
}

async function seeded() {
  const store = build();
  await send(store, '2026-10-01T03:59:59.000Z', A, 11, 'ACCEPTED'); // Sep 30 23:59:59 EDT: September
  const ids = [];
  ids.push(await send(store, '2026-10-01T04:00:00.000Z', A, 11, 'ACCEPTED', 'RESULTED_IN_SERVICE')); // Oct 1 00:00 EDT
  ids.push(await send(store, '2026-10-02T14:00:00.000Z', A, 11, 'ACCEPTED', 'DID_NOT_RESULT_IN_SERVICE'));
  ids.push(await send(store, '2026-10-03T14:00:00.000Z', A, 11, 'ACCEPTED'));
  ids.push(await send(store, '2026-10-04T14:00:00.000Z', A, 11, 'NOT_APPROPRIATE'));
  ids.push(await send(store, '2026-10-05T14:00:00.000Z', B, 12));
  ids.push(await send(store, '2026-10-06T14:00:00.000Z', C, 10, 'NOT_APPROPRIATE'));
  ids.push(await send(store, '2026-10-07T14:00:00.000Z', C, 11));
  await send(store, '2026-11-01T04:00:00.000Z', A, 11, 'ACCEPTED'); // Nov 1 00:00 EDT: November
  clock = new Date(NOW);
  return { store, ids };
}

const service = (store) => createReferralActivityService({ store, now: () => new Date(NOW) });
const october = (extra = {}) => ({ periodType: 'MONTHLY', date: { year: 2026, month: 10, day: 15 }, ...extra });
const calc = (numerator, denominator, value) => ({ numerator, denominator, value, state: 'CALCULATED' });
const byId = (list, key, id) => list.find((x) => x[key] === id);

describe('organization-wide, October 2026 (hand-computed)', () => {
  test('summary: 7 referrals; rates follow PRD 12.4', async () => {
    const { store } = await seeded();
    const r = await service(store).getReferralActivity(october());
    assert.equal(r.period.label, '2026-10');
    assert.deepEqual(r.scope, { type: 'ORGANIZATION' });
    const s = r.summary;
    assert.deepEqual(
      [s.totalReferrals, s.made, s.received, s.accepted, s.notAppropriate, s.awaitingResponse, s.resultedInService, s.didNotResultInService],
      [7, 7, 7, 3, 2, 2, 1, 1],
    );
    assert.deepEqual(s.acceptanceRate, calc(3, 5, 60));       // 3 / (3 + 2)
    assert.deepEqual(s.notAppropriateRate, calc(2, 5, 40));   // 2 / (3 + 2)
    assert.deepEqual(s.resultedInServiceRate, calc(1, 2, 50)); // 1 / (1 + 1); #3 not recorded is excluded
    assert.equal(r.partial, true);
  });

  test('by Program: made by referring Program, received by receiving Program', async () => {
    const { store } = await seeded();
    const { programs } = await service(store).getReferralActivity(october());
    assert.deepEqual(programs.map((p) => [p.programId, p.name, p.made, p.received]),
      [[10, 'Synthetic Program Ten', 4, 1], [11, 'Synthetic Program Eleven', 1, 5], [12, 'Synthetic Program Twelve', 2, 1]]);
    const p11 = byId(programs, 'programId', 11);
    assert.deepEqual([p11.accepted, p11.notAppropriate, p11.awaitingResponse], [3, 1, 1]);
    assert.deepEqual(p11.acceptanceRate, calc(3, 4, 75));
    assert.deepEqual(p11.resultedInServiceRate, calc(1, 2, 50));
    // Program 10 decided one referral and declined it: a real 0%, not N/A.
    assert.deepEqual(byId(programs, 'programId', 10).acceptanceRate, calc(0, 1, 0));
  });

  test('truth states (PRD 12.6): nothing decided yet is PENDING, nothing to measure is NO_DATA, never 0%', async () => {
    const { store } = await seeded();
    const p12 = byId((await service(store).getReferralActivity(october())).programs, 'programId', 12);
    assert.deepEqual(p12.acceptanceRate, { numerator: 0, denominator: 0, value: null, state: 'PENDING' }); // #5 awaiting
    assert.deepEqual(p12.resultedInServiceRate, { numerator: 0, denominator: 0, value: null, state: 'NO_DATA' });
    // One accepted referral with no outcome yet: Resulted in Service is
    // PENDING (it can still resolve), not 0% and not NO_DATA.
    const fresh = build();
    await send(fresh, '2026-10-05T14:00:00.000Z', A, 11, 'ACCEPTED');
    clock = new Date(NOW);
    const one = await service(fresh).getReferralActivity(october());
    assert.deepEqual(one.summary.resultedInServiceRate, { numerator: 0, denominator: 0, value: null, state: 'PENDING' });
    assert.deepEqual(one.summary.acceptanceRate, calc(1, 1, 100));
    assert.deepEqual(ratio(0, 0, 0).state, 'NO_DATA');
    assert.deepEqual(ratio(0, 0, 3).state, 'PENDING');
  });

  test('by Department: the Department each Program had at creation', async () => {
    const { store } = await seeded();
    const { departments } = await service(store).getReferralActivity(october());
    assert.deepEqual(departments.map((d) => [d.departmentId, d.name, d.made, d.received]),
      [[1, 'Synthetic Dept A', 4, 1], [2, 'Synthetic Dept B', 3, 6]]);
    // Dept 2 rates come from summed counts (3 / (3 + 1)), not an average of Program rates.
    assert.deepEqual(byId(departments, 'departmentId', 2).acceptanceRate, calc(3, 4, 75));
  });
});

describe('scopes', () => {
  test('Program 11: total counts made OR received once; each side counts its own role', async () => {
    const { store } = await seeded();
    const r = await service(store).getReferralActivity(october({ programId: 11 }));
    assert.deepEqual(r.scope, { type: 'PROGRAM', programId: 11 });
    assert.deepEqual([r.summary.totalReferrals, r.summary.made, r.summary.received], [6, 1, 5]); // #1-5, #7
    assert.deepEqual(r.summary.acceptanceRate, calc(3, 4, 75));
    assert.deepEqual(r.programs.map((p) => p.programId), [11]);
    assert.deepEqual(r.departments.map((d) => [d.departmentId, d.made, d.received]), [[2, 1, 5]]);
  });

  test('Department 1: made by its Programs and received by its Programs', async () => {
    const { store } = await seeded();
    const r = await service(store).getReferralActivity(october({ departmentId: 1 }));
    assert.deepEqual([r.summary.totalReferrals, r.summary.made, r.summary.received], [5, 4, 1]); // #1-4, #6
    assert.deepEqual(r.summary.acceptanceRate, calc(0, 1, 0));
    assert.deepEqual(r.programs.map((p) => [p.programId, p.made, p.received]), [[10, 4, 1]]);
  });

  test('a referral made and received inside the same Department counts once in its total, once on each side', async () => {
    const { store } = await seeded();
    const r = await service(store).getReferralActivity(october({ departmentId: 2 }));
    // #5 (P11 -> P12) and #7 (P12 -> P11) are inside Dept 2.
    assert.equal(r.summary.totalReferrals, 7);
    assert.deepEqual([r.summary.made, r.summary.received], [3, 6]);
  });
});

describe('history and corrections (PRD 12.4)', () => {
  test('a Program that changes Department: past referrals keep the old Department; the Program stays one row', async () => {
    const { store } = await seeded();
    store._setProgramDepartment(10, 2);
    clock = new Date('2026-10-10T14:00:00.000Z');
    await send(store, '2026-10-10T14:00:00.000Z', A, 11); // made by P10, now in Dept 2
    clock = new Date(NOW);
    const r = await service(store).getReferralActivity(october());
    assert.deepEqual(byId(r.programs, 'programId', 10).made, 5, 'one Program row, not split by Department');
    assert.deepEqual(r.departments.map((d) => [d.departmentId, d.made]), [[1, 4], [2, 4]]);
  });

  test('a decision correction (real card 8 service) changes current-state counts but never moves the referral out of its period', async () => {
    const { store, ids } = await seeded();
    // #3 (Accepted, no outcome) is corrected to Not Appropriate, weeks later.
    clock = new Date(NOW);
    await createOutcomeService({ store }).correctResponse(R11, ids[2],
      { decision: 'NOT_APPROPRIATE', reasonId: 1, version: await versionOf(store, ids[2], 11) });
    const r = await service(store).getReferralActivity(october());
    assert.deepEqual([r.summary.totalReferrals, r.summary.accepted, r.summary.notAppropriate], [7, 2, 3]);
    assert.deepEqual(r.summary.acceptanceRate, calc(2, 5, 40));
  });
});

describe('outcome corrections (real card 8 service)', () => {
  test('correcting a recorded outcome moves it between Resulted and Did Not Result', async () => {
    const { store, ids } = await seeded();
    // #1 was Resulted in Service; corrected to Did Not Result in Service.
    await createOutcomeService({ store }).correctOutcome(R11, ids[0],
      { outcome: 'DID_NOT_RESULT_IN_SERVICE', version: await versionOf(store, ids[0], 11) });
    const r = await service(store).getReferralActivity(october());
    assert.deepEqual([r.summary.resultedInService, r.summary.didNotResultInService], [0, 2]);
    assert.deepEqual(r.summary.resultedInServiceRate, calc(0, 2, 0));
    assert.equal(r.summary.totalReferrals, 7);
  });

  test('correcting an outcome back to Not Recorded makes the rate PENDING again', async () => {
    const store = build();
    const id = await send(store, '2026-10-05T14:00:00.000Z', A, 11, 'ACCEPTED', 'RESULTED_IN_SERVICE');
    clock = new Date(NOW);
    assert.deepEqual((await service(store).getReferralActivity(october())).summary.resultedInServiceRate, calc(1, 1, 100));
    await createOutcomeService({ store }).correctOutcome(R11, id, { outcome: 'NOT_RECORDED', version: await versionOf(store, id, 11) });
    const after = (await service(store).getReferralActivity(october())).summary.resultedInServiceRate;
    assert.deepEqual(after, { numerator: 0, denominator: 0, value: null, state: 'PENDING' });
  });
});

describe('periods and dates', () => {
  test('a past period with no referrals is zero with NO_DATA rates, not an error', async () => {
    const { store } = await seeded();
    const r = await service(store).getReferralActivity({ periodType: 'MONTHLY', date: { year: 2026, month: 8, day: 1 } });
    assert.equal(r.summary.totalReferrals, 0);
    assert.equal(r.summary.acceptanceRate.state, 'NO_DATA');
    assert.deepEqual([r.programs, r.departments, r.partial], [[], [], false]);
  });

  test('a period that has not started is refused (not reported as zero)', async () => {
    const { store } = await seeded();
    const err = await service(store).getReferralActivity({ periodType: 'MONTHLY', date: { year: 2026, month: 11, day: 1 } })
      .catch((e) => e);
    assert.deepEqual([err.code, err.fields], ['INVALID_REQUEST', ['date']]);
  });

  test('dates before 2000 are refused', async () => {
    const { store } = await seeded();
    const err = await service(store).getReferralActivity({ periodType: 'YEARLY', date: { year: 1999, month: 12, day: 31 } })
      .catch((e) => e);
    assert.deepEqual(err.fields, ['date']);
  });

  test('unknown Program or Department is refused, not reported as zero', async () => {
    const { store } = await seeded();
    for (const extra of [{ programId: 99 }, { departmentId: 99 }]) {
      const err = await service(store).getReferralActivity(october(extra)).catch((e) => e);
      assert.equal(err.code, 'INVALID_REQUEST');
    }
  });
});

describe('one consistent result (PRD 12.7)', () => {
  test('each report makes exactly one store read for its numbers', async () => {
    const { store } = await seeded();
    let reads = 0;
    const original = store.aggregateReferrals;
    store.aggregateReferrals = (...args) => { reads += 1; return original(...args); };
    store.countReferrals = () => { throw new Error('not used by this report'); };
    await service(store).getReferralActivity(october());
    assert.equal(reads, 1);
  });

  test('the summary always equals the sum of the breakdowns', async () => {
    const { store } = await seeded();
    const r = await service(store).getReferralActivity(october());
    for (const key of ['made', 'received', 'accepted', 'notAppropriate', 'awaitingResponse', 'resultedInService']) {
      assert.equal(r.programs.reduce((n, p) => n + p[key], 0), r.summary[key], key);
      assert.equal(r.departments.reduce((n, d) => n + d[key], 0), r.summary[key], key);
    }
  });
});

// Every report endpoint. All three share resolveReportQuery, so each must
// accept and refuse exactly the same dates.
const REPORTS = ['total-referrals', 'timing-metrics', 'referral-activity'];
const all = (value) => REPORTS.map(() => value);

describe('one date rule for every report (all three endpoints, HTTP)', () => {
  const appAt = (store, nowIso) => createApp({
    referralStore: store, affiliationStore: store, resolveIdentity: () => ({ userId: A }), nodeEnv: 'test', now: () => new Date(nowIso),
  });
  const statuses = async (store, nowIso, query) => {
    const app = appAt(store, nowIso);
    const out = [];
    for (const report of REPORTS) {
      const res = await request(app).get(`/api/reports/${report}`).query(query);
      out.push(res.status === 400 ? `400 ${res.body.fields}` : res.status);
    }
    return out;
  };

  test('a future date inside an already-started period is refused by every report', async () => {
    const { store } = await seeded();
    // Oct 20 noon EDT: October has started, but Oct 21 is still in the future.
    assert.deepEqual(await statuses(store, '2026-10-20T16:00:00.000Z', { period: 'MONTHLY', date: '2026-10-21' }), all('400 date'));
    assert.deepEqual(await statuses(store, '2026-10-20T16:00:00.000Z', { period: 'MONTHLY', date: '2026-10-20' }), all(200));
    assert.deepEqual(await statuses(store, '2026-10-20T16:00:00.000Z', { period: 'YEARLY', date: '2027-01-01' }), all('400 date'));
  });

  test('New York midnight in EDT: 11:59 PM on Oct 20 is still Oct 20, even though UTC says Oct 21', async () => {
    const { store } = await seeded();
    const late = '2026-10-21T03:59:59.000Z'; // Oct 20 23:59:59 EDT
    assert.deepEqual(await statuses(store, late, { period: 'WEEKLY', date: '2026-10-20' }), all(200));
    assert.deepEqual(await statuses(store, late, { period: 'WEEKLY', date: '2026-10-21' }), all('400 date'));
    const midnight = '2026-10-21T04:00:00.000Z'; // Oct 21 00:00:00 EDT
    assert.deepEqual(await statuses(store, midnight, { period: 'WEEKLY', date: '2026-10-21' }), all(200));
  });

  test('New York midnight in EST (after the clocks change): the boundary moves to 05:00 UTC', async () => {
    const { store } = await seeded();
    const late = '2026-12-01T04:59:59.000Z'; // Nov 30 23:59:59 EST
    assert.deepEqual(await statuses(store, late, { period: 'MONTHLY', date: '2026-11-30' }), all(200));
    assert.deepEqual(await statuses(store, late, { period: 'MONTHLY', date: '2026-12-01' }), all('400 date'));
    const midnight = '2026-12-01T05:00:00.000Z'; // Dec 1 00:00:00 EST
    assert.deepEqual(await statuses(store, midnight, { period: 'MONTHLY', date: '2026-12-01' }), all(200));
  });

  test('dates before 2000 are refused by every report; no date means today', async () => {
    const { store } = await seeded();
    assert.deepEqual(await statuses(store, NOW, { period: 'YEARLY', date: '1999-12-31' }), all('400 date'));
    assert.deepEqual(await statuses(store, NOW, { period: 'YEARLY', date: '2000-01-01' }), all(200));
    assert.deepEqual(await statuses(store, NOW, { period: 'MONTHLY' }), all(200));
  });
});

describe('HTTP: GET /api/reports/referral-activity', () => {
  const appFor = (store, userId = A) => createApp({
    referralStore: store, affiliationStore: store, resolveIdentity: () => (userId === null ? null : { userId }),
    nodeEnv: 'test', now: () => new Date(NOW),
  });
  const url = '/api/reports/referral-activity';

  test('any active signed-in user, no grant needed (PRD 3.5); aggregate only; never cached', async () => {
    const { store } = await seeded();
    const res = await request(appFor(store, C)).get(url).query({ period: 'MONTHLY', date: '2026-10-15' });
    assert.equal(res.status, 200);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.body.summary.totalReferrals, 7);
    const text = JSON.stringify(res.body);
    for (const secret of ['Synthetic Person', '555-010-0147', 'Synthetic need', 'referralId', 'submissionId']) {
      assert.ok(!text.includes(secret), secret);
    }
  });

  test('refusals: no identity, inactive or unknown user, bad or future query; nothing echoed', async () => {
    const { store } = await seeded();
    assert.equal((await request(appFor(store, null)).get(url).query({ period: 'MONTHLY' })).status, 401);
    assert.equal((await request(appFor(store, 999)).get(url).query({ period: 'MONTHLY' })).status, 403);
    store._setUserActive(B, false);
    assert.equal((await request(appFor(store, B)).get(url).query({ period: 'MONTHLY' })).status, 403);
    for (const query of [
      { period: 'MONTHLY', date: '2026-11-01' },
      { period: 'MONTHLY', date: '1999-01-01' },
      { period: 'MONTHLY', programId: '10', departmentId: '1' },
      { period: 'DAILY' },
    ]) {
      assert.equal((await request(appFor(store)).get(url).query(query)).status, 400, JSON.stringify(query));
    }
    const odd = await request(appFor(store)).get(url).query({ period: 'MONTHLY', [MARKER]: MARKER });
    assert.equal(odd.status, 400);
    assert.doesNotMatch(JSON.stringify(odd.body), new RegExp(MARKER));
  });
});
