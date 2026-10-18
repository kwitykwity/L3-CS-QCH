// Total Referrals (Trello card 9, PRD 12.2, 12.4, 12.5). All data is SYNTHETIC.
// Expected values below were worked out by hand from the PRD definitions,
// not by running the code under test.
//
// Fiscal year 2027 = Jul 1, 2026 - Jun 30, 2027 (named for the year it ends).
// Reporting zone America/New_York: EDT (UTC-4) until Nov 1, 2026, then EST (UTC-5).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
import { createReferralService } from '../src/referrals/referralService.js';
import { periodContaining } from '../src/reporting/periods.js';

const A = 100;  // affiliated with Program 10 (Department 1)
const B = 101;  // affiliated with Program 11 (Department 2)
const C = 102;  // affiliated with Program 12 (Department 2)

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
    ],
    grants: [],
  }, { now: () => clock });
}

const body = (receivingProgramId) => ({
  submissionId: randomUUID(),
  receivingProgramId,
  participantName: 'Synthetic Person',
  contactMethod: 'PHONE_CALL',
  contactValue: '555-010-0147',
  referralContext: 'Synthetic need',
});

// Creates a referral stamped at the given UTC instant.
async function send(store, isoUtc, userId, receivingProgramId) {
  clock = new Date(isoUtc);
  await createReferralService({ store }).createDirectReferral(userId, body(receivingProgramId));
}

async function seeded() {
  const store = build();
  // [UTC instant, who, to] with the New York wall time and period noted.
  await send(store, '2026-07-01T03:59:59.000Z', A, 11); // Jun 30 23:59:59 EDT  FY2026 (not FY2027)
  await send(store, '2026-07-01T04:00:00.000Z', A, 11); // Jul 1 00:00:00 EDT   FY2027 Q1 first instant
  await send(store, '2026-10-01T03:59:59.000Z', B, 12); // Sep 30 23:59:59 EDT  Q1 last instant
  await send(store, '2026-10-01T04:00:00.000Z', B, 10); // Oct 1 00:00:00 EDT   Q2 first instant
  await send(store, '2026-10-14T19:42:00.000Z', A, 11); // Oct 14 15:42 EDT     Q2
  await send(store, '2026-10-14T19:43:00.000Z', A, 11); // same pair again: a new referral, counted again
  await send(store, '2027-01-01T04:59:59.000Z', C, 11); // Dec 31 23:59:59 EST  Q2 last instant
  await send(store, '2027-01-01T05:00:00.000Z', C, 10); // Jan 1 00:00:00 EST   Q3 first instant
  await send(store, '2027-06-30T23:59:59.000Z', A, 12); // Jun 30 19:59:59 EDT  FY2027 Q4
  await send(store, '2027-07-01T03:59:59.000Z', A, 12); // Jun 30 23:59:59 EDT  FY2027 Q4 last instant
  await send(store, '2027-07-01T04:00:00.000Z', A, 12); // Jul 1 00:00:00 EDT   FY2028
  return store;
}

const signedIn = (req) => ({ userId: A });
function appFor(store, nowIso = '2026-10-18T16:00:00.000Z', resolveIdentity = signedIn) {
  return createApp({ referralStore: store, affiliationStore: store, resolveIdentity, now: () => new Date(nowIso) });
}
const total = async (store, query, nowIso) => {
  const res = await request(appFor(store, nowIso)).get('/api/reports/total-referrals').query(query);
  return res;
};

describe('period boundaries (PRD 12.2)', () => {
  test('FY2027 runs Jul 1, 2026 00:00 EDT to Jul 1, 2027 00:00 EDT', () => {
    const p = periodContaining('YEARLY', { year: 2026, month: 10, day: 18 });
    assert.equal(p.label, 'FY2027');
    assert.equal(p.start.toISOString(), '2026-07-01T04:00:00.000Z');
    assert.equal(p.end.toISOString(), '2027-07-01T04:00:00.000Z');
  });
  test('January belongs to the fiscal year that ends that June', () => {
    assert.equal(periodContaining('YEARLY', { year: 2027, month: 1, day: 15 }).label, 'FY2027');
    assert.equal(periodContaining('YEARLY', { year: 2027, month: 6, day: 30 }).label, 'FY2027');
    assert.equal(periodContaining('YEARLY', { year: 2027, month: 7, day: 1 }).label, 'FY2028');
  });
  test('fiscal quarters: Q1 Jul-Sep, Q2 Oct-Dec, Q3 Jan-Mar, Q4 Apr-Jun', () => {
    const label = (y, m) => periodContaining('QUARTERLY', { year: y, month: m, day: 15 }).label;
    assert.deepEqual(
      [label(2026, 7), label(2026, 9), label(2026, 10), label(2026, 12), label(2027, 1), label(2027, 3), label(2027, 4), label(2027, 6)],
      ['FY2027 Q1', 'FY2027 Q1', 'FY2027 Q2', 'FY2027 Q2', 'FY2027 Q3', 'FY2027 Q3', 'FY2027 Q4', 'FY2027 Q4'],
    );
  });
  test('Q2 spans the EDT to EST change: Oct 1 00:00 EDT to Jan 1 00:00 EST', () => {
    const p = periodContaining('QUARTERLY', { year: 2026, month: 11, day: 15 });
    assert.equal(p.start.toISOString(), '2026-10-01T04:00:00.000Z');
    assert.equal(p.end.toISOString(), '2027-01-01T05:00:00.000Z');
  });
  test('weeks are Sunday to Saturday, and the week containing Nov 1 changes offset', () => {
    // Oct 18, 2026 is a Sunday.
    const w = periodContaining('WEEKLY', { year: 2026, month: 10, day: 24 }); // Saturday
    assert.equal(w.startDate, '2026-10-18');
    assert.equal(w.endDate, '2026-10-25');
    const dst = periodContaining('WEEKLY', { year: 2026, month: 11, day: 1 }); // Sunday, clocks fall back at 2 AM
    assert.equal(dst.startDate, '2026-11-01');
    assert.equal(dst.start.toISOString(), '2026-11-01T04:00:00.000Z'); // midnight is still EDT
    assert.equal(dst.end.toISOString(), '2026-11-08T05:00:00.000Z');   // next midnight is EST
  });
  test('monthly is the calendar month', () => {
    const m = periodContaining('MONTHLY', { year: 2027, month: 2, day: 10 });
    assert.equal(m.startDate, '2027-02-01');
    assert.equal(m.endDate, '2027-03-01');
  });
});

describe('Total Referrals known answers (PRD 12.4)', () => {
  test('FY2027 organization total is 9 (instants one second outside either end are excluded)', async () => {
    const store = await seeded();
    const res = await total(store, { period: 'YEARLY', date: '2026-10-18' });
    assert.equal(res.status, 200);
    assert.equal(res.body.value, 9);
    assert.equal(res.body.period.label, 'FY2027');
  });

  test('quarters: Q1 = 2, Q2 = 4, Q3 = 1, Q4 = 2', async () => {
    const store = await seeded();
    const q = async (date) => (await total(store, { period: 'QUARTERLY', date })).body.value;
    assert.equal(await q('2026-08-15'), 2); // Jul 1 00:00 and Sep 30 23:59:59
    assert.equal(await q('2026-11-15'), 4); // Oct 1 00:00, two on Oct 14, Dec 31 23:59:59
    assert.equal(await q('2027-02-15'), 1); // Jan 1 00:00
    assert.equal(await q('2027-05-15'), 2); // two on Jun 30 (EDT)
  });

  test('the same sender and Program referred twice is two referrals', async () => {
    const store = await seeded();
    const res = await total(store, { period: 'WEEKLY', date: '2026-10-14' }); // Oct 11-17
    assert.equal(res.body.value, 2);
  });

  test('month and week windows', async () => {
    const store = await seeded();
    assert.equal((await total(store, { period: 'MONTHLY', date: '2026-10-20' })).body.value, 3); // Oct 1, Oct 14 x2
    assert.equal((await total(store, { period: 'MONTHLY', date: '2026-11-20' })).body.value, 0);
    assert.equal((await total(store, { period: 'WEEKLY', date: '2026-10-01' })).body.value, 2);   // Sep 27 - Oct 3: Sep 30 23:59:59 and Oct 1 00:00:00
  });

  // FY2027 referrals (sender Program > receiving Program), numbered 1-9:
  //  1 Jul 1   10>11    2 Sep 30  11>12    3 Oct 1   11>10
  //  4 Oct 14  10>11    5 Oct 14  10>11    6 Dec 31  12>11
  //  7 Jan 1   12>10    8 Jun 30  10>12    9 Jun 30  10>12
  // Program 10 is on 1,3,4,5,7,8,9 = 7.  Program 11: 1,2,3,4,5,6 = 6.  Program 12: 2,6,7,8,9 = 5.
  // Department 1 = Program 10 only = 7.  Department 2 = Programs 11 and 12: all 9, because
  // #2 and #6 are made AND received inside Department 2 and must be counted once, not twice.
  test('Program scope counts referrals made OR received, each once', async () => {
    const store = await seeded();
    const p = async (programId) => (await total(store, { period: 'YEARLY', date: '2026-10-18', programId })).body.value;
    assert.equal(await p(10), 7);
    assert.equal(await p(11), 6);
    assert.equal(await p(12), 5);
  });

  test('Department scope counts a referral once even when made and received inside it', async () => {
    const store = await seeded();
    const d = async (departmentId) => (await total(store, { period: 'YEARLY', date: '2026-10-18', departmentId })).body.value;
    assert.equal(await d(1), 7);
    assert.equal(await d(2), 9);
  });

  test('Department history: moving a Program later does not change past counts', async () => {
    const store = await seeded();
    // Rows keep the Department stored at creation (PRD 12.4). Re-point Program 10 afterwards.
    (await store.getProgram(10)).departmentId = 2;
    const res = await total(store, { period: 'YEARLY', date: '2026-10-18', departmentId: 1 });
    assert.equal(res.body.value, 7);
  });

  test('an empty period is a real zero', async () => {
    const store = await seeded();
    const res = await total(store, { period: 'MONTHLY', date: '2026-11-20' });
    assert.equal(res.body.value, 0);
  });

  test('partial period is flagged with its as-of time', async () => {
    const store = await seeded();
    const now = (await total(store, { period: 'QUARTERLY', date: '2026-10-18' }, '2026-10-18T16:00:00.000Z')).body;
    assert.equal(now.partial, true);
    assert.equal(now.asOf, '2026-10-18T16:00:00.000Z');
    const past = (await total(store, { period: 'QUARTERLY', date: '2026-08-15' }, '2026-10-18T16:00:00.000Z')).body;
    assert.equal(past.partial, false);
  });

  test('date defaults to today in New York (11 PM EDT on Oct 18 is already Oct 19 UTC)', async () => {
    const store = await seeded();
    const res = await total(store, { period: 'WEEKLY' }, '2026-10-19T03:30:00.000Z'); // Oct 18, 11:30 PM EDT
    assert.equal(res.body.period.start, '2026-10-18');
  });
});

describe('response and access rules', () => {
  test('response is aggregate only: no referral IDs, names, or contact details', async () => {
    const store = await seeded();
    const res = await total(store, { period: 'YEARLY', date: '2026-10-18' });
    assert.deepEqual(Object.keys(res.body).sort(), ['asOf', 'metric', 'partial', 'period', 'scope', 'value']);
    const text = JSON.stringify(res.body);
    assert.ok(!/Synthetic Person|555-010|referralId|submissionId/.test(text));
    assert.equal(res.headers['cache-control'], 'no-store');
  });

  test('no identity -> 401, and no number is returned', async () => {
    const store = await seeded();
    const res = await request(appFor(store, undefined, () => null)).get('/api/reports/total-referrals').query({ period: 'YEARLY' });
    assert.equal(res.status, 401);
    assert.equal(res.body.value, undefined);
  });

  test('no store configured -> 503', async () => {
    const app = createApp({ resolveIdentity: signedIn });
    const res = await request(app).get('/api/reports/total-referrals').query({ period: 'YEARLY' });
    assert.equal(res.status, 503);
  });

  test('any signed-in user may view it, including one with no grants', async () => {
    const store = await seeded();
    const res = await request(appFor(store, undefined, () => ({ userId: B }))).get('/api/reports/total-referrals').query({ period: 'YEARLY', date: '2026-10-18' });
    assert.equal(res.status, 200);
  });

  test('invalid filters are refused (PRD 12.7)', async () => {
    const store = await seeded();
    const bad = [
      {},                                                       // period required
      { period: 'DAILY' },
      { period: 'YEARLY', date: '2026-02-30' },
      { period: 'YEARLY', date: '10/18/2026' },
      { period: 'YEARLY', programId: 'abc' },
      { period: 'YEARLY', programId: '10', departmentId: '1' }, // not both
      { period: 'YEARLY', programId: '999' },                   // unknown Program is not zero
      { period: 'YEARLY', departmentId: '999' },
      { period: 'YEARLY', userId: '100' },                      // identity never from the query
    ];
    for (const query of bad) {
      const res = await total(store, query);
      assert.equal(res.status, 400, JSON.stringify(query));
      assert.equal(res.body.value, undefined);
    }
  });
});
