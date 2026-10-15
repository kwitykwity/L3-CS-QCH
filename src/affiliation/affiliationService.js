// Program listing and staff-selected Program affiliation
// (Final Technical PRD 3.2, 3.9, 4.4, 9.1, 9.6, 10.3, 10.5).
//
// Rules implemented here:
// - Only ACTIVE Programs can be listed for selection or chosen as an
//   affiliation (PRD 4.4: discontinued items are excluded from new
//   operational choices).
// - Staff choose their own Program affiliation (QCH, Oct 14). Nothing is
//   preselected: a user with no affiliation gets null, never a default
//   (PRD 3.9).
// - The user is always the server-derived identity. The request body can
//   only carry `programId` (PRD 3.2, 10.3).
// - A referral's Referring Program is the submitter's current affiliation.
//   The client cannot choose a different one (PRD 3.9).
// - Changing an affiliation only changes the user's stored current
//   Program. Past referrals keep their own referring_program_id, so they
//   are never rewritten (PRD 9.1).
//
// The store is injected so this logic is testable without a database.
// See memoryStore.js for the contract.

import { errors } from './errors.js';

const ACTIVE = 'ACTIVE';

// Minimum-necessary Program fields for selection lists (PRD 10.5).
// Routing details such as notification_email are never returned.
function toProgramSummary(program, department) {
  return {
    programId: program.programId,
    name: program.name,
    site: program.site ?? null,
    departmentId: department.departmentId,
    departmentName: department.name,
  };
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function createAffiliationService({ store }) {
  if (!store) {
    throw new Error('createAffiliationService requires a store');
  }

  async function requireActiveUser(userId) {
    if (!isPositiveInteger(userId)) throw errors.notAuthenticated();
    const user = await store.getUser(userId);
    if (!user || !user.isActive) throw errors.userNotActive();
    return user;
  }

  // A Program is selectable only when it and its Department are ACTIVE.
  async function getSelectableProgram(programId) {
    const program = await store.getProgram(programId);
    if (!program || program.lifecycleStatus !== ACTIVE) return null;
    const department = await store.getDepartment(program.departmentId);
    if (!department || department.lifecycleStatus !== ACTIVE) return null;
    return { program, department };
  }

  async function listActivePrograms() {
    const rows = await store.listActivePrograms();
    return rows
      .map(({ program, department }) => toProgramSummary(program, department))
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name) ||
          (a.site ?? '').localeCompare(b.site ?? '') ||
          a.programId - b.programId,
      );
  }

  async function getAffiliation(userId) {
    const user = await requireActiveUser(userId);

    if (user.currentProgramId == null) {
      return { status: 'NOT_SET', program: null };
    }

    const selectable = await getSelectableProgram(user.currentProgramId);
    if (!selectable) {
      // The stored Program was discontinued or retired after it was chosen.
      // The user must choose again before making a referral.
      return { status: 'PROGRAM_NOT_ACTIVE', program: null };
    }

    return {
      status: 'SET',
      program: toProgramSummary(selectable.program, selectable.department),
    };
  }

  // `body` is the raw request body. Only { programId } is accepted.
  async function setAffiliation(userId, body, { correlationId } = {}) {
    const user = await requireActiveUser(userId);

    if (
      body === null ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !Object.hasOwn(body, 'programId') ||
      !isPositiveInteger(body.programId)
    ) {
      throw errors.invalidRequest();
    }

    const selectable = await getSelectableProgram(body.programId);
    if (!selectable) throw errors.programNotSelectable();

    if (user.currentProgramId !== body.programId) {
      // The store must update the user and append the audit event in one
      // transaction (PRD 9.3, 9.6).
      await store.updateUserProgramAffiliation({
        userId: user.userId,
        fromProgramId: user.currentProgramId ?? null,
        toProgramId: body.programId,
        actorUserId: user.userId,
        correlationId: correlationId ?? null,
      });
    }

    return {
      status: 'SET',
      program: toProgramSummary(selectable.program, selectable.department),
    };
  }

  // For the referral submission pipeline (Direct Referral card and GPME).
  // Returns the Referring Program and its Department at this moment, which
  // the referral then stores permanently.
  //
  // `submittedReferringProgramId` is whatever the client sent, if anything.
  // It is never trusted: if present it must equal the current affiliation.
  //
  // Call this inside the referral-creation transaction so an affiliation
  // change cannot land between this check and the insert.
  async function resolveReferringProgram(userId, submittedReferringProgramId) {
    const user = await requireActiveUser(userId);

    if (user.currentProgramId == null) throw errors.affiliationRequired();

    const selectable = await getSelectableProgram(user.currentProgramId);
    if (!selectable) throw errors.affiliationProgramNotActive();

    if (
      submittedReferringProgramId !== undefined &&
      submittedReferringProgramId !== null &&
      submittedReferringProgramId !== user.currentProgramId
    ) {
      throw errors.referringProgramMismatch();
    }

    return Object.freeze({
      referringProgramId: selectable.program.programId,
      referringDepartmentId: selectable.department.departmentId,
    });
  }

  return Object.freeze({
    listActivePrograms,
    getAffiliation,
    setAffiliation,
    resolveReferringProgram,
  });
}
