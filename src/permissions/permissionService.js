// Permission administration (Trello Task Y).
//
// Governing requirements: Frozen Handoff PRD 23 (Authorization) and 24
// (Permission Administration); Handoff MVP 22, 23; acceptance gates 27 and
// 28; Current Handoff Wireframes screen 16. Permission changes must be
// authorized server-side, validate the target user, validate Program scope,
// preserve least privilege, prevent self-elevation and create audit
// evidence. "Implementation-specific restrictions beyond these requirements
// must not be treated as QCH policy unless QCH approves them" (PRD 24).
//
// Each rule below names what governs it. Rules with an OPEN QUESTION keep
// the narrower behavior only because the frozen documents do not define the
// wider one; they are not QCH policy. The questions are listed in the README
// ("Permission administration").
//
// - Administrator check: ADMINISTER_PERMISSIONS, read inside the
//   transaction, from server-side identity. PRD 23 ("administrative
//   permission management must itself require authorized administrative
//   capability"), 24, MVP 22, 23.
// - Only an ORGANIZATION-scope ADMINISTER_PERMISSIONS counts. The documents
//   describe "authorized QCH administrators" and define no Program- or
//   Department-limited administrator, so a scoped copy grants nothing
//   (least privilege, PRD 24). OPEN QUESTION Q2.
// - No self-elevation: nobody can ADD a permission to themselves. PRD 23,
//   24; MVP 22, 23; wireframe 16. Removing your own permission is allowed:
//   it is not elevation and nothing in the documents forbids it.
// - Target user must exist (PRD 24 "validate the target user"); new grants
//   only for ACTIVE users (same rule, read with least privilege), while
//   removal works for inactive users so access can be cleaned up. OPEN
//   QUESTION Q3 on the active-only reading.
// - Program scope: each permission has one scope the app honors; a
//   Program-scope grant needs a Program that exists and is not RETIRED. PRD
//   24 "validate relevant Program scope"; MVP 22 "no trust in
//   browser-supplied authorization claims" (the browser never picks the
//   scope).
// - New grants are always IN_APP; DEMO grants are read-only here. Demo
//   access is set by the demo seed and reset, and is ignored outside
//   development and test (PRD 22 and MVP 22: development/demo identity stays
//   distinguishable from production; PRD 34 environment separation).
// - ADMINISTER_PERMISSIONS itself is not granted or removed on this screen.
//   PRD 24 says administrators manage "appropriate" permissions and does not
//   say whether that includes the administrator capability; production
//   users, groups and permissions are a QCH IT production dependency (PRD 37
//   item 6, MVP 31 item 7). Not built pending OPEN QUESTION Q1; not QCH policy.
//
// Every change (audit evidence: Handoff PRD 24, 26): one transaction. Hold permission
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

  // What the screen shows for one grant (data minimization, Handoff PRD 34).
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
        // Adding to yourself would be self-elevation (Handoff PRD 23, 24).
        // Removing your own permissions is allowed: it cannot raise anyone's
        // authority.
        canAdd: target.userId !== actorId,
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
      // REQUIRED: no self-elevation (Handoff PRD 23, 24; MVP 22, 23).
      if (targetId === actorId) throw permissionErrors.selfElevation();

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
      // Removing your own permission is allowed: it is not self-elevation,
      // and the frozen documents require only that (Handoff PRD 24; MVP 23).
      // The administrator capability itself is not removable here (see
      // isRevocable), so nobody can remove their own administrator rights.

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
