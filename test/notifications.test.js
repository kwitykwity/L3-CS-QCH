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

function setup({ sender, programs, maxAttempts = 3, retryAfterMs = 60_000 } = {}) {
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
