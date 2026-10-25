// Reporting known-answer world (Trello: "Testing: Reporting browser
// journeys"; Final Technical PRD 12.2 to 12.7, 17.6). SYNTHETIC data only.
//
// Nine referrals in fiscal year 2027, created and moved through their
// lifecycle by the REAL HTTP API (send, respond, record outcome, correct),
// with a controlled clock. Then Program 12 moves from Department 2 to
// Department 1, so Department history can be checked.
//
// KNOWN_ANSWERS holds the expected numbers, worked out by hand from the
// table below (the arithmetic is written next to each one). The API
// journey (reportingJourney.test.js) checks them now; the browser
// journeys will check the SAME numbers on screen once the Reporting UI
// exists, so the two can never disagree about what is right.
//
// Reporting zone America/New_York. "Today" for every report:
// AS_OF = Sat Oct 24, 2026, 12:00 EDT.
//
//  #   created (New York)        from -> to     what happens
//  A1  Jul 6  10:00              P10 -> P12     Accepted +2 h; Resulted +72 h
//  A2  Jul 13 09:00              P10 -> P12     Accepted +4 h; Did Not Result
//  A3  Jul 20 15:00              P12 -> P11     Not Appropriate +1 h
//  A4  Jul 31 23:30 (Aug 1 UTC)  P12 -> P13     Accepted +24 h; no outcome yet
//  A5  Aug 3  12:00              P10 -> P11     never answered
//  A6  Sep 30 23:59:59           P10 -> P13     Accepted +6 h; Resulted +48 h,
//                                               later corrected to Did Not
//  A7  Oct 1  00:00:00           P12 -> P10     Accepted +1 h; Resulted +24 h
//  A8  Oct 20 10:00              P10 -> P12     never answered
//  A9  Oct 21 10:00              P10 -> P12     Not Appropriate +3 h, later
//                                               corrected to Accepted; no outcome
//  Oct 23: Program 12 moves from Department 2 to Department 1.
//
// Departments at creation: D1 = P10, P11; D2 = P12, P13.

import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createMemoryReferralStore } from '../../src/referrals/memoryReferralStore.js';

export const AS_OF = '2026-10-24T16:00:00.000Z';
const H = 3600 * 1000;

export const USERS = Object.freeze({
  WORKER_FAMILY: 101,   // works in P10 (Department 1)
  WORKER_ADULT: 102,    // works in P12 (Department 2)
  RECEIVER: 201,        // receiving staff for P10 to P13: respond, record, correct
  ORG_ADMIN: 301,       // MANAGE_ORGANIZATION (moves the Program)
  NO_GRANTS: 401,       // any active user may view aggregate reporting (PRD 3.5)
  INACTIVE: 501,
});

export const IDS = Object.freeze({ D1: 1, D2: 2, P10: 10, P11: 11, P12: 12, P13: 13 });

function seedStore(clock) {
  const g = (userId, permission, programId, extra = {}) => ({
    userId, permission, scopeType: 'PROGRAM', programId, departmentId: null, grantSource: 'IN_APP', ...extra,
  });
  const receiving = ['VIEW_RECEIVED_REFERRAL', 'RESPOND_TO_REFERRAL', 'RECORD_OUTCOME', 'CORRECT_OUTCOME', 'UPDATE_RECEIVED_REFERRAL'];
  return createMemoryReferralStore({
    departments: [
      { departmentId: IDS.D1, name: 'Synthetic Family Services', lifecycleStatus: 'ACTIVE' },
      { departmentId: IDS.D2, name: 'Synthetic Adult Services', lifecycleStatus: 'ACTIVE' },
    ],
    programs: [
      { programId: IDS.P10, departmentId: IDS.D1, name: 'Synthetic Family Center', site: null, lifecycleStatus: 'ACTIVE' },
      { programId: IDS.P11, departmentId: IDS.D1, name: 'Synthetic Youth Jobs', site: null, lifecycleStatus: 'ACTIVE' },
      { programId: IDS.P12, departmentId: IDS.D2, name: 'Synthetic Adult Education', site: null, lifecycleStatus: 'ACTIVE' },
      { programId: IDS.P13, departmentId: IDS.D2, name: 'Synthetic Housing Desk', site: null, lifecycleStatus: 'ACTIVE' },
    ],
    users: [
      { userId: USERS.WORKER_FAMILY, isActive: true, currentProgramId: IDS.P10 },
      { userId: USERS.WORKER_ADULT, isActive: true, currentProgramId: IDS.P12 },
      { userId: USERS.RECEIVER, isActive: true, currentProgramId: IDS.P11 },
      { userId: USERS.ORG_ADMIN, isActive: true },
      { userId: USERS.NO_GRANTS, isActive: true },
      { userId: USERS.INACTIVE, isActive: false },
    ],
    grants: [
      ...[IDS.P10, IDS.P11, IDS.P12, IDS.P13].flatMap((p) => receiving.map((perm) => g(USERS.RECEIVER, perm, p))),
      g(USERS.ORG_ADMIN, 'MANAGE_ORGANIZATION', null, { scopeType: 'ORG' }),
    ],
    notAppropriateReasons: [{ reasonId: 1, code: 'PROGRAM_CRITERIA_NOT_MET', label: 'Program criteria not met', displayOrder: 1 }],
  }, { now: () => new Date(clock.now) });
}

// The timeline, in the order it happened. `at` is UTC.
const TIMELINE = [
  ['2026-07-06T14:00:00Z', 'send', 'A1', USERS.WORKER_FAMILY, IDS.P12],
  ['2026-07-06T16:00:00Z', 'accept', 'A1'],
  ['2026-07-09T14:00:00Z', 'record', 'A1', 'RESULTED_IN_SERVICE'],
  ['2026-07-13T13:00:00Z', 'send', 'A2', USERS.WORKER_FAMILY, IDS.P12],
  ['2026-07-13T17:00:00Z', 'accept', 'A2'],
  ['2026-07-20T13:00:00Z', 'record', 'A2', 'DID_NOT_RESULT_IN_SERVICE'],
  ['2026-07-20T19:00:00Z', 'send', 'A3', USERS.WORKER_ADULT, IDS.P11],
  ['2026-07-20T20:00:00Z', 'notAppropriate', 'A3'],
  ['2026-08-01T03:30:00Z', 'send', 'A4', USERS.WORKER_ADULT, IDS.P13], // Jul 31 23:30 EDT
  ['2026-08-02T03:30:00Z', 'accept', 'A4'],
  ['2026-08-03T16:00:00Z', 'send', 'A5', USERS.WORKER_FAMILY, IDS.P11],
  ['2026-10-01T03:59:59Z', 'send', 'A6', USERS.WORKER_FAMILY, IDS.P13], // Sep 30 23:59:59 EDT
  ['2026-10-01T04:00:00Z', 'send', 'A7', USERS.WORKER_ADULT, IDS.P10], // Oct 1 00:00:00 EDT
  ['2026-10-01T05:00:00Z', 'accept', 'A7'],
  ['2026-10-01T09:59:59Z', 'accept', 'A6'],
  ['2026-10-02T04:00:00Z', 'record', 'A7', 'RESULTED_IN_SERVICE'],
  ['2026-10-03T03:59:59Z', 'record', 'A6', 'RESULTED_IN_SERVICE'],
  ['2026-10-05T12:00:00Z', 'correctOutcome', 'A6', 'DID_NOT_RESULT_IN_SERVICE'],
  ['2026-10-20T14:00:00Z', 'send', 'A8', USERS.WORKER_FAMILY, IDS.P12],
  ['2026-10-21T14:00:00Z', 'send', 'A9', USERS.WORKER_FAMILY, IDS.P12],
  ['2026-10-21T17:00:00Z', 'notAppropriate', 'A9'],
  ['2026-10-22T14:00:00Z', 'correctDecision', 'A9', 'ACCEPTED'],
  ['2026-10-23T14:00:00Z', 'moveProgram', IDS.P12, IDS.D1],
];

// Builds the world through the real API. Returns the store, the referral
// IDs, and `report(path, query, { asOf, userId })` for reading reports.
export async function buildReportingWorld() {
  const clock = { now: TIMELINE[0][0] };
  const store = seedStore(clock);
  let actor = null;
  const app = createApp({
    affiliationStore: store,
    referralStore: store,
    resolveIdentity: () => (actor ? { userId: actor } : null),
    now: () => new Date(clock.reportNow ?? clock.now),
  });
  const as = async (userId, method, url, body) => {
    actor = userId;
    const res = await request(app)[method](url).send(body);
    if (res.status >= 300) throw new Error(`${method} ${url} -> ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  };
  const versionOf = async (id) => (await as(USERS.RECEIVER, 'get', `/api/referrals/${id}`)).referral.version;

  const ids = {};
  for (const [at, action, ...args] of TIMELINE) {
    clock.now = at;
    if (action === 'send') {
      const [name, worker, programId] = args;
      const sent = await as(worker, 'post', '/api/referrals', {
        submissionId: randomUUID(),
        receivingProgramId: programId,
        participantName: `Synthetic Person ${name}`,
        contactMethod: 'NOT_AVAILABLE',
        referralContext: `Synthetic need ${name}`,
      });
      ids[name] = sent.referral.referralId;
    } else if (action === 'accept') {
      await as(USERS.RECEIVER, 'post', `/api/referrals/${ids[args[0]]}/response`, { decision: 'ACCEPTED' });
    } else if (action === 'notAppropriate') {
      await as(USERS.RECEIVER, 'post', `/api/referrals/${ids[args[0]]}/response`, { decision: 'NOT_APPROPRIATE', reasonId: 1 });
    } else if (action === 'record') {
      await as(USERS.RECEIVER, 'post', `/api/referrals/${ids[args[0]]}/outcome`, { outcome: args[1] });
    } else if (action === 'correctOutcome') {
      await as(USERS.RECEIVER, 'post', `/api/referrals/${ids[args[0]]}/outcome/correction`,
        { outcome: args[1], version: await versionOf(ids[args[0]]) });
    } else if (action === 'correctDecision') {
      await as(USERS.RECEIVER, 'post', `/api/referrals/${ids[args[0]]}/response/correction`,
        { decision: args[1], version: await versionOf(ids[args[0]]) });
    } else if (action === 'moveProgram') {
      const [programId, departmentId] = args;
      actor = USERS.ORG_ADMIN;
      const current = await request(app).get('/api/program-management/departments');
      if (current.status !== 200) throw new Error(`departments -> ${current.status}`);
      const program = await store.getProgram(programId);
      await as(USERS.ORG_ADMIN, 'post', `/api/program-management/programs/${programId}/move`,
        { version: program.version, departmentId });
    }
  }

  // Every report is read "as of" AS_OF unless a test says otherwise.
  const report = (path, query, { asOf = AS_OF, userId = USERS.NO_GRANTS } = {}) => {
    clock.reportNow = asOf;
    actor = userId;
    return request(app).get(`/api/reports/${path}`).query(query);
  };
  return { store, ids, report };
}

// A rate as the referral-activity report states it (PRD 12.4, 12.6).
const rate = (numerator, denominator, value) => ({ numerator, denominator, value, state: 'CALCULATED' });
const pending = (numerator = 0, denominator = 0) => ({ numerator, denominator, value: null, state: 'PENDING' });
const noData = () => ({ numerator: 0, denominator: 0, value: null, state: 'NO_DATA' });

// Timing in hours, as the API's milliseconds.
const timing = (qualifyingCount, pendingCount, averageH, medianH) => ({
  status: qualifyingCount > 0 ? 'OK' : 'N/A',
  qualifyingCount,
  pendingCount,
  averageMs: averageH === null ? null : averageH * H,
  medianMs: medianH === null ? null : medianH * H,
});

// Expected answers, by hand. Each key is one report request.
export const KNOWN_ANSWERS = Object.freeze({
  // FY2027 so far (Jul 1, 2026 to today): all nine referrals.
  YEAR: {
    query: { period: 'YEARLY', date: '2026-10-24' },
    period: { type: 'YEARLY', label: 'FY2027', start: '2026-07-01', endExclusive: '2027-07-01', timeZone: 'America/New_York' },
    partial: true,
    total: 9,
    // Accepted A1 A2 A4 A6 A7 A9 = 6; Not Appropriate A3 = 1; awaiting A5 A8 = 2.
    // Resulted (current) A1 A7 = 2; Did Not A2 A6 = 2.
    summary: {
      totalReferrals: 9, made: 9, received: 9, accepted: 6, notAppropriate: 1, awaitingResponse: 2,
      resultedInService: 2, didNotResultInService: 2,
      acceptanceRate: rate(6, 7, 85.71),        // 6 / 7 = 85.714...%
      notAppropriateRate: rate(1, 7, 14.29),    // 1 / 7 = 14.285...%
      resultedInServiceRate: rate(2, 4, 50),    // 2 / (2 + 2)
    },
    // First responses (h): A1 2, A2 4, A3 1, A4 24, A6 6, A7 1, A9 3 (the FIRST
    // response, kept after the correction). Sorted 1 1 2 3 4 6 24 -> median 3;
    // sum 41 -> average 41 / 7. Awaiting: A5, A8.
    timeToFirstResponse: timing(7, 2, 41 / 7, 3),
    // Reached Resulted (first time, h): A1 72, A6 48 (later corrected; still
    // reached), A7 24. Sorted 24 48 72 -> median 48; average 144 / 3 = 48.
    // Pending (Accepted, no outcome, never Resulted): A4, A9.
    timeToRecordedService: timing(3, 2, 48, 48),
  },
  // Fiscal quarter 1 (Jul to Sep): A1 to A6. A finished period.
  Q1: {
    query: { period: 'QUARTERLY', date: '2026-09-30' },
    period: { type: 'QUARTERLY', label: 'FY2027 Q1', start: '2026-07-01', endExclusive: '2026-10-01', timeZone: 'America/New_York' },
    partial: false,
    total: 6,
    summary: {
      totalReferrals: 6, made: 6, received: 6, accepted: 4, notAppropriate: 1, awaitingResponse: 1,
      resultedInService: 1, didNotResultInService: 2,
      acceptanceRate: rate(4, 5, 80),            // A1 A2 A4 A6 of 5 decided
      notAppropriateRate: rate(1, 5, 20),
      resultedInServiceRate: rate(1, 3, 33.33),  // A1 of A1 A2 A6
    },
    // First (h): 2 4 1 24 6 -> sorted 1 2 4 6 24, median 4; sum 37 / 5 = 7.4.
    timeToFirstResponse: timing(5, 1, 7.4, 4),
    // Reached: A1 72, A6 48 -> median (48 + 72) / 2 = 60, average 60. Pending A4.
    timeToRecordedService: timing(2, 1, 60, 60),
  },
  // July: A1 to A4. A4 is Jul 31 23:30 EDT, already Aug 1 in UTC.
  JULY: {
    query: { period: 'MONTHLY', date: '2026-07-15' },
    period: { type: 'MONTHLY', label: '2026-07', start: '2026-07-01', endExclusive: '2026-08-01', timeZone: 'America/New_York' },
    partial: false,
    total: 4,
    summary: {
      totalReferrals: 4, made: 4, received: 4, accepted: 3, notAppropriate: 1, awaitingResponse: 0,
      resultedInService: 1, didNotResultInService: 1,
      acceptanceRate: rate(3, 4, 75),
      notAppropriateRate: rate(1, 4, 25),
      resultedInServiceRate: rate(1, 2, 50),
    },
    // First (h): 2 4 1 24 -> sorted 1 2 4 24, median (2 + 4) / 2 = 3; sum 31 / 4 = 7.75.
    timeToFirstResponse: timing(4, 0, 7.75, 3),
    // Reached: A1 72 only. Pending A4.
    timeToRecordedService: timing(1, 1, 72, 72),
  },
  // August: A5 only, never answered. Nothing decided yet -> PENDING, not 0%.
  AUGUST: {
    query: { period: 'MONTHLY', date: '2026-08-15' },
    period: { type: 'MONTHLY', label: '2026-08', start: '2026-08-01', endExclusive: '2026-09-01', timeZone: 'America/New_York' },
    partial: false,
    total: 1,
    summary: {
      totalReferrals: 1, made: 1, received: 1, accepted: 0, notAppropriate: 0, awaitingResponse: 1,
      resultedInService: 0, didNotResultInService: 0,
      acceptanceRate: pending(),
      notAppropriateRate: pending(),
      resultedInServiceRate: noData(),           // nobody accepted, nothing can come
    },
    timeToFirstResponse: timing(0, 1, null, null),
    timeToRecordedService: timing(0, 0, null, null),
  },
  // September: A6 only (Sep 30 23:59:59 EDT). Resulted, then corrected to
  // Did Not: Resulted in Service is a REAL 0%, not N/A.
  SEPTEMBER: {
    query: { period: 'MONTHLY', date: '2026-09-01' },
    period: { type: 'MONTHLY', label: '2026-09', start: '2026-09-01', endExclusive: '2026-10-01', timeZone: 'America/New_York' },
    partial: false,
    total: 1,
    summary: {
      totalReferrals: 1, made: 1, received: 1, accepted: 1, notAppropriate: 0, awaitingResponse: 0,
      resultedInService: 0, didNotResultInService: 1,
      acceptanceRate: rate(1, 1, 100),
      notAppropriateRate: rate(0, 1, 0),
      resultedInServiceRate: rate(0, 1, 0),
    },
    timeToFirstResponse: timing(1, 0, 6, 6),
    // It REACHED Resulted (+48 h) before the correction, so it still counts here.
    timeToRecordedService: timing(1, 0, 48, 48),
  },
  // October so far: A7 (Oct 1 00:00:00 EDT), A8, A9.
  OCTOBER: {
    query: { period: 'MONTHLY', date: '2026-10-24' },
    period: { type: 'MONTHLY', label: '2026-10', start: '2026-10-01', endExclusive: '2026-11-01', timeZone: 'America/New_York' },
    partial: true,
    total: 3,
    summary: {
      totalReferrals: 3, made: 3, received: 3, accepted: 2, notAppropriate: 0, awaitingResponse: 1,
      resultedInService: 1, didNotResultInService: 0,
      acceptanceRate: rate(2, 2, 100),           // A7, A9 (corrected to Accepted)
      notAppropriateRate: rate(0, 2, 0),
      resultedInServiceRate: rate(1, 1, 100),
    },
    // First (h): A7 1, A9 3 -> median 2, average 2. Awaiting A8.
    timeToFirstResponse: timing(2, 1, 2, 2),
    // Reached: A7 24. Pending A9.
    timeToRecordedService: timing(1, 1, 24, 24),
  },
  // The current week, Sun Oct 18 to Sat Oct 24: A8, A9.
  THIS_WEEK: {
    query: { period: 'WEEKLY', date: '2026-10-24' },
    period: { type: 'WEEKLY', start: '2026-10-18', endExclusive: '2026-10-25', timeZone: 'America/New_York' },
    partial: true,
    total: 2,
    summary: {
      totalReferrals: 2, made: 2, received: 2, accepted: 1, notAppropriate: 0, awaitingResponse: 1,
      resultedInService: 0, didNotResultInService: 0,
      acceptanceRate: rate(1, 1, 100),
      notAppropriateRate: rate(0, 1, 0),
      resultedInServiceRate: pending(),          // A9 accepted, outcome not recorded yet
    },
    timeToFirstResponse: timing(1, 1, 3, 3),
    timeToRecordedService: timing(0, 1, null, null),
  },
  // June 2026 (FY2026): nothing at all. A real zero count; every rate and
  // time is "no data", never 0%.
  EMPTY_JUNE: {
    query: { period: 'MONTHLY', date: '2026-06-15' },
    period: { type: 'MONTHLY', label: '2026-06', start: '2026-06-01', endExclusive: '2026-07-01', timeZone: 'America/New_York' },
    partial: false,
    total: 0,
    summary: {
      totalReferrals: 0, made: 0, received: 0, accepted: 0, notAppropriate: 0, awaitingResponse: 0,
      resultedInService: 0, didNotResultInService: 0,
      acceptanceRate: noData(),
      notAppropriateRate: noData(),
      resultedInServiceRate: noData(),
    },
    timeToFirstResponse: timing(0, 0, null, null),
    timeToRecordedService: timing(0, 0, null, null),
  },
});
