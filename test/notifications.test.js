// Card 15: new-referral notifications (PRD 11.2 to 11.6, 16.4).
// All data is synthetic (PRD 15.5).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createNotificationService } from '../src/notifications/notificationService.js';
import { createMemoryDeliveryStore } from '../src/notifications/memoryDeliveryStore.js';
import { createSimulatedOutboxSender } from '../src/notifications/simulatedOutbox.js';
import { buildNewReferralMessage, NEW_REFERRAL } from '../src/notifications/content.js';
import {
  FAILURE_CATEGORIES,
  NotificationSendError,
  categoryForHttpStatus,
} from '../src/notifications/errors.js';

const PROGRAM_EMAIL = 'synthetic-program-a@example.test';

// Synthetic participant data. None of it may ever reach a message or a log.
const PARTICIPANT = {
  participantName: 'Zephyrine Testcase',
  contactValue: '555-0142',
  participantZip: '99901',
  referralContext: 'Synthetic context about housing',
  notes: 'Synthetic private note',
};

function clock(start = '2026-10-17T12:00:00.000Z') {
  let t = new Date(start).getTime();
  return {
    now: () => new Date(t),
    advance: (ms) => { t += ms; },
  };
}

function captureLogger() {
  const lines = [];
  const push = (level) => (line) => lines.push({ level, line });
  return { lines, info: push('info'), warn: push('warn'), error: push('error') };
}

// A sender that fails with the given categories in order, then succeeds.
function scriptedSender(failures = []) {
  const sent = [];
  let call = 0;
  return {
    sent,
    get calls() { return call; },
    async send(message) {
      const failure = failures[call++];
      if (failure) throw failure;
      sent.push(message);
    },
  };
}

// Timers the test fires by hand, so slow sends are deterministic.
function manualTimers() {
  const pending = [];
  return {
    pending,
    setTimeout(fn, ms) { const handle = { fn, ms, cleared: false }; pending.push(handle); return handle; },
    clearTimeout(handle) { if (handle) handle.cleared = true; },
    fireAll() { for (const h of pending.splice(0)) if (!h.cleared) h.fn(); },
  };
}

// Lets queued promise callbacks run.
const settle = () => new Promise((resolve) => setImmediate(resolve));

// A sender whose first call waits until the test settles it.
function slowFirstSender() {
  const sent = [];
  let call = 0;
  let release;
  return {
    sent,
    get calls() { return call; },
    resolveFirst: () => release.resolve(),
    rejectFirst: (err) => release.reject(err),
    async send(message) {
      call += 1;
      if (call === 1) {
        await new Promise((resolve, reject) => { release = { resolve, reject }; });
      }
      sent.push(message);
    },
  };
}

function setup({ sender, programs, maxAttempts = 3, retryAfterMs = 60_000, sendTimeoutMs, timers } = {}) {
  const c = clock();
  const store = createMemoryDeliveryStore(
    {
      programs: programs ?? [
        { programId: 1, notificationEmail: PROGRAM_EMAIL },
        { programId: 2, notificationEmail: null },
      ],
      referrals: [
        { referralId: 101, receivingProgramId: 1, ...PARTICIPANT },
        { referralId: 102, receivingProgramId: 2, ...PARTICIPANT },
      ],
    },
    { now: c.now },
  );
  const out = sender ?? createSimulatedOutboxSender({ nodeEnv: 'test' });
  const logger = captureLogger();
  const service = createNotificationService({
    store, sender: out, logger, now: c.now, maxAttempts, retryAfterMs,
    ...(sendTimeoutMs ? { sendTimeoutMs } : {}),
    ...(timers ? { timers } : {}),
  });
  return { store, sender: out, logger, service, clock: c };
}

test('a committed referral sends one generic email to the receiving Program', async () => {
  const { service, sender, store } = setup();
  const result = await service.notifyReferralCommitted({ referralId: 101, correlationId: 'req-1' });

  assert.equal(result.outcome, 'SENT');
  const messages = sender.list();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, PROGRAM_EMAIL);

  const delivery = await store.getDeliveryByReferral(101, NEW_REFERRAL);
  assert.equal(delivery.status, 'SENT');
  assert.equal(delivery.attemptCount, 1);
  assert.ok(delivery.sentAt instanceof Date);
  assert.equal(delivery.failureCategory, null);
  assert.equal(delivery.correlationId, 'req-1');
});

test('the message contains no participant data (PRD 11.2)', async () => {
  const { service, sender } = setup();
  await service.notifyReferralCommitted({ referralId: 101 });
  const [{ subject, body }] = sender.list();

  for (const value of Object.values(PARTICIPANT)) {
    assert.ok(!subject.includes(value), `subject leaked ${value}`);
    assert.ok(!body.includes(value), `body leaked ${value}`);
  }
  assert.ok(!subject.includes('101') && !body.includes('101'), 'no referral ID in the message');
  assert.equal(buildNewReferralMessage.length, 0, 'content builder takes no arguments');
});

test('the recipient always comes from Program configuration, never the caller (PRD 11.3)', async () => {
  const { service, sender } = setup();
  await service.notifyReferralCommitted({ referralId: 101, to: 'attacker@example.test' });
  assert.equal(sender.list()[0].to, PROGRAM_EMAIL);
});

test('the delivery row stores no message content or recipient (PRD 11.5)', async () => {
  const { service, store } = setup();
  await service.notifyReferralCommitted({ referralId: 101 });
  const delivery = await store.getDeliveryByReferral(101, NEW_REFERRAL);
  const stored = JSON.stringify(delivery);

  assert.ok(!stored.includes(PROGRAM_EMAIL));
  assert.ok(!stored.includes(buildNewReferralMessage().subject));
  for (const value of Object.values(PARTICIPANT)) assert.ok(!stored.includes(value));
});

test('calling notify twice for the same referral sends only once', async () => {
  const { service, sender } = setup();
  await service.notifyReferralCommitted({ referralId: 101 });
  const second = await service.notifyReferralCommitted({ referralId: 101 });

  assert.equal(second.outcome, 'SENT');
  assert.equal(sender.list().length, 1);
});

test('concurrent notify calls for the same referral send only once', async () => {
  const { service, sender } = setup();
  await Promise.all([
    service.notifyReferralCommitted({ referralId: 101 }),
    service.notifyReferralCommitted({ referralId: 101 }),
    service.notifyReferralCommitted({ referralId: 101 }),
  ]);
  assert.equal(sender.list().length, 1);
});

test('no committed referral means no delivery and no email (PRD 11.4)', async () => {
  const { service, sender, store } = setup();
  for (const referralId of [999, 0, -1, 1.5, '101', undefined]) {
    const result = await service.notifyReferralCommitted({ referralId });
    assert.equal(result.outcome, 'SKIPPED');
  }
  assert.equal(sender.list().length, 0);
  assert.equal(await store.getDeliveryByReferral(999, NEW_REFERRAL), null);
});

test('a Program with no notification email is recorded FAILED without sending', async () => {
  const { service, sender, store } = setup();
  const result = await service.notifyReferralCommitted({ referralId: 102 });

  assert.equal(result.outcome, 'FAILED');
  assert.equal(sender.list().length, 0);
  const delivery = await store.getDeliveryByReferral(102, NEW_REFERRAL);
  assert.equal(delivery.status, 'FAILED');
  assert.equal(delivery.failureCategory, FAILURE_CATEGORIES.NO_RECIPIENT);
  assert.equal(await store.referralExists(102), true, 'the referral is untouched');
});

test('a transient failure stays PENDING, then a later retry sends it', async () => {
  const sender = scriptedSender([new NotificationSendError(FAILURE_CATEGORIES.THROTTLED)]);
  const { service, store, clock: c } = setup({ sender });

  const first = await service.notifyReferralCommitted({ referralId: 101 });
  assert.equal(first.outcome, 'PENDING');
  let delivery = await store.getDeliveryByReferral(101, NEW_REFERRAL);
  assert.equal(delivery.status, 'PENDING');
  assert.equal(delivery.failureCategory, FAILURE_CATEGORIES.THROTTLED);

  c.advance(60_001);
  const counts = await service.retryPendingDeliveries();
  assert.equal(counts.SENT, 1);

  delivery = await store.getDeliveryByReferral(101, NEW_REFERRAL);
  assert.equal(delivery.status, 'SENT');
  assert.equal(delivery.attemptCount, 2);
  assert.equal(delivery.failureCategory, null);
  assert.equal(sender.sent.length, 1);
});

test('a repeated notify call while a delivery is PENDING does not skip the retry wait', async () => {
  const sender = scriptedSender([new NotificationSendError(FAILURE_CATEGORIES.THROTTLED)]);
  const { service } = setup({ sender });

  await service.notifyReferralCommitted({ referralId: 101 });
  const again = await service.notifyReferralCommitted({ referralId: 101 });

  assert.equal(again.outcome, 'PENDING');
  assert.equal(sender.calls, 1, 'only the retry schedule may try again');
});

test('two overlapping retry runs send a PENDING delivery only once', async () => {
  const sender = scriptedSender([new NotificationSendError(FAILURE_CATEGORIES.UNAVAILABLE)]);
  const { service, clock: c } = setup({ sender });

  await service.notifyReferralCommitted({ referralId: 101 });
  c.advance(60_001);
  await Promise.all([service.retryPendingDeliveries(), service.retryPendingDeliveries()]);

  assert.equal(sender.calls, 2, 'first attempt plus exactly one retry');
  assert.equal(sender.sent.length, 1);
});

test('retries wait at least retryAfterMs between attempts', async () => {
  const sender = scriptedSender([new NotificationSendError(FAILURE_CATEGORIES.UNAVAILABLE)]);
  const { service, clock: c } = setup({ sender });

  await service.notifyReferralCommitted({ referralId: 101 });
  c.advance(30_000);
  await service.retryPendingDeliveries();
  assert.equal(sender.calls, 1, 'too early, no second attempt');

  c.advance(30_001);
  await service.retryPendingDeliveries();
  assert.equal(sender.calls, 2);
});

test('repeated transient failures stop at maxAttempts and end FAILED', async () => {
  const throttled = () => new NotificationSendError(FAILURE_CATEGORIES.THROTTLED);
  const sender = scriptedSender([throttled(), throttled(), throttled(), throttled()]);
  const { service, store, logger, clock: c } = setup({ sender, maxAttempts: 3 });

  await service.notifyReferralCommitted({ referralId: 101 });
  for (let i = 0; i < 5; i += 1) {
    c.advance(60_001);
    await service.retryPendingDeliveries();
  }

  assert.equal(sender.calls, 3, 'bounded at maxAttempts');
  const delivery = await store.getDeliveryByReferral(101, NEW_REFERRAL);
  assert.equal(delivery.status, 'FAILED');
  assert.equal(delivery.attemptCount, 3);
  assert.equal(delivery.failureCategory, FAILURE_CATEGORIES.THROTTLED);
  assert.ok(logger.lines.some((l) => l.level === 'warn' && l.line.includes('outcome=FAILED')),
    'a final failure is logged as a warning for monitoring (PRD 11.6)');
});

test('a permanent failure ends FAILED at once with no retry', async () => {
  const sender = scriptedSender([new NotificationSendError(FAILURE_CATEGORIES.AUTH_FAILED)]);
  const { service, store, clock: c } = setup({ sender });

  const result = await service.notifyReferralCommitted({ referralId: 101 });
  assert.equal(result.outcome, 'FAILED');
  c.advance(60_001);
  await service.retryPendingDeliveries();

  assert.equal(sender.calls, 1);
  const delivery = await store.getDeliveryByReferral(101, NEW_REFERRAL);
  assert.equal(delivery.failureCategory, FAILURE_CATEGORIES.AUTH_FAILED);
});

test('an unclassified sender error is treated as UNKNOWN and not retried', async () => {
  const sender = scriptedSender([new Error(`smtp said no to ${PROGRAM_EMAIL}`)]);
  const { service, store, logger } = setup({ sender });

  const result = await service.notifyReferralCommitted({ referralId: 101 });
  assert.equal(result.outcome, 'FAILED');
  const delivery = await store.getDeliveryByReferral(101, NEW_REFERRAL);
  assert.equal(delivery.failureCategory, FAILURE_CATEGORIES.UNKNOWN);
  assert.ok(logger.lines.every((l) => !l.line.includes('smtp said no')), 'provider text is never logged');
});

test('notify never throws, even when the store fails, and the referral stays', async () => {
  const { store, sender } = setup();
  const broken = {
    ...store,
    async getOrCreateDelivery() { throw new Error(`db down ${PARTICIPANT.participantName}`); },
  };
  const logger = captureLogger();
  const service = createNotificationService({ store: broken, sender, logger });

  const result = await service.notifyReferralCommitted({ referralId: 101 });
  assert.equal(result.outcome, 'ERROR');
  assert.equal(await store.referralExists(101), true);
  assert.ok(logger.lines.some((l) => l.level === 'error' && l.line.includes('error=Error')));
  assert.ok(logger.lines.every((l) => !l.line.includes(PARTICIPANT.participantName)));
});

test('retryPendingDeliveries never throws when the store fails', async () => {
  const { store, sender } = setup();
  const broken = { ...store, async listRetryableDeliveries() { throw new Error('db down'); } };
  const service = createNotificationService({ store: broken, sender, logger: captureLogger() });
  const counts = await service.retryPendingDeliveries();
  assert.equal(counts.ERROR, 1);
});

test('logs carry IDs and outcomes only, never recipient, content or participant data', async () => {
  const sender = scriptedSender([new NotificationSendError(FAILURE_CATEGORIES.THROTTLED)]);
  const { service, logger, clock: c } = setup({ sender });

  await service.notifyReferralCommitted({ referralId: 101, correlationId: 'req-9' });
  c.advance(60_001);
  await service.retryPendingDeliveries();
  await service.notifyReferralCommitted({ referralId: 102 });

  const all = logger.lines.map((l) => l.line).join('\n');
  assert.ok(all.includes('delivery=1') && all.includes('referral=101') && all.includes('correlation=req-9'));
  assert.ok(!all.includes(PROGRAM_EMAIL));
  assert.ok(!all.includes(buildNewReferralMessage().subject));
  for (const value of Object.values(PARTICIPANT)) assert.ok(!all.includes(value));
});

test('an unsafe correlation ID is dropped, not stored or logged', async () => {
  const { service, store, logger } = setup();
  await service.notifyReferralCommitted({ referralId: 101, correlationId: 'bad id\ninjected=1' });
  const delivery = await store.getDeliveryByReferral(101, NEW_REFERRAL);
  assert.equal(delivery.correlationId, null);
  assert.ok(logger.lines.every((l) => !l.line.includes('injected')));
});

test('the simulated outbox refuses to run outside development and test (PRD 16.4)', () => {
  for (const nodeEnv of ['production', 'staging', '', undefined, 'Development']) {
    assert.throws(() => createSimulatedOutboxSender({ nodeEnv }));
  }
  assert.doesNotThrow(() => createSimulatedOutboxSender({ nodeEnv: 'development' }));
  assert.doesNotThrow(() => createSimulatedOutboxSender({ nodeEnv: 'test' }));
});

test('HTTP statuses map to failure categories', () => {
  assert.equal(categoryForHttpStatus(429), FAILURE_CATEGORIES.THROTTLED);
  assert.equal(categoryForHttpStatus(401), FAILURE_CATEGORIES.AUTH_FAILED);
  assert.equal(categoryForHttpStatus(403), FAILURE_CATEGORIES.AUTH_FAILED);
  assert.equal(categoryForHttpStatus(503), FAILURE_CATEGORIES.UNAVAILABLE);
  assert.equal(categoryForHttpStatus(400), FAILURE_CATEGORIES.REJECTED);
  assert.equal(categoryForHttpStatus(undefined), FAILURE_CATEGORIES.UNKNOWN);
});

test('an unknown category passed to NotificationSendError becomes UNKNOWN', () => {
  assert.equal(new NotificationSendError('MADE_UP').category, FAILURE_CATEGORIES.UNKNOWN);
});

// ---------------------------------------------------------------------------
// Review fix 1: attempt ownership (PRD 11.6)
// ---------------------------------------------------------------------------

test('sendTimeoutMs must be shorter than retryAfterMs, so a send ends before its lease', () => {
  const { store, sender } = setup();
  assert.throws(() => createNotificationService({ store, sender, retryAfterMs: 60_000, sendTimeoutMs: 60_000 }), /sendTimeoutMs/);
  assert.throws(() => createNotificationService({ store, sender, retryAfterMs: 0 }), /retryAfterMs/);
});

test('a completion only succeeds for the attempt that owns the row', async () => {
  const { store, clock: c } = setup();
  const { delivery } = await store.getOrCreateDelivery({ referralId: 101, notificationType: NEW_REFERRAL });
  const first = await store.claimDeliveryAttempt({ deliveryId: delivery.deliveryId, expectedAttemptCount: 0 });
  c.advance(60_001);
  const second = await store.claimDeliveryAttempt({ deliveryId: delivery.deliveryId, expectedAttemptCount: 1 });
  assert.equal(first.attemptCount, 1);
  assert.equal(second.attemptCount, 2);

  const id = delivery.deliveryId;
  assert.equal(await store.markDeliverySent({ deliveryId: id, attempt: 1 }), null);
  assert.equal(await store.markDeliveryFailed({ deliveryId: id, attempt: 1, failureCategory: 'UNKNOWN' }), null);
  assert.equal(await store.recordTransientFailure({ deliveryId: id, attempt: 1, failureCategory: 'THROTTLED' }), null);
  assert.equal((await store.getDeliveryByReferral(101, NEW_REFERRAL)).status, 'PENDING', 'the old attempt changed nothing');

  assert.equal((await store.markDeliverySent({ deliveryId: id, attempt: 2 })).status, 'SENT');
});

test('slow send: it times out as TIMEOUT, a later retry sends, and the late result is ignored', async () => {
  const sender = slowFirstSender();
  const timers = manualTimers();
  const { service, store, logger, clock: c } = setup({ sender, timers, sendTimeoutMs: 30_000 });

  const pendingNotify = service.notifyReferralCommitted({ referralId: 101 });
  await settle();
  assert.equal(timers.pending[0].ms, 30_000, 'the send is bounded');
  timers.fireAll(); // the first send is still hanging
  const first = await pendingNotify;

  assert.equal(first.outcome, 'PENDING');
  let delivery = await store.getDeliveryByReferral(101, NEW_REFERRAL);
  assert.equal(delivery.failureCategory, FAILURE_CATEGORIES.TIMEOUT);

  // Still inside the lease: no second attempt.
  c.advance(30_000);
  await service.retryPendingDeliveries();
  assert.equal(sender.calls, 1);

  // Lease over: attempt 2 sends.
  c.advance(30_001);
  const counts = await service.retryPendingDeliveries();
  assert.equal(counts.SENT, 1);

  // The abandoned first send finishes late. Nothing changes.
  sender.resolveFirst();
  await settle();
  delivery = await store.getDeliveryByReferral(101, NEW_REFERRAL);
  assert.equal(delivery.status, 'SENT');
  assert.equal(delivery.attemptCount, 2);
  assert.equal(delivery.failureCategory, null);
  assert.ok(logger.lines.every((l) => !l.line.includes('stale_attempt')), 'the late send never tries to write');
});

test('slow send: a late failure after timeout is swallowed and does not overwrite SENT', async () => {
  const sender = slowFirstSender();
  const timers = manualTimers();
  const { service, store, clock: c } = setup({ sender, timers, sendTimeoutMs: 30_000 });

  const pendingNotify = service.notifyReferralCommitted({ referralId: 101 });
  await settle();
  timers.fireAll();
  await pendingNotify;
  c.advance(60_001);
  await service.retryPendingDeliveries();

  sender.rejectFirst(new NotificationSendError(FAILURE_CATEGORIES.AUTH_FAILED));
  await settle();
  const delivery = await store.getDeliveryByReferral(101, NEW_REFERRAL);
  assert.equal(delivery.status, 'SENT');
  assert.equal(delivery.failureCategory, null);
});

test('late completion: an older attempt that finishes after a newer claim is rejected and logged', async () => {
  const { store, logger, clock: c } = setup();
  // While attempt 1 is sending, another worker claims attempt 2.
  const sender = {
    async send() {
      c.advance(60_001);
      const d = await store.getDeliveryByReferral(101, NEW_REFERRAL);
      await store.claimDeliveryAttempt({ deliveryId: d.deliveryId, expectedAttemptCount: d.attemptCount });
    },
  };
  const service = createNotificationService({ store, sender, logger, now: c.now });

  const result = await service.notifyReferralCommitted({ referralId: 101 });
  assert.equal(result.outcome, 'PENDING', 'reports the row as it really is');
  const delivery = await store.getDeliveryByReferral(101, NEW_REFERRAL);
  assert.equal(delivery.status, 'PENDING');
  assert.equal(delivery.attemptCount, 2, 'attempt 2 still owns the row');
  assert.ok(logger.lines.some((l) => l.line.includes('event=stale_attempt') && l.line.includes('attempt=1')));
});

// ---------------------------------------------------------------------------
// Review fix 2: interrupted attempts (PRD 11.6)
// ---------------------------------------------------------------------------

test('recipient lookup fails: INTERNAL_ERROR, stays PENDING, and a later retry sends', async () => {
  const { service, store, sender, clock: c } = setup();
  store._failNext('getRecipientForReferral');

  const first = await service.notifyReferralCommitted({ referralId: 101 });
  assert.equal(first.outcome, 'PENDING');
  assert.equal((await store.getDeliveryByReferral(101, NEW_REFERRAL)).failureCategory, FAILURE_CATEGORIES.INTERNAL_ERROR);
  assert.equal(sender.list().length, 0);

  c.advance(60_001);
  await service.retryPendingDeliveries();
  assert.equal((await store.getDeliveryByReferral(101, NEW_REFERRAL)).status, 'SENT');
  assert.equal(sender.list().length, 1);
});

test('recipient lookup fails on the last attempt: ends FAILED, never stuck PENDING', async () => {
  const { service, store } = setup({ maxAttempts: 1 });
  store._failNext('getRecipientForReferral');

  const result = await service.notifyReferralCommitted({ referralId: 101 });
  assert.equal(result.outcome, 'FAILED');
  const delivery = await store.getDeliveryByReferral(101, NEW_REFERRAL);
  assert.equal(delivery.status, 'FAILED');
  assert.equal(delivery.failureCategory, FAILURE_CATEGORIES.INTERNAL_ERROR);
});

test('recording SENT fails once: it is retried right away, with no second email', async () => {
  const { service, store, sender } = setup();
  store._failNext('markDeliverySent');

  const result = await service.notifyReferralCommitted({ referralId: 101 });
  assert.equal(result.outcome, 'SENT');
  assert.equal(sender.list().length, 1);
});

test('recording a transient failure fails: the row stays retryable and a later retry sends', async () => {
  const sender = scriptedSender([new NotificationSendError(FAILURE_CATEGORIES.THROTTLED)]);
  const { service, store, clock: c } = setup({ sender });
  store._failNext('recordTransientFailure', 2);

  const first = await service.notifyReferralCommitted({ referralId: 101 });
  assert.equal(first.outcome, 'PENDING');

  c.advance(60_001);
  await service.retryPendingDeliveries();
  assert.equal((await store.getDeliveryByReferral(101, NEW_REFERRAL)).status, 'SENT');
});

test('status writes fail on the last attempt: the sweep closes it as INTERRUPTED after the lease', async () => {
  const { service, store, sender, logger, clock: c } = setup({ maxAttempts: 1 });
  store._failNext('markDeliverySent', 2);

  const result = await service.notifyReferralCommitted({ referralId: 101 });
  assert.equal(result.outcome, 'PENDING');
  assert.ok(logger.lines.some((l) => l.line.includes('event=result_not_recorded') && l.line.includes('accepted=true')));

  // Too early: the lease has not ended.
  c.advance(30_000);
  await service.retryPendingDeliveries();
  assert.equal((await store.getDeliveryByReferral(101, NEW_REFERRAL)).status, 'PENDING');

  c.advance(30_001);
  const counts = await service.retryPendingDeliveries();
  assert.equal(counts.FAILED, 1);
  const delivery = await store.getDeliveryByReferral(101, NEW_REFERRAL);
  assert.equal(delivery.status, 'FAILED');
  assert.equal(delivery.failureCategory, FAILURE_CATEGORIES.INTERRUPTED);
  assert.equal(sender.list().length, 1, 'the sweep never sends');
  assert.ok(logger.lines.some((l) => l.level === 'warn' && l.line.includes('category=INTERRUPTED')));
});

// ---------------------------------------------------------------------------
// Review fix 3: safe logging (PRD 15.3)
// ---------------------------------------------------------------------------

test('an error name carrying sensitive text is logged as OtherError, never verbatim', async () => {
  const { store, sender } = setup();
  const marker = `${PARTICIPANT.participantName} ${PARTICIPANT.contactValue}`;
  const broken = {
    ...store,
    async getOrCreateDelivery() {
      const err = new Error('boom');
      err.name = marker;
      throw err;
    },
  };
  const logger = captureLogger();
  const service = createNotificationService({ store: broken, sender, logger });

  await service.notifyReferralCommitted({ referralId: 101 });
  assert.ok(logger.lines.some((l) => l.line.includes('error=OtherError')));
  assert.ok(logger.lines.every((l) => !l.line.includes(PARTICIPANT.participantName)
    && !l.line.includes(PARTICIPANT.contactValue)));
});

// ---------------------------------------------------------------------------
// Re-review fix: bound the whole claim-to-send window (PRD 11.6)
// ---------------------------------------------------------------------------

// Wraps a store so the FIRST recipient lookup waits until the test releases it.
function pausedFirstLookup(store) {
  let reached; let release;
  const reachedP = new Promise((r) => { reached = r; });
  const gate = new Promise((r) => { release = r; });
  let calls = 0;
  const wrapped = {
    ...store,
    async getRecipientForReferral(referralId) {
      calls += 1;
      if (calls === 1) { reached(); await gate; }
      return store.getRecipientForReferral(referralId);
    },
  };
  return { wrapped, reachedP, release };
}

test('stalled lookup: attempt 1 pauses past its lease, attempt 2 sends, released attempt 1 sends nothing', async () => {
  const { store, clock: c } = setup();
  const sender = scriptedSender();
  const logger = captureLogger();
  const { wrapped, reachedP, release } = pausedFirstLookup(store);
  const service = createNotificationService({ store: wrapped, sender, logger, now: c.now });

  const first = service.notifyReferralCommitted({ referralId: 101 });
  await reachedP; // attempt 1 has claimed and is stuck in the lookup

  c.advance(60_001); // past attempt 1's lease
  const counts = await service.retryPendingDeliveries();
  assert.equal(counts.SENT, 1, 'attempt 2 sends');

  release(); // attempt 1 resumes
  const result = await first;
  assert.equal(result.outcome, 'SENT', 'reports the real state');
  assert.equal(sender.calls, 1, 'no additional send');
  const delivery = await store.getDeliveryByReferral(101, NEW_REFERRAL);
  assert.equal(delivery.status, 'SENT');
  assert.equal(delivery.attemptCount, 2);
  assert.ok(logger.lines.some((l) => l.line.includes('event=claim_expired_before_send') && l.line.includes('attempt=1')));
});

test('stalled lookup past the send deadline with no retry yet: nothing sent, CLAIM_EXPIRED, later retry sends once', async () => {
  const { store, clock: c } = setup();
  const sender = scriptedSender();
  const { wrapped, reachedP, release } = pausedFirstLookup(store);
  const service = createNotificationService({ store: wrapped, sender, logger: captureLogger(), now: c.now });

  const first = service.notifyReferralCommitted({ referralId: 101 });
  await reachedP;
  c.advance(30_001); // past claim + retryAfterMs - sendTimeoutMs (60s - 30s)
  release();
  assert.equal((await first).outcome, 'PENDING');
  assert.equal(sender.calls, 0, 'an expired claim never starts a send');
  assert.equal((await store.getDeliveryByReferral(101, NEW_REFERRAL)).failureCategory, FAILURE_CATEGORIES.CLAIM_EXPIRED);

  c.advance(60_001);
  await service.retryPendingDeliveries();
  assert.equal(sender.calls, 1);
  assert.equal((await store.getDeliveryByReferral(101, NEW_REFERRAL)).status, 'SENT');
});

test('a lookup that finishes before the send deadline still sends normally', async () => {
  const { store, clock: c } = setup();
  const sender = scriptedSender();
  const { wrapped, reachedP, release } = pausedFirstLookup(store);
  const service = createNotificationService({ store: wrapped, sender, logger: captureLogger(), now: c.now });

  const first = service.notifyReferralCommitted({ referralId: 101 });
  await reachedP;
  c.advance(29_000);
  release();
  assert.equal((await first).outcome, 'SENT');
  assert.equal(sender.calls, 1);
});

test('an attempt superseded before its deadline never starts a send', async () => {
  const { store, clock: c } = setup();
  const sender = scriptedSender();
  const { wrapped, reachedP, release } = pausedFirstLookup(store);
  const logger = captureLogger();
  const service = createNotificationService({ store: wrapped, sender, logger, now: c.now });

  const first = service.notifyReferralCommitted({ referralId: 101 });
  await reachedP;
  // Another worker claims attempt 2 (as if clocks disagreed about the lease).
  const d = await store.getDeliveryByReferral(101, NEW_REFERRAL);
  await store.claimDeliveryAttempt({ deliveryId: d.deliveryId, expectedAttemptCount: 1 });
  release();
  await first;
  assert.equal(sender.calls, 0);
  assert.ok(logger.lines.some((l) => l.line.includes('event=superseded_before_send')));
});

test('a claim that expires on the last attempt ends FAILED / CLAIM_EXPIRED, not stuck PENDING', async () => {
  const { store, clock: c } = setup({ maxAttempts: 1 });
  const sender = scriptedSender();
  const { wrapped, reachedP, release } = pausedFirstLookup(store);
  const service = createNotificationService({ store: wrapped, sender, logger: captureLogger(), now: c.now, maxAttempts: 1 });

  const first = service.notifyReferralCommitted({ referralId: 101 });
  await reachedP;
  c.advance(30_001);
  release();
  assert.equal((await first).outcome, 'FAILED');
  const delivery = await store.getDeliveryByReferral(101, NEW_REFERRAL);
  assert.equal(delivery.failureCategory, FAILURE_CATEGORIES.CLAIM_EXPIRED);
  assert.equal(sender.calls, 0);
});
