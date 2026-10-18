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
//
//   Consistency of reference reads (PRD 3.9, 9.3, 9.4)
//       tx.getUser, tx.getProgram and tx.getDepartment are locking reads:
//       each row read stays locked against changes until the transaction
//       commits or rolls back. A concurrent affiliation change, or a
//       Program or Department lifecycle change, on a row the referral has
//       read waits until the referral transaction ends. So the affiliation,
//       Program and Department state a referral records is still the
//       current state when the referral commits: a change either commits
//       before the read (and the referral sees it) or waits until after
//       the commit (and affects only later referrals).
//       Being inside a transaction is not enough on its own. Azure SQL
//       runs with READ_COMMITTED_SNAPSHOT on, where a plain SELECT takes no
//       lock and a concurrent UPDATE can commit after the read. The Azure
//       SQL store must therefore read these rows with a lock hint held to
//       the end of the transaction, for example
//         SELECT ... FROM dbo.users       WITH (REPEATABLEREAD) WHERE user_id = @userId
//         SELECT ... FROM dbo.programs    WITH (REPEATABLEREAD) WHERE program_id = @programId
//         SELECT ... FROM dbo.departments WITH (REPEATABLEREAD) WHERE department_id = @departmentId
//       inside the same transaction as the INSERT. Writers (affiliation
//       update, lifecycle changes) use ordinary UPDATEs in their own
//       transactions and therefore wait. A lock timeout or deadlock
//       (error 1205) rolls the whole referral back and is reported as a
//       retryable failure; the Submission ID keeps any retry safe.
//       Reads outside withTransaction are not locking.
//   getReferralBySubmissionId(submissionId) -> referral row | null
//   insertReferral(row) -> row with referralId (permanent) and createdAt (UTC)
//       Throws DuplicateSubmissionError when the submission_id unique
//       constraint rejects the insert. The Azure SQL store must translate
//       only that violation (uq_referrals_submission, error 2627/2601 naming
//       that index) into DuplicateSubmissionError; every other constraint or
//       database error propagates unchanged, so it is never mistaken for a
//       safe retry.
//   appendAuditEvent({ entityType, entityId, action, actorUserId,
//                      before, after, correlationId })
//       Written in the same transaction as the change it records. The store
//       adds occurredAt (UTC) itself; callers never supply the timestamp.
//
// Reporting (card 9): countReferrals({ from, to, programId?, departmentId? }) -> number
//   (see its comment below for the exact SQL).
//
// Read methods (card 6, receiving queue + authorization):
//   getActiveGrants(userId) -> [{ permission, scopeType, programId,
//       departmentId, grantSource, revokedAt }] from dbo.user_grants where
//       revoked_at IS NULL. Authorization is decided by the service, not here.
//   getReferralById(referralId) -> referral row | null
//   listReferralsByReceivingPrograms(programIds, { stage, limit, after })
//   listReferralsByCreator(userId, { stage, limit, after })
//       Newest first (created_at DESC, then referral_id DESC), at most
//       `limit` rows, filtered by stage when given (see stage.js for the
//       exact conditions). Uses ix_referrals_inbox / ix_referrals_my_sent.
//       `after` = { createdAt, referralId } (a page cursor, cursor.js):
//       only rows strictly after that position, in SQL
//         AND (created_at < @afterCreatedAt
//              OR (created_at = @afterCreatedAt AND referral_id < @afterId))
//       with the same ORDER BY and TOP (@limit). Scope (program IDs or
//       creator), stage, cursor and limit are all applied in the query and
//       all parameterized. createdAt must be returned with the full stored
//       precision (for datetime2: CONVERT(varchar(33), created_at, 127))
//       and the cursor value compared as datetime2, so no row is skipped or
//       repeated between pages.
//
// Columns map to dbo.referrals and dbo.audit_events in
// db/migrations/001_core_schema.sql (PR #4).

import { createMemoryStore } from '../affiliation/memoryStore.js';
import { DuplicateSubmissionError } from './errors.js';
import { stageOf } from './stage.js';

// Row locks for the in-memory store: shared locks for transaction reads,
// exclusive locks for changes. A shared lock is held until its transaction
// ends; an exclusive lock only while one change is applied. Readers never
// wait for a writer that is only waiting, so the store cannot deadlock.
function createRowLocks() {
  const rows = new Map(); // key -> { readers: Set(owner), writer: boolean, wake: [] }

  const entry = (key) => {
    if (!rows.has(key)) rows.set(key, { readers: new Set(), writer: false, wake: [] });
    return rows.get(key);
  };
  const waitFor = (row) => new Promise((resolve) => row.wake.push(resolve));
  const wakeAll = (row) => row.wake.splice(0).forEach((resolve) => resolve());

  async function shared(key, owner) {
    const row = entry(key);
    while (row.writer) await waitFor(row);
    row.readers.add(owner);
  }

  async function exclusive(key, fn) {
    const row = entry(key);
    while (row.writer || row.readers.size > 0) await waitFor(row);
    row.writer = true;
    try {
      return await fn();
    } finally {
      row.writer = false;
      wakeAll(row);
    }
  }

  function releaseShared(owner) {
    for (const row of rows.values()) {
      if (row.readers.delete(owner)) wakeAll(row);
    }
  }

  return { shared, exclusive, releaseShared };
}

export function createMemoryReferralStore(seed = {}, { now = () => new Date() } = {}) {
  const base = createMemoryStore(seed, { now });
  const locks = createRowLocks();
  // Test hook: awaited after every locking read, so tests can pause a
  // transaction between its reads and its insert.
  let afterLockingRead = null;
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
    const owner = Symbol('transaction');

    // Locking read: the row stays locked until this transaction ends.
    const lockingRead = (kind, read) => async (id) => {
      await locks.shared(`${kind}:${id}`, owner);
      const row = await read(id);
      if (afterLockingRead) await afterLockingRead(kind, id);
      return row;
    };

    const tx = {
      getUser: lockingRead('user', base.getUser),
      getProgram: lockingRead('program', base.getProgram),
      getDepartment: lockingRead('department', base.getDepartment),
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
      locks.releaseShared(owner);
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

  const grants = (seed.grants ?? []).map((g) => ({ revokedAt: null, ...g }));

  // Order: createdAt DESC, referralId DESC. `after` is a cursor position
  // { createdAt, referralId }; only rows strictly after it are returned.
  const isAfter = (r, after) =>
    r.createdAt < after.createdAt || (r.createdAt === after.createdAt && r.referralId < after.referralId);

  function newestFirst(rows, { stage, limit, after }) {
    return rows
      .filter((r) => !stage || stageOf(r) === stage)
      .filter((r) => !after || isAfter(r, after))
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

    // Reporting (card 9). Count of committed referrals with
    // from <= createdAt < to (both UTC ISO strings), each counted once.
    // Scope: none = organization; programId = referring OR receiving
    // Program; departmentId = referring OR receiving Department as stored
    // on the referral at creation (historical context). Never both.
    // Azure SQL:
    //   SELECT COUNT(*) FROM dbo.referrals
    //   WHERE created_at >= @from AND created_at < @to
    //     [AND (referring_program_id = @programId OR receiving_program_id = @programId)]
    //     [AND (referring_department_id = @departmentId OR receiving_department_id = @departmentId)]
    async countReferrals({ from, to, programId, departmentId }) {
      return referrals.filter((r) =>
        r.createdAt >= from && r.createdAt < to
        && (programId === undefined || r.referringProgramId === programId || r.receivingProgramId === programId)
        && (departmentId === undefined || r.referringDepartmentId === departmentId || r.receivingDepartmentId === departmentId),
      ).length;
    },

    async listReferralsByCreator(userId, options = {}) {
      return newestFirst(referrals.filter((r) => r.createdByUserId === userId), options);
    },

    // Changes to rows a referral transaction may have read wait for that
    // transaction to end (see "Consistency of reference reads" above).
    updateUserProgramAffiliation: (change) =>
      locks.exclusive(`user:${change.userId}`, () => base.updateUserProgramAffiliation(change)),

    // Test helpers. Not part of the store contract.
    _setProgramStatus: (programId, status) =>
      locks.exclusive(`program:${programId}`, async () => base._setProgramStatus(programId, status)),
    _setDepartmentStatus: (departmentId, status) =>
      locks.exclusive(`department:${departmentId}`, async () => base._setDepartmentStatus(departmentId, status)),
    _afterLockingRead(fn) { afterLockingRead = fn; },
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
