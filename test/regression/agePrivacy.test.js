// Task HH: age privacy, end to end.
//
// Frozen Handoff PRD 5.3, 5.4, 15, 28; Handoff MVP 6, 15, 29 and acceptance
// gates 6, 7 and 8:
//
//   "Enter age -> use age during matching -> select Program -> submit
//    referral -> age absent from persisted referral data."
//
// An employee may give an exact age or an age range in Find a Program. The
// age is a temporary matching input: GPME may use it, but it must never be
// saved on the referral, and it must never show up later in what staff see
// (Sent, Received, referral details), in audit history, notifications,
// reports or logs.
//
// How this proves "no trace": the same synthetic Find a Program journey runs
// three times on a fresh store with a fixed clock: once with an exact age,
// once with an age range, and once with no age at all. Everything that is
// kept or shown after submission must come out IDENTICAL in all three runs.
// If any of it differed, the age would have left a trace.
//
// The one record that may legitimately differ is the GPME evaluation, which
// keeps which Programs were shown and their own eligibility wording (for
// example "Serves ages 18 to 64"). Those describe the Program, not the
// participant, so they are checked separately: no age field, and never the
// participant's age numbers.
//
// The browser half (the age typed on screen never reaches the saved
// referral or later views) is e2e/agePrivacy.spec.js.
//
// The data store is the in-memory store; the production SharePoint Lists
// schema is a QCH IT dependency (Handoff PRD 27, 28). All data is SYNTHETIC
// (Handoff PRD 35).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createMemoryReferralStore } from '../../src/referrals/memoryReferralStore.js';
import { createNotificationService } from '../../src/notifications/notificationService.js';
import { createSimulatedOutboxSender } from '../../src/notifications/simulatedOutbox.js';
import { NEW_REFERRAL } from '../../src/notifications/content.js';

const WORKER = 100;    // sends referrals from Program 10; no receiving rights
const INTAKE = 200;    // Program 11: view + respond
const OUTCOMES = 201;  // Program 11: view + record outcome

const P_FAMILY = 10;   // the worker's Program
const P_ADULT_ED = 11; // receives the referral; ages 18 to 64
const P_YOUTH = 12;    // ages 16 to 21
const P_TRADES = 13;   // age rule not on file

const EMPLOYMENT = 2;

// One Submission ID and one clock for every run, so the three runs can be
// compared field by field.
const SUBMISSION_ID = '6f1d2c4e-8a3b-4c5d-9e7f-0a1b2c3d4e5f';
const FIXED_NOW = new Date('2026-10-20T14:00:00.000Z');

// Ages chosen so they are not any Program's age limit (18, 64, 16, 21) and
// so they can be found if they ever leak into kept text.
const EXACT_AGE = 37;
const RANGE = { min: 33, max: 46 };

const AGE_CASES = {
  exact: {
    // The employee describes the need; the interpreter proposes one exact
    // age, the employee confirms it.
    text: `Needs a job, age ${EXACT_AGE}`,
    proposed: { min: EXACT_AGE, max: EXACT_AGE },
    confirmed: { min: EXACT_AGE, max: EXACT_AGE },
  },
  range: {
    // No age in the description; the employee adds an age range during
    // review before matching.
    text: 'Needs a job',
    proposed: null,
    confirmed: RANGE,
  },
  none: {
    text: 'Needs a job',
    proposed: null,
    confirmed: null,
  },
};

const NO_LIMITS = { ageLimitState: 'NO_RESTRICTION', ageMin: null, ageMax: null, serviceAreaState: 'NO_RESTRICTION', serviceAreaZips: [] };
const grant = (userId, permission, programId) => ({
  userId, permission, scopeType: 'PROGRAM', programId, departmentId: null, grantSource: 'IN_APP',
});

function organization() {
  return createMemoryReferralStore({
    departments: [
      { departmentId: 1, name: 'Synthetic Family Services', lifecycleStatus: 'ACTIVE' },
      { departmentId: 2, name: 'Synthetic Adult Services', lifecycleStatus: 'ACTIVE' },
    ],
    programs: [
      { programId: P_FAMILY, departmentId: 1, name: 'Synthetic Family Center', site: 'Site A', lifecycleStatus: 'ACTIVE',
        needCategoryIds: [1], ...NO_LIMITS },
      { programId: P_ADULT_ED, departmentId: 2, name: 'Synthetic Adult Education', site: 'Site B', lifecycleStatus: 'ACTIVE',
        needCategoryIds: [EMPLOYMENT], ...NO_LIMITS, ageLimitState: 'SET', ageMin: 18, ageMax: 64 },
      { programId: P_YOUTH, departmentId: 2, name: 'Synthetic Youth Jobs', site: null, lifecycleStatus: 'ACTIVE',
        needCategoryIds: [EMPLOYMENT], ...NO_LIMITS, ageLimitState: 'SET', ageMin: 16, ageMax: 21 },
      { programId: P_TRADES, departmentId: 2, name: 'Synthetic Trades', site: null, lifecycleStatus: 'ACTIVE',
        needCategoryIds: [EMPLOYMENT], ...NO_LIMITS, ageLimitState: 'NOT_ON_FILE' },
    ],
    needCategories: [
      { needCategoryId: 1, name: 'Food', lifecycleStatus: 'ACTIVE' },
      { needCategoryId: EMPLOYMENT, name: 'Employment', lifecycleStatus: 'ACTIVE' },
    ],
    users: [
      { userId: WORKER, isActive: true, displayName: 'Synthetic Worker' },
      { userId: INTAKE, isActive: true, currentProgramId: P_ADULT_ED },
      { userId: OUTCOMES, isActive: true, currentProgramId: P_ADULT_ED },
    ],
    grants: [
      grant(INTAKE, 'VIEW_RECEIVED_REFERRAL', P_ADULT_ED), grant(INTAKE, 'RESPOND_TO_REFERRAL', P_ADULT_ED),
      grant(OUTCOMES, 'VIEW_RECEIVED_REFERRAL', P_ADULT_ED), grant(OUTCOMES, 'RECORD_OUTCOME', P_ADULT_ED),
    ],
    notAppropriateReasons: [
      { reasonId: 1, code: 'PROGRAM_CRITERIA_NOT_MET', label: 'Program criteria not met', displayOrder: 1 },
    ],
    programNotificationEmails: { [P_ADULT_ED]: 'synthetic-intake@example.test' },
  }, { now: () => new Date(FIXED_NOW) });
}

function captureConsole(t) {
  const lines = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    t.mock.method(console, level, (...args) => lines.push(args.map(String).join(' ')));
  }
  return lines;
}

// Correlation IDs are random per request and the simulated outbox stamps
// the real time, so they are the only values allowed to differ by run.
const VOLATILE_KEYS = new Set(['correlationId', 'acceptedAt']);
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !VOLATILE_KEYS.has(key))
      .map(([key, v]) => [key, stable(v)]));
  }
  return value;
}

// Any property whose name is about the participant's age. Program age
// eligibility (ageMin, ageMax and ageLimitState on a Program) is allowed to
// be kept (MVP 6), but none of the referral-side records hold Program facts,
// so any age-named key in them is a leak.
// Matches age, ageRange, ageMin, savedAgeRange, participantAge, age_range,
// dob, dateOfBirth. Case-sensitive on purpose, so "stage", "message" or
// "language" never match.
const AGE_KEY = /^ages?(Range|Min|Max|Group)?$|Ages?(Range|Min|Max|Group)?$|(^|_)age(_|$)|^dob$|[Dd]ateOfBirth|date_of_birth/;
function ageKeysIn(value, path = '$') {
  const found = [];
  if (Array.isArray(value)) value.forEach((v, i) => found.push(...ageKeysIn(v, `${path}[${i}]`)));
  else if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      if (AGE_KEY.test(key)) found.push(`${path}.${key}`);
      found.push(...ageKeysIn(v, `${path}.${key}`));
    }
  }
  return found;
}

// The participant's age numbers as whole words in text (so 37 does not match
// inside 2037 or a UUID).
function ageNumbersIn(text, ages) {
  return ages.filter((n) => new RegExp(`(?<![\\d.:-])${n}(?![\\d.:-])`).test(text));
}

// One full synthetic journey: describe the need, review the proposal,
// match, choose Program 11, submit (and resend), notify, receive, respond,
// record the outcome, and look at every later view and report.
async function runJourney(t, ageCase) {
  const { text, proposed, confirmed } = AGE_CASES[ageCase];
  const store = organization();
  const lines = captureConsole(t);

  const outbox = createSimulatedOutboxSender({ nodeEnv: 'test' });
  const notifications = createNotificationService({
    store: store.notificationStore, sender: outbox, now: () => new Date(FIXED_NOW),
  });
  const started = [];
  const notifier = {
    notifyReferralCommitted(args) {
      const run = notifications.notifyReferralCommitted(args);
      started.push(run);
      return run;
    },
    retryPendingDeliveries: (options) => notifications.retryPendingDeliveries(options),
  };

  let current = null;
  const app = createApp({
    affiliationStore: store,
    referralStore: store,
    resolveIdentity: () => (current ? { userId: current } : null),
    nodeEnv: 'test',
    now: () => new Date(FIXED_NOW),
    notifier,
  });
  const as = (userId) => ({
    get: (url) => { current = userId; return request(app).get(url); },
    post: (url, body) => { current = userId; return request(app).post(url).send(body); },
    put: (url, body) => { current = userId; return request(app).put(url).send(body); },
  });
  const worker = as(WORKER);
  const intake = as(INTAKE);
  const outcomes = as(OUTCOMES);

  // The worker's Program is the referring Program (affiliation).
  const affiliation = await worker.get('/api/me/affiliation');
  assert.equal((await worker.put('/api/me/affiliation', { programId: P_FAMILY, version: affiliation.body.version })).status, 200);

  // 1. Describe the need. The interpreter proposes; nothing is decided yet.
  const interpreted = await worker.post('/api/gpme/interpret', { text });
  assert.equal(interpreted.status, 200);
  assert.equal(interpreted.headers['cache-control'], 'no-store');
  assert.deepEqual(interpreted.body.ageRange ?? null, proposed, `${ageCase}: proposed age`);

  // 2. The employee reviews and confirms what matching may use (Handoff
  //    PRD 5.2). The exact age stays exact: min equals max, never widened
  //    into an invented range (Handoff PRD 5.3).
  const answers = { needCategoryIds: [EMPLOYMENT] };
  if (confirmed) answers.ageRange = confirmed;

  // 3. GPME uses the age.
  const matched = await worker.post('/api/gpme/match', answers);
  assert.equal(matched.status, 200);
  assert.equal(matched.headers['cache-control'], 'no-store');
  assert.equal(matched.body.status, 'RESULTS');
  const listed = (group) => matched.body[group].map((p) => p.programId).sort((a, b) => a - b);

  // 4. The employee, not GPME, chooses Program 11 and submits.
  const draft = {
    submissionId: SUBMISSION_ID,
    receivingProgramId: P_ADULT_ED,
    participantName: 'Synthetic Person Age Privacy',
    contactMethod: 'NOT_AVAILABLE',
    referralContext: 'Synthetic context for the age privacy test',
    gpme: answers,
  };
  const sent = await worker.post('/api/referrals', draft);
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  const referralId = sent.body.referral.referralId;
  // A resend of the same submission (lost confirmation) is still one referral.
  const resent = await worker.post('/api/referrals', draft);
  assert.equal(resent.status, 200);
  assert.equal(resent.body.status, 'ALREADY_RECEIVED');
  await Promise.all(started);

  // 5. The receiving Program finds it, opens it, accepts it, and records
  //    the outcome.
  const received = await intake.get(`/api/referrals/received?programId=${P_ADULT_ED}`);
  const openedByIntake = await intake.get(`/api/referrals/${referralId}`);
  const responded = await intake.post(`/api/referrals/${referralId}/response`, { decision: 'ACCEPTED' });
  assert.equal(responded.status, 200);
  const outcome = await outcomes.post(`/api/referrals/${referralId}/outcome`, { outcome: 'RESULTED_IN_SERVICE' });
  assert.equal(outcome.status, 200);

  // 6. Later views: the sender's Sent list, the details on both sides, the
  //    submission lookup, and the aggregate reports.
  const later = {
    sentList: await worker.get('/api/referrals/sent'),
    sentDetail: await worker.get(`/api/referrals/${referralId}`),
    submission: await worker.get(`/api/referrals/submissions/${SUBMISSION_ID}`),
    receivedList: await intake.get(`/api/referrals/received?programId=${P_ADULT_ED}`),
    receivedDetail: await outcomes.get(`/api/referrals/${referralId}`),
    totalReferrals: await worker.get('/api/reports/total-referrals?period=MONTHLY'),
    referralActivity: await worker.get('/api/reports/referral-activity?period=MONTHLY'),
    timingMetrics: await worker.get('/api/reports/timing-metrics?period=MONTHLY'),
  };
  for (const [name, res] of Object.entries(later)) assert.equal(res.status, 200, `${ageCase}: ${name}`);

  const evaluation = await store.getGpmeEvaluation(store._referrals[0].gpmeEvaluationId);
  const delivery = await store.notificationStore.getDeliveryByReferral(referralId, NEW_REFERRAL);

  return {
    plausible: listed('plausible'),
    possible: listed('possible'),
    evaluation,
    // Everything kept or shown after submission.
    kept: stable({
      responses: {
        sent: sent.body,
        resent: resent.body,
        received: received.body,
        openedByIntake: openedByIntake.body,
        responded: responded.body,
        outcome: outcome.body,
        ...Object.fromEntries(Object.entries(later).map(([name, res]) => [name, res.body])),
      },
      referrals: store._referrals,
      auditEvents: store._referralAuditEvents,
      evaluationCount: store._gpmeEvaluations.length,
      delivery,
      outbox: outbox.list(),
      // Log lines carry the random correlation ID too.
      logs: lines.map((line) => line.replace(/correlation=[0-9a-f-]{36}/g, 'correlation=<id>')),
    }),
  };
}

describe('Task HH: participant age is used for matching but never kept (Handoff PRD 5.3, 5.4, 28; MVP gates 6 to 8)', () => {
  test('an exact age and an age range both change what GPME suggests', async (t) => {
    const exact = await runJourney(t, 'exact');
    const range = await runJourney(t, 'range');
    const none = await runJourney(t, 'none');

    // Exact age 37 and range 33 to 46 both fit Program 11 (18 to 64) and
    // rule out Program 12 (16 to 21). Without an age, Program 11 and 12 can
    // only be "possible" because their age rule cannot be checked.
    assert.deepEqual(exact.plausible, [P_ADULT_ED]);
    assert.deepEqual(range.plausible, [P_ADULT_ED]);
    assert.deepEqual(exact.possible, [P_TRADES]);
    assert.deepEqual(range.possible, [P_TRADES]);
    assert.deepEqual(none.plausible, []);
    assert.deepEqual(none.possible, [P_ADULT_ED, P_YOUTH, P_TRADES]);
  });

  test('after submission, everything kept or shown is identical with an exact age, an age range, or no age', async (t) => {
    const exact = await runJourney(t, 'exact');
    const range = await runJourney(t, 'range');
    const none = await runJourney(t, 'none');

    // Same saved referral, audit history, notification, Sent and Received
    // views, referral details, reports and logs: the age left no trace.
    assert.deepEqual(exact.kept, none.kept, 'an exact age changed something that was kept or shown');
    assert.deepEqual(range.kept, none.kept, 'an age range changed something that was kept or shown');
  });

  test('no age field and no age number anywhere in what is kept or shown', async (t) => {
    for (const ageCase of ['exact', 'range']) {
      const run = await runJourney(t, ageCase);
      assert.deepEqual(ageKeysIn(run.kept), [], `${ageCase}: age-named field kept`);
      const ages = ageCase === 'exact' ? [EXACT_AGE] : [RANGE.min, RANGE.max];
      assert.deepEqual(ageNumbersIn(JSON.stringify(run.kept), ages), [], `${ageCase}: participant age kept`);
    }
  });

  test('the GPME evaluation keeps what was shown and chosen, never the participant\'s age', async (t) => {
    for (const ageCase of ['exact', 'range']) {
      const { evaluation } = await runJourney(t, ageCase);
      assert.deepEqual(ageKeysIn(evaluation), [], `${ageCase}: age-named field in the evaluation`);
      const ages = ageCase === 'exact' ? [EXACT_AGE] : [RANGE.min, RANGE.max];
      assert.deepEqual(ageNumbersIn(JSON.stringify(evaluation), ages), [], `${ageCase}: participant age in the evaluation`);
      // What it does keep: the Programs shown, in order, and which one the
      // employee chose; the explanations describe each Program's own rules.
      assert.deepEqual(evaluation.results.map((r) => [r.programId, r.programContext.group, r.wasSelected]), [
        [P_ADULT_ED, 'PLAUSIBLE', true], [P_TRADES, 'POSSIBLE', false],
      ]);
      assert.ok(evaluation.results[0].programContext.explanations.includes('Serves ages 18 to 64'));
    }
  });

  test('an exact age is matched as that one age, not widened into an invented range', async (t) => {
    // Handoff PRD 5.3: an exact age must not error because Programs use
    // ranges, and must not silently become a made-up range. 21 is exactly
    // Program 12's upper limit and inside Program 11's range: as one age it
    // fits both. Widened even by one year (20 to 22) it would no longer
    // fully fit Program 12.
    const store = organization();
    let current = WORKER;
    const app = createApp({
      affiliationStore: store, referralStore: store, resolveIdentity: () => ({ userId: current }), nodeEnv: 'test',
    });
    captureConsole(t);
    const proposal = await request(app).post('/api/gpme/interpret').send({ text: 'Needs a job, age 21' });
    assert.deepEqual(proposal.body.ageRange, { min: 21, max: 21 });
    const res = await request(app).post('/api/gpme/match').send({ needCategoryIds: [EMPLOYMENT], ageRange: proposal.body.ageRange });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.plausible.map((p) => p.programId).sort((a, b) => a - b), [P_ADULT_ED, P_YOUTH]);
    assert.ok(!res.text.includes('"ageRange"'), 'the match response does not echo the age');
  });

  test('the age cannot be smuggled onto the referral as a referral field', async (t) => {
    // Only the approved referral fields are accepted (Handoff PRD 15); an
    // age sent outside the gpme part is refused, and nothing is saved.
    const store = organization();
    const app = createApp({
      affiliationStore: store, referralStore: store, resolveIdentity: () => ({ userId: WORKER }), nodeEnv: 'test',
    });
    captureConsole(t);
    const affiliation = await request(app).get('/api/me/affiliation');
    await request(app).put('/api/me/affiliation').send({ programId: P_FAMILY, version: affiliation.body.version });
    const base = {
      submissionId: SUBMISSION_ID, receivingProgramId: P_ADULT_ED,
      participantName: 'Synthetic Person Age Privacy', contactMethod: 'NOT_AVAILABLE',
      referralContext: 'Synthetic context for the age privacy test',
    };
    for (const extra of [{ age: EXACT_AGE }, { ageRange: RANGE }, { participantAge: EXACT_AGE }, { dateOfBirth: '1989-01-01' }]) {
      const res = await request(app).post('/api/referrals').send({ ...base, ...extra });
      assert.equal(res.status, 400, JSON.stringify(extra));
      assert.ok(!res.text.includes(String(EXACT_AGE)) && !res.text.includes('1989'), 'the refusal does not echo the value');
    }
    // Inside the gpme part, only the approved matching inputs are allowed.
    const smuggled = await request(app).post('/api/referrals')
      .send({ ...base, gpme: { needCategoryIds: [EMPLOYMENT], ageRange: RANGE, participantAge: EXACT_AGE } });
    assert.equal(smuggled.status, 400);
    assert.equal(store._referrals.length, 0);
  });
});
