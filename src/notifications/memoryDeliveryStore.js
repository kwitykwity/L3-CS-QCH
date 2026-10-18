// In-memory store for tests and local development with SYNTHETIC data only.
// It is not used in production.
//
// It defines the notification store contract that the Azure SQL store must
// also meet. Columns map to dbo.notification_deliveries, dbo.referrals and
// dbo.programs in db/migrations/001_core_schema.sql (PR #4).
//
//   referralExists(referralId) -> boolean
//       A committed referral row exists (PRD 11.4).
//   getRecipientForReferral(referralId) -> string | null
//       The receiving Program's notification_email, read server-side
//       (PRD 11.3):
//         SELECT p.notification_email FROM dbo.referrals r
//           JOIN dbo.programs p ON p.program_id = r.receiving_program_id
//          WHERE r.referral_id = @referralId
//       Never returned to the browser and never logged.
//   getOrCreateDelivery({ referralId, notificationType, correlationId })
//       -> { delivery, created }
//       INSERT a PENDING row; if uq_notifications_referral_type rejects it,
//       SELECT the existing row instead. One row per referral and type,
//       so a repeated call never creates a second delivery.
//   claimDeliveryAttempt({ deliveryId, expectedAttemptCount }) -> delivery | null
//       ONE conditional update, so two workers can never both send:
//         UPDATE ... SET attempt_count = attempt_count + 1,
//                        last_attempt_at = SYSUTCDATETIME()
//          WHERE delivery_id = @id AND status = 'PENDING'
//            AND attempt_count = @expectedAttemptCount
//       0 rows -> null (someone else claimed it, or it is no longer PENDING).
//   The attempt number returned by a claim is that attempt's token. Every
//   completion below is ONE conditional update that only succeeds while
//   the row is still PENDING at that same attempt, so an older attempt can
//   never overwrite a newer attempt's result:
//          WHERE delivery_id = @id AND status = 'PENDING'
//            AND attempt_count = @attempt
//   0 rows -> null (a newer attempt owns the row, or it is finished).
//   markDeliverySent({ deliveryId, attempt }) -> delivery | null
//       status = 'SENT', sent_at = SYSUTCDATETIME(), failure_category = NULL.
//   markDeliveryFailed({ deliveryId, attempt, failureCategory }) -> delivery | null
//       status = 'FAILED'. Stops retries.
//   recordTransientFailure({ deliveryId, attempt, failureCategory }) -> delivery | null
//       Stays PENDING with the latest category.
//   listRetryableDeliveries({ maxAttempts, lastAttemptBefore, limit }) -> [delivery]
//       PENDING rows with attempt_count < maxAttempts whose last attempt is
//       older than lastAttemptBefore (the lease has ended), oldest first.
//       Uses ix_notifications_status (status, last_attempt_at).
//   listInterruptedDeliveries({ maxAttempts, lastAttemptBefore, limit }) -> [delivery]
//       PENDING rows with attempt_count >= maxAttempts whose last attempt
//       is older than lastAttemptBefore: the final attempt never recorded
//       a result. Same index.
//   getDeliveryByReferral(referralId, notificationType) -> delivery | null
//
// A delivery row holds IDs, status, counts, timestamps, a category and a
// correlation ID only. No message body, subject, recipient, or participant
// data (PRD 11.5).

const STATUSES = Object.freeze(['PENDING', 'SENT', 'FAILED']);

export function createMemoryDeliveryStore(
  { programs = [], referrals = [] } = {},
  { now = () => new Date() } = {},
) {
  const programsById = new Map(programs.map((p) => [p.programId, { ...p }]));
  const referralsById = new Map(referrals.map((r) => [r.referralId, { ...r }]));
  const deliveries = new Map();
  const byReferralAndType = new Map();
  let nextDeliveryId = 1;

  const copy = (row) => (row ? { ...row } : null);
  const key = (referralId, type) => `${referralId}:${type}`;

  // Test helper state: the next N calls to the named method throw.
  const failNext = new Map();
  function maybeFail(method) {
    const left = failNext.get(method) ?? 0;
    if (left > 0) {
      failNext.set(method, left - 1);
      throw new Error('simulated store failure');
    }
  }

  function pending(deliveryId) {
    const row = deliveries.get(deliveryId);
    return row && row.status === 'PENDING' ? row : null;
  }

  // The row, only if it is PENDING and still owned by this attempt.
  function owned(deliveryId, attempt) {
    const row = pending(deliveryId);
    return row && Number.isInteger(attempt) && row.attemptCount === attempt ? row : null;
  }

  function checkRow(row) {
    if (!STATUSES.includes(row.status)) throw new Error('ck_notifications_status');
    if ((row.status === 'SENT') !== (row.sentAt !== null)) throw new Error('ck_notifications_sent');
    if (row.attemptCount < 0) throw new Error('ck_notifications_attempts');
  }

  return {
    async referralExists(referralId) {
      return referralsById.has(referralId);
    },

    async getRecipientForReferral(referralId) {
      maybeFail('getRecipientForReferral');
      const referral = referralsById.get(referralId);
      if (!referral) return null;
      const program = programsById.get(referral.receivingProgramId);
      return program?.notificationEmail ?? null;
    },

    async getOrCreateDelivery({ referralId, notificationType, correlationId = null }) {
      // Stands in for fk_notifications_referral.
      if (!referralsById.has(referralId)) throw new Error('fk_notifications_referral');
      const existingId = byReferralAndType.get(key(referralId, notificationType));
      if (existingId) return { delivery: copy(deliveries.get(existingId)), created: false };

      const row = {
        deliveryId: nextDeliveryId++,
        referralId,
        notificationType,
        status: 'PENDING',
        attemptCount: 0,
        lastAttemptAt: null,
        sentAt: null,
        failureCategory: null,
        correlationId,
        createdAt: now(),
      };
      checkRow(row);
      deliveries.set(row.deliveryId, row);
      byReferralAndType.set(key(referralId, notificationType), row.deliveryId);
      return { delivery: copy(row), created: true };
    },

    async claimDeliveryAttempt({ deliveryId, expectedAttemptCount }) {
      const row = pending(deliveryId);
      if (!row || row.attemptCount !== expectedAttemptCount) return null;
      row.attemptCount += 1;
      row.lastAttemptAt = now();
      return copy(row);
    },

    async markDeliverySent({ deliveryId, attempt }) {
      maybeFail('markDeliverySent');
      const row = owned(deliveryId, attempt);
      if (!row) return null;
      row.status = 'SENT';
      row.sentAt = now();
      row.failureCategory = null;
      checkRow(row);
      return copy(row);
    },

    async markDeliveryFailed({ deliveryId, attempt, failureCategory }) {
      maybeFail('markDeliveryFailed');
      const row = owned(deliveryId, attempt);
      if (!row) return null;
      row.status = 'FAILED';
      row.failureCategory = failureCategory;
      checkRow(row);
      return copy(row);
    },

    async recordTransientFailure({ deliveryId, attempt, failureCategory }) {
      maybeFail('recordTransientFailure');
      const row = owned(deliveryId, attempt);
      if (!row) return null;
      row.failureCategory = failureCategory;
      return copy(row);
    },

    async listRetryableDeliveries({ maxAttempts, lastAttemptBefore, limit }) {
      return [...deliveries.values()]
        .filter((d) => d.status === 'PENDING'
          && d.attemptCount < maxAttempts
          && (d.lastAttemptAt === null || d.lastAttemptAt < lastAttemptBefore))
        .sort((a, b) => (a.lastAttemptAt ?? 0) - (b.lastAttemptAt ?? 0) || a.deliveryId - b.deliveryId)
        .slice(0, limit)
        .map(copy);
    },

    async listInterruptedDeliveries({ maxAttempts, lastAttemptBefore, limit }) {
      return [...deliveries.values()]
        .filter((d) => d.status === 'PENDING'
          && d.attemptCount >= maxAttempts
          && d.lastAttemptAt !== null && d.lastAttemptAt < lastAttemptBefore)
        .sort((a, b) => a.lastAttemptAt - b.lastAttemptAt || a.deliveryId - b.deliveryId)
        .slice(0, limit)
        .map(copy);
    },

    async getDeliveryByReferral(referralId, notificationType) {
      const id = byReferralAndType.get(key(referralId, notificationType));
      return id ? copy(deliveries.get(id)) : null;
    },

    // Test helper. Not part of the store contract.
    _failNext(method, times = 1) { failNext.set(method, times); },
  };
}
