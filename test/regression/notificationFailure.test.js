// Trello Task NN: notification failure regression (Frozen Handoff PRD §21,
// §19, §26, §34, §36; Handoff MVP §21).
//
//   PRD §21  Notification occurs after authoritative referral persistence.
//            A notification failure must not roll back or delete the
//            referral. Notification failure and retry must be
//            independently traceable.
//
// What was already covered: test/notificationWiring.test.js and
// test/notifications.test.js check the ordering, each failure kind,
// bounded retries and no duplicate email, one rule at a time. This file
// checks them together over HTTP and adds what those do not:
//   1. at the moment a send starts, the referral and its CREATED audit
//      record are already saved;
//   2. under EVERY failure kind the referral is left exactly as it was
//      saved (never updated, only its CREATED audit record), and the
//      receiving Program can still work it;
//   3. the failure and each retry can be followed on their own, outside
//      the referral record: the CREATED audit record, the delivery row and
//      one log line per attempt share one correlation ID, with the attempt
//      number, outcome and category, and two referrals' traces never mix;
//      none of it carries participant data.
//
// Production email (QCH shared mailbox through Microsoft Graph, PRD §21,
// §30) is a QCH IT dependency; here the sender is simulated.
// Tests only: no product code changed. In-memory store; SYNTHETIC data.

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

const WORKER = 100;      // sends referrals from P_SENDER
const INTAKE = 200;      // receiving Program: view + respond
const P_SENDER = 10;
const P_EMAIL = 11;      // has a notification address
const P_NO_EMAIL = 12;   // has none
const P_EMAIL_2 = 13;    // a second Program with its own address
const ADDRESS = { [P_EMAIL]: 'receiving.nn@example.test', [P_EMAIL_2]: 'receiving.nn2@example.test' };
const RETRY_MS = 60_001; // just past the default retry lease (60 s)

// Text that must never reach a delivery row or a log (PRD §34).
const MARKERS = {
  name: 'Synthetic Person NN Marker',
  context: 'Synthetic context marker NN21CTX',
  phone: '(555) 010-0199',
};

const grant = (userId, permission, programId) => ({
  userId, permission, scopeType: 'PROGRAM', programId, departmentId: null, grantSource: 'IN_APP',
});

// A sender whose behavior each test sets. `mode`:
//   'down'   every send fails as UNAVAILABLE (temporary)
//   'denied' every send fails as AUTH_FAILED (permanent)
//   'throws' sender.send throws synchronously (not even a promise)
//   'up'     the simulated outbox accepts it
// sender.downAddresses: addresses that fail as UNAVAILABLE whatever the mode.
function setup({ mode = 'up', onSend = null } = {}) {
  let t = new Date('2026-10-28T12:00:00.000Z').getTime();
  const now = () => new Date(t);
  const advance = (ms) => { t += ms; };

  const store = createMemoryReferralStore({
    departments: [{ departmentId: 1, name: 'Synthetic Department', lifecycleStatus: 'ACTIVE' }],
    programs: [P_SENDER, P_EMAIL, P_NO_EMAIL, P_EMAIL_2].map((programId) => ({
      programId, departmentId: 1, name: `Synthetic Program ${programId}`, site: null, lifecycleStatus: 'ACTIVE',
    })),
    users: [
      { userId: WORKER, isActive: true, currentProgramId: P_SENDER },
      { userId: INTAKE, isActive: true, currentProgramId: P_EMAIL },
    ],
    grants: [P_EMAIL, P_NO_EMAIL].flatMap((p) => [grant(INTAKE, 'VIEW_RECEIVED_REFERRAL', p), grant(INTAKE, 'RESPOND_TO_REFERRAL', p)]),
    notAppropriateReasons: [{ reasonId: 1, code: 'OTHER', label: 'Other', displayOrder: 1 }],
    programNotificationEmails: ADDRESS,
  }, { now });

  const outbox = createSimulatedOutboxSender({ nodeEnv: 'test' });
  const sender = {
    mode,
    downAddresses: new Set(),
    send(message, options) {
      if (onSend) onSend(store);
      if (sender.downAddresses.has(message.to)) return Promise.reject(new NotificationSendError(FAILURE_CATEGORIES.UNAVAILABLE));
      if (sender.mode === 'throws') throw new Error('simulated sender crash');
      if (sender.mode === 'down') return Promise.reject(new NotificationSendError(FAILURE_CATEGORIES.UNAVAILABLE));
      if (sender.mode === 'denied') return Promise.reject(new NotificationSendError(FAILURE_CATEGORIES.AUTH_FAILED));
      return outbox.send(message, options);
    },
  };
  const logLines = [];
  const logger = Object.fromEntries(['info', 'warn', 'error'].map((level) => [level, (line) => logLines.push({ level, line })]));
  const real = createNotificationService({ store: store.notificationStore, sender, logger, now });
  const runs = [];
  const notifier = {
    notifyReferralCommitted(args) { const run = real.notifyReferralCommitted(args); runs.push(run); return run; },
    retryPendingDeliveries: (options) => real.retryPendingDeliveries(options),
  };

  let current = null;
  const app = createApp({
    affiliationStore: store, referralStore: store, nodeEnv: 'test', now, notifier,
    resolveIdentity: () => (current ? { userId: current } : null),
  });
  const as = (userId) => ({
    get: (url) => { current = userId; return request(app).get(url); },
    post: (url, body) => { current = userId; return request(app).post(url).send(body); },
  });

  // Waits until every started notification has finished.
  async function settle(count) {
    for (let i = 0; i < 200 && runs.length < count; i += 1) await new Promise((resolve) => setImmediate(resolve));
    assert.ok(runs.length >= count, `${count} notification(s) should have started`);
    await Promise.all(runs);
  }
  // One retry pass after the lease has ended.
  async function retryLater() {
    advance(RETRY_MS);
    return notifier.retryPendingDeliveries();
  }
  const delivery = (referralId) => store.notificationStore.getDeliveryByReferral(referralId, NEW_REFERRAL);
  const referralRow = (referralId) => store._referrals.find((r) => r.referralId === referralId);
  const auditOf = (referralId) => store._referralAuditEvents
    .filter((e) => e.entityType === 'REFERRAL' && e.entityId === referralId);
  const linesFor = (referralId) => logLines.filter((l) => new RegExp(`\\breferral=${referralId}\\b`).test(l.line));
  return { store, sender, outbox, logLines, as, settle, retryLater, delivery, referralRow, auditOf, linesFor, now };
}

const draft = (receivingProgramId) => ({
  submissionId: randomUUID(), receivingProgramId, participantName: MARKERS.name,
  contactMethod: 'PHONE_CALL', contactValue: MARKERS.phone, referralContext: MARKERS.context,
});

// The fields of one log line, e.g. { referral: '1', attempt: '2', ... }.
const fieldsOf = (line) => Object.fromEntries(
  line.replace(/^\[notification\] /, '').split(' ').map((pair) => pair.split('=')),
);

const noMarkers = (text, where) => {
  for (const [field, value] of Object.entries(MARKERS)) assert.ok(!text.includes(value), `${where} contains ${field}`);
};

describe('Task NN: the referral is saved before any notification (PRD §21)', () => {
  test('when a send starts, the referral and its CREATED audit record already exist', async () => {
    const seen = [];
    const t = setup({
      onSend: (store) => seen.push({
        referrals: store._referrals.map((r) => r.referralId),
        created: store._referralAuditEvents.filter((e) => e.action === 'CREATED').map((e) => e.entityId),
      }),
    });
    const sent = await t.as(WORKER).post('/api/referrals', draft(P_EMAIL));
    assert.deepEqual([sent.status, sent.body.status], [201, 'RECEIVED']);
    const id = sent.body.referral.referralId;
    await t.settle(1);

    assert.equal(seen.length, 1, 'one send');
    assert.deepEqual(seen[0], { referrals: [id], created: [id] }, 'saved and audited before the send started');
    assert.equal((await t.delivery(id)).status, 'SENT');
  });
});

describe('Task NN: a notification failure never changes the referral (PRD §21)', () => {
  // Each failure kind, and the delivery state it must end in.
  const FAILURES = [
    { name: 'email service down (temporary, retried until the last attempt)', mode: 'down', program: P_EMAIL,
      end: ['FAILED', FAILURE_CATEGORIES.UNAVAILABLE, 3] },
    { name: 'sending refused (permanent, not retried)', mode: 'denied', program: P_EMAIL,
      end: ['FAILED', FAILURE_CATEGORIES.AUTH_FAILED, 1] },
    { name: 'no notification address for the Program', mode: 'up', program: P_NO_EMAIL,
      end: ['FAILED', FAILURE_CATEGORIES.NO_RECIPIENT, 1] },
    { name: 'the sender crashes outright', mode: 'throws', program: P_EMAIL,
      end: ['FAILED', FAILURE_CATEGORIES.UNKNOWN, 1] },
  ];

  for (const failure of FAILURES) {
    test(`${failure.name}: the referral stays exactly as saved, and the Program can still work it`, async () => {
      const t = setup({ mode: failure.mode });
      const sent = await t.as(WORKER).post('/api/referrals', draft(failure.program));
      assert.deepEqual([sent.status, sent.body.status], [201, 'RECEIVED'], 'the sender is told it was received');
      assert.doesNotMatch(JSON.stringify(sent.body), /notif|deliver|email|PENDING|FAILED/i,
        'the answer says nothing about email either way');
      const id = sent.body.referral.referralId;
      await t.settle(1);

      // As saved, and every retry pass later: never rolled back, deleted or updated.
      const saved = JSON.stringify([t.referralRow(id), t.auditOf(id)]);
      for (let i = 0; i < 4; i += 1) await t.retryLater();
      assert.equal(JSON.stringify([t.referralRow(id), t.auditOf(id)]), saved, 'the referral and its audit did not change');
      assert.equal(t.store._referrals.length, 1);
      assert.equal(t.referralRow(id).rowVersion, 1, 'never updated');
      assert.deepEqual(t.auditOf(id).map((e) => e.action), ['CREATED']);

      // The notification ended where it should, and sent nothing.
      const row = await t.delivery(id);
      assert.deepEqual([row.status, row.failureCategory, row.attemptCount], failure.end);
      assert.equal(row.sentAt, null);
      assert.equal(t.outbox.list().length, 0);

      // The receiving Program finds it Awaiting Response and can answer it.
      const queue = await t.as(INTAKE).get('/api/referrals/received');
      assert.equal(queue.body.referrals.find((r) => r.referralId === id).stage, 'AWAITING_RESPONSE');
      assert.equal((await t.as(INTAKE).post(`/api/referrals/${id}/response`, { decision: 'ACCEPTED' })).status, 200);
      assert.deepEqual(t.auditOf(id).map((e) => e.action), ['CREATED', 'ACCEPTED']);
    });
  }

  test('the delivery record itself failing to save is logged with the referral ID, and the referral still stands', async () => {
    const t = setup({ mode: 'up' });
    // The memory store has no switch for this call, so fail it once here.
    const deliveries = t.store.notificationStore;
    const realCreate = deliveries.getOrCreateDelivery;
    deliveries.getOrCreateDelivery = async () => {
      deliveries.getOrCreateDelivery = realCreate;
      throw new Error('simulated delivery store outage');
    };
    const sent = await t.as(WORKER).post('/api/referrals', draft(P_EMAIL));
    assert.deepEqual([sent.status, sent.body.status], [201, 'RECEIVED']);
    const id = sent.body.referral.referralId;
    await t.settle(1);

    assert.equal(t.referralRow(id).rowVersion, 1);
    assert.deepEqual(t.auditOf(id).map((e) => e.action), ['CREATED']);
    const logged = t.linesFor(id).map((l) => [l.level, fieldsOf(l.line).event, fieldsOf(l.line).error]);
    assert.deepEqual(logged, [['error', 'internal_error', 'Error']], 'traceable by referral ID, error kind only');
    noMarkers(t.logLines.map((l) => l.line).join('\n'), 'notification logs');
  });
});

describe('Task NN: failure and retry can be traced on their own (PRD §21, §26)', () => {
  test('audit record, delivery row and one log line per attempt share one correlation ID; two referrals never mix', async () => {
    const t = setup({ mode: 'down' });
    const worker = t.as(WORKER);

    // Two referrals, to two Programs, while email is down: A's address
    // will recover, B's will not.
    const a = (await worker.post('/api/referrals', draft(P_EMAIL))).body.referral.referralId;
    const b = (await worker.post('/api/referrals', draft(P_EMAIL_2))).body.referral.referralId;
    await t.settle(2);
    const created = (id) => t.auditOf(id).find((e) => e.action === 'CREATED');
    const correlationA = created(a).correlationId;
    const correlationB = created(b).correlationId;
    assert.ok(correlationA && correlationB && correlationA !== correlationB, 'each referral has its own correlation ID');

    // Attempt 2: both fail again, and the delivery row records when.
    const attempt2At = t.now().getTime() + RETRY_MS;
    await t.retryLater();
    const pendingB = await t.delivery(b);
    assert.deepEqual([pendingB.status, pendingB.attemptCount], ['PENDING', 2]);
    assert.equal(pendingB.lastAttemptAt.getTime(), attempt2At, 'when the last attempt ran');

    // Attempt 3: A's address is back and sends; B's is still down and its
    // last attempt fails for good.
    t.sender.mode = 'up';
    t.sender.downAddresses.add(ADDRESS[P_EMAIL_2]);
    await t.retryLater();

    const rowA = await t.delivery(a);
    const rowB = await t.delivery(b);
    assert.deepEqual([rowA.status, rowA.attemptCount, rowA.correlationId], ['SENT', 3, correlationA]);
    assert.ok(rowA.sentAt instanceof Date);
    assert.deepEqual([rowB.status, rowB.failureCategory, rowB.attemptCount, rowB.correlationId],
      ['FAILED', 'UNAVAILABLE', 3, correlationB]);
    assert.equal(rowB.sentAt, null);
    assert.equal(t.outbox.list().length, 1, 'one email, for A only');

    // A's trace, attempt by attempt, joined only by referral and correlation ID.
    const traceA = t.linesFor(a).map((l) => ({ level: l.level, ...fieldsOf(l.line) }))
      .map(({ level, attempt, outcome, category, correlation }) => ({ level, attempt, outcome, category, correlation }));
    assert.deepEqual(traceA, [
      { level: 'info', attempt: '1', outcome: 'RETRY_LATER', category: 'UNAVAILABLE', correlation: correlationA },
      { level: 'info', attempt: '2', outcome: 'RETRY_LATER', category: 'UNAVAILABLE', correlation: correlationA },
      { level: 'info', attempt: '3', outcome: 'SENT', category: undefined, correlation: correlationA },
    ]);
    const traceB = t.linesFor(b).map((l) => [l.level, fieldsOf(l.line).attempt, fieldsOf(l.line).outcome, fieldsOf(l.line).correlation]);
    assert.deepEqual(traceB, [
      ['info', '1', 'RETRY_LATER', correlationB], ['info', '2', 'RETRY_LATER', correlationB], ['warn', '3', 'FAILED', correlationB],
    ]);
    // Each trace is its own: no line of A's carries B's IDs, or the reverse.
    for (const line of t.linesFor(a)) assert.ok(!line.line.includes(correlationB));
    for (const line of t.linesFor(b)) assert.ok(!line.line.includes(correlationA));

    // The referral records hold none of this: notification is traced apart
    // from the referral, which is still only CREATED and never updated.
    for (const id of [a, b]) {
      assert.equal(t.referralRow(id).rowVersion, 1);
      assert.deepEqual(t.auditOf(id).map((e) => e.action), ['CREATED']);
      assert.doesNotMatch(JSON.stringify(t.referralRow(id)), /deliver|notif|attempt/i);
    }

    // No trace carries participant data (PRD §34).
    noMarkers(t.logLines.map((l) => l.line).join('\n'), 'notification logs');
    noMarkers(JSON.stringify([rowA, rowB]), 'delivery rows');
  });

  test('a delivery that never succeeds ends FAILED at a bounded attempt count, logged as a warning with its category', async () => {
    const t = setup({ mode: 'down' });
    const id = (await t.as(WORKER).post('/api/referrals', draft(P_EMAIL))).body.referral.referralId;
    await t.settle(1);
    const correlation = t.auditOf(id)[0].correlationId;
    for (let i = 0; i < 5; i += 1) await t.retryLater();

    const row = await t.delivery(id);
    assert.deepEqual([row.status, row.failureCategory, row.attemptCount, row.correlationId],
      ['FAILED', 'UNAVAILABLE', 3, correlation]);
    const trace = t.linesFor(id).map((l) => [l.level, fieldsOf(l.line).attempt, fieldsOf(l.line).outcome]);
    assert.deepEqual(trace, [['info', '1', 'RETRY_LATER'], ['info', '2', 'RETRY_LATER'], ['warn', '3', 'FAILED']]);
    assert.equal(t.outbox.list().length, 0);
  });
});
