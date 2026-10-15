// In-memory store for tests and local development with SYNTHETIC data only.
// It is not used in production.
//
// It defines the store contract that the Azure SQL store must also meet:
//
//   getUser(userId)            -> { userId, isActive, currentProgramId } | null
//   getProgram(programId)      -> { programId, departmentId, name, site, lifecycleStatus } | null
//   getDepartment(departmentId)-> { departmentId, name, lifecycleStatus } | null
//   listActivePrograms()       -> [{ program, department }] where BOTH are ACTIVE
//   updateUserProgramAffiliation({ userId, fromProgramId, toProgramId,
//                                  actorUserId, correlationId })
//        Sets users.current_program_id and appends one audit event
//        (entity USER, action UPDATED) in a single transaction.
//        Never touches referrals.
//
// Field names map to db/migrations/001_core_schema.sql:
//   users.current_program_id, programs.lifecycle_status,
//   departments.lifecycle_status, audit_events.

export function createMemoryStore({ departments = [], programs = [], users = [] } = {}) {
  const departmentsById = new Map(departments.map((d) => [d.departmentId, { ...d }]));
  const programsById = new Map(programs.map((p) => [p.programId, { ...p }]));
  const usersById = new Map(users.map((u) => [u.userId, { currentProgramId: null, ...u }]));
  const auditEvents = [];

  const copy = (row) => (row ? { ...row } : null);

  return {
    async getUser(userId) {
      return copy(usersById.get(userId));
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

    async updateUserProgramAffiliation({ userId, fromProgramId, toProgramId, actorUserId, correlationId }) {
      const user = usersById.get(userId);
      if (!user) throw new Error('user not found');
      user.currentProgramId = toProgramId;
      auditEvents.push({
        entityType: 'USER',
        entityId: userId,
        action: 'UPDATED',
        actorUserId,
        before: { current_program_id: fromProgramId },
        after: { current_program_id: toProgramId },
        correlationId,
      });
    },

    // Test helpers. Not part of the store contract.
    _auditEvents: auditEvents,
    _setProgramStatus(programId, lifecycleStatus) {
      programsById.get(programId).lifecycleStatus = lifecycleStatus;
    },
  };
}
