// Canonical referral-creation transaction for both entry paths, Direct
// Referral and GPME-assisted (Final Technical PRD 2.1, 2.2, 3.2, 3.6, 3.9,
// 6.1, 6.2, 7.2, 7.3, 8.1, 8.7, 9.1, 9.3, 9.6; cards 3 and 11).
//
// Sequence (PRD 2.2): validate -> authorize -> verify receiving Program
// -> transaction -> create referral + permanent Referral ID -> commit
// -> notification (PRD 11.4).
//
// Notification (Task E): after the transaction has committed, the
// optional `notifier` (src/notifications/notificationService.js) is
// started for the referral and NOT awaited. The caller gets its answer
// without waiting for email, and nothing the notifier does can change,
// delay or undo the referral (PRD 6.2, 11.6). It runs for a retry of the
// same Submission ID too: the notifier keeps one delivery per referral, so
// a repeat never sends twice, and it fills the gap if the first request
// stopped between the commit and the notification. Only IDs are passed;
// the recipient is looked up server-side (PRD 11.3).
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
//   NOT_RECORDED (PRD 6.2). The client cannot set these or `source`.
// - GPME-assisted (card 11): the request carries the worker's matching
//   answers in `gpme`. Inside the same transaction the server re-runs GPME
//   with current Program data and the current rule version and checks that
//   the receiving Program is among the results. Only then is the referral
//   saved, with source GPME_ASSISTED and a GPME evaluation record (rule
//   version, the listed Programs, their explanations, which one was
//   selected) so the recommendation can be explained later (PRD 8.7, 9.1).
//   The matching answers themselves are never stored (PRD 5.3). Everything
//   after matching is the same pipeline as Direct Referral (PRD 2.2).
// - The audit event holds IDs only, never participant data (PRD 5.4, 9.6).

import { createAffiliationService } from '../affiliation/affiliationService.js';
import { errors as affiliationErrors } from '../affiliation/errors.js';
import { DuplicateSubmissionError, referralErrors } from './errors.js';
import { validateDirectReferral } from './validateReferral.js';
import { safeErrorKind } from '../gpme/gpmeService.js';
import { GPME_RULE_VERSION, MATCH_STATUS, matchPrograms } from '../gpme/matchPrograms.js';

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
function sourceOf(request) {
  return request.gpme ? 'GPME_ASSISTED' : 'DIRECT';
}

// What gets kept about a GPME recommendation (dbo.gpme_evaluation_results):
// Program facts and explanations only, never the participant's answers.
// Explanations are built from Program facts (src/gpme/matchPrograms.js).
function toEvaluation(result, receivingProgramId) {
  const listed = [
    ...result.plausible.map((p) => ({ ...p, group: 'PLAUSIBLE' })),
    ...result.possible.map((p) => ({ ...p, group: 'POSSIBLE' })),
  ];
  return {
    ruleVersion: result.ruleVersion,
    results: listed.map((p, index) => ({
      programId: p.programId,
      displayOrder: index + 1,
      explanation: p.explanations.join('; '),
      programContext: {
        group: p.group,
        programName: p.name,
        site: p.site,
        departmentId: p.departmentId,
        departmentName: p.departmentName,
        explanations: [...p.explanations],
      },
      wasSelected: p.programId === receivingProgramId,
    })),
  };
}

function defaultLogGpmeFailure(err) {
  console.error(`[referrals] GPME re-check unavailable (${safeErrorKind(err)})`);
}

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

function defaultLogNotifyFailure(err) {
  console.error(`[referrals] notification could not be started (${safeErrorKind(err)})`);
}

export function createReferralService({
  store, gpmeRuleVersion = GPME_RULE_VERSION, logGpmeFailure = defaultLogGpmeFailure,
  notifier = null, logNotifyFailure = defaultLogNotifyFailure,
} = {}) {
  if (!store) throw new Error('createReferralService requires a store');

  // Starts the notification for a committed referral, on a later tick,
  // without waiting for it. Never throws into the referral path.
  function notifyCommitted(referralId, correlationId) {
    if (!notifier) return;
    Promise.resolve()
      .then(() => notifier.notifyReferralCommitted({ referralId, correlationId }))
      .catch((err) => {
        try { logNotifyFailure(err); } catch { /* logging must not throw either */ }
      });
  }

  // Re-runs GPME inside the referral transaction (card 11). Returns the
  // evaluation to save, or throws a fixed error. A technical failure is
  // GPME_UNAVAILABLE, never "result changed" (PRD 8.5).
  async function confirmGpmeRecommendation(tx, gpme, receivingProgramId) {
    let needCategories;
    let candidates;
    try {
      needCategories = await tx.listNeedCategories();
      candidates = await tx.listMatchablePrograms();
    } catch (err) {
      logGpmeFailure(err);
      throw referralErrors.gpmeUnavailable();
    }

    const active = new Set(
      needCategories.filter((c) => c.lifecycleStatus === 'ACTIVE').map((c) => c.needCategoryId),
    );
    if (!gpme.needCategoryIds.every((id) => active.has(id))) throw referralErrors.invalidRequest(['gpme']);

    let result;
    try {
      result = matchPrograms(gpme, { candidates, needCategories, ruleVersion: gpmeRuleVersion });
    } catch (err) {
      logGpmeFailure(err);
      throw referralErrors.gpmeUnavailable();
    }
    const listed = result.status === MATCH_STATUS.RESULTS
      && [...result.plausible, ...result.possible].some((p) => p.programId === receivingProgramId);
    if (!listed) throw referralErrors.gpmeResultChanged();
    return toEvaluation(result, receivingProgramId);
  }

  // A repeated Submission ID from the same user with the same content is a
  // retry: return the referral that already exists. Anything else is a
  // conflict, reported without revealing the other referral.
  function replay(existing, userId, request) {
    if (existing.createdByUserId !== userId) throw referralErrors.submissionIdConflict();
    // A Direct retry of a GPME-assisted Submission ID (or the reverse) is a
    // different logical request.
    if (existing.source !== sourceOf(request)) throw referralErrors.submissionIdConflict();
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
    if (!validation.ok) {
      throw validation.unexpectedField
        ? referralErrors.unexpectedField()
        : referralErrors.invalidRequest(validation.fields);
    }
    const request = validation.value;

    const result = await createInTransaction(userId, request, correlationId);
    // Only reached once the referral is committed (RECEIVED) or found
    // committed (ALREADY_RECEIVED).
    notifyCommitted(result.referral.referralId, correlationId);
    return result;
  }

  async function createInTransaction(userId, request, correlationId) {
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

        const source = sourceOf(request);
        let gpmeEvaluationId = null;
        let ruleVersion = null;
        if (request.gpme) {
          const evaluation = await confirmGpmeRecommendation(tx, request.gpme, receiving.program.programId);
          gpmeEvaluationId = await tx.insertGpmeEvaluation(evaluation);
          ruleVersion = evaluation.ruleVersion;
        }

        const row = await tx.insertReferral({
          submissionId: request.submissionId,
          source,
          gpmeEvaluationId,
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
            source,
            ...(gpmeEvaluationId === null ? {} : { gpme_evaluation_id: gpmeEvaluationId, gpme_rule_version: ruleVersion }),
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

  // createDirectReferral serves both entry paths (the name predates GPME).
  return Object.freeze({ createDirectReferral, checkSubmission });
}
