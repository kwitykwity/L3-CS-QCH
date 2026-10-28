// Trello Task EE: failure recovery and no data loss, end to end over HTTP
// (Final Technical PRD 2.2, 6.2, 6.4, 7.2 to 7.5, 8.5, 8.8, 9.3, 9.4,
// 10.4, 11.4 to 11.6, 12.4, 15.4).
//
// Each failure path already has its own unit tests (notifications,
// notificationWiring, gpme, gpmeInterpretation, referralResponse,
// serviceOutcome). These journeys check what those do not: that a
// secondary failure in the middle of real work never undoes the primary
// result and never leaves a misleading state anywhere staff look (sender,
// receiver, reports), and that every failed write reports no success,
// changes nothing, and can be retried safely.
//
// Browser-side recovery for Direct Referral (inputs preserved, safe check,
// no double send) is in e2e/directReferralRecovery.spec.js; for the guided
// path in e2e/gpme.spec.js. SYNTHETIC data only.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createMemoryReferralStore } from '../../src/referrals/memoryReferralStore.js';
import { createNotificationService } from '../../src/notifications/notificationService.js';
import { createSimulatedOutboxSender } from '../../src/notifications/simulatedOutbox.js';
import { NEW_REFERRAL } from '../../src/notifications/content.js';
import { FAILURE_CATEGORIES, NotificationSendError } from '../../src/notifications/errors.js';

const WORKER = 100;   // sends from Program 10
const INTAKE = 200;   // Programs 11 and 12: view, respond, record, correct
const P_SENDER = 10;
const P_EMAIL = 11;   // has a notification email
const P_NO_EMAIL = 12; // has none: NO_RECIPIENT
const FOOD = 1;
const HOUSING = 2;    // no Program offers it

// Text that must never appear in a failure response or a log line.
const MARKERS = {
  participantName: 'Synthetic Person Failure Kappa',
  contactValue: '(555) 010-0199',
  referralContext: 'Synthetic context marker QEE14CTX',
  notes: 'Synthetic note marker QEE14NOTE',
};

const grants = (programId) => ['VIEW_RECEIVED_REFERRAL', 'RESPOND_TO_REFERRAL', 'RECORD_OUTCOME', 'CORRECT_OUTCOME', 'UPDATE_RECEIVED_REFERRAL']
  .map((permission) => ({ userId: INTAKE, permission, scopeType: 'PROGRAM', programId, departmentId: null, grantSource: 'IN_APP' }));
const NO_LIMITS = { ageLimitState: 'NO_RESTRICTION', serviceAreaState: 'NO_RESTRICTION' };

function setup({ interpreter } = {}) {
  let t = Date.parse('2026-10-20T14:00:00.000Z');
  const now = () => new Date(t);
  const store = createMemoryReferralStore({
    departments: [{ departmentId: 1, name: 'Synthetic Dept', lifecycleStatus: 'ACTIVE' }],
    programs: [
      { programId: P_SENDER, departmentId: 1, name: 'Synthetic Sender', site: null, lifecycleStatus: 'ACTIVE', needCategoryIds: [], ...NO_LIMITS },
      { programId: P_EMAIL, departmentId: 1, name: 'Synthetic Pantry', site: null, lifecycleStatus: 'ACTIVE', needCategoryIds: [FOOD], ...NO_LIMITS },
      { programId: P_NO_EMAIL, departmentId: 1, name: 'Synthetic Meals', site: null, lifecycleStatus: 'ACTIVE', needCategoryIds: [FOOD], ...NO_LIMITS },
    ],
    needCategories: [
      { needCategoryId: FOOD, name: 'Food', lifecycleStatus: 'ACTIVE' },
      { needCategoryId: HOUSING, name: 'Housing', lifecycleStatus: 'ACTIVE' },
    ],
    users: [
      { userId: WORKER, isActive: true, currentProgramId: P_SENDER, displayName: 'Synthetic Worker' },
      { userId: INTAKE, isActive: true, currentProgramId: P_EMAIL },
    ],
    grants: [...grants(P_EMAIL), ...grants(P_NO_EMAIL)],
    notAppropriateReasons: [{ reasonId: 1, code: 'PROGRAM_CRITERIA_NOT_MET', label: 'Program criteria not met', displayOrder: 1 }],
    programNotificationEmails: { [P_EMAIL]: 'synthetic-pantry@example.org' },
  }, { now });

  // The email service is reachable only when `mail.up` is true.
  const outbox = createSimulatedOutboxSender({ nodeEnv: 'test' });
  const mail = { up: false };
  const sender = {
    async send(message) {
      if (!mail.up) throw new NotificationSendError(FAILURE_CATEGORIES.UNAVAILABLE);
      return outbox.send(message);
    },
  };
  const logLines = [];
  const logger = { info: (l) => logLines.push(l), warn: (l) => logLines.push(l), error: (l) => logLines.push(l) };
  const service = createNotificationService({ store: store.notificationStore, sender, logger, now });
  const runs = [];
  const notifier = {
    notifyReferralCommitted(args) { const run = service.notifyReferralCommitted(args); runs.push(run); return run; },
    retryPendingDeliveries: (options) => service.retryPendingDeliveries(options),
  };
  let current = null;
  const app = createApp({
    affiliationStore: store, referralStore: store, resolveIdentity: () => (current ? { userId: current } : null),
    nodeEnv: 'test', now, notifier, ...(interpreter ? { gpmeInterpreter: interpreter } : {}),
  });
  const responses = [];
  const as = (userId) => {
    const go = async (pending) => { const res = await pending; responses.push(res); return res; };
    return {
      get: (url) => { current = userId; return go(request(app).get(url)); },
      post: (url, body) => { current = userId; return go(request(app).post(url).send(body)); },
    };
  };
  const settle = async () => {
    for (let i = 0; i < 50; i += 1) await new Promise((r) => setImmediate(r));
    await Promise.all(runs);
  };
  return {
    store, as, responses, outbox, mail, logLines, settle, notifier,
    notificationsStarted: () => runs.length,
    advance: (ms) => { t += ms; },
    delivery: (referralId) => store.notificationStore.getDeliveryByReferral(referralId, NEW_REFERRAL),
  };
}

const draft = (receivingProgramId, extra = {}) => ({
  submissionId: randomUUID(), receivingProgramId, contactMethod: 'PHONE_CALL', ...MARKERS, ...extra,
});
const snapshot = (store) => JSON.stringify([store._referrals, store._referralAuditEvents, store._gpmeEvaluations]);
const noMarkers = (text, where) => {
  for (const [field, value] of Object.entries(MARKERS)) assert.ok(!text.includes(value), `${where} contains ${field}`);
  assert.doesNotMatch(text, /\bat [\w.]+ \(|node:internal|Error: /, `${where} contains a stack trace`);
};

describe('Task EE: a failed notification never undoes or misreports a referral', () => {
  test('email down and NO_RECIPIENT: referrals stand, every view and report is accurate, retries send once', async () => {
    const { store, as, outbox, mail, settle, delivery, notifier, advance, logLines, responses } = setup();
    const worker = as(WORKER);
    const intake = as(INTAKE);
    const activity = async () => (await worker.get('/api/reports/referral-activity?period=MONTHLY&date=2026-10-20')).body.summary;

    const toPantry = draft(P_EMAIL);
    const sentA = await worker.post('/api/referrals', toPantry);
    const sentB = await worker.post('/api/referrals', draft(P_NO_EMAIL));
    await settle();

    // The sender is told the truth about the referral: received.
    assert.deepEqual([sentA.status, sentA.body.status], [201, 'RECEIVED']);
    assert.deepEqual([sentB.status, sentB.body.status], [201, 'RECEIVED']);
    const a = sentA.body.referral.referralId;
    const b = sentB.body.referral.referralId;
    assert.doesNotMatch(JSON.stringify([sentA.body, sentB.body]), /notif|deliver|email|PENDING|FAILED/i,
      'the referral answer says nothing about email either way');

    // The notifications failed, each in its own way; the referrals stand.
    assert.deepEqual([(await delivery(a)).status, (await delivery(a)).failureCategory], ['PENDING', FAILURE_CATEGORIES.UNAVAILABLE]);
    assert.deepEqual([(await delivery(b)).status, (await delivery(b)).failureCategory], ['FAILED', FAILURE_CATEGORIES.NO_RECIPIENT]);
    assert.equal(outbox.list().length, 0);
    assert.equal(store._referrals.length, 2);

    // Every place staff look shows them, awaiting a response (PRD 12.4:
    // notification failure does not change Awaiting Response).
    const queue = await intake.get('/api/referrals/received');
    assert.deepEqual(queue.body.referrals.map((r) => r.referralId).sort(), [a, b].sort());
    const sent = await worker.get('/api/referrals/sent');
    assert.deepEqual(sent.body.referrals.map((r) => r.stage), ['AWAITING_RESPONSE', 'AWAITING_RESPONSE']);
    let summary = await activity();
    assert.deepEqual([summary.totalReferrals, summary.awaitingResponse], [2, 2]);

    // A resend of the same submission (lost confirmation) is one referral
    // and no second notification attempt.
    const again = await worker.post('/api/referrals', toPantry);
    assert.deepEqual([again.status, again.body.status], [200, 'ALREADY_RECEIVED']);
    assert.equal(again.body.referral.referralId, a);
    assert.equal(store._referrals.length, 2);
    assert.equal((await delivery(a)).attemptCount, 1);

    // Work carries on while email is down.
    assert.equal((await intake.post(`/api/referrals/${a}/response`, { decision: 'ACCEPTED' })).status, 200);
    assert.equal((await intake.post(`/api/referrals/${a}/outcome`, { outcome: 'RESULTED_IN_SERVICE' })).status, 200);
    assert.equal((await intake.post(`/api/referrals/${b}/response`, { decision: 'NOT_APPROPRIATE', reasonId: 1 })).status, 200);
    summary = await activity();
    assert.deepEqual([summary.totalReferrals, summary.awaitingResponse, summary.accepted, summary.notAppropriate, summary.resultedInService],
      [2, 0, 1, 1, 1]);

    // Email comes back: the pending notification is sent once; NO_RECIPIENT
    // is not retried; the late email changes no referral.
    const before = snapshot(store);
    mail.up = true;
    advance(60_001);
    await notifier.retryPendingDeliveries();
    advance(60_001);
    await notifier.retryPendingDeliveries();
    assert.equal((await delivery(a)).status, 'SENT');
    assert.equal((await delivery(b)).status, 'FAILED');
    assert.equal(outbox.list().length, 1);
    assert.equal(snapshot(store), before, 'sending late changes no referral or audit record');
    assert.equal((await worker.get(`/api/referrals/${a}`)).body.referral.stage, 'COMPLETE');

    for (const res of responses) if (res.status >= 400) noMarkers(JSON.stringify(res.body ?? {}), `${res.req.method} ${res.req.path}`);
    noMarkers(logLines.map((l) => JSON.stringify(l)).join('\n'), 'notification logs');
  });
});

describe('Task EE: a technical failure is never shown as "no result"', () => {
  const broken = { version: 'synthetic-broken-1', interpret() { throw new Error('synthetic interpreter outage'); } };

  test('describe-the-need down is UNABLE_TO_INTERPRET, not "nothing recognized"; matching still works; nothing stored', async () => {
    const { store, as } = setup({ interpreter: broken });
    const worker = as(WORKER);
    const before = snapshot(store);
    const down = await worker.post('/api/gpme/interpret', { text: 'Synthetic: needs food this week' });
    assert.equal(down.status, 503);
    assert.deepEqual(down.body, { status: 'UNABLE_TO_INTERPRET' }, 'no needs, no guess, no error details');

    const ok = setup();
    const nothing = await ok.as(WORKER).post('/api/gpme/interpret', { text: 'zzzz qqqq' });
    assert.equal(nothing.status, 200);
    assert.equal(nothing.body.status, 'NOTHING_RECOGNIZED');

    const match = await worker.post('/api/gpme/match', { needCategoryIds: [FOOD] });
    assert.equal(match.body.status, 'RESULTS', 'the manual answers still work');
    assert.equal(snapshot(store), before);
  });

  test('matching down is UNABLE_TO_MATCH, never NO_PLAUSIBLE_MATCH; a guided send saves nothing; Direct still works', async () => {
    const { store, as } = setup();
    const worker = as(WORKER);
    const none = await worker.post('/api/gpme/match', { needCategoryIds: [HOUSING] });
    assert.deepEqual([none.status, none.body.status], [200, 'NO_PLAUSIBLE_MATCH']);
    assert.ok(Array.isArray(none.body.plausible) && none.body.plausible.length === 0);

    store._failMatching();
    const down = await worker.post('/api/gpme/match', { needCategoryIds: [FOOD] });
    assert.deepEqual([down.status, down.body.status], [503, 'UNABLE_TO_MATCH']);
    assert.equal(down.body.plausible, undefined, 'a failure carries no result lists at all');

    const guided = draft(P_EMAIL, { gpme: { needCategoryIds: [FOOD] } });
    const refused = await worker.post('/api/referrals', guided);
    assert.deepEqual([refused.status, refused.body.code], [503, 'GPME_UNAVAILABLE']);
    assert.equal(store._referrals.length, 0);
    const { gpme, ...direct } = guided;
    assert.equal((await worker.post('/api/referrals', direct)).status, 201);
    assert.equal(store._referrals.length, 1);
  });
});

describe('Task EE: failed writes report no success, change nothing, and retry once', () => {
  test('response, outcome and corrections: audit failure rolls back; invalid and stale requests change nothing; retries apply once', async () => {
    const { store, as, responses } = setup();
    const worker = as(WORKER);
    const intake = as(INTAKE);
    const id = (await worker.post('/api/referrals', draft(P_EMAIL))).body.referral.referralId;
    const url = (suffix) => `/api/referrals/${id}${suffix}`;
    const version = async () => (await intake.get(url(''))).body.referral.version;
    const unchanged = async (label, attempt) => {
      const before = snapshot(store);
      const res = await attempt();
      assert.ok(res.status >= 400, `${label}: ${res.status}`);
      assert.notEqual(res.body?.status, 'RECEIVED');
      assert.equal(res.body?.referral, undefined, `${label}: no referral returned as if saved`);
      assert.equal(snapshot(store), before, `${label}: changed something`);
      return res;
    };

    // Invalid requests.
    await unchanged('bad decision', () => intake.post(url('/response'), { decision: 'MAYBE' }));
    await unchanged('extra field', () => intake.post(url('/response'), { decision: 'ACCEPTED', actorUserId: WORKER }));
    await unchanged('outcome too early', () => intake.post(url('/outcome'), { outcome: 'RESULTED_IN_SERVICE' }));

    // Audit failure on the response: no success, nothing saved; retry once.
    store._failNextAudit();
    await unchanged('response audit fails', () => intake.post(url('/response'), { decision: 'ACCEPTED' }));
    assert.equal((await intake.post(url('/response'), { decision: 'ACCEPTED' })).status, 200);
    await unchanged('second response', () => intake.post(url('/response'), { decision: 'NOT_APPROPRIATE', reasonId: 1 }));

    // Audit failure on the outcome; retry once; a second record is refused.
    store._failNextAudit();
    await unchanged('outcome audit fails', () => intake.post(url('/outcome'), { outcome: 'RESULTED_IN_SERVICE' }));
    const recorded = await intake.post(url('/outcome'), { outcome: 'RESULTED_IN_SERVICE' });
    assert.equal(recorded.status, 200);
    await unchanged('outcome twice', () => intake.post(url('/outcome'), { outcome: 'DID_NOT_RESULT_IN_SERVICE' }));

    // Corrections: audit failure rolls back; a stale screen is refused with
    // what is saved now, never overwriting it.
    const seen = await version();
    store._failNextAudit();
    await unchanged('outcome correction audit fails', () => intake.post(url('/outcome/correction'), { outcome: 'DID_NOT_RESULT_IN_SERVICE', version: seen }));
    assert.equal((await intake.post(url('/outcome/correction'), { outcome: 'DID_NOT_RESULT_IN_SERVICE', version: seen })).status, 200);
    const stale = await unchanged('stale outcome correction', () => intake.post(url('/outcome/correction'), { outcome: 'RESULTED_IN_SERVICE', version: seen }));
    assert.equal(stale.body.code, 'REFERRAL_CHANGED');
    assert.equal(stale.body.current.serviceOutcome, 'DID_NOT_RESULT_IN_SERVICE');
    await unchanged('stale decision correction', () => intake.post(url('/response/correction'), { decision: 'NOT_APPROPRIATE', reasonId: 1, version: seen }));

    // One audit entry per change that really happened.
    const trail = store._referralAuditEvents.filter((e) => e.entityType === 'REFERRAL' && e.entityId === id).map((e) => e.action);
    assert.deepEqual(trail, ['CREATED', 'ACCEPTED', 'SERVICE_OUTCOME_RECORDED', 'CORRECTED']);

    for (const res of responses) {
      if (res.status >= 400) noMarkers(JSON.stringify(res.body ?? {}), `${res.req.method} ${res.req.path} (${res.status})`);
    }
  });

  test('referral creation: audit failure saves nothing and reports no success; the same submission then saves once', async () => {
    const { store, as, settle, delivery, notificationsStarted } = setup();
    const worker = as(WORKER);
    const body = draft(P_EMAIL);
    store._failNextAudit();
    const failed = await worker.post('/api/referrals', body);
    assert.ok(failed.status >= 500);
    assert.notEqual(failed.body?.status, 'RECEIVED');
    noMarkers(JSON.stringify(failed.body ?? {}), 'failed create');
    await settle();
    assert.equal(store._referrals.length, 0);
    assert.equal(notificationsStarted(), 0, 'no notification for a referral that was not saved');

    const saved = await worker.post('/api/referrals', body);
    assert.deepEqual([saved.status, saved.body.status], [201, 'RECEIVED']);
    await settle();
    assert.equal(store._referrals.length, 1);
    assert.equal(notificationsStarted(), 1);
    assert.ok(await delivery(saved.body.referral.referralId), 'the saved referral gets its notification');
  });
});
