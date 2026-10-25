// Task E: new-referral notifications wired into referral creation
// (Final Technical PRD 2.2, 6.2, 11.2 to 11.6, 15.3, 16.4).
// All data is SYNTHETIC. The sender is the simulated outbox or a fake;
// nothing here sends email or talks to an outside service.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
import { createReferralService } from '../src/referrals/referralService.js';
import { createNotificationService } from '../src/notifications/notificationService.js';
import { createSimulatedOutboxSender } from '../src/notifications/simulatedOutbox.js';
import { startNotificationRetries } from '../src/notifications/retryTimer.js';
import { buildNewReferralMessage, NEW_REFERRAL } from '../src/notifications/content.js';
import { FAILURE_CATEGORIES, NotificationSendError } from '../src/notifications/errors.js';
import { syntheticSeed } from '../scripts/syntheticSeed.js';

const RECEIVING = 11;
const EMAIL = 'receiving.sample@example.test';
const REFERRER = 100;
const RECEIVER = 101;
const MANAGER = 102;

// Synthetic participant data. None of it may reach a message, a delivery
// row or a log line.
const PARTICIPANT = {
  participantName: 'Zephyrine Wiringcase',
  contactValue: '(555) 010-0177',
  participantZip: '99903',
  referralContext: 'Synthetic context: needs housing paperwork help',
  notes: 'Synthetic private note for wiring test',
};

const g = (userId, permission) => ({
  userId, permission, scopeType: 'PROGRAM', programId: RECEIVING, departmentId: null, grantSource: 'IN_APP',
});

function clock(start = '2026-10-24T12:00:00.000Z') {
  let t = new Date(start).getTime();
  return { now: () => new Date(t), advance: (ms) => { t += ms; } };
}

function captureLogger() {
  const lines = [];
  const push = (level) => (line) => lines.push({ level, line });
  return { lines, info: push('info'), warn: push('warn'), error: push('error') };
}

function body(overrides = {}) {
  return {
    submissionId: randomUUID(),
    receivingProgramId: RECEIVING,
    contactMethod: 'PHONE_CALL',
    ...PARTICIPANT,
    ...overrides,
  };
}

// Lets queued work run; the notification starts on a later tick.
async function waitFor(check, what) {
  for (let i = 0; i < 200; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`timed out waiting for ${what}`);
}

function setup({ sender, emails = { [RECEIVING]: EMAIL }, notifier: customNotifier } = {}) {
  // One clock for the store (attempt times) and the notifier (retry leases).
  const time = clock();
  const store = createMemoryReferralStore({
    departments: [
      { departmentId: 1, name: 'Synthetic Dept A', lifecycleStatus: 'ACTIVE' },
      { departmentId: 2, name: 'Synthetic Dept B', lifecycleStatus: 'ACTIVE' },
    ],
    programs: [
      { programId: 10, departmentId: 1, name: 'Referring Program', site: null, lifecycleStatus: 'ACTIVE' },
      { programId: RECEIVING, departmentId: 2, name: 'Receiving Program', site: null, lifecycleStatus: 'ACTIVE' },
      { programId: 12, departmentId: 2, name: 'Old Program', site: null, lifecycleStatus: 'DISCONTINUED' },
    ],
    users: [
      { userId: REFERRER, isActive: true, currentProgramId: 10 },
      { userId: RECEIVER, isActive: true, currentProgramId: RECEIVING },
      { userId: MANAGER, isActive: true, currentProgramId: RECEIVING },
    ],
    grants: [g(RECEIVER, 'VIEW_RECEIVED_REFERRAL'), g(MANAGER, 'MANAGE_PROGRAM')],
    programNotificationEmails: emails,
  }, { now: time.now });
  const logger = captureLogger();
  const outbox = createSimulatedOutboxSender({ nodeEnv: 'test' });
  const real = createNotificationService({
    store: store.notificationStore, sender: sender ?? outbox, logger, now: time.now,
  });
  // Records every notification the referral path starts, so tests can wait
  // for it to finish.
  const started = [];
  const notifier = customNotifier ?? {
    notifyReferralCommitted(args) {
      const run = real.notifyReferralCommitted(args);
      started.push({ args, run });
      return run;
    },
    retryPendingDeliveries: (options) => real.retryPendingDeliveries(options),
  };
  const appFor = (userId) => createApp({
    affiliationStore: store, referralStore: store, resolveIdentity: () => ({ userId }), notifier,
  });
  async function settled(count = 1) {
    await waitFor(() => started.length >= count, `${count} notification(s) to start`);
    return Promise.all(started.map((s) => s.run));
  }
  const delivery = (referralId) => store.notificationStore.getDeliveryByReferral(referralId, NEW_REFERRAL);
  return { store, time, logger, outbox, real, notifier, started, appFor, settled, delivery };
}

function assertNoParticipantData(text, where) {
  for (const [field, value] of Object.entries(PARTICIPANT)) {
    assert.ok(!text.includes(value), `${where} must not contain ${field}`);
  }
}

describe('a committed referral triggers its notification', () => {
  test('one generic email to the receiving Program, delivery SENT, no participant data anywhere', async () => {
    const t = setup();
    const response = await request(t.appFor(REFERRER)).post('/api/referrals').send(body());
    assert.equal(response.status, 201);
    const { referralId } = response.body.referral;

    const [result] = await t.settled();
    assert.equal(result.outcome, 'SENT');

    const sent = t.outbox.list();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, EMAIL, 'the recipient is the receiving Program, looked up on the server');
    const { subject, body: text } = buildNewReferralMessage();
    assert.equal(sent[0].subject, subject);
    assert.equal(sent[0].body, text);
    assertNoParticipantData(JSON.stringify(sent[0]), 'the email');

    const row = await t.delivery(referralId);
    assert.equal(row.status, 'SENT');
    assert.equal(row.attemptCount, 1);
    assert.match(row.correlationId, /^[0-9a-f-]{36}$/, 'the request correlation ID links the delivery to the audit event');
    const rowText = JSON.stringify(row);
    assert.ok(!rowText.includes(EMAIL), 'the delivery row holds no recipient');
    assertNoParticipantData(rowText, 'the delivery row');

    const logs = t.logger.lines.map((l) => l.line).join('\n');
    assert.match(logs, /outcome=SENT/);
    assert.ok(!logs.includes(EMAIL), 'logs hold no recipient');
    assertNoParticipantData(logs, 'the logs');
  });

  test('the referral is committed before the notification starts', async () => {
    const t = setup();
    let committedWhenStarted = null;
    const notifier = {
      notifyReferralCommitted(args) {
        committedWhenStarted = t.store._referrals.some((r) => r.referralId === args.referralId);
        return t.real.notifyReferralCommitted(args);
      },
    };
    const app = createApp({ affiliationStore: t.store, referralStore: t.store, resolveIdentity: () => ({ userId: REFERRER }), notifier });
    const response = await request(app).post('/api/referrals').send(body());
    assert.equal(response.status, 201);
    await waitFor(() => committedWhenStarted !== null, 'the notification to start');
    assert.equal(committedWhenStarted, true);
  });

  test('the referral answer does not wait for the email', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const accepted = [];
    const slowSender = { async send(message) { await gate; accepted.push(message); } };
    const t = setup({ sender: slowSender });

    const response = await request(t.appFor(REFERRER)).post('/api/referrals').send(body());
    assert.equal(response.status, 201, 'answered while the email is still being sent');
    await waitFor(() => t.started.length === 1, 'the notification to start');
    assert.equal(accepted.length, 0);
    assert.equal((await t.delivery(response.body.referral.referralId)).status, 'PENDING');

    release();
    const [result] = await t.settled();
    assert.equal(result.outcome, 'SENT');
    assert.equal(accepted.length, 1);
  });
});

describe('a notification failure never invalidates the referral', () => {
  test('temporary failure: referral kept, delivery PENDING, then SENT on a later retry', async () => {
    let failures = 1;
    const outbox = createSimulatedOutboxSender({ nodeEnv: 'test' });
    const flaky = {
      async send(message) {
        if (failures > 0) { failures -= 1; throw new NotificationSendError(FAILURE_CATEGORIES.UNAVAILABLE); }
        return outbox.send(message);
      },
    };
    const t = setup({ sender: flaky });
    const response = await request(t.appFor(REFERRER)).post('/api/referrals').send(body());
    assert.equal(response.status, 201);
    const { referralId } = response.body.referral;
    await t.settled();

    let row = await t.delivery(referralId);
    assert.equal(row.status, 'PENDING');
    assert.equal(row.failureCategory, FAILURE_CATEGORIES.UNAVAILABLE);
    const read = await request(t.appFor(REFERRER)).get(`/api/referrals/${referralId}`);
    assert.equal(read.status, 200, 'the referral is still there');
    assert.equal(read.body.referral.responseStatus, 'AWAITING_RESPONSE');

    t.time.advance(60_001);
    const counts = await t.notifier.retryPendingDeliveries();
    assert.equal(counts.SENT, 1);
    row = await t.delivery(referralId);
    assert.equal(row.status, 'SENT');
    assert.equal(row.attemptCount, 2);
    assert.equal(outbox.list().length, 1);
  });

  test('retries are bounded: after the last attempt the delivery is FAILED and the referral is unchanged', async () => {
    const down = { async send() { throw new NotificationSendError(FAILURE_CATEGORIES.UNAVAILABLE); } };
    const t = setup({ sender: down });
    const response = await request(t.appFor(REFERRER)).post('/api/referrals').send(body());
    const { referralId } = response.body.referral;
    await t.settled();
    for (let i = 0; i < 5; i += 1) {
      t.time.advance(60_001);
      await t.notifier.retryPendingDeliveries();
    }
    const row = await t.delivery(referralId);
    assert.equal(row.status, 'FAILED');
    assert.equal(row.attemptCount, 3, 'never more than maxAttempts (3)');
    assert.equal(t.store._referrals.length, 1);
    assert.equal(t.store._referrals[0].responseStatus, 'AWAITING_RESPONSE');
    assert.ok(t.logger.lines.some((l) => l.level === 'warn' && /outcome=FAILED/.test(l.line)), 'final failure logged at warn');
  });

  test('a permanent failure (AUTH_FAILED) ends FAILED at once; the referral is kept', async () => {
    const denied = { async send() { throw new NotificationSendError(FAILURE_CATEGORIES.AUTH_FAILED); } };
    const t = setup({ sender: denied });
    const response = await request(t.appFor(REFERRER)).post('/api/referrals').send(body());
    assert.equal(response.status, 201);
    await t.settled();
    const row = await t.delivery(response.body.referral.referralId);
    assert.equal(row.status, 'FAILED');
    assert.equal(row.failureCategory, FAILURE_CATEGORIES.AUTH_FAILED);
    assert.equal(t.store._referrals.length, 1);
  });

  test('a Program with no notification email: FAILED with NO_RECIPIENT, referral kept, nothing sent', async () => {
    const t = setup({ emails: {} });
    const response = await request(t.appFor(REFERRER)).post('/api/referrals').send(body());
    assert.equal(response.status, 201);
    await t.settled();
    const row = await t.delivery(response.body.referral.referralId);
    assert.equal(row.status, 'FAILED');
    assert.equal(row.failureCategory, FAILURE_CATEGORIES.NO_RECIPIENT);
    assert.equal(t.outbox.list().length, 0);
  });

  test('a notifier that throws or rejects cannot break or delay the referral', async (ctx) => {
    const logged = [];
    for (const notifier of [
      { notifyReferralCommitted() { throw new TypeError('synthetic notifier failure'); } },
      { async notifyReferralCommitted() { throw new Error('synthetic notifier failure'); } },
    ]) {
      const t = setup({ notifier });
      const service = createReferralService({ store: t.store, notifier, logNotifyFailure: (err) => logged.push(err.name) });
      const result = await service.createDirectReferral(REFERRER, body());
      assert.equal(result.status, 'RECEIVED');
      assert.equal(t.store._referrals.length, 1);
    }
    await waitFor(() => logged.length === 2, 'both failures to be logged');
    assert.deepEqual(logged, ['TypeError', 'Error']);

    // Through HTTP too, with the default logger (silenced here).
    const errorLog = ctx.mock.method(console, 'error', () => {});
    const t = setup({ notifier: { notifyReferralCommitted() { throw new Error('synthetic'); } } });
    const response = await request(t.appFor(REFERRER)).post('/api/referrals').send(body());
    assert.equal(response.status, 201);
    await waitFor(() => errorLog.mock.callCount() === 1, 'the failure to be logged');
    const line = errorLog.mock.calls[0].arguments[0];
    assert.match(line, /notification could not be started \(Error\)/);
    assertNoParticipantData(line, 'the log line');
  });
});

describe('duplicates', () => {
  test('retrying the same Submission ID never sends a second email', async () => {
    const t = setup();
    const same = body();
    const first = await request(t.appFor(REFERRER)).post('/api/referrals').send(same);
    const again = await request(t.appFor(REFERRER)).post('/api/referrals').send(same);
    assert.equal(first.status, 201);
    assert.equal(again.status, 200);
    assert.equal(again.body.status, 'ALREADY_RECEIVED');
    const results = await t.settled(2);
    assert.equal(results[0].outcome, 'SENT');
    assert.equal(results[1].outcome, 'SENT', 'the repeat reports the existing delivery');
    assert.equal(t.outbox.list().length, 1);
    assert.equal((await t.delivery(first.body.referral.referralId)).attemptCount, 1);
  });

  test('two identical submissions at the same time: one referral, one email', async () => {
    const t = setup();
    const same = body();
    const app = t.appFor(REFERRER);
    const responses = await Promise.all([
      request(app).post('/api/referrals').send(same),
      request(app).post('/api/referrals').send(same),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 201]);
    await t.settled(2);
    assert.equal(t.store._referrals.length, 1);
    assert.equal(t.outbox.list().length, 1);
  });

  test('a retry fills in a notification that never started after the commit', async () => {
    const t = setup();
    const same = body();
    // The first request committed, but the process stopped before notifying.
    const withoutNotifier = createReferralService({ store: t.store });
    const first = await withoutNotifier.createDirectReferral(REFERRER, same);
    assert.equal(first.status, 'RECEIVED');
    assert.equal(await t.delivery(first.referral.referralId), null);

    const retry = await request(t.appFor(REFERRER)).post('/api/referrals').send(same);
    assert.equal(retry.status, 200);
    await t.settled();
    assert.equal((await t.delivery(first.referral.referralId)).status, 'SENT');
    assert.equal(t.outbox.list().length, 1);
  });
});

describe('nothing is sent for a referral that was not saved', () => {
  test('a refused referral starts no notification', async () => {
    const t = setup();
    const app = t.appFor(REFERRER);
    const notSelectable = await request(app).post('/api/referrals').send(body({ receivingProgramId: 12 }));
    assert.equal(notSelectable.status, 422);
    const invalid = await request(app).post('/api/referrals').send(body({ participantName: '' }));
    assert.equal(invalid.status, 400);
    // A caller can never choose the recipient (PRD 11.3).
    const injected = await request(app).post('/api/referrals').send(body({ notificationEmail: 'attacker@example.test' }));
    assert.equal(injected.status, 400);
    assert.equal(injected.body.code, 'UNEXPECTED_FIELD');

    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(t.started.length, 0);
    assert.equal(t.outbox.list().length, 0);
    assert.equal(t.store._referrals.length, 0);
  });

  test('an unknown referral ID is skipped', async () => {
    const t = setup();
    assert.deepEqual(await t.real.notifyReferralCommitted({ referralId: 999 }), { outcome: 'SKIPPED' });
    assert.equal(t.outbox.list().length, 0);
  });
});

describe('the recipient stays on the server', () => {
  test('the notification email never appears in any API response', async () => {
    const t = setup();
    const created = await request(t.appFor(REFERRER)).post('/api/referrals').send(body());
    const { referralId } = created.body.referral;
    await t.settled();

    const reads = [
      [REFERRER, `/api/referrals/${referralId}`],
      [REFERRER, '/api/referrals/sent'],
      [REFERRER, '/api/programs'],
      [RECEIVER, `/api/referrals/${referralId}`],
      [RECEIVER, `/api/referrals/received?programId=${RECEIVING}`],
      [MANAGER, `/api/program-management/programs/${RECEIVING}`],
      [MANAGER, '/api/program-management/programs'],
    ];
    for (const [userId, url] of reads) {
      const response = await request(t.appFor(userId)).get(url);
      assert.equal(response.status, 200, url);
      assert.ok(!JSON.stringify(response.body).includes(EMAIL), `${url} must not return the recipient`);
    }
    assert.ok(!JSON.stringify(created.body).includes(EMAIL));
  });

  test('Program rows never carry the address (it is kept apart in the store)', async () => {
    const t = setup();
    const program = await t.store.getProgram(RECEIVING);
    assert.ok(!JSON.stringify(program).includes(EMAIL));
  });

  test('the synthetic dev seed uses example.org addresses, and one Program has none', () => {
    const { programNotificationEmails, programs } = syntheticSeed({ receiving: true });
    const addresses = Object.values(programNotificationEmails);
    assert.ok(addresses.length > 0);
    for (const address of addresses) assert.match(address, /@example\.org$/);
    assert.equal(programNotificationEmails[5], undefined, 'Program 5 shows the NO_RECIPIENT case');
    for (const program of programs) assert.equal(program.notificationEmail, undefined);
  });
});

describe('retry timer', () => {
  function fakeTimers() {
    const state = { fn: null, ms: null, cleared: false };
    return {
      state,
      setInterval(fn, ms) { state.fn = fn; state.ms = ms; return { unref() { state.unrefed = true; } }; },
      clearInterval() { state.cleared = true; },
    };
  }

  test('runs retryPendingDeliveries on its interval, one run at a time, and stops', async () => {
    let calls = 0;
    let finish;
    const notifier = {
      retryPendingDeliveries() {
        calls += 1;
        return new Promise((resolve) => { finish = () => resolve({ SENT: 0, PENDING: 0, FAILED: 0, ERROR: 0 }); });
      },
    };
    const timers = fakeTimers();
    const retries = startNotificationRetries({ notifier, intervalMs: 5_000, timers });
    assert.equal(timers.state.ms, 5_000);
    assert.equal(timers.state.unrefed, true, 'the timer alone does not keep the process running');

    timers.state.fn();
    timers.state.fn(); // still running: skipped
    assert.equal(calls, 1);
    finish();
    await new Promise((resolve) => setImmediate(resolve));
    timers.state.fn();
    assert.equal(calls, 2);
    finish();

    retries.stop();
    assert.equal(timers.state.cleared, true);
  });

  test('a failing run is logged by kind only and never throws', async () => {
    const logger = captureLogger();
    const notifier = { async retryPendingDeliveries() { throw new RangeError(`secret ${EMAIL}`); } };
    const retries = startNotificationRetries({ notifier, logger, timers: fakeTimers() });
    assert.equal(await retries.runOnce(), null);
    assert.deepEqual(logger.lines, [{ level: 'error', line: '[notification] event=retry_run_failed error=RangeError' }]);
  });

  test('refuses a missing notifier or a bad interval', () => {
    assert.throws(() => startNotificationRetries({}), /needs a notifier/);
    assert.throws(() => startNotificationRetries({ notifier: { retryPendingDeliveries() {} }, intervalMs: 0 }), /intervalMs/);
  });
});
