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
// Field names map to db/migrations/001_core_schema.sql:
//   users.current_program_id, users.row_version, programs.lifecycle_status,
//   departments.lifecycle_status, audit_events.

export function createMemoryStore(
  { departments = [], programs = [], users = [] } = {},
  { now = () => new Date() } = {},
) {
  // rowVersion stands in for SQL ROWVERSION on departments too.
  const departmentsById = new Map(departments.map((d) => [d.departmentId, {
    createdAt: null, updatedAt: null, ...d, rowVersion: 1,
  }]));
  let nextDepartmentId = Math.max(0, ...departments.map((d) => d.departmentId)) + 1;
  let nextProgramId = Math.max(0, ...programs.map((p) => p.programId)) + 1;
  // rowVersion stands in for SQL ROWVERSION: bumped on every Program change.
  const programsById = new Map(programs.map((p) => [p.programId, {
    description: null,
    eligibilityNotes: null,
    scheduleNotes: null,
    costNotes: null,
    updatedAt: null,
    ...p,
    rowVersion: 1,
  }]));
  // rowVersion stands in for SQL ROWVERSION: bumped on every user update.
  const usersById = new Map(users.map((u) => [u.userId, { currentProgramId: null, ...u, rowVersion: 1 }]));
  const auditEvents = [];
  let failNextAudit = false;

  const copy = (row) => (row ? { ...row } : null);

  function publicProgram(program) {
    if (!program) return null;
    const { rowVersion, ...rest } = program;
    return { ...rest, version: `v${rowVersion}` };
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
      const rows = [];
      for (const program of programsById.values()) {
        const department = departmentsById.get(program.departmentId);
        if (program.lifecycleStatus === 'ACTIVE' && department?.lifecycleStatus === 'ACTIVE') {
          rows.push({ program: publicProgram(program), department: publicDepartment(department) });
        }
      }
      return rows;
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
      programsById.set(row.programId, { createdAt: at, ...row, updatedAt: at, rowVersion: 1 });
    },
    _applyDepartmentChange(departmentId, fields) {
      const department = departmentsById.get(departmentId);
      Object.assign(department, fields, { updatedAt: now().toISOString() });
      department.rowVersion += 1;
    },
  };
}
