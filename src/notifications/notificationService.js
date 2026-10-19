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
// - Logs carry IDs, outcome, attempt count, category, correlation ID, and
//   an allowlisted error kind only. Never the recipient, subject, body,
//   provider error text, or a raw error name (PRD 15.3).
//
// Attempt ownership (PRD 11.6)
// - Claiming an attempt bumps attempt_count. That number is the attempt's
//   token: every completion (SENT, retry later, FAILED) is a conditional
//   write that only succeeds while attempt_count still equals it. An older
//   attempt can never overwrite a newer attempt's result.
// - last_attempt_at + retryAfterMs is the claim's lease: a retry can only
//   claim the delivery after the lease ends.
// - An attempt may only START a send before its send deadline:
//     claim start + retryAfterMs - sendTimeoutMs
//   and only while it still owns the row. Order before sending:
//     1. recipient lookup, 2. ownership re-read, 3. deadline check and
//     sender.send() together in one synchronous function
//     (startSendBefore, which is deliberately not async).
//   The deadline is checked AFTER every await, and nothing can be awaited
//   between that check and the call to sender.send(), so a slow lookup or
//   a slow ownership read can never carry an expired attempt into a send.
//   Past the deadline the attempt sends nothing and records CLAIM_EXPIRED
//   (retried, or FAILED on the last attempt). Superseded: nothing is sent.
// - We stop WAITING for a send after sendTimeoutMs, and abort its
//   AbortSignal. Aborting is best-effort: JavaScript cannot force the
//   sender's work to stop, and the provider may already have the message.
//   So a timed-out send can still finish, at the provider, after the lease
//   ends and while a newer attempt is sending. Its late result is ignored
//   and never written.
//
// Interrupted attempts (PRD 11.6)
// - If our own step fails after the claim (recipient lookup, status
//   write), the attempt is recorded as INTERNAL_ERROR: retried while
//   attempts remain, FAILED on the last one.
// - If even that write fails, the row stays PENDING. retryPendingDeliveries()
//   retries it like any other while attempts remain. A row stuck PENDING
//   at maxAttempts after its lease ends is closed as FAILED / INTERRUPTED.
//   Nothing is left PENDING forever.
//
// Delivery guarantee: at least once while attempts remain, never exactly
// once. What IS guaranteed: an attempt never STARTS a send after its
// deadline or after losing its claim, so two attempts never start sending
// for the same lease. What is NOT guaranteed: that a started send has
// stopped by the time a newer attempt starts. A second copy is still
// possible through provider-acceptance uncertainty: (a) a send times out
// (we stop waiting) but the provider accepts it anyway, possibly while a
// retry is also sending, or (b) the provider accepts it and we cannot
// record SENT. The message is generic, so such a duplicate only tells the
// Program twice.

import { buildNewReferralMessage, NEW_REFERRAL } from './content.js';
import {
  FAILURE_CATEGORIES,
  NotificationSendError,
  categoryForError,
  isTransient,
  safeErrorKind,
} from './errors.js';

const CORRELATION_ID = /^[A-Za-z0-9_-]{1,64}$/;

function isReferralId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

// Only a short, plain ID reaches the logs or the database.
function safeCorrelationId(value) {
  return typeof value === 'string' && CORRELATION_ID.test(value) ? value : null;
}

const defaultTimers = Object.freeze({
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle),
});

export function createNotificationService({
  store,
  sender,
  logger = console,
  now = () => new Date(),
  maxAttempts = 3,
  retryAfterMs = 60_000,
  sendTimeoutMs = 30_000,
  timers = defaultTimers,
} = {}) {
  if (!store || !sender) throw new Error('createNotificationService needs a store and a sender');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('maxAttempts must be a positive integer');
  if (!Number.isInteger(retryAfterMs) || retryAfterMs < 1) throw new Error('retryAfterMs must be a positive integer');
  if (!Number.isInteger(sendTimeoutMs) || sendTimeoutMs < 1 || sendTimeoutMs >= retryAfterMs) {
    throw new Error('sendTimeoutMs must be a positive integer smaller than retryAfterMs');
  }

  function log(level, fields) {
    const line = Object.entries(fields)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    logger[level](`[notification] ${line}`);
  }

  function logUnexpected(where, err, referralId) {
    log('error', { event: 'internal_error', where, referral: referralId, error: safeErrorKind(err) });
  }

  // The only place a send starts. Deliberately NOT async: the deadline
  // check and the sender.send() call run in one synchronous step, so no
  // await can ever sit between them.
  // Returns null (and sends nothing) if the deadline has passed. Otherwise
  // returns a promise that resolves when the sender accepts, rejects with
  // the sender's error, or rejects with TIMEOUT after sendTimeoutMs. On
  // timeout we stop waiting and abort the signal, but cannot force the
  // send to stop (see header). Its late result is swallowed.
  function startSendBefore(deadlineMs, message) {
    if (now().getTime() > deadlineMs) return null;
    const controller = new AbortController();
    let sending;
    try {
      sending = Promise.resolve(sender.send(message, { signal: controller.signal }));
    } catch (err) {
      sending = Promise.reject(err);
    }
    sending.catch(() => {}); // a late failure must not become an unhandled rejection
    let handle;
    const timeout = new Promise((resolve, reject) => {
      handle = timers.setTimeout(() => {
        controller.abort();
        reject(new NotificationSendError(FAILURE_CATEGORIES.TIMEOUT));
      }, sendTimeoutMs);
    });
    return Promise.race([sending, timeout]).finally(() => timers.clearTimeout(handle));
  }

  async function currentOutcome(claimed) {
    const current = await store.getDeliveryByReferral(claimed.referralId, claimed.notificationType);
    return current?.status ?? 'PENDING';
  }

  async function attemptDelivery(delivery) {
    // Taken BEFORE the claim, so it is never later than the stored
    // last_attempt_at: the send deadline errs on the early side.
    const claimStartedMs = now().getTime();
    const sendDeadlineMs = claimStartedMs + retryAfterMs - sendTimeoutMs;
    const claimed = await store.claimDeliveryAttempt({
      deliveryId: delivery.deliveryId,
      expectedAttemptCount: delivery.attemptCount,
    });
    if (!claimed) {
      // Another attempt got there first, or it is no longer PENDING.
      const current = await store.getDeliveryByReferral(delivery.referralId, delivery.notificationType);
      return { outcome: current?.status ?? 'PENDING', deliveryId: delivery.deliveryId };
    }

    const attempt = claimed.attemptCount;
    const owned = { deliveryId: claimed.deliveryId, attempt };
    const base = {
      delivery: claimed.deliveryId,
      referral: claimed.referralId,
      type: claimed.notificationType,
      attempt,
      correlation: claimed.correlationId,
    };

    // Every result is written only if this attempt still owns the row.
    async function finish(kind, failureCategory = null) {
      let written;
      if (kind === 'SENT') written = await store.markDeliverySent(owned);
      else if (kind === 'RETRY') written = await store.recordTransientFailure({ ...owned, failureCategory });
      else written = await store.markDeliveryFailed({ ...owned, failureCategory });

      if (!written) {
        log('warn', { ...base, event: 'stale_attempt', result: kind });
        return { outcome: await currentOutcome(claimed), deliveryId: claimed.deliveryId };
      }
      const outcome = kind === 'RETRY' ? 'PENDING' : kind;
      const level = kind === 'FAILED' ? 'warn' : 'info';
      log(level, { ...base, outcome: kind === 'RETRY' ? 'RETRY_LATER' : kind, category: failureCategory });
      return { outcome, deliveryId: claimed.deliveryId };
    }

    let accepted = false;
    try {
      const recipient = await store.getRecipientForReferral(claimed.referralId);
      if (!recipient) return await finish('FAILED', FAILURE_CATEGORIES.NO_RECIPIENT);

      // Still ours? Superseded attempts send nothing.
      const current = await store.getDeliveryByReferral(claimed.referralId, claimed.notificationType);
      if (!current || current.status !== 'PENDING' || current.attemptCount !== attempt) {
        log('warn', { ...base, event: 'superseded_before_send' });
        return { outcome: current?.status ?? 'PENDING', deliveryId: claimed.deliveryId };
      }

      // Last gate, after every await: checked and sent in one synchronous
      // step inside startSendBefore().
      const { subject, body } = buildNewReferralMessage();
      const sending = startSendBefore(sendDeadlineMs, { to: recipient, subject, body });
      if (!sending) {
        log('warn', { ...base, event: 'claim_expired_before_send' });
        return await finish(attempt < maxAttempts ? 'RETRY' : 'FAILED', FAILURE_CATEGORIES.CLAIM_EXPIRED);
      }
      try {
        await sending;
        accepted = true;
      } catch (err) {
        const category = categoryForError(err);
        const retry = isTransient(category) && attempt < maxAttempts;
        return await finish(retry ? 'RETRY' : 'FAILED', category);
      }

      return await finish('SENT');
    } catch (err) {
      // Our own step failed after the claim.
      logUnexpected('attemptDelivery', err, claimed.referralId);
      try {
        if (accepted) {
          // The provider took the message; only recording SENT failed.
          // Try once more. If that fails too, the row stays PENDING and a
          // retry may send a second copy (see header).
          return await finish('SENT');
        }
        const retry = attempt < maxAttempts;
        return await finish(retry ? 'RETRY' : 'FAILED', FAILURE_CATEGORIES.INTERNAL_ERROR);
      } catch (writeErr) {
        logUnexpected('attemptDelivery.record', writeErr, claimed.referralId);
        log('warn', { ...base, event: 'result_not_recorded', accepted });
        return { outcome: 'PENDING', deliveryId: claimed.deliveryId };
      }
    }
  }

  // Closes rows left PENDING at maxAttempts after their lease ended: the
  // last attempt never recorded a result. Conditional on attempt_count, so
  // a late result from that attempt cannot be overwritten afterwards.
  async function closeInterrupted(lastAttemptBefore, limit, counts) {
    const stuck = await store.listInterruptedDeliveries({ maxAttempts, lastAttemptBefore, limit });
    for (const delivery of stuck) {
      try {
        const closed = await store.markDeliveryFailed({
          deliveryId: delivery.deliveryId,
          attempt: delivery.attemptCount,
          failureCategory: FAILURE_CATEGORIES.INTERRUPTED,
        });
        if (!closed) continue; // something else finished it first
        counts.FAILED += 1;
        log('warn', {
          delivery: delivery.deliveryId,
          referral: delivery.referralId,
          type: delivery.notificationType,
          attempt: delivery.attemptCount,
          correlation: delivery.correlationId,
          outcome: 'FAILED',
          category: FAILURE_CATEGORIES.INTERRUPTED,
        });
      } catch (err) {
        logUnexpected('closeInterrupted', err, delivery.referralId);
        counts.ERROR += 1;
      }
    }
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

    // Meant to run on a timer. Closes interrupted deliveries, then retries
    // PENDING deliveries whose lease (last attempt + retryAfterMs) has
    // ended, up to maxAttempts each. Resolves to counts by outcome. Never
    // rejects.
    async retryPendingDeliveries({ limit = 50 } = {}) {
      const counts = { SENT: 0, PENDING: 0, FAILED: 0, ERROR: 0 };
      const lastAttemptBefore = new Date(now().getTime() - retryAfterMs);

      try {
        await closeInterrupted(lastAttemptBefore, limit, counts);
      } catch (err) {
        logUnexpected('retryPendingDeliveries.closeInterrupted', err, null);
        counts.ERROR += 1;
      }

      let due;
      try {
        due = await store.listRetryableDeliveries({ maxAttempts, lastAttemptBefore, limit });
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
