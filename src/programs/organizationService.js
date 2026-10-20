// Organization changes, slice 14C (Trello card 14): creating Programs,
// moving a Program to another Department, and the Department lifecycle
// (Final Technical PRD 3.6, 4.4, 6.4, 9.3, 9.4, 9.6, 10.3, 13.4).
//
// Authorization (PRD 3.6): MANAGE_ORGANIZATION ("Create Programs,
// administer Department lifecycle") as an active ORG-scope grant, read
// inside the transaction. MANAGE_PROGRAM, ADMINISTER_PERMISSIONS, and
// PROGRAM- or DEPARTMENT-scope grants do not count.
//
// Department lifecycle (PRD 4.4): ACTIVE -> DISCONTINUED -> ACTIVE
// (audited as REACTIVATED). "A Department with active Programs cannot be
// removed/discontinued without first moving or discontinuing those
// Programs." RETIRED Departments are not changed here.
//
// Concurrency: every change that can make a Program ACTIVE in a Department
// (create, reactivate, move in) and every Department change holds that
// Department for update first, so a Department discontinue can't miss a
// Program becoming active at the same moment. Names are unique (schema
// uq_departments_name, uq_programs_name_site); the name key is held while
// checking, so two creates with one name can't both succeed.

import { hasOrgScopeCapability } from '../authorization/referralAccess.js';
import { programErrors } from './errors.js';
import {
  EDITABLE_FIELDS,
  validateCreateDepartment,
  validateCreateProgram,
  validateLifecycleChange,
  validateMoveProgram,
  validateRenameDepartment,
} from './validateProgramChange.js';

export const MANAGE_ORGANIZATION = 'MANAGE_ORGANIZATION';

const positiveInt = (v) => Number.isSafeInteger(v) && v > 0;

function throwInvalid(validation) {
  throw validation.unexpectedField
    ? programErrors.unexpectedField()
    : programErrors.invalidRequest(validation.fields);
}

function toDepartmentView(department, programs = null) {
  const view = {
    departmentId: department.departmentId,
    name: department.name,
    lifecycleStatus: department.lifecycleStatus,
    version: department.version,
  };
  if (programs) {
    view.activeProgramCount = programs.filter((p) => p.lifecycleStatus === 'ACTIVE').length;
    view.programCount = programs.length;
  }
  return view;
}

// Routing details such as notification_email are never returned.
function toProgramView(program, department) {
  const out = {
    programId: program.programId,
    name: program.name,
    departmentId: program.departmentId,
    departmentName: department?.name ?? null,
    lifecycleStatus: program.lifecycleStatus,
    version: program.version,
  };
  for (const name of Object.keys(EDITABLE_FIELDS)) out[name] = program[name] ?? null;
  return out;
}

export function createOrganizationService({ store, allowDemoGrants = false }) {
  if (!store || typeof store.withTransaction !== 'function') {
    throw new Error('createOrganizationService requires a transactional store');
  }

  async function authorizeOrg(tx, userId) {
    if (!positiveInt(userId)) throw programErrors.notAuthenticated();
    const user = await tx.getUser(userId);
    if (!user || !user.isActive) throw programErrors.userNotActive();
    const grants = await tx.getActiveGrants(userId);
    if (!hasOrgScopeCapability(grants, MANAGE_ORGANIZATION, { allowDemoGrants })) throw programErrors.notAuthorized();
  }

  async function heldDepartment(tx, departmentId) {
    if (!positiveInt(departmentId)) throw programErrors.departmentNotFound();
    const department = await tx.lockDepartmentForUpdate(departmentId);
    if (!department) throw programErrors.departmentNotFound();
    return department;
  }

  async function departmentStale(tx, departmentId) {
    const now = (await tx.listDepartments()).find((d) => d.departmentId === departmentId);
    return programErrors.departmentChanged(toDepartmentView(now, await tx.listDepartmentPrograms(departmentId)));
  }

  // ----- Departments ------------------------------------------------------

  async function listDepartments(userId) {
    return store.withTransaction(async (tx) => {
      await authorizeOrg(tx, userId);
      const departments = [];
      for (const d of await tx.listDepartments()) {
        departments.push(toDepartmentView(d, await tx.listDepartmentPrograms(d.departmentId)));
      }
      return { departments };
    });
  }

  async function createDepartment(userId, body, { correlationId = null } = {}) {
    const validation = validateCreateDepartment(body);
    if (!validation.ok) throwInvalid(validation);
    const { name } = validation.value;
    return store.withTransaction(async (tx) => {
      await authorizeOrg(tx, userId);
      if (await tx.lockDepartmentName(name) !== null) throw programErrors.departmentNameTaken();
      const department = await tx.insertDepartment({ name });
      await tx.appendAuditEvent({
        entityType: 'DEPARTMENT',
        entityId: department.departmentId,
        action: 'CREATED',
        actorUserId: userId,
        before: null,
        after: { name, lifecycle_status: 'ACTIVE' },
        correlationId,
      });
      return { status: 'CREATED', department: toDepartmentView(department, []) };
    });
  }

  async function renameDepartment(userId, departmentId, body, { correlationId = null } = {}) {
    const validation = validateRenameDepartment(body);
    if (!validation.ok) throwInvalid(validation);
    const { version, name } = validation.value;
    return store.withTransaction(async (tx) => {
      await authorizeOrg(tx, userId);
      const department = await heldDepartment(tx, departmentId);
      if (department.lifecycleStatus === 'RETIRED') throw programErrors.departmentRetired();
      if (department.version !== version) throw await departmentStale(tx, departmentId);
      if (department.name === name) throw programErrors.noChange();
      const owner = await tx.lockDepartmentName(name);
      if (owner !== null && owner !== departmentId) throw programErrors.departmentNameTaken();
      const updated = await tx.updateDepartment({ departmentId, expectedVersion: version, set: { name } });
      if (!updated) throw await departmentStale(tx, departmentId);
      await tx.appendAuditEvent({
        entityType: 'DEPARTMENT',
        entityId: departmentId,
        action: 'RENAMED',
        actorUserId: userId,
        before: { name: department.name },
        after: { name },
        correlationId,
      });
      return { status: 'RENAMED', department: toDepartmentView(updated, await tx.listDepartmentPrograms(departmentId)) };
    });
  }

  async function changeDepartmentLifecycle(userId, departmentId, body, target, { correlationId = null } = {}) {
    const validation = validateLifecycleChange(body);
    if (!validation.ok) throwInvalid(validation);
    const { version } = validation.value;
    return store.withTransaction(async (tx) => {
      await authorizeOrg(tx, userId);
      const department = await heldDepartment(tx, departmentId);
      if (department.lifecycleStatus === 'RETIRED') throw programErrors.departmentRetired();
      if (department.version !== version) throw await departmentStale(tx, departmentId);
      if (department.lifecycleStatus === target) throw programErrors.departmentAlreadyInStatus();
      const programs = await tx.listDepartmentPrograms(departmentId);
      if (target === 'DISCONTINUED' && programs.some((p) => p.lifecycleStatus === 'ACTIVE')) {
        throw programErrors.departmentHasActivePrograms();
      }
      const updated = await tx.updateDepartment({ departmentId, expectedVersion: version, set: { lifecycleStatus: target } });
      if (!updated) throw await departmentStale(tx, departmentId);
      const action = target === 'ACTIVE' ? 'REACTIVATED' : 'DISCONTINUED';
      await tx.appendAuditEvent({
        entityType: 'DEPARTMENT',
        entityId: departmentId,
        action,
        actorUserId: userId,
        before: { lifecycle_status: department.lifecycleStatus },
        after: { lifecycle_status: target },
        correlationId,
      });
      return { status: action, department: toDepartmentView(updated, programs) };
    });
  }

  // ----- Programs ---------------------------------------------------------

  // A new Program starts ACTIVE in an ACTIVE Department. Nobody manages it
  // until a permission administrator grants MANAGE_PROGRAM (PRD 3.6), and
  // its notification email (routing) is set up separately.
  async function createProgram(userId, body, { correlationId = null } = {}) {
    const validation = validateCreateProgram(body);
    if (!validation.ok) throwInvalid(validation);
    const { departmentId, name, ...details } = validation.value;
    return store.withTransaction(async (tx) => {
      await authorizeOrg(tx, userId);
      // Lock order: Department, then the name key.
      const department = await heldDepartment(tx, departmentId);
      if (department.lifecycleStatus !== 'ACTIVE') throw programErrors.departmentNotActive();
      if (await tx.lockProgramName(name, details.site) !== null) throw programErrors.programNameTaken();
      const program = await tx.insertProgram({ departmentId, name, ...details });
      await tx.appendAuditEvent({
        entityType: 'PROGRAM',
        entityId: program.programId,
        action: 'CREATED',
        actorUserId: userId,
        before: null,
        after: {
          department_id: departmentId,
          name,
          lifecycle_status: 'ACTIVE',
          ...Object.fromEntries(Object.entries(EDITABLE_FIELDS).map(([k, rule]) => [rule.column, details[k]])),
        },
        correlationId,
      });
      return { status: 'CREATED', program: toProgramView(program, department) };
    });
  }

  // Moves a Program to another ACTIVE Department, for example before its
  // old Department is discontinued (PRD 4.4). Past referrals keep their
  // historical Department context.
  async function moveProgram(userId, programId, body, { correlationId = null } = {}) {
    if (!positiveInt(programId)) throw programErrors.programNotFound();
    const validation = validateMoveProgram(body);
    if (!validation.ok) throwInvalid(validation);
    const { version, departmentId } = validation.value;
    return store.withTransaction(async (tx) => {
      await authorizeOrg(tx, userId);
      // Lock order: Program, then Department (same as reactivation).
      const program = await tx.lockProgramForUpdate(programId);
      if (!program) throw programErrors.programNotFound();
      if (program.lifecycleStatus === 'RETIRED') throw programErrors.programRetired();
      const stale = async () => {
        const now = await tx.getProgram(programId);
        return programErrors.programChanged(toProgramView(now, await tx.getDepartment(now.departmentId)));
      };
      if (program.version !== version) throw await stale();
      if (program.departmentId === departmentId) throw programErrors.noChange();
      const target = await heldDepartment(tx, departmentId);
      if (target.lifecycleStatus !== 'ACTIVE') throw programErrors.departmentNotActive();
      const updated = await tx.updateProgram({ programId, expectedVersion: version, set: { departmentId } });
      if (!updated) throw await stale();
      await tx.appendAuditEvent({
        entityType: 'PROGRAM',
        entityId: programId,
        action: 'UPDATED',
        actorUserId: userId,
        before: { department_id: program.departmentId },
        after: { department_id: departmentId },
        correlationId,
      });
      return { status: 'MOVED', program: toProgramView(updated, target) };
    });
  }

  return {
    listDepartments,
    createDepartment,
    renameDepartment,
    discontinueDepartment: (u, id, b, o) => changeDepartmentLifecycle(u, id, b, 'DISCONTINUED', o),
    reactivateDepartment: (u, id, b, o) => changeDepartmentLifecycle(u, id, b, 'ACTIVE', o),
    createProgram,
    moveProgram,
  };
}
