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
import { matchingFactsOf, validateMatchingChange } from './validateMatchingChange.js';
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

  // Discovery uses the same server-side grants as individual management
  // actions. Lifecycle does not hide discontinued Programs from managers.
  async function listManagedPrograms(userId) {
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      throw programErrors.notAuthenticated();
    }
    return store.withTransaction(async (tx) => {
      const user = await tx.getUser(userId);
      if (!user || !user.isActive) throw programErrors.userNotActive();
      const grants = await tx.getActiveGrants(userId);
      const ids = [...programIdsWithCapability(grants, MANAGE_PROGRAM, { allowDemoGrants })]
        .filter((id) => id > 0).sort((a, b) => a - b);
      const programs = [];
      for (const id of ids) {
        const program = await tx.getProgram(id);
        if (!program) continue;
        const department = await tx.getDepartment(program.departmentId);
        programs.push({
          programId: program.programId,
          name: program.name,
          site: program.site ?? null,
          departmentId: program.departmentId,
          departmentName: department?.name ?? null,
          lifecycleStatus: program.lifecycleStatus,
        });
      }
      programs.sort((a, b) => a.name.localeCompare(b.name)
        || (a.site ?? '').localeCompare(b.site ?? '')
        || a.programId - b.programId);
      return { programs };
    });
  }

  // Read for the maintenance screen, with the version to send back.
  async function getProgram(userId, programId) {
    checkIds(userId, programId);
    return store.withTransaction(async (tx) => {
      const { program, department } = await authorize(tx, userId, programId, MANAGE_PROGRAM);
      return { program: toManagedProgram(program, department) };
    });
  }

  async function getMatchingFacts(userId, programId) {
    checkIds(userId, programId);
    return store.withTransaction(async (tx) => {
      const { program, department } = await authorize(tx, userId, programId, MANAGE_PROGRAM);
      const categories = await tx.listNeedCategories();
      const languages = await tx.listServiceLanguages();
      return {
        program: toManagedProgram(program, department),
        facts: matchingFactsOf(program),
        categories: categories.map((row) => ({
          needCategoryId: row.needCategoryId,
          name: row.name,
          lifecycleStatus: row.lifecycleStatus,
        })),
        // Language of service (Task W): the controlled list, same rules as
        // categories. Meaning comes from languageId, never from the name.
        languages: languages.map((row) => ({
          languageId: row.languageId,
          name: row.name,
          lifecycleStatus: row.lifecycleStatus,
        })),
      };
    });
  }

  async function updateMatchingFacts(userId, programId, body, { correlationId = null } = {}) {
    checkIds(userId, programId);
    return store.withTransaction(async (tx) => {
      const { program, department } = await authorize(tx, userId, programId, MANAGE_PROGRAM);
      if (program.lifecycleStatus === 'RETIRED') throw programErrors.programRetired();
      const validation = validateMatchingChange(body);
      if (!validation.ok) throwInvalid(validation);
      const { version } = validation.value;
      // languageIds is optional: left out, the saved languages are kept.
      const facts = {
        ...validation.value.facts,
        languageIds: validation.value.facts.languageIds
          ?? [...(program.languageIds ?? [])].sort((a, b) => a - b),
      };
      const stale = () => programErrors.programChanged({
        ...toManagedProgram(program, department),
        matchingFacts: matchingFactsOf(program),
      });
      if (program.version !== version) throw stale();

      const categories = await tx.listNeedCategories();
      const previousIds = new Set(program.needCategoryIds ?? []);
      const allowed = new Set(categories
        .filter((row) => row.lifecycleStatus === 'ACTIVE' || previousIds.has(row.needCategoryId))
        .map((row) => row.needCategoryId));
      if (facts.needCategoryIds.some((id) => !allowed.has(id))) {
        throw programErrors.invalidRequest(['needCategoryIds']);
      }

      // Same rule for languages: an ACTIVE language, or one already saved.
      const languages = await tx.listServiceLanguages();
      const previousLanguages = new Set(program.languageIds ?? []);
      const allowedLanguages = new Set(languages
        .filter((row) => row.lifecycleStatus === 'ACTIVE' || previousLanguages.has(row.languageId))
        .map((row) => row.languageId));
      if (facts.languageIds.some((id) => !allowedLanguages.has(id))) {
        throw programErrors.invalidRequest(['languageIds']);
      }

      const before = matchingFactsOf(program);
      const comparable = {
        ...before,
        needCategoryIds: [...before.needCategoryIds].sort((a, b) => a - b),
        serviceAreaZips: [...before.serviceAreaZips].sort(),
        languageIds: [...before.languageIds].sort((a, b) => a - b),
      };
      if (JSON.stringify(comparable) === JSON.stringify(facts)) throw programErrors.noChange();

      // SQL implementations must update the Program, category links, ZIP
      // rows and language links in this same transaction, using the
      // Program version.
      const updated = await tx.updateProgram({
        programId, expectedVersion: version, set: structuredClone(facts),
      });
      if (!updated) throw stale();
      await tx.appendAuditEvent({
        entityType: 'PROGRAM',
        entityId: programId,
        action: 'UPDATED',
        actorUserId: userId,
        before: { matching_facts: before },
        after: { matching_facts: facts },
        correlationId,
      });
      return {
        status: 'UPDATED',
        program: toManagedProgram(updated, department),
        facts: matchingFactsOf(updated),
      };
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
    listManagedPrograms,
    getProgram,
    updateDetails,
    getMatchingFacts,
    updateMatchingFacts,
    discontinue: (userId, programId, body, options) =>
      changeLifecycle(userId, programId, body, 'DISCONTINUED', options),
    reactivate: (userId, programId, body, options) =>
      changeLifecycle(userId, programId, body, 'ACTIVE', options),
  });
}
