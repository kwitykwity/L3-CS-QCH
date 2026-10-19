// In-memory store for tests and local development with SYNTHETIC data only.
// It is not used in production.
//
// It defines the store contract that the Azure SQL store must also meet:
//
//   getUser(userId) -> { userId, isActive, currentProgramId, version } | null
//       `version` is an opaque string that changes every time the user row
//       changes (dbo.users.row_version, ROWVERSION). Callers only compare it.
//   getProgram(programId)      -> { programId, departmentId, name, site, lifecycleStatus } | null
//   getDepartment(departmentId)-> { departmentId, name, lifecycleStatus } | null
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
  const departmentsById = new Map(departments.map((d) => [d.departmentId, { ...d }]));
  const programsById = new Map(programs.map((p) => [p.programId, withMatchingFacts(p)]));
  const needCategoryRows = needCategories.map((c) => ({ lifecycleStatus: 'ACTIVE', ...c }));
  let failMatching = false;
  // rowVersion stands in for SQL ROWVERSION: bumped on every user update.
  const usersById = new Map(users.map((u) => [u.userId, { currentProgramId: null, ...u, rowVersion: 1 }]));
  const auditEvents = [];
  let failNextAudit = false;

  const copy = (row) => (row ? { ...row } : null);

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
        rows.push({ program: copyProgram(program), department: { ...department } });
      }
    }
    return rows;
  }

  return {
    async getUser(userId) {
      return publicUser(usersById.get(userId));
    },

    async getProgram(programId) {
      const program = programsById.get(programId);
      return program ? copyProgram(program) : null;
    },

    async getDepartment(departmentId) {
      return copy(departmentsById.get(departmentId));
    },

    async listActivePrograms() {
      return activeProgramRows();
    },

    async updateProgramMatchingFacts({ programId, ...facts }) {
      const program = programsById.get(programId);
      if (!program) return null;
      const next = { ...program };
      for (const key of MATCHING_FACT_KEYS) if (key in facts) next[key] = facts[key];
      if (findMatchingFactProblems(next).length > 0) throw new InvalidMatchingFactsError();
      // Validated first, then applied as one change (like one transaction).
      Object.assign(program, withMatchingFacts(next));
      return copyProgram(program);
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
      user.currentProgramId = toProgramId;
      user.rowVersion += 1;
      auditEvents.push(event);
      return { version: `v${user.rowVersion}` };
    },

    // Test helpers. Not part of the store contract.
    _auditEvents: auditEvents,
    _failNextAudit() { failNextAudit = true; },
    _setProgramStatus(programId, lifecycleStatus) {
      programsById.get(programId).lifecycleStatus = lifecycleStatus;
    },
    _failMatching(value = true) { failMatching = value; },
    _setDepartmentStatus(departmentId, lifecycleStatus) {
      departmentsById.get(departmentId).lifecycleStatus = lifecycleStatus;
    },
  };
}
