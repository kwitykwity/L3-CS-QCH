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
  const departmentsById = new Map(departments.map((d) => [d.departmentId, { ...d }]));
  const programsById = new Map(programs.map((p) => [p.programId, { ...p }]));
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

  return {
    async getUser(userId) {
      return publicUser(usersById.get(userId));
    },

    async getProgram(programId) {
      return copy(programsById.get(programId));
    },

    async getDepartment(departmentId) {
      return copy(departmentsById.get(departmentId));
    },

    async listActivePrograms() {
      const rows = [];
      for (const program of programsById.values()) {
        const department = departmentsById.get(program.departmentId);
        if (program.lifecycleStatus === 'ACTIVE' && department?.lifecycleStatus === 'ACTIVE') {
          rows.push({ program: { ...program }, department: { ...department } });
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
      programsById.get(programId).lifecycleStatus = lifecycleStatus;
    },
    _setDepartmentStatus(departmentId, lifecycleStatus) {
      departmentsById.get(departmentId).lifecycleStatus = lifecycleStatus;
    },
  };
}
