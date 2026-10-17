// In-memory store for tests and local development with SYNTHETIC data only.
// It is not used in production.
//
// It extends the card 2 store (src/affiliation/memoryStore.js) with the
// referral contract that the Azure SQL store must also meet:
//
//   withTransaction(async (tx) => result)
//       Runs fn with a transaction-scoped store `tx` that has every method
//       below plus the affiliation read methods. Commits if fn resolves,
//       rolls back everything fn wrote if it throws.
//   getReferralBySubmissionId(submissionId) -> referral row | null
//   insertReferral(row) -> row with referralId (permanent) and createdAt (UTC)
//       Throws DuplicateSubmissionError when the submission_id unique
//       constraint rejects the insert.
//   appendAuditEvent({ entityType, entityId, action, actorUserId,
//                      before, after, correlationId })
//       Written in the same transaction as the change it records. The store
//       adds occurredAt (UTC) itself; callers never supply the timestamp.
//
// Columns map to dbo.referrals and dbo.audit_events in
// db/migrations/001_core_schema.sql (PR #4).

import { createMemoryStore } from '../affiliation/memoryStore.js';
import { DuplicateSubmissionError } from './errors.js';

export function createMemoryReferralStore(seed = {}, { now = () => new Date() } = {}) {
  const base = createMemoryStore(seed);
  const referrals = [];        // committed rows
  const auditEvents = [];      // committed referral audit events
  const committedIds = new Set();  // submission IDs of committed referrals
  // submission ID -> promise that settles when the transaction holding it
  // ends (true = committed, false = rolled back). Mimics how a SQL unique
  // index makes a second insert wait for the first transaction to finish.
  const inFlight = new Map();
  let nextReferralId = 1;
  let failNextAudit = false;

  const copy = (row) => (row ? { ...row } : null);

  async function getReferralBySubmissionId(submissionId) {
    return copy(referrals.find((r) => r.submissionId === submissionId));
  }

  async function withTransaction(fn) {
    const staged = { referrals: [], audit: [], locks: [] };

    const tx = {
      getUser: base.getUser,
      getProgram: base.getProgram,
      getDepartment: base.getDepartment,
      listActivePrograms: base.listActivePrograms,

      async getReferralBySubmissionId(submissionId) {
        return copy(staged.referrals.find((r) => r.submissionId === submissionId))
          ?? getReferralBySubmissionId(submissionId);
      },

      async insertReferral(row) {
        // Acts like the UNIQUE constraint. If another transaction is
        // inserting the same submission_id, wait for it: if it commits this
        // insert fails; if it rolls back this insert proceeds.
        while (inFlight.has(row.submissionId)) {
          await inFlight.get(row.submissionId).promise;
        }
        if (committedIds.has(row.submissionId)) throw new DuplicateSubmissionError();
        let settle;
        const promise = new Promise((resolve) => { settle = resolve; });
        inFlight.set(row.submissionId, { promise });
        staged.locks.push({ submissionId: row.submissionId, settle });
        // Like an IDENTITY column: IDs are never reused, gaps are possible.
        const saved = { ...row, referralId: nextReferralId++, createdAt: now().toISOString() };
        staged.referrals.push(saved);
        return { ...saved };
      },

      async appendAuditEvent(event) {
        if (failNextAudit) {
          failNextAudit = false;
          throw new Error('simulated audit failure');
        }
        // The store sets the authoritative timestamp (PRD 9.6, 9.7); in SQL
        // this is audit_events.occurred_at DEFAULT SYSUTCDATETIME().
        staged.audit.push({ ...structuredClone(event), occurredAt: now().toISOString() });
      },
    };

    const release = () => {
      for (const { submissionId, settle } of staged.locks) {
        inFlight.delete(submissionId);
        settle();
      }
    };

    try {
      const result = await fn(tx);
      referrals.push(...staged.referrals);
      auditEvents.push(...staged.audit);
      for (const r of staged.referrals) committedIds.add(r.submissionId);
      release();
      return result;
    } catch (err) {
      release();
      throw err;
    }
  }

  return {
    ...base,
    withTransaction,
    getReferralBySubmissionId,

    // Test helpers. Not part of the store contract.
    _referrals: referrals,
    _referralAuditEvents: auditEvents,
    _failNextAudit() { failNextAudit = true; },
  };
}
