// Permission administration (Trello Task Y; Final Technical PRD 3.2, 3.3,
// 3.6, 3.8, 9.3, 9.6, 10.5, 13.4).
//
// Who (PRD 3.6, 3.8): ADMINISTER_PERMISSIONS as an active ORG-scope grant,
// read inside the transaction. The PRD describes "designated QCH
// administrators" and never a Program- or Department-only administrator,
// so other scopes count for nothing (fail closed), like every other
// capability in src/authorization/referralAccess.js. No other capability
// (MANAGE_PROGRAM, MANAGE_ORGANIZATION, receiving rights, an affiliation)
// lets anyone change permissions (PRD 3.8).
//
// The acting user comes only from server-side identity (PRD 3.2). The
// target user is the resource named in the URL, never a claim about who
// is asking.
//
// Rules REQUIRED by the PRD and the frozen handoff contract:
// - The administrator check above, on the server, inside the transaction.
// - No self-elevation: nobody can grant themselves anything.
// - Only the GRANTABLE permissions, each in its one honored scope
//   (validatePermissionChange.js), so scope boundaries hold.
// - A Program-scope grant needs a Program that exists and is not RETIRED.
// - New grants are always grantSource IN_APP.
//
// TEAM IMPLEMENTATION RESTRICTIONS: stricter than required, NOT approved
// QCH policy. Pending QCH confirmation (README, "Permission administration"); QCH
// may loosen them, so keep each one easy to change:
// - All self-changes are refused, removals too (the contract only
//   requires blocking self-elevation). See selfChange below.
// - ADMINISTER_PERMISSIONS is not granted or revoked on this screen (team
//   reading of PRD 3.8). See GRANTABLE and isRevocable.
// - Only IN_APP grants are removable here. See isRevocable.
// - New grants go only to active users; revoking works for inactive users
//   too, so access can be cleaned up.
//
// Every change (PRD 9.3, 9.6, 13.4): one transaction. Hold permission
// administration first (one change at a time, no deadlocks), check the
// administrator, then the target, then the current grants; refuse a
// duplicate (ALREADY_GRANTED) or a grant already gone (GRANT_CHANGED),
// each with the target's current grants; write the change and its audit
// event (entity USER_GRANT, GRANTED or REVOKED). If the audit write fails,
// nothing changes.
//
// Errors never reveal whether a user exists to someone who is not an
// administrator: the request's shape is checked first (it depends on
// nothing stored), then the administrator, and only then the target.

import { hasOrgScopeCapability } from '../authorization/referralAccess.js';
import { permissionErrors } from './errors.js';
import {
  ADMINISTER_PERMISSIONS,
  GRANTABLE,
  isRevocable,
  labelOf,
  validateGrantRequest,
  validateRevokeRequest,
} from './validatePermissionChange.js';

const positiveInt = (v) => Number.isSafeInteger(v) && v > 0;

function throwInvalid(validation) {
  throw validation.unexpectedField
    ? permissionErrors.unexpectedField()
    : permissionErrors.invalidRequest(validation.fields);
}

export function createPermissionService({ store, allowDemoGrants = false }) {
  if (!store || typeof store.withTransaction !== 'function') {
    throw new Error('createPermissionService requires a transactional store');
  }

  async function authorizeAdmin(tx, actorId) {
    if (!positiveInt(actorId)) throw permissionErrors.notAuthenticated();
    const actor = await tx.getUser(actorId);
    if (!actor || !actor.isActive) throw permissionErrors.userNotActive();
    const grants = await tx.getActiveGrants(actorId);
    if (!hasOrgScopeCapability(grants, ADMINISTER_PERMISSIONS, { allowDemoGrants })) {
      throw permissionErrors.notAuthorized();
    }
  }

  // Every Program with its Department, committed state (for names and the
  // Program picker). RETIRED Programs are listed only for naming old grants.
  async function programIndex(tx) {
    const index = new Map();
    for (const department of await tx.listDepartments()) {
      for (const program of await tx.listDepartmentPrograms(department.departmentId)) {
        index.set(program.programId, {
          programId: program.programId,
          name: program.name,
          site: program.site ?? null,
          departmentName: department.name,
          lifecycleStatus: program.lifecycleStatus,
        });
      }
    }
    return index;
  }

  // What the screen shows for one grant (PRD 10.5: no other user data).
  function toGrantView(grant, programs) {
    const program = grant.programId != null ? programs.get(grant.programId) ?? null : null;
    return {
      grantId: grant.grantId,
      permission: grant.permission,
      label: labelOf(grant.permission),
      scopeType: grant.scopeType,
      programId: grant.programId ?? null,
      programName: program?.name ?? null,
      programSite: program?.site ?? null,
      grantSource: grant.grantSource,
      grantedAt: grant.grantedAt ?? null,
      revocable: isRevocable(grant),
    };
  }

  function sortGrants(views) {
    return views.sort((a, b) => a.label.localeCompare(b.label)
      || (a.programName ?? '').localeCompare(b.programName ?? '')
      || a.grantId - b.grantId);
  }

  const toUserView = (user, actorId) => ({
    userId: user.userId,
    displayName: user.displayName ?? `Staff member ${user.userId}`,
    isActive: user.isActive === true,
    isYou: user.userId === actorId,
  });

  async function currentGrants(tx, userId, programs) {
    return sortGrants((await tx.getActiveGrants(userId)).map((g) => toGrantView(g, programs)));
  }

  async function loadTarget(tx, targetId) {
    if (!positiveInt(targetId)) throw permissionErrors.userNotFound();
    const target = await tx.getUser(targetId);
    if (!target) throw permissionErrors.userNotFound();
    return target;
  }

  // GET /overview: who can be managed, the Programs to choose from, and
  // what can be granted.
  async function overview(actorId) {
    return store.withTransaction(async (tx) => {
      await authorizeAdmin(tx, actorId);
      const programs = await programIndex(tx);
      return {
        users: (await tx.listUsers()).map((u) => toUserView(u, actorId)),
        programs: [...programs.values()]
          .filter((p) => p.lifecycleStatus !== 'RETIRED')
          .sort((a, b) => a.name.localeCompare(b.name) || (a.site ?? '').localeCompare(b.site ?? '')),
        grantable: Object.entries(GRANTABLE).map(([permission, rule]) => ({
          permission, label: rule.label, scopeType: rule.scopeType,
        })),
      };
    });
  }

  // GET /users/:userId/grants
  async function getUserGrants(actorId, targetId) {
    return store.withTransaction(async (tx) => {
      await authorizeAdmin(tx, actorId);
      const target = await loadTarget(tx, targetId);
      const programs = await programIndex(tx);
      return {
        user: toUserView(target, actorId),
        canChange: target.userId !== actorId,
        grants: await currentGrants(tx, target.userId, programs),
      };
    });
  }

  // POST /users/:userId/grants  { permission, programId? }
  async function grant(actorId, targetId, body, { correlationId = null } = {}) {
    // The request's shape is checked first, for everyone, like every other
    // write route: it depends on nothing stored, so it reveals nothing.
    const validation = validateGrantRequest(body);
    if (!validation.ok) throwInvalid(validation);
    const { permission, scopeType, programId } = validation.value;
    return store.withTransaction(async (tx) => {
      await tx.holdPermissionAdministration();
      await authorizeAdmin(tx, actorId);
      // REQUIRED: no self-elevation (PRD 3.8, frozen handoff contract).
      if (targetId === actorId) throw permissionErrors.selfChange();

      const target = await loadTarget(tx, targetId);
      if (!target.isActive) throw permissionErrors.targetNotActive();
      if (scopeType === 'PROGRAM') {
        const program = await tx.getProgram(programId);
        if (!program || program.lifecycleStatus === 'RETIRED') throw permissionErrors.invalidRequest(['programId']);
      }

      const programs = await programIndex(tx);
      const active = await tx.getActiveGrants(target.userId);
      // Only an IN_APP grant is a duplicate. A DEMO grant is ignored outside
      // development and test, so it must not stop a real grant being made.
      const duplicate = active.some((g) => g.grantSource === 'IN_APP' && g.permission === permission
        && g.scopeType === scopeType && (g.programId ?? null) === programId && (g.departmentId ?? null) === null);
      if (duplicate) {
        throw permissionErrors.alreadyGranted(sortGrants(active.map((g) => toGrantView(g, programs))));
      }

      const created = await tx.insertGrant({
        userId: target.userId, permission, scopeType, programId, departmentId: null, grantSource: 'IN_APP',
      });
      await tx.appendAuditEvent({
        entityType: 'USER_GRANT',
        entityId: created.grantId,
        action: 'GRANTED',
        actorUserId: actorId,
        before: null,
        after: { user_id: target.userId, permission, scope_type: scopeType, program_id: programId, grant_source: 'IN_APP' },
        correlationId,
      });
      const grants = sortGrants([...active, created].map((g) => toGrantView(g, programs)));
      return { status: 'GRANTED', grant: toGrantView(created, programs), grants };
    });
  }

  // POST /users/:userId/grants/:grantId/revoke  (empty body)
  async function revoke(actorId, targetId, grantId, body, { correlationId = null } = {}) {
    const validation = validateRevokeRequest(body);
    if (!validation.ok) throwInvalid(validation);
    return store.withTransaction(async (tx) => {
      await tx.holdPermissionAdministration();
      await authorizeAdmin(tx, actorId);
      // TEAM RESTRICTION, not approved QCH policy (pending QCH confirmation): removing
      // your own permissions is not self-elevation; refused only by team choice.
      if (targetId === actorId) throw permissionErrors.selfChange();

      const target = await loadTarget(tx, targetId);
      const programs = await programIndex(tx);
      const active = await tx.getActiveGrants(target.userId);
      const views = () => sortGrants(active.map((g) => toGrantView(g, programs)));
      const existing = positiveInt(grantId) ? active.find((g) => g.grantId === grantId) : null;
      if (!existing) throw permissionErrors.grantChanged(views());
      if (!isRevocable(existing)) throw permissionErrors.notRevocable(views());

      const revoked = await tx.revokeGrant({ grantId, userId: target.userId });
      if (!revoked) throw permissionErrors.grantChanged(views());
      await tx.appendAuditEvent({
        entityType: 'USER_GRANT',
        entityId: grantId,
        action: 'REVOKED',
        actorUserId: actorId,
        before: {
          user_id: target.userId, permission: existing.permission, scope_type: existing.scopeType,
          program_id: existing.programId ?? null, grant_source: existing.grantSource, revoked_at: null,
        },
        after: { revoked_at: revoked.revokedAt },
        correlationId,
      });
      const grants = sortGrants(active.filter((g) => g.grantId !== grantId).map((g) => toGrantView(g, programs)));
      return { status: 'REVOKED', grants };
    });
  }

  return Object.freeze({ overview, getUserGrants, grant, revoke });
}
