// New-referral notification delivery (Final Technical PRD 2.2, 11.2 to 11.6).
//
// - Runs only for a committed referral with a permanent Referral ID
//   (PRD 11.4). The referral-creation transaction calls
//   notifyReferralCommitted() after it commits; nothing here can roll the
//   referral back or change it (PRD 9.3, 11.6).
// - Never throws to the caller. A notification problem is recorded and
//   logged; the referral stays successfully received (PRD 6.2, 17.5).
// - The recipient is read server-side from the receiving Program's
//   configuration. Callers cannot pass a recipient (PRD 11.3).
// - The message is generic, with no participant data (PRD 11.2).
// - Delivery state is PENDING -> SENT or FAILED, stored separately from the
//   referral with minimum technical metadata (PRD 11.5).
// - Transient failures retry a bounded number of times; a claim step makes
//   retries duplicate-safe. Permanent or repeated failures stop and are
//   logged for monitoring (PRD 11.6).
// - Logs carry IDs, outcome, attempt count, category and correlation ID
//   only. Never the recipient, subject, body, or provider error text
//   (PRD 15.3).

import { buildNewReferralMessage, NEW_REFERRAL } from './content.js';
import { FAILURE_CATEGORIES, categoryForError, isTransient } from './errors.js';

const CORRELATION_ID = /^[A-Za-z0-9_-]{1,64}$/;

function isReferralId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

// Only a short, plain ID reaches the logs or the database.
function safeCorrelationId(value) {
  return typeof value === 'string' && CORRELATION_ID.test(value) ? value : null;
}

export function createNotificationService({
  store,
  sender,
  logger = console,
  now = () => new Date(),
  maxAttempts = 3,
  retryAfterMs = 60_000,
} = {}) {
  if (!store || !sender) throw new Error('createNotificationService needs a store and a sender');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('maxAttempts must be a positive integer');
  if (!Number.isInteger(retryAfterMs) || retryAfterMs < 0) throw new Error('retryAfterMs must be a non-negative integer');

  function log(level, fields) {
    const line = Object.entries(fields)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    logger[level](`[notification] ${line}`);
  }

  function logUnexpected(where, err, referralId) {
    const name = typeof err?.name === 'string' ? err.name : 'UnknownError';
    log('error', { event: 'internal_error', where, referral: referralId, error: name });
  }

  async function attemptDelivery(delivery) {
    const claimed = await store.claimDeliveryAttempt({
      deliveryId: delivery.deliveryId,
      expectedAttemptCount: delivery.attemptCount,
    });
    if (!claimed) {
      // Another attempt got there first, or it is no longer PENDING.
      const current = await store.getDeliveryByReferral(delivery.referralId, delivery.notificationType);
      return { outcome: current?.status ?? 'PENDING', deliveryId: delivery.deliveryId };
    }

    const base = {
      delivery: claimed.deliveryId,
      referral: claimed.referralId,
      type: claimed.notificationType,
      attempt: claimed.attemptCount,
      correlation: claimed.correlationId,
    };

    const recipient = await store.getRecipientForReferral(claimed.referralId);
    if (!recipient) {
      await store.markDeliveryFailed({ deliveryId: claimed.deliveryId, failureCategory: FAILURE_CATEGORIES.NO_RECIPIENT });
      log('warn', { ...base, outcome: 'FAILED', category: FAILURE_CATEGORIES.NO_RECIPIENT });
      return { outcome: 'FAILED', deliveryId: claimed.deliveryId };
    }

    const { subject, body } = buildNewReferralMessage();
    try {
      await sender.send({ to: recipient, subject, body });
    } catch (err) {
      const category = categoryForError(err);
      if (isTransient(category) && claimed.attemptCount < maxAttempts) {
        await store.recordTransientFailure({ deliveryId: claimed.deliveryId, failureCategory: category });
        log('info', { ...base, outcome: 'RETRY_LATER', category });
        return { outcome: 'PENDING', deliveryId: claimed.deliveryId };
      }
      await store.markDeliveryFailed({ deliveryId: claimed.deliveryId, failureCategory: category });
      log('warn', { ...base, outcome: 'FAILED', category });
      return { outcome: 'FAILED', deliveryId: claimed.deliveryId };
    }

    await store.markDeliverySent({ deliveryId: claimed.deliveryId });
    log('info', { ...base, outcome: 'SENT' });
    return { outcome: 'SENT', deliveryId: claimed.deliveryId };
  }

  return {
    // Call once, after the referral transaction commits. Takes only IDs.
    // Resolves to { outcome, deliveryId? }; outcome is SENT, PENDING,
    // FAILED, SKIPPED (no committed referral) or ERROR. Never rejects.
    async notifyReferralCommitted({ referralId, correlationId } = {}) {
      try {
        if (!isReferralId(referralId) || !(await store.referralExists(referralId))) {
          log('warn', { event: 'skipped_no_committed_referral' });
          return { outcome: 'SKIPPED' };
        }

        const { delivery, created } = await store.getOrCreateDelivery({
          referralId,
          notificationType: NEW_REFERRAL,
          correlationId: safeCorrelationId(correlationId),
        });

        // A repeated call never sends again. A delivery left PENDING is
        // picked up by retryPendingDeliveries() on its schedule.
        if (!created) return { outcome: delivery.status, deliveryId: delivery.deliveryId };

        return await attemptDelivery(delivery);
      } catch (err) {
        logUnexpected('notifyReferralCommitted', err, isReferralId(referralId) ? referralId : null);
        return { outcome: 'ERROR' };
      }
    },

    // Retries PENDING deliveries whose last attempt is at least
    // retryAfterMs old, up to maxAttempts each. Meant to run on a timer.
    // Resolves to counts by outcome. Never rejects.
    async retryPendingDeliveries({ limit = 50 } = {}) {
      const counts = { SENT: 0, PENDING: 0, FAILED: 0, ERROR: 0 };
      let due;
      try {
        due = await store.listRetryableDeliveries({
          maxAttempts,
          lastAttemptBefore: new Date(now().getTime() - retryAfterMs),
          limit,
        });
      } catch (err) {
        logUnexpected('retryPendingDeliveries', err, null);
        counts.ERROR += 1;
        return counts;
      }

      for (const delivery of due) {
        try {
          const { outcome } = await attemptDelivery(delivery);
          counts[outcome] = (counts[outcome] ?? 0) + 1;
        } catch (err) {
          logUnexpected('retryPendingDeliveries', err, delivery.referralId);
          counts.ERROR += 1;
        }
      }
      return counts;
    },
  };
}
