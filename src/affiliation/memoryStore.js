// In-memory store for tests and local development with SYNTHETIC data only.
// It is not used in production.
//
// It defines the store contract that the Azure SQL store must also meet:
//
//   getUser(userId) -> { userId, isActive, currentProgramId, version } | null
//       `version` is an opaque string that changes every time the user row
//       changes (dbo.users.row_version, ROWVERSION). Callers only compare it.
//   getProgram(programId)      -> { programId, departmentId, name, site, lifecycleStatus,
//                                   description, eligibilityNotes, scheduleNotes,
//                                   costNotes, version, updatedAt, ... } | null
//       `version` is an opaque string that changes every time the Program
//       row changes (dbo.programs.row_version). Callers only compare it.
//   getDepartment(departmentId)-> { departmentId, name, lifecycleStatus, version } | null
//   listActivePrograms()       -> [{ program, department }] where BOTH are ACTIVE
//
// GPME additions (card 10, migration 003):
//   listNeedCategories()       -> [{ needCategoryId, name, lifecycleStatus }]
//       dbo.service_categories (holds the need category list)
//   listMatchablePrograms()    -> [{ program, department }] where BOTH are ACTIVE,
//       and program also carries its matching facts:
//         needCategoryIds   program_service_categories.service_category_id
//         ageLimitState     programs.age_limit_state (SET, NO_RESTRICTION,
//                           NOT_ON_FILE, OTHER_LIMIT)
//         ageMin, ageMax    programs.age_min, programs.age_max
//         serviceAreaState  programs.service_area_state (same four states)
//         serviceAreaZips   program_service_area_zips.zip_code
//       Reads never validate or throw on these facts: GPME reads them
//       through readMatchingFacts(), which treats inconsistent facts as
//       NOT_ON_FILE. So bad matching data can never stop the store, Program
//       listing, affiliation, or Direct Referral from working (PRD 8.8).
//
//   updateProgramMatchingFacts({ programId, ...facts }) -> program | null
//       The WRITE path for matching facts (Program maintenance). Validates
//       with findMatchingFactProblems() and throws InvalidMatchingFactsError
//       (nothing written) if the facts break the rules, for example
//       serviceAreaState SET with no ZIP codes. null if no such Program.
//       Azure SQL requirement: the state columns and the
//       program_service_area_zips rows change in ONE transaction, after
//       this validation, so the state/ZIP rule (which the database cannot
//       CHECK across tables) holds for every committed edit.
//
//   updateUserProgramAffiliation({ userId, expectedVersion, fromProgramId,
//                                  toProgramId, actorUserId, correlationId })
//       -> { version } (the new version) on success
//       -> null if the user's version is no longer expectedVersion (stale);
//          nothing is written in that case.
//       ONE transaction, all or nothing (PRD 9.3, 9.4, 9.6):
//         UPDATE dbo.users SET current_program_id = @to
//           WHERE user_id = @userId AND row_version = @expectedVersion;
//         -- 0 rows -> ROLLBACK, return null
//         INSERT dbo.audit_events (entity_type='USER', action='UPDATED',
//           actor_user_id, before_json, after_json, correlation_id)
//           -- occurred_at comes from the database default SYSUTCDATETIME()
//         COMMIT
//       If the audit insert fails, the user update rolls back too.
//       The store, never the caller, sets the audit timestamp (occurredAt,
//       UTC, PRD 9.6, 9.7). Never touches referrals.
//
// Field names map to db/migrations/001_core_schema.sql and 003:
//   users.current_program_id, users.row_version, programs.lifecycle_status,
//   departments.lifecycle_status, audit_events.

import { findMatchingFactProblems } from '../gpme/programFacts.js';
import { checkAuditEvent } from '../referrals/auditRules.js';

const MATCHING_FACT_KEYS = Object.freeze([
  'needCategoryIds', 'ageLimitState', 'ageMin', 'ageMax', 'serviceAreaState', 'serviceAreaZips',
]);

// Thrown by updateProgramMatchingFacts. Fixed message, never Program data.
export class InvalidMatchingFactsError extends Error {
  constructor() {
    super('invalid Program matching facts');
    this.name = 'InvalidMatchingFactsError';
  }
}

const copyList = (value) => (Array.isArray(value) ? [...value] : value);

// Program matching facts default to "not on file" (migration 003 defaults).
// Existing rows are loaded as they are, even if inconsistent: validation
// belongs to the write path, and GPME reads them fail-safe.
function withMatchingFacts(program) {
  const row = {
    needCategoryIds: [],
    ageLimitState: 'NOT_ON_FILE',
    ageMin: null,
    ageMax: null,
    serviceAreaState: 'NOT_ON_FILE',
    serviceAreaZips: [],
    ...program,
  };
  row.needCategoryIds = copyList(row.needCategoryIds);
  row.serviceAreaZips = copyList(row.serviceAreaZips);
  return row;
}

function copyProgram(program) {
  return {
    ...program,
    needCategoryIds: copyList(program.needCategoryIds),
    serviceAreaZips: copyList(program.serviceAreaZips),
  };
}

export function createMemoryStore(
  { departments = [], programs = [], users = [], needCategories = [] } = {},
  { now = () => new Date() } = {},
) {
  // rowVersion stands in for SQL ROWVERSION on departments too.
  const departmentsById = new Map(departments.map((d) => [d.departmentId, {
    createdAt: null, updatedAt: null, ...d, rowVersion: 1,
  }]));
  let nextDepartmentId = Math.max(0, ...departments.map((d) => d.departmentId)) + 1;
  let nextProgramId = Math.max(0, ...programs.map((p) => p.programId)) + 1;
  // rowVersion stands in for SQL ROWVERSION: bumped on every Program change.
  // Matching facts default to "not on file" (withMatchingFacts).
  const programsById = new Map(programs.map((p) => [p.programId, {
    ...withMatchingFacts({
      description: null,
      eligibilityNotes: null,
      scheduleNotes: null,
      costNotes: null,
      updatedAt: null,
      ...p,
    }),
    rowVersion: 1,
  }]));
  const needCategoryRows = needCategories.map((c) => ({ lifecycleStatus: 'ACTIVE', ...c }));
  let failMatching = false;
  // rowVersion stands in for SQL ROWVERSION: bumped on every user update.
  const usersById = new Map(users.map((u) => [u.userId, { currentProgramId: null, ...u, rowVersion: 1 }]));
  const auditEvents = [];
  let failNextAudit = false;

  const copy = (row) => (row ? { ...row } : null);

  // Copies the matching-fact lists so callers can't change the stored row.
  function publicProgram(program) {
    if (!program) return null;
    const { rowVersion, ...rest } = program;
    return { ...copyProgram(rest), version: `v${rowVersion}` };
  }

  const publicDepartment = (department) => {
    if (!department) return null;
    const { rowVersion, ...rest } = department;
    return { ...rest, version: `v${rowVersion}` };
  };

  function publicUser(user) {
    if (!user) return null;
    const { rowVersion, ...rest } = user;
    return { ...rest, version: `v${rowVersion}` };
  }

  function activeProgramRows() {
    const rows = [];
    for (const program of programsById.values()) {
      const department = departmentsById.get(program.departmentId);
      if (program.lifecycleStatus === 'ACTIVE' && department?.lifecycleStatus === 'ACTIVE') {
        rows.push({ program: publicProgram(program), department: publicDepartment(department) });
      }
    }
    return rows;
  }

  return {
    async getUser(userId) {
      return publicUser(usersById.get(userId));
    },

    async getProgram(programId) {
      return publicProgram(programsById.get(programId));
    },

    async getDepartment(departmentId) {
      return publicDepartment(departmentsById.get(departmentId));
    },

    async listActivePrograms() {
      return activeProgramRows();
    },

    // Not transactional in the memory store; the Azure SQL store changes the
    // state columns and ZIP rows in one transaction after validation. Like
    // every Program change, it moves the Program's version.
    async updateProgramMatchingFacts({ programId, ...facts }) {
      const program = programsById.get(programId);
      if (!program) return null;
      const next = { ...program };
      for (const key of MATCHING_FACT_KEYS) if (key in facts) next[key] = facts[key];
      if (findMatchingFactProblems(next).length > 0) throw new InvalidMatchingFactsError();
      // Validated first, then applied as one change (like one transaction).
      Object.assign(program, withMatchingFacts(next), { updatedAt: now().toISOString() });
      program.rowVersion += 1;
      return publicProgram(program);
    },

    async listNeedCategories() {
      if (failMatching) throw new Error('simulated store failure');
      return needCategoryRows.map((c) => ({ ...c }));
    },

    async listMatchablePrograms() {
      if (failMatching) throw new Error('simulated store failure');
      return activeProgramRows();
    },

    async updateUserProgramAffiliation({ userId, expectedVersion, fromProgramId, toProgramId, actorUserId, correlationId }) {
      const user = usersById.get(userId);
      if (!user || `v${user.rowVersion}` !== expectedVersion) return null; // stale: nothing written

      // Build everything first, then apply both changes together, so a
      // failure leaves the user row and audit history exactly as they were.
      const event = {
        entityType: 'USER',
        entityId: userId,
        action: 'UPDATED',
        actorUserId,
        occurredAt: now().toISOString(),
        before: { current_program_id: fromProgramId },
        after: { current_program_id: toProgramId },
        correlationId,
      };
      if (failNextAudit) {
        failNextAudit = false;
        throw new Error('simulated audit failure');
      }
      // The dbo.audit_events rules, checked before anything is applied.
      checkAuditEvent(event, { userExists: (id) => usersById.has(id) });
      user.currentProgramId = toProgramId;
      user.rowVersion += 1;
      auditEvents.push(event);
      return { version: `v${user.rowVersion}` };
    },

    // Test helpers. Not part of the store contract.
    _auditEvents: auditEvents,
    _failNextAudit() { failNextAudit = true; },
    _setProgramStatus(programId, lifecycleStatus) {
      const program = programsById.get(programId);
      program.lifecycleStatus = lifecycleStatus;
      program.rowVersion += 1;
    },
    // Applies an already-validated, already-authorized Program change.
    // Only the transactional store calls this, at commit (see
    // memoryReferralStore.js). Returns the new public row.
    _applyProgramChange(programId, fields) {
      const program = programsById.get(programId);
      Object.assign(program, fields, { updatedAt: now().toISOString() });
      program.rowVersion += 1;
      return publicProgram(program);
    },
    _setUserActive(userId, isActive) {
      const user = usersById.get(userId);
      user.isActive = isActive;
      user.rowVersion += 1;
    },
    _failMatching(value = true) { failMatching = value; },
    _setProgramDepartment(programId, departmentId) {
      programsById.get(programId).departmentId = departmentId;
    },
    _setDepartmentStatus(departmentId, lifecycleStatus) {
      const department = departmentsById.get(departmentId);
      department.lifecycleStatus = lifecycleStatus;
      department.rowVersion += 1;
    },

    // Organization changes (slice 14C). Only the transactional store calls
    // these, at commit (see memoryReferralStore.js). Not part of the store
    // contract; the SQL store uses INSERT/UPDATE in the transaction.
    _allDepartments: () => [...departmentsById.values()].map(publicDepartment),
    _allPrograms: () => [...programsById.values()].map(publicProgram),
    _allocateDepartmentId: () => nextDepartmentId++,
    _allocateProgramId: () => nextProgramId++,
    _insertDepartment(row) {
      const at = now().toISOString();
      departmentsById.set(row.departmentId, { createdAt: at, updatedAt: at, ...row, rowVersion: 1 });
    },
    _insertProgram(row) {
      const at = now().toISOString();
      programsById.set(row.programId, { ...withMatchingFacts({ createdAt: at, ...row }), updatedAt: at, rowVersion: 1 });
    },
    _applyDepartmentChange(departmentId, fields) {
      const department = departmentsById.get(departmentId);
      Object.assign(department, fields, { updatedAt: now().toISOString() });
      department.rowVersion += 1;
    },
  };
}
