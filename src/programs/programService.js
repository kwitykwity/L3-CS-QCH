// Program maintenance, slice 14A: common Program information and the
// Program lifecycle (Final Technical PRD 3.2, 3.3, 3.6, 3.8, 4.1, 4.2,
// 4.4, 6.4, 9.3, 9.4, 9.6, 10.3, 10.5, 13.4).
//
// Authorization (PRD 3.6, capability + resource + scope):
// - MANAGE_PROGRAM, as an active PROGRAM-scope grant for THIS Program,
//   read from the database inside the transaction. A grant for another
//   Program, a revoked grant, a DEMO grant (unless explicitly allowed in
//   development/test), ADMINISTER_PERMISSIONS, MANAGE_ORGANIZATION, a
//   receiving grant, or the user's Program affiliation does not authorize
//   a change (PRD 3.8, 3.9).
// - Discontinue/reactivate uses LIFECYCLE_CAPABILITY = MANAGE_PROGRAM for
//   that Program. The PRD does not name the capability for Program
//   lifecycle. TEAM DECISION (confirmed Oct 19): the Program Director
//   discontinues and reactivates their own Program.
//
// Every change (PRD 6.4, 9.3, 9.4, 9.6):
//   one transaction: active user + grants (locking reads), Program held for
//   update, validate, conditional UPDATE on the version the worker last
//   saw, audit event with the before/after values, commit. A stale version
//   is refused with the current Program; nothing is written. If the audit
//   write fails, the change rolls back.
//
// Lifecycle (PRD 4.4): ACTIVE -> DISCONTINUED (excluded from new referral
// choices; history untouched) and DISCONTINUED -> ACTIVE (audited as
// REACTIVATED; only while the Department is ACTIVE). RETIRED Programs are
// not changed here.

import {
  programIdsWithCapability,
} from '../authorization/referralAccess.js';
import { programErrors } from './errors.js';
import {
  EDITABLE_FIELDS,
  validateLifecycleChange,
  validateProgramDetails,
} from './validateProgramChange.js';

export const MANAGE_PROGRAM = 'MANAGE_PROGRAM';
export const LIFECYCLE_CAPABILITY = MANAGE_PROGRAM;

// What the maintenance screen shows (PRD 10.5). Routing details such as
// notification_email are never returned.
function toManagedProgram(program, department) {
  const out = {
    programId: program.programId,
    name: program.name,
    departmentId: program.departmentId,
    departmentName: department?.name ?? null,
    lifecycleStatus: program.lifecycleStatus,
    version: program.version,
    updatedAt: program.updatedAt ?? null,
  };
  for (const name of Object.keys(EDITABLE_FIELDS)) out[name] = program[name] ?? null;
  return out;
}

function throwInvalid(validation) {
  throw validation.unexpectedField
    ? programErrors.unexpectedField()
    : programErrors.invalidRequest(validation.fields);
}

function checkIds(userId, programId) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw programErrors.notAuthenticated();
  if (!Number.isSafeInteger(programId) || programId <= 0) throw programErrors.programNotFound();
}

export function createProgramService({ store, allowDemoGrants = false }) {
  if (!store || typeof store.withTransaction !== 'function') {
    throw new Error('createProgramService requires a transactional store');
  }

  // Inside the transaction: active user, the Program held for update, and
  // the capability for that Program. Returns { program, department }.
  // holdDepartment: hold the Department for update instead of only reading
  // it. Reactivation does this, so it can't race a Department discontinue
  // (slice 14C). Lock order: Program, then Department.
  async function authorize(tx, userId, programId, capability, { holdDepartment = false } = {}) {
    const user = await tx.getUser(userId);
    if (!user || !user.isActive) throw programErrors.userNotActive();

    const program = await tx.lockProgramForUpdate(programId);
    if (!program) throw programErrors.programNotFound();

    const grants = await tx.getActiveGrants(userId);
    const allowed = programIdsWithCapability(grants, capability, { allowDemoGrants }).has(programId);
    if (!allowed) throw programErrors.notAuthorized();

    const department = holdDepartment
      ? await tx.lockDepartmentForUpdate(program.departmentId)
      : await tx.getDepartment(program.departmentId);
    return { program, department };
  }

  async function staleError(tx, programId) {
    const now = await tx.getProgram(programId);
    const department = await tx.getDepartment(now.departmentId);
    return programErrors.programChanged(toManagedProgram(now, department));
  }

  // Read for the maintenance screen, with the version to send back.
  async function getProgram(userId, programId) {
    checkIds(userId, programId);
    return store.withTransaction(async (tx) => {
      const { program, department } = await authorize(tx, userId, programId, MANAGE_PROGRAM);
      return { program: toManagedProgram(program, department) };
    });
  }

  async function updateDetails(userId, programId, body, { correlationId = null } = {}) {
    checkIds(userId, programId);
    const validation = validateProgramDetails(body);
    if (!validation.ok) throwInvalid(validation);
    const { version, changes } = validation.value;

    return store.withTransaction(async (tx) => {
      const { program, department } = await authorize(tx, userId, programId, MANAGE_PROGRAM);
      if (program.lifecycleStatus === 'RETIRED') throw programErrors.programRetired();
      if (program.version !== version) throw await staleError(tx, programId);

      // Only fields whose value really changes are written and audited.
      const set = {};
      const before = {};
      const after = {};
      for (const [name, value] of Object.entries(changes)) {
        const old = program[name] ?? null;
        if (old === value) continue;
        set[name] = value;
        before[EDITABLE_FIELDS[name].column] = old;
        after[EDITABLE_FIELDS[name].column] = value;
      }
      if (Object.keys(set).length === 0) throw programErrors.noChange();

      const updated = await tx.updateProgram({ programId, expectedVersion: version, set });
      if (!updated) throw await staleError(tx, programId);

      await tx.appendAuditEvent({
        entityType: 'PROGRAM',
        entityId: programId,
        action: 'UPDATED',
        actorUserId: userId,
        before,
        after,
        correlationId,
      });

      return { status: 'UPDATED', program: toManagedProgram(updated, department) };
    });
  }

  async function changeLifecycle(userId, programId, body, target, { correlationId = null } = {}) {
    checkIds(userId, programId);
    const validation = validateLifecycleChange(body);
    if (!validation.ok) throwInvalid(validation);
    const { version } = validation.value;

    return store.withTransaction(async (tx) => {
      const { program, department } = await authorize(tx, userId, programId, LIFECYCLE_CAPABILITY, {
        holdDepartment: target === 'ACTIVE',
      });
      if (program.lifecycleStatus === 'RETIRED') throw programErrors.programRetired();
      if (program.version !== version) throw await staleError(tx, programId);
      if (program.lifecycleStatus === target) throw programErrors.alreadyInStatus();
      if (target === 'ACTIVE' && department?.lifecycleStatus !== 'ACTIVE') {
        throw programErrors.departmentNotActive();
      }

      const updated = await tx.updateProgram({
        programId,
        expectedVersion: version,
        set: { lifecycleStatus: target },
      });
      if (!updated) throw await staleError(tx, programId);

      await tx.appendAuditEvent({
        entityType: 'PROGRAM',
        entityId: programId,
        action: target === 'ACTIVE' ? 'REACTIVATED' : 'DISCONTINUED',
        actorUserId: userId,
        before: { lifecycle_status: program.lifecycleStatus },
        after: { lifecycle_status: target },
        correlationId,
      });

      return {
        status: target === 'ACTIVE' ? 'REACTIVATED' : 'DISCONTINUED',
        program: toManagedProgram(updated, department),
      };
    });
  }

  return Object.freeze({
    getProgram,
    updateDetails,
    discontinue: (userId, programId, body, options) =>
      changeLifecycle(userId, programId, body, 'DISCONTINUED', options),
    reactivate: (userId, programId, body, options) =>
      changeLifecycle(userId, programId, body, 'ACTIVE', options),
  });
}
