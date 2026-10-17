// Canonical referral-creation transaction for Direct Referral
// (Final Technical PRD 2.2, 3.2, 3.6, 3.9, 6.1, 6.2, 7.2, 7.3, 9.1, 9.3, 9.6).
//
// Sequence (PRD 2.2): validate -> authorize -> verify receiving Program
// -> transaction -> create referral + permanent Referral ID -> commit.
// Notification is triggered only after commit, by a later card (PRD 11.4).
//
// - Identity is the server-derived userId only (PRD 3.2). CREATE_REFERRAL
//   needs app access only, which an active user has (PRD 3.6).
// - The Referring Program is the user's current affiliation, resolved
//   inside the transaction (PRD 3.9; card 2).
// - Original Referring/Receiving Program and Department facts are copied
//   onto the referral and never rewritten later (PRD 9.1).
// - A unique Submission ID makes retries safe: the same logical request
//   never creates a second referral (PRD 7.3). The database unique
//   constraint (uq_referrals_submission) is the final guard against
//   concurrent duplicates.
// - Every new referral starts AWAITING_RESPONSE / no decision /
//   NOT_RECORDED, source DIRECT (PRD 6.2). The client cannot set these.
// - The audit event holds IDs only, never participant data (PRD 5.4, 9.6).

import { createAffiliationService } from '../affiliation/affiliationService.js';
import { errors as affiliationErrors } from '../affiliation/errors.js';
import { DuplicateSubmissionError, referralErrors } from './errors.js';
import { validateDirectReferral } from './validateReferral.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Fields that must match for a repeated Submission ID to count as the same
// logical request. Server-derived values (Referring Program, timestamps)
// are excluded.
const SAME_REQUEST_FIELDS = [
  'receivingProgramId',
  'participantName',
  'contactMethod',
  'contactValue',
  'participantZip',
  'referralContext',
  'notes',
];

// Minimum-necessary confirmation returned to the browser (PRD 10.5).
// No participant data is echoed back.
function toConfirmation(row) {
  return {
    referralId: row.referralId,
    submissionId: row.submissionId,
    receivingProgramId: row.receivingProgramId,
    referringProgramId: row.referringProgramId,
    responseStatus: row.responseStatus,
    createdAt: row.createdAt,
  };
}

async function requireActiveUser(store, userId) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw referralErrors.notAuthenticated();
  const user = await store.getUser(userId);
  if (!user || !user.isActive) throw affiliationErrors.userNotActive();
  return user;
}

async function getSelectableProgram(store, programId) {
  const program = await store.getProgram(programId);
  if (!program || program.lifecycleStatus !== 'ACTIVE') return null;
  const department = await store.getDepartment(program.departmentId);
  if (!department || department.lifecycleStatus !== 'ACTIVE') return null;
  return { program, department };
}

export function createReferralService({ store }) {
  if (!store) throw new Error('createReferralService requires a store');

  // A repeated Submission ID from the same user with the same content is a
  // retry: return the referral that already exists. Anything else is a
  // conflict, reported without revealing the other referral.
  function replay(existing, userId, request) {
    if (existing.createdByUserId !== userId) throw referralErrors.submissionIdConflict();
    for (const field of SAME_REQUEST_FIELDS) {
      if ((existing[field] ?? null) !== (request[field] ?? null)) {
        throw referralErrors.submissionIdConflict();
      }
    }
    return { status: 'ALREADY_RECEIVED', referral: toConfirmation(existing) };
  }

  async function createDirectReferral(userId, body, { correlationId = null } = {}) {
    if (!Number.isSafeInteger(userId) || userId <= 0) throw referralErrors.notAuthenticated();

    const validation = validateDirectReferral(body);
    if (!validation.ok) throw referralErrors.invalidRequest(validation.fields);
    const request = validation.value;

    try {
      return await store.withTransaction(async (tx) => {
        await requireActiveUser(tx, userId);

        const existing = await tx.getReferralBySubmissionId(request.submissionId);
        if (existing) return replay(existing, userId, request);

        // Referring Program = current affiliation, checked inside the
        // transaction so a concurrent affiliation change cannot slip in.
        const referring = await createAffiliationService({ store: tx })
          .resolveReferringProgram(userId, request.referringProgramId);

        const receiving = await getSelectableProgram(tx, request.receivingProgramId);
        if (!receiving) throw referralErrors.receivingProgramNotSelectable();

        const row = await tx.insertReferral({
          submissionId: request.submissionId,
          source: 'DIRECT',
          createdByUserId: userId,
          referringProgramId: referring.referringProgramId,
          referringDepartmentId: referring.referringDepartmentId,
          receivingProgramId: receiving.program.programId,
          receivingDepartmentId: receiving.department.departmentId,
          participantName: request.participantName,
          contactMethod: request.contactMethod,
          contactValue: request.contactValue,
          participantZip: request.participantZip,
          referralContext: request.referralContext,
          notes: request.notes,
          responseStatus: 'AWAITING_RESPONSE',
          decision: null,
          serviceOutcome: 'NOT_RECORDED',
        });

        await tx.appendAuditEvent({
          entityType: 'REFERRAL',
          entityId: row.referralId,
          action: 'CREATED',
          actorUserId: userId,
          before: null,
          after: {
            source: 'DIRECT',
            referring_program_id: row.referringProgramId,
            receiving_program_id: row.receivingProgramId,
            referring_department_id: row.referringDepartmentId,
            receiving_department_id: row.receivingDepartmentId,
          },
          correlationId,
        });

        return { status: 'RECEIVED', referral: toConfirmation(row) };
      });
    } catch (err) {
      // Lost race: another request with the same Submission ID committed
      // first. Our transaction rolled back; answer from the committed row.
      if (err instanceof DuplicateSubmissionError) {
        const existing = await store.getReferralBySubmissionId(request.submissionId);
        if (existing) return replay(existing, userId, request);
      }
      throw err;
    }
  }

  // Safe check after an unconfirmed submission (PRD 7.4): was this
  // Submission ID received for this user? Another user's Submission ID is
  // reported as not received, so nothing is revealed.
  async function checkSubmission(userId, submissionId) {
    await requireActiveUser(store, userId);
    if (typeof submissionId !== 'string' || !UUID.test(submissionId)) {
      throw referralErrors.invalidRequest(['submissionId']);
    }
    const existing = await store.getReferralBySubmissionId(submissionId.toLowerCase());
    if (!existing || existing.createdByUserId !== userId) {
      return { status: 'NOT_RECEIVED', referral: null };
    }
    return { status: 'RECEIVED', referral: toConfirmation(existing) };
  }

  return Object.freeze({ createDirectReferral, checkSubmission });
}
