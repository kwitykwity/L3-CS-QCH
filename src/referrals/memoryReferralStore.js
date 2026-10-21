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
//
// GPME-assisted referrals (card 11):
//   tx.listNeedCategories(), tx.listMatchablePrograms()
//       The same reads GPME uses (src/affiliation/memoryStore.js), inside
//       the referral transaction, so the re-check at submission sees
//       current Program data. In Azure SQL the receiving Program's row is
//       already held by tx.getProgram; its matching facts (age and
//       service-area state columns, program_service_area_zips,
//       program need categories) should be read in the same transaction
//       WITH (REPEATABLEREAD), so an edit to them waits until the referral
//       commits and the saved evaluation matches what was checked.
//   tx.insertGpmeEvaluation({ ruleVersion, results: [{ programId,
//       displayOrder, explanation, programContext, wasSelected }] })
//       -> evaluationId. One row in dbo.gpme_evaluations (rule_version_id
//       looked up from dbo.gpme_rule_versions by version_label) and one row
//       per listed Program in dbo.gpme_evaluation_results
//       (program_context_json = JSON of programContext), in the referral's
//       transaction. Program facts only: no matching answers (PRD 5.3).
//       The referral row then gets source = 'GPME_ASSISTED' and
//       gpme_evaluation_id (ck_referrals_source_gpme,
//       ux_referrals_gpme_evaluation).
//   getGpmeEvaluation(evaluationId) -> { evaluationId, ruleVersion,
//       evaluatedAt, results } | null   (committed only; tests and later
//       referral-detail views)
//   appendAuditEvent({ entityType, entityId, action, actorUserId,
//                      before, after, correlationId })
//       Written in the same transaction as the change it records. The store
//       adds occurredAt (UTC) itself; callers never supply the timestamp.
//
// Reporting (card 9): countReferrals({ from, to, programId?, departmentId? }) -> number
//   (see its comment below for the exact SQL).
// Reporting (card 13): listTimingFacts({ from, to, programId?, departmentId? })
//   -> [{ createdAt, firstRespondedAt, decision, firstResultedInServiceAt, serviceOutcome }]
//   for the same cohort and scope as countReferrals (see its comment).
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
// Response lifecycle (card 7):
//   listActiveNotAppropriateReasons() -> [{ reasonId, code, label,
//       requiresExplanation, displayOrder }] from dbo.not_appropriate_reasons
//       where lifecycle_status = 'ACTIVE', ordered by display_order.
//   getNotAppropriateReason(reasonId) -> reason (any lifecycle) | null
//   tx.getActiveGrants(userId), tx.getNotAppropriateReason(reasonId)
//       Locking reads, held until the response transaction ends (same rule
//       as "Consistency of reference reads" above). A grant revocation
//       (UPDATE dbo.user_grants SET revoked_at = ...) or a reason lifecycle
//       change on a row the response has read waits until the response
//       commits or rolls back, so a response never commits on a grant or
//       reason that was already revoked or discontinued. In Azure SQL:
//         SELECT ... FROM dbo.user_grants WITH (REPEATABLEREAD)
//           WHERE user_id = @userId AND revoked_at IS NULL
//         SELECT ... FROM dbo.not_appropriate_reasons WITH (REPEATABLEREAD)
//           WHERE reason_id = @reasonId
//       in the same transaction as the conditional UPDATE below. (A grant
//       added during the response is not blocked and does not need to be.)
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
// Service outcome and corrections (card 8):
//   Every referral row carries `version` (dbo.referrals.row_version,
//   ROWVERSION): an opaque token that changes on every update. Callers
//   only compare it (PRD 9.4).
//   tx.updateReferral({ referralId, when, set, setNow, setNowIfNull })
//       -> updated row, or null when a condition in `when` no longer holds
//          (nothing is written). ONE conditional update:
//          UPDATE dbo.referrals SET <set>, <setNow> = SYSUTCDATETIME(),
//                 <setNowIfNull> = COALESCE(<col>, SYSUTCDATETIME()),
//                 updated_at = SYSUTCDATETIME()
//          WHERE referral_id = @id AND <each `when` column = @value>
//          `when` may include { version } (row_version = @version) for
//          corrections, or current state values (decision, service_outcome)
//          for first-time recording. A second writer to the same row waits
//          for the first transaction, then re-checks its conditions.
//          setNowIfNull is how first_resulted_in_service_at is set once and
//          never rewritten by a later correction (PRD 12.4).
//
// Program maintenance (card 14A):
//   tx.lockProgramForUpdate(programId) -> program | null
//       Reads the Program for a change. Only one transaction at a time may
//       hold a Program for update; a second one waits until the first
//       commits or rolls back. Plain readers (for example a referral being
//       created) are not blocked by it. In Azure SQL:
//         SELECT ... FROM dbo.programs WITH (UPDLOCK, ROWLOCK)
//           WHERE program_id = @programId
//   tx.getUser, tx.getActiveGrants, tx.getDepartment
//       Locking reads held until the transaction ends (REPEATABLEREAD, as
//       above), so a user deactivation, grant revocation, or Department
//       change that starts during a Program change waits for it.
//   tx.updateProgram({ programId, expectedVersion, set }) -> program | null
//       ONE conditional update, only on a Program this transaction holds
//       for update:
//         UPDATE dbo.programs SET ..., updated_at = SYSUTCDATETIME()
//           WHERE program_id = @id AND row_version = @expectedVersion
//       0 rows -> null (the row changed since the caller read it); nothing
//       is written. The change becomes visible only at commit, together
//       with its audit event (tx.appendAuditEvent, same transaction). At
//       commit it waits for any transaction that has read the Program
//       (for example a referral checking that it is ACTIVE), so such a
//       transaction commits against the state it read (PRD 9.3, 9.4).
//
// Configurable fields (card 14B; dbo.field_definitions, dbo.field_options,
// dbo.program_field_applicability):
//   tx.lockFieldForUpdate(fieldId), tx.lockOptionForUpdate(optionId),
//   tx.lockApplicabilityForUpdate(programId, fieldId) -> row | null
//       Same rule as lockProgramForUpdate: one holder at a time
//       (SELECT ... WITH (UPDLOCK, ROWLOCK)), held until the transaction ends.
//       Always lock in this order to avoid deadlocks: field, then option,
//       then applicability rows in ascending programId.
//   tx.getField(fieldId), tx.getOption(optionId),
//   tx.listFieldOptions(fieldId), tx.listFieldApplicability(fieldId),
//   tx.listProgramApplicability(programId)
//       Reads that include this transaction's own uncommitted changes.
//   tx.insertField(row), tx.insertOption(row), tx.insertApplicability(row)
//       -> new row (IDENTITY ids are allocated at once; gaps are possible).
//       insertApplicability returns null if the (program, field) row
//       already exists (primary key).
//   tx.updateField / tx.updateOption / tx.updateApplicability
//       ({ ...id, expectedVersion, set }) -> row | null
//       ONE conditional UPDATE ... WHERE <id> AND row_version = @expected,
//       only on a row this transaction holds for update; null = 0 rows.
//   tx.listFieldValues(programId, fieldId) -> [value rows]
//   tx.replaceFieldValues({ programId, fieldId, rows })
//       Only while holding that (program, field) applicability row. Replaces
//       the Program's current value rows for the field (multi-select: one
//       row per option; every row has exactly one value column, as
//       ck_pfv_one_value requires):
//         DELETE dbo.program_field_values WHERE program_id = @p AND field_id = @f;
//         INSERT dbo.program_field_values (...) VALUES (...);  -- per row
//       in the same transaction as the applicability version bump and the
//       audit event.
//   Every change becomes visible only at commit, together with its audit
//   events. Every row carries `version` (row_version).
//
// Organization changes (card 14C; dbo.departments, dbo.programs):
//   tx.lockDepartmentForUpdate(departmentId) -> department | null
//       SELECT ... WITH (UPDLOCK, ROWLOCK). Every change that can make a
//       Program ACTIVE in a Department (create, reactivate, move in) and
//       every Department change holds the Department first. Lock order:
//       Program, then Department, then name keys.
//   tx.lockDepartmentName(name) -> departmentId | null
//   tx.lockProgramName(name, site) -> programId | null
//       Key-range lock on the unique name (SELECT ... WITH (UPDLOCK,
//       HOLDLOCK) WHERE name = @name [AND site = @site]) so two creates or
//       renames to the same name can't both pass the check. Names compare
//       case-insensitively (default collation).
//   tx.insertDepartment({ name }), tx.insertProgram(row) -> new row
//       Only while holding the name key (and, for a Program, its
//       Department).
//   tx.updateDepartment({ departmentId, expectedVersion, set }) -> row | null
//       Conditional UPDATE on row_version, only on a held Department; a
//       rename also needs the new name key. At commit it waits for readers
//       of the Department (for example a referral being created).
//   tx.listDepartmentPrograms(departmentId), tx.listDepartments()
//       Committed rows plus this transaction's own changes, read with
//       READCOMMITTEDLOCK (no lock kept; see lockDepartmentForUpdate).
//
// Columns map to dbo.referrals, dbo.programs, dbo.audit_events and the
// field tables in db/migrations/001_core_schema.sql (PR #4).

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

  // Turns this owner's shared lock into an exclusive one, waiting for every
  // OTHER reader to finish (like SQL lock conversion). Callers must already
  // hold the row's update intent, so two owners never upgrade the same row
  // at once and this cannot deadlock. Returns a function that releases it.
  async function upgrade(key, owner) {
    const row = entry(key);
    while (row.writer || [...row.readers].some((r) => r !== owner)) await waitFor(row);
    row.writer = true;
    return () => {
      row.writer = false;
      wakeAll(row);
    };
  }

  return { shared, exclusive, releaseShared, upgrade };
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
  // referral ID -> in-flight first response (same waiting rule as above).
  const responseInFlight = new Map();
  // row key ("program:11", "field:5", ...) -> the transaction holding it
  // for update (UPDLOCK).
  const updateHeld = new Map();

  // Configurable-field tables. rowVersion stands in for ROWVERSION.
  const tables = {
    field: { rows: new Map(), nextId: 1, idOf: (r) => r.fieldId },
    option: { rows: new Map(), nextId: 1, idOf: (r) => r.optionId },
    applicability: { rows: new Map(), idOf: (r) => `${r.programId}:${r.fieldId}` },
    value: { rows: new Map(), nextId: 1, idOf: (r) => r.valueId },
  };
  const seedRows = (table, list, idField) => {
    for (const row of list ?? []) {
      const full = { ...row, rowVersion: 1 };
      // Seeds may leave the identity column out; assign the next one.
      if (idField && full[idField] == null) full[idField] = Math.max(table.nextId, ...list.map((r) => (r[idField] ?? 0) + 1));
      if (idField) table.nextId = Math.max(table.nextId, full[idField] + 1);
      table.rows.set(table.idOf(full), full);
    }
  };
  seedRows(tables.field, (seed.fields ?? []).map((f) => ({
    lifecycleStatus: 'ACTIVE', replacedByFieldId: null, discontinuedAt: null, retiredAt: null,
    createdAt: now().toISOString(), ...f,
  })), 'fieldId');
  seedRows(tables.option, (seed.fieldOptions ?? []).map((o) => ({ lifecycleStatus: 'ACTIVE', displayOrder: 0, ...o })), 'optionId');
  seedRows(tables.applicability, (seed.fieldApplicability ?? []).map((a) => ({ isRequired: false, displayOrder: 0, ...a })));
  seedRows(tables.value, (seed.fieldValues ?? []).map((v) => ({
    optionId: null, valueText: null, valueNumber: null, valueDate: null, valueBool: null, ...v,
  })), 'valueId');

  const publicRow = (row) => {
    if (!row) return null;
    const { rowVersion, ...rest } = row;
    return { ...rest, version: `v${rowVersion}` };
  };
  let nextReferralId = 1;
  const gpmeEvaluations = [];  // committed GPME evaluations
  let nextEvaluationId = 1;
  let failNextAudit = false;

  const copy = (row) => (row ? withVersion({ ...row }) : null);
  // The public, opaque version token (dbo.referrals.row_version).
  function withVersion(row) {
    if (!row) return null;
    const { rowVersion, ...rest } = row;
    return rowVersion === undefined ? row : { ...rest, rowVersion, version: `v${rowVersion}` };
  }

  async function getReferralBySubmissionId(submissionId) {
    return copy(referrals.find((r) => r.submissionId === submissionId));
  }

  async function withTransaction(fn) {
    const staged = {
      referrals: [], audit: [], locks: [], updates: [], responseLocks: [], programUpdates: [], holds: [],
      departmentInserts: [], programInserts: [], departmentUpdates: [], evaluations: [],
    };
    // Uncommitted field-table rows: "table:id" -> row.
    const overlay = new Map();
    const holds = (key) => staged.holds.some((h) => h.key === key);
    async function holdForUpdate(key) {
      if (holds(key)) return;
      while (updateHeld.has(key)) await updateHeld.get(key).promise;
      let settle;
      const promise = new Promise((resolve) => { settle = resolve; });
      updateHeld.set(key, { promise, owner });
      staged.holds.push({ key, settle });
      // Same test hook as locking reads, with kind 'hold' and the row key.
      if (afterLockingRead) await afterLockingRead('hold', key);
    }
    const rowOf = (name, id) => overlay.get(`${name}:${id}`) ?? tables[name].rows.get(id) ?? null;
    const allRows = (name) => {
      const byId = new Map(tables[name].rows);
      for (const [key, row] of overlay) if (key.startsWith(`${name}:`)) byId.set(tables[name].idOf(row), row);
      return [...byId.values()].filter((row) => !row.deleted);
    };
    const sortById = (a, b) => (a.fieldId ?? 0) - (b.fieldId ?? 0) || (a.optionId ?? 0) - (b.optionId ?? 0)
      || (a.programId ?? 0) - (b.programId ?? 0);
    function insertRow(name, idField, row) {
      const table = tables[name];
      const full = { ...row, rowVersion: 1 };
      if (idField) full[idField] = table.nextId++;
      overlay.set(`${name}:${table.idOf(full)}`, full);
      return publicRow(full);
    }
    function updateRow(name, id, expectedVersion, set) {
      if (!holds(`${name}:${id}`)) throw new Error(`update of ${name} requires holding it for update first`);
      const current = rowOf(name, id);
      if (!current || `v${current.rowVersion}` !== expectedVersion) return null; // 0 rows updated
      const next = { ...current, ...set, rowVersion: current.rowVersion + 1 };
      overlay.set(`${name}:${id}`, next);
      return publicRow(next);
    }
    const owner = Symbol('transaction');

    // Name uniqueness keys. SQL Server's default collation compares names
    // case-insensitively, and the UNIQUE (name, site) constraint treats
    // NULL sites as equal to each other.
    const nameKey = (name) => String(name).toLowerCase();
    const programKey = (name, site) => `${nameKey(name)}\u0000${site == null ? '\u0001' : nameKey(site)}`;
    const txDepartments = () => {
      const rows = new Map(base._allDepartments().map((d) => [d.departmentId, d]));
      for (const d of staged.departmentInserts) rows.set(d.departmentId, { ...d, version: 'v1' });
      for (const { departmentId, fields } of staged.departmentUpdates) {
        rows.set(departmentId, { ...rows.get(departmentId), ...fields });
      }
      return [...rows.values()].sort((a, b) => a.departmentId - b.departmentId);
    };
    const txPrograms = () => {
      const rows = new Map(base._allPrograms().map((p) => [p.programId, p]));
      for (const p of staged.programInserts) rows.set(p.programId, { ...p, version: 'v1' });
      for (const { programId, fields } of staged.programUpdates) {
        rows.set(programId, { ...rows.get(programId), ...fields });
      }
      return [...rows.values()].sort((a, b) => a.programId - b.programId);
    };

    // Committed row with this transaction's own staged changes applied.
    const currentRow = (referralId) => {
      const committed = referrals.find((r) => r.referralId === referralId)
        ?? staged.referrals.find((r) => r.referralId === referralId);
      if (!committed) return null;
      const row = { ...committed };
      for (const u of staged.updates) if (u.referralId === referralId) Object.assign(row, u.fields);
      return withVersion(row);
    };

    // Row write lock, held until this transaction ends (like the X lock an
    // UPDATE takes). Reentrant within the same transaction.
    const heldRows = new Set();
    async function lockRowForWrite(referralId) {
      if (heldRows.has(referralId)) return;
      while (responseInFlight.has(referralId)) {
        await responseInFlight.get(referralId).promise;
      }
      let settle;
      const promise = new Promise((resolve) => { settle = resolve; });
      responseInFlight.set(referralId, { promise });
      staged.responseLocks.push({ referralId, settle });
      heldRows.add(referralId);
    }

    function stageUpdate(referralId, row, fields) {
      const all = { ...fields, rowVersion: row.rowVersion + 1, updatedAt: now().toISOString() };
      staged.updates.push({ referralId, fields: all });
      return withVersion({ ...row, ...all });
    }

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
      listNeedCategories: base.listNeedCategories,
      listMatchablePrograms: base.listMatchablePrograms,

      async insertGpmeEvaluation({ ruleVersion, results }) {
        // Like an IDENTITY column: IDs are never reused, gaps are possible.
        const evaluationId = nextEvaluationId++;
        staged.evaluations.push({
          evaluationId,
          ruleVersion,
          evaluatedAt: now().toISOString(),
          results: structuredClone(results),
        });
        return evaluationId;
      },

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
        const createdAt = now().toISOString();
        const saved = { ...row, referralId: nextReferralId++, createdAt, updatedAt: createdAt, rowVersion: 1 };
        staged.referrals.push(saved);
        return withVersion(saved);
      },

      async getReferralById(referralId) {
        return currentRow(referralId);
      },

      getActiveGrants: lockingRead('grants', (userId) => activeGrants(userId)),
      getNotAppropriateReason: lockingRead('reason', (reasonId) => reasonById(reasonId)),

      async recordFirstResponse({ referralId, decision, notAppropriateReasonId = null, notAppropriateExplanation = null, respondedByUserId }) {
        // Like UPDATE ... WHERE response_status = 'AWAITING_RESPONSE': a
        // second responder waits for the first transaction, then finds the
        // row already RESPONDED (0 rows updated) unless the first rolled back.
        await lockRowForWrite(referralId);
        const row = currentRow(referralId);
        if (!row || row.responseStatus !== 'AWAITING_RESPONSE') return null;

        return stageUpdate(referralId, row, {
          responseStatus: 'RESPONDED',
          decision,
          notAppropriateReasonId,
          notAppropriateExplanation,
          respondedByUserId,
          firstRespondedAt: now().toISOString(),
        });
      },

      async updateReferral({ referralId, when = {}, set = {}, setNow = [], setNowIfNull = [] }) {
        await lockRowForWrite(referralId);
        const row = currentRow(referralId);
        if (!row) return null;
        for (const [key, value] of Object.entries(when)) {
          if ((row[key] ?? null) !== value) return null; // 0 rows updated
        }
        const stamp = now().toISOString();
        const fields = { ...set };
        for (const key of setNow) fields[key] = stamp;
        for (const key of setNowIfNull) fields[key] = row[key] ?? stamp;
        return stageUpdate(referralId, row, fields);
      },

      async lockProgramForUpdate(programId) {
        await holdForUpdate(`program:${programId}`);
        return tx.getProgram(programId);
      },

      async lockFieldForUpdate(fieldId) {
        await holdForUpdate(`field:${fieldId}`);
        return publicRow(rowOf('field', fieldId));
      },
      async lockOptionForUpdate(optionId) {
        await holdForUpdate(`option:${optionId}`);
        return publicRow(rowOf('option', optionId));
      },
      async lockApplicabilityForUpdate(programId, fieldId) {
        await holdForUpdate(`applicability:${programId}:${fieldId}`);
        return publicRow(rowOf('applicability', `${programId}:${fieldId}`));
      },
      async getField(fieldId) { return publicRow(rowOf('field', fieldId)); },
      async getOption(optionId) { return publicRow(rowOf('option', optionId)); },
      async listFieldOptions(fieldId) {
        return allRows('option').filter((o) => o.fieldId === fieldId)
          .sort((a, b) => a.displayOrder - b.displayOrder || a.optionId - b.optionId).map(publicRow);
      },
      async listFieldApplicability(fieldId) {
        return allRows('applicability').filter((a) => a.fieldId === fieldId).sort(sortById).map(publicRow);
      },
      async listProgramApplicability(programId) {
        return allRows('applicability').filter((a) => a.programId === programId).sort(sortById).map(publicRow);
      },
      async insertField(row) {
        const field = insertRow('field', 'fieldId', {
          replacedByFieldId: null, discontinuedAt: null, retiredAt: null, createdAt: now().toISOString(), ...row,
        });
        // field_key is UNIQUE in the schema; derived from the new ID.
        const keyed = { ...overlay.get(`field:${field.fieldId}`), fieldKey: `field_${field.fieldId}` };
        overlay.set(`field:${field.fieldId}`, keyed);
        return publicRow(keyed);
      },
      async insertOption(row) { return insertRow('option', 'optionId', row); },
      async insertApplicability(row) {
        await holdForUpdate(`applicability:${row.programId}:${row.fieldId}`);
        if (rowOf('applicability', `${row.programId}:${row.fieldId}`)) return null; // primary key
        return insertRow('applicability', null, row);
      },
      async updateField({ fieldId, expectedVersion, set }) { return updateRow('field', fieldId, expectedVersion, set); },
      async updateOption({ optionId, expectedVersion, set }) { return updateRow('option', optionId, expectedVersion, set); },
      async updateApplicability({ programId, fieldId, expectedVersion, set }) {
        return updateRow('applicability', `${programId}:${fieldId}`, expectedVersion, set);
      },
      async listFieldValues(programId, fieldId) {
        return allRows('value').filter((v) => v.programId === programId && v.fieldId === fieldId)
          .sort((a, b) => a.valueId - b.valueId).map(publicRow);
      },
      async replaceFieldValues({ programId, fieldId, rows }) {
        if (!holds(`applicability:${programId}:${fieldId}`)) {
          throw new Error('replaceFieldValues requires holding the applicability row for update first');
        }
        for (const old of allRows('value').filter((v) => v.programId === programId && v.fieldId === fieldId)) {
          overlay.set(`value:${old.valueId}`, { ...old, deleted: true });
        }
        for (const row of rows) {
          const filled = [row.optionId, row.valueText, row.valueNumber, row.valueDate, row.valueBool]
            .filter((v) => v !== null && v !== undefined).length;
          if (filled !== 1) throw new Error('ck_pfv_one_value');
          insertRow('value', 'valueId', {
            programId, fieldId, optionId: null, valueText: null, valueNumber: null, valueDate: null, valueBool: null,
            ...row, updatedAt: now().toISOString(),
          });
        }
      },
      now: () => now().toISOString(),

      async updateProgram({ programId, expectedVersion, set }) {
        if (!holds(`program:${programId}`)) {
          throw new Error('updateProgram requires lockProgramForUpdate first');
        }
        if (staged.programUpdates.some((u) => u.programId === programId)) {
          throw new Error('one Program update per transaction');
        }
        const current = await base.getProgram(programId);
        if (!current || current.version !== expectedVersion) return null; // 0 rows updated
        staged.programUpdates.push({ programId, fields: { ...set } });
        // The version the row will have once this transaction commits.
        const nextVersion = `v${Number(current.version.slice(1)) + 1}`;
        return { ...current, ...set, version: nextVersion, updatedAt: now().toISOString() };
      },

      // ----- Organization changes (card 14C) -----
      async lockDepartmentForUpdate(departmentId) {
        await holdForUpdate(`department:${departmentId}`);
        return tx.getDepartment(departmentId);
      },

      // Holds the unique-name key and returns the departmentId that has
      // the name now (this transaction's own changes included), or null.
      async lockDepartmentName(name) {
        const key = nameKey(name);
        await holdForUpdate(`department-name:${key}`);
        const match = txDepartments().find((d) => nameKey(d.name) === key);
        return match ? match.departmentId : null;
      },

      async lockProgramName(name, site) {
        const key = programKey(name, site);
        await holdForUpdate(`program-name:${key}`);
        const match = txPrograms().find((p) => programKey(p.name, p.site) === key);
        return match ? match.programId : null;
      },

      async insertDepartment({ name }) {
        if (!holds(`department-name:${nameKey(name)}`)) throw new Error('insertDepartment requires lockDepartmentName first');
        const row = { departmentId: base._allocateDepartmentId(), name, lifecycleStatus: 'ACTIVE' };
        staged.departmentInserts.push(row);
        return { ...row, version: 'v1' };
      },

      async insertProgram(row) {
        if (!holds(`program-name:${programKey(row.name, row.site)}`)) throw new Error('insertProgram requires lockProgramName first');
        if (!holds(`department:${row.departmentId}`)) throw new Error('insertProgram requires lockDepartmentForUpdate first');
        const full = { ...row, programId: base._allocateProgramId(), lifecycleStatus: 'ACTIVE' };
        staged.programInserts.push(full);
        return { ...full, version: 'v1', updatedAt: now().toISOString() };
      },

      async updateDepartment({ departmentId, expectedVersion, set }) {
        if (!holds(`department:${departmentId}`)) throw new Error('updateDepartment requires lockDepartmentForUpdate first');
        if (set.name !== undefined && !holds(`department-name:${nameKey(set.name)}`)) {
          throw new Error('renaming a Department requires lockDepartmentName first');
        }
        if (staged.departmentUpdates.some((u) => u.departmentId === departmentId)) {
          throw new Error('one Department update per transaction');
        }
        const current = await base.getDepartment(departmentId);
        if (!current || current.version !== expectedVersion) return null; // 0 rows updated
        staged.departmentUpdates.push({ departmentId, fields: { ...set } });
        return { ...current, ...set, version: `v${Number(current.version.slice(1)) + 1}` };
      },

      // Programs in a Department, committed state plus this transaction's
      // own changes. NOT a locking read (READCOMMITTEDLOCK in SQL): every
      // change that makes a Program ACTIVE in a Department (create,
      // reactivate, move in) holds that Department for update, so a caller
      // holding the Department sees a state no one else can change.
      async listDepartmentPrograms(departmentId) {
        return txPrograms().filter((p) => p.departmentId === departmentId);
      },

      async listDepartments() {
        return txDepartments();
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
      for (const { key, settle } of staged.holds) {
        updateHeld.delete(key);
        settle();
      }
      locks.releaseShared(owner);
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
      // Program changes wait for other readers of those rows to finish
      // (lock conversion), then everything below is applied in one step.
      const writeReleases = [];
      for (const { departmentId } of staged.departmentUpdates) {
        writeReleases.push(await locks.upgrade(`department:${departmentId}`, owner));
      }
      for (const { programId } of staged.programUpdates) {
        writeReleases.push(await locks.upgrade(`program:${programId}`, owner));
      }
      for (const row of staged.departmentInserts) base._insertDepartment(row);
      for (const row of staged.programInserts) base._insertProgram(row);
      for (const { departmentId, fields } of staged.departmentUpdates) {
        base._applyDepartmentChange(departmentId, fields);
      }
      for (const { programId, fields } of staged.programUpdates) {
        base._applyProgramChange(programId, fields);
      }
      writeReleases.forEach((done) => done());
      for (const [key, row] of overlay) {
        const name = key.slice(0, key.indexOf(':'));
        if (row.deleted) tables[name].rows.delete(tables[name].idOf(row));
        else tables[name].rows.set(tables[name].idOf(row), row);
      }
      referrals.push(...staged.referrals);
      for (const { referralId, fields } of staged.updates) {
        Object.assign(referrals.find((r) => r.referralId === referralId), fields);
      }
      auditEvents.push(...staged.audit);
      gpmeEvaluations.push(...staged.evaluations);
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
  const activeGrants = (userId) =>
    grants.filter((g) => g.userId === userId && g.revokedAt == null).map((g) => ({ ...g }));
  const reasonById = (reasonId) => {
    const r = reasons.find((x) => x.reasonId === reasonId);
    return r ? { ...r } : null;
  };

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

    async getGpmeEvaluation(evaluationId) {
      const found = gpmeEvaluations.find((e) => e.evaluationId === evaluationId);
      return found ? structuredClone(found) : null;
    },

    async getActiveGrants(userId) {
      return activeGrants(userId);
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

    // Reporting (card 13). The timing facts of the cohort countReferrals
    // counts: committed referrals with from <= createdAt < to, in the same
    // scope. Only the five columns the timing metrics need; never
    // participant data or IDs (PRD 10.5, 12.1).
    // Azure SQL (durations are computed in the service, from these values):
    //   SELECT created_at, first_responded_at, decision,
    //          first_resulted_in_service_at, service_outcome
    //   FROM dbo.referrals
    //   WHERE created_at >= @from AND created_at < @to
    //     [AND (referring_program_id = @programId OR receiving_program_id = @programId)]
    //     [AND (referring_department_id = @departmentId OR receiving_department_id = @departmentId)]
    //   Timestamps must come back as exact UTC instants (datetime2(3)).
    async listTimingFacts({ from, to, programId, departmentId }) {
      return referrals
        .filter((r) =>
          r.createdAt >= from && r.createdAt < to
          && (programId === undefined || r.referringProgramId === programId || r.receivingProgramId === programId)
          && (departmentId === undefined || r.referringDepartmentId === departmentId || r.receivingDepartmentId === departmentId))
        .map((r) => ({
          createdAt: r.createdAt,
          firstRespondedAt: r.firstRespondedAt ?? null,
          decision: r.decision ?? null,
          firstResultedInServiceAt: r.firstResultedInServiceAt ?? null,
          serviceOutcome: r.serviceOutcome,
        }));
    },

    async listActiveNotAppropriateReasons() {
      return reasons
        .filter((r) => r.lifecycleStatus === 'ACTIVE')
        .sort((a, b) => a.displayOrder - b.displayOrder || a.reasonId - b.reasonId)
        .map(({ reasonId, code, label, requiresExplanation, displayOrder }) => ({ reasonId, code, label, requiresExplanation, displayOrder }));
    },

    async getNotAppropriateReason(reasonId) {
      return reasonById(reasonId);
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
    _fieldRows: () => [...tables.field.rows.values()].map(publicRow),
    _optionRows: () => [...tables.option.rows.values()].map(publicRow),
    _applicabilityRows: () => [...tables.applicability.rows.values()].map(publicRow),
    _valueRows: () => [...tables.value.rows.values()].map(publicRow),
    // Deactivates a user, waiting for any transaction that has read them.
    _setUserActive: (userId, isActive) =>
      locks.exclusive(`user:${userId}`, async () => base._setUserActive(userId, isActive)),
    // Revokes a user's grants for one capability, waiting for any response
    // transaction that has read that user's grants (like an UPDATE).
    _revokeGrants: (userId, permission) =>
      locks.exclusive(`grants:${userId}`, async () => {
        for (const g of grants) {
          if (g.userId === userId && g.permission === permission && g.revokedAt == null) g.revokedAt = now().toISOString();
        }
      }),
    _setReasonStatus: (reasonId, lifecycleStatus) =>
      locks.exclusive(`reason:${reasonId}`, async () => {
        reasons.find((r) => r.reasonId === reasonId).lifecycleStatus = lifecycleStatus;
      }),
    _referrals: referrals,
    _referralAuditEvents: auditEvents,
    _gpmeEvaluations: gpmeEvaluations,
    _failNextAudit() { failNextAudit = true; },
    _grants: grants,
    // Simulates a later receiving response so tests can cover every stage
    // before the Respond card exists.
    _setReferralState(referralId, fields) {
      Object.assign(referrals.find((r) => r.referralId === referralId), fields);
    },
  };
}
