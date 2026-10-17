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
//
// Read methods (card 6, receiving queue + authorization):
//   getActiveGrants(userId) -> [{ permission, scopeType, programId,
//       departmentId, grantSource, revokedAt }] from dbo.user_grants where
//       revoked_at IS NULL. Authorization is decided by the service, not here.
//   getReferralById(referralId) -> referral row | null
//   listReferralsByReceivingPrograms(programIds, { stage, limit })
//   listReferralsByCreator(userId, { stage, limit })
//       Newest first (created_at DESC, then referral_id DESC), at most
//       `limit` rows, filtered by stage when given (see stage.js for the
//       exact conditions). Uses ix_referrals_inbox / ix_referrals_my_sent.
//
// Response lifecycle (card 7):
//   listActiveNotAppropriateReasons() -> [{ reasonId, code, label,
//       requiresExplanation, displayOrder }] from dbo.not_appropriate_reasons
//       where lifecycle_status = 'ACTIVE', ordered by display_order.
//   getNotAppropriateReason(reasonId) -> reason (any lifecycle) | null
//   tx.getReferralById(referralId)
//   tx.recordFirstResponse({ referralId, decision, notAppropriateReasonId,
//       notAppropriateExplanation, respondedByUserId })
//       -> updated row, or null if the referral is no longer
//          AWAITING_RESPONSE. Must be ONE conditional update:
//          UPDATE ... SET response_status='RESPONDED', decision=...,
//          first_responded_at=SYSUTCDATETIME(), ...
//          WHERE referral_id=@id AND response_status='AWAITING_RESPONSE'
//          so two concurrent responses can never both succeed.
//
// Columns map to dbo.referrals and dbo.audit_events in
// db/migrations/001_core_schema.sql (PR #4).

import { createMemoryStore } from '../affiliation/memoryStore.js';
import { DuplicateSubmissionError } from './errors.js';
import { stageOf } from './stage.js';

export function createMemoryReferralStore(seed = {}, { now = () => new Date() } = {}) {
  const base = createMemoryStore(seed);
  const referrals = [];        // committed rows
  const auditEvents = [];      // committed referral audit events
  const committedIds = new Set();  // submission IDs of committed referrals
  // submission ID -> promise that settles when the transaction holding it
  // ends (true = committed, false = rolled back). Mimics how a SQL unique
  // index makes a second insert wait for the first transaction to finish.
  const inFlight = new Map();
  // referral ID -> in-flight first response (same waiting rule as above).
  const responseInFlight = new Map();
  let nextReferralId = 1;
  let failNextAudit = false;

  const copy = (row) => (row ? { ...row } : null);

  async function getReferralBySubmissionId(submissionId) {
    return copy(referrals.find((r) => r.submissionId === submissionId));
  }

  async function withTransaction(fn) {
    const staged = { referrals: [], audit: [], locks: [], updates: [], responseLocks: [] };

    // Committed row with this transaction's own staged changes applied.
    const currentRow = (referralId) => {
      const committed = referrals.find((r) => r.referralId === referralId)
        ?? staged.referrals.find((r) => r.referralId === referralId);
      if (!committed) return null;
      const row = { ...committed };
      for (const u of staged.updates) if (u.referralId === referralId) Object.assign(row, u.fields);
      return row;
    };

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

      async getReferralById(referralId) {
        return currentRow(referralId);
      },

      async recordFirstResponse({ referralId, decision, notAppropriateReasonId = null, notAppropriateExplanation = null, respondedByUserId }) {
        // Like UPDATE ... WHERE response_status = 'AWAITING_RESPONSE': a
        // second responder waits for the first transaction, then finds the
        // row already RESPONDED (0 rows updated) unless the first rolled back.
        while (responseInFlight.has(referralId)) {
          await responseInFlight.get(referralId).promise;
        }
        const row = currentRow(referralId);
        if (!row || row.responseStatus !== 'AWAITING_RESPONSE') return null;

        let settle;
        const promise = new Promise((resolve) => { settle = resolve; });
        responseInFlight.set(referralId, { promise });
        staged.responseLocks.push({ referralId, settle });

        const fields = {
          responseStatus: 'RESPONDED',
          decision,
          notAppropriateReasonId,
          notAppropriateExplanation,
          respondedByUserId,
          firstRespondedAt: now().toISOString(),
        };
        staged.updates.push({ referralId, fields });
        return { ...row, ...fields };
      },

      async appendAuditEvent(event) {
        if (failNextAudit) {
          failNextAudit = false;
          throw new Error('simulated audit failure');
        }
        staged.audit.push(structuredClone(event));
      },
    };

    const release = () => {
      for (const { submissionId, settle } of staged.locks) {
        inFlight.delete(submissionId);
        settle();
      }
      for (const { referralId, settle } of staged.responseLocks) {
        responseInFlight.delete(referralId);
        settle();
      }
    };

    try {
      const result = await fn(tx);
      referrals.push(...staged.referrals);
      for (const { referralId, fields } of staged.updates) {
        Object.assign(referrals.find((r) => r.referralId === referralId), fields);
      }
      auditEvents.push(...staged.audit);
      for (const r of staged.referrals) committedIds.add(r.submissionId);
      release();
      return result;
    } catch (err) {
      release();
      throw err;
    }
  }

  const grants = (seed.grants ?? []).map((g) => ({ revokedAt: null, ...g }));
  const reasons = (seed.notAppropriateReasons ?? []).map((r) => ({ requiresExplanation: false, lifecycleStatus: 'ACTIVE', ...r }));

  function newestFirst(rows, { stage, limit }) {
    return rows
      .filter((r) => !stage || stageOf(r) === stage)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.referralId - a.referralId)
      .slice(0, limit ?? Infinity)
      .map(copy);
  }

  return {
    ...base,
    withTransaction,
    getReferralBySubmissionId,

    async getActiveGrants(userId) {
      return grants.filter((g) => g.userId === userId && g.revokedAt == null).map((g) => ({ ...g }));
    },

    async getReferralById(referralId) {
      return copy(referrals.find((r) => r.referralId === referralId));
    },

    async listReferralsByReceivingPrograms(programIds, options = {}) {
      const ids = new Set(programIds);
      return newestFirst(referrals.filter((r) => ids.has(r.receivingProgramId)), options);
    },

    async listReferralsByCreator(userId, options = {}) {
      return newestFirst(referrals.filter((r) => r.createdByUserId === userId), options);
    },

    async listActiveNotAppropriateReasons() {
      return reasons
        .filter((r) => r.lifecycleStatus === 'ACTIVE')
        .sort((a, b) => a.displayOrder - b.displayOrder || a.reasonId - b.reasonId)
        .map(({ reasonId, code, label, requiresExplanation, displayOrder }) => ({ reasonId, code, label, requiresExplanation, displayOrder }));
    },

    async getNotAppropriateReason(reasonId) {
      const r = reasons.find((x) => x.reasonId === reasonId);
      return r ? { ...r } : null;
    },

    // Test helpers. Not part of the store contract.
    _referrals: referrals,
    _referralAuditEvents: auditEvents,
    _failNextAudit() { failNextAudit = true; },
    _grants: grants,
    // Simulates a later receiving response so tests can cover every stage
    // before the Respond card exists.
    _setReferralState(referralId, fields) {
      Object.assign(referrals.find((r) => r.referralId === referralId), fields);
    },
  };
}
