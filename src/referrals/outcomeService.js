// Service outcome and authorized corrections (Trello card 8)
// (Final Technical PRD 2.4, 3.3, 3.6, 5.4, 6.1, 6.2, 6.4, 6.5, 9.3, 9.4,
// 9.6, 10.3, 10.5, 12.4, 13.4).
//
// Three actions, each its own capability for the referral's receiving
// Program (PRD 3.6). None implies another, and none implies view:
//
// 1. recordOutcome       RECORD_OUTCOME
//    RESPONDED + ACCEPTED + NOT_RECORDED
//      -> RESULTED_IN_SERVICE or DID_NOT_RESULT_IN_SERVICE.
//    Accepted does not mean service occurred (PRD 6.1): the receiving
//    Program records it. A Not Appropriate referral cannot receive an
//    outcome until an authorized correction changes the decision to
//    Accepted (PRD 6.5). An outcome that is already recorded is changed
//    only through correctOutcome.
//
// 2. correctOutcome      CORRECT_OUTCOME (Service Outcome only)
//    Accepted referral with a recorded outcome -> a different outcome,
//    including back to NOT_RECORDED if it was recorded by mistake.
//
// 3. correctResponse     UPDATE_RECEIVED_REFERRAL (Response/Decision)
//    RESPONDED -> a different decision, or a different Not Appropriate
//    reason/explanation. The response stays RESPONDED; there is no
//    correction back to Awaiting Response. Changing to Not Appropriate is
//    refused while a service outcome is recorded, because Not Appropriate
//    cannot carry an outcome (PRD 6.5) and the outcome is never cleared
//    silently: the worker corrects the outcome first (PRD 13.4).
//
// Rules shared by all three (PRD 6.4, 9.3, 9.4, 9.6):
// - The server loads the authoritative row, checks authorization, checks
//   the transition, writes the change and its audit event in ONE
//   transaction, and returns the confirmed state.
// - Corrections must send the `version` the worker last saw. A stale
//   version is refused with 409 REFERRAL_CHANGED and the current state;
//   nothing is written (PRD 9.4, 13.4).
// - The audit event keeps the prior and new values (PRD 6.2 "prior value
//   remains in audit history"). The Not Appropriate explanation is
//   sensitive (PRD 5.4, 6.5) and is never copied into audit history;
//   only whether one exists.
// - first_responded_at and first_resulted_in_service_at are set once and
//   never rewritten by a correction (PRD 12.4).
// - Users who cannot view the referral get the same 404 as a missing
//   referral; viewers without the capability get 403 (PRD 3.3).

import { errors as affiliationErrors } from '../affiliation/errors.js';
import {
  CORRECT_OUTCOME, RECORD_OUTCOME, UPDATE_RECEIVED,
  programIdsWithCapability, receivingProgramIds, referralAccess,
} from '../authorization/referralAccess.js';
import { referralErrors } from './errors.js';
import { validateResponse } from './responseService.js';
import { stageOf } from './stage.js';

export const RECORDED_OUTCOMES = Object.freeze(['RESULTED_IN_SERVICE', 'DID_NOT_RESULT_IN_SERVICE']);
export const OUTCOMES = Object.freeze(['NOT_RECORDED', ...RECORDED_OUTCOMES]);
const VERSION_MAX = 64;

// Returns { ok: true, value }, { ok: false, fields } (allowlisted names
// only) or { ok: false, unexpectedField: true } (name never echoed).
function readBody(body, allowedKeys) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false, fields: [] };
  if (Object.keys(body).some((k) => !allowedKeys.includes(k))) return { ok: false, unexpectedField: true };
  return { ok: true };
}

const validVersion = (v) => typeof v === 'string' && v.length > 0 && v.length <= VERSION_MAX;

export function validateRecordOutcome(body) {
  const shape = readBody(body, ['outcome']);
  if (!shape.ok) return shape;
  if (!RECORDED_OUTCOMES.includes(body.outcome)) return { ok: false, fields: ['outcome'] };
  return { ok: true, value: { outcome: body.outcome } };
}

export function validateCorrectOutcome(body) {
  const shape = readBody(body, ['outcome', 'version']);
  if (!shape.ok) return shape;
  const fields = [];
  if (!OUTCOMES.includes(body.outcome)) fields.push('outcome');
  if (!validVersion(body.version)) fields.push('version');
  if (fields.length > 0) return { ok: false, fields };
  return { ok: true, value: { outcome: body.outcome, version: body.version } };
}

// Same decision/reason/explanation rules as the first response (card 7),
// plus the required version.
export function validateCorrectResponse(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false, fields: [] };
  const { version, ...rest } = body;
  const inner = validateResponse(rest);
  if (!inner.ok && inner.unexpectedField) return inner;
  const fields = inner.ok ? [] : [...inner.fields];
  if (!validVersion(version)) fields.push('version');
  if (fields.length > 0) return { ok: false, fields };
  return { ok: true, value: { ...inner.value, version } };
}

function throwInvalid(validation) {
  throw validation.unexpectedField
    ? referralErrors.unexpectedField()
    : referralErrors.invalidRequest(validation.fields);
}

// Minimum-necessary confirmed state (PRD 10.5, 13.3). No participant data
// and never the explanation text.
function confirmation(row, reason) {
  return {
    referralId: row.referralId,
    version: row.version,
    responseStatus: row.responseStatus,
    decision: row.decision ?? null,
    serviceOutcome: row.serviceOutcome,
    stage: stageOf(row),
    outcomeRecordedAt: row.outcomeRecordedAt ?? null,
    notAppropriateReason: reason ? { reasonId: reason.reasonId, label: reason.label } : null,
    hasExplanation: Boolean(row.notAppropriateExplanation),
  };
}

export function createOutcomeService({ store, allowDemoGrants = false }) {
  if (!store) throw new Error('createOutcomeService requires a store');

  async function requireActiveUser(reader, userId) {
    if (!Number.isSafeInteger(userId) || userId <= 0) throw referralErrors.notAuthenticated();
    const user = await reader.getUser(userId);
    if (!user || !user.isActive) throw affiliationErrors.userNotActive();
    return user;
  }

  // Loads the row and checks `capability` for its receiving Program, all
  // inside the transaction (grants are a locking read, as in card 7).
  async function authorize(tx, userId, referralId, capability) {
    await requireActiveUser(tx, userId);
    const row = await tx.getReferralById(referralId);
    if (!row) throw referralErrors.referralNotFound();
    const grants = await tx.getActiveGrants(userId);
    const access = referralAccess(userId, row, receivingProgramIds(grants, { allowDemoGrants }));
    const allowed = programIdsWithCapability(grants, capability, { allowDemoGrants }).has(row.receivingProgramId);
    if (!allowed) throw access.canView ? referralErrors.notAuthorizedForAction() : referralErrors.referralNotFound();
    return { row, canView: access.canView };
  }

  async function reasonFor(tx, reasonId) {
    return reasonId == null ? null : tx.getNotAppropriateReason(reasonId);
  }

  // The current state for a 409, only for users who may view the referral.
  async function staleError(tx, referralId, canView) {
    if (!canView) return referralErrors.referralChanged(undefined);
    const now = await tx.getReferralById(referralId);
    return referralErrors.referralChanged(confirmation(now, await reasonFor(tx, now.notAppropriateReasonId)));
  }

  function checkIds(userId, referralId) {
    if (!Number.isSafeInteger(userId) || userId <= 0) throw referralErrors.notAuthenticated();
    if (!Number.isSafeInteger(referralId) || referralId <= 0) throw referralErrors.referralNotFound();
  }

  // 1. First recording of the service outcome.
  async function recordOutcome(userId, referralId, body, { correlationId = null } = {}) {
    checkIds(userId, referralId);
    const validation = validateRecordOutcome(body);
    if (!validation.ok) throwInvalid(validation);
    const { outcome } = validation.value;

    return store.withTransaction(async (tx) => {
      const { row } = await authorize(tx, userId, referralId, RECORD_OUTCOME);

      if (row.responseStatus !== 'RESPONDED') throw referralErrors.outcomeNeedsAcceptance();
      if (row.decision !== 'ACCEPTED') throw referralErrors.outcomeNeedsAcceptance();
      if (row.serviceOutcome !== 'NOT_RECORDED') throw referralErrors.outcomeAlreadyRecorded();

      // Conditional on the state checked above, so a concurrent decision
      // correction or a second recorder cannot slip in between.
      const updated = await tx.updateReferral({
        referralId,
        when: { responseStatus: 'RESPONDED', decision: 'ACCEPTED', serviceOutcome: 'NOT_RECORDED' },
        set: { serviceOutcome: outcome, outcomeRecordedByUserId: userId },
        setNow: ['outcomeRecordedAt'],
        setNowIfNull: outcome === 'RESULTED_IN_SERVICE' ? ['firstResultedInServiceAt'] : [],
      });
      if (!updated) {
        const now = await tx.getReferralById(referralId);
        if (now.decision !== 'ACCEPTED') throw referralErrors.outcomeNeedsAcceptance();
        throw referralErrors.outcomeAlreadyRecorded();
      }

      await tx.appendAuditEvent({
        entityType: 'REFERRAL',
        entityId: referralId,
        action: 'SERVICE_OUTCOME_RECORDED',
        actorUserId: userId,
        before: { service_outcome: 'NOT_RECORDED' },
        after: { service_outcome: outcome },
        correlationId,
      });

      return { status: 'OUTCOME_RECORDED', referral: confirmation(updated, null) };
    });
  }

  // 2. Correct a recorded Service Outcome (CORRECT_OUTCOME only).
  async function correctOutcome(userId, referralId, body, { correlationId = null } = {}) {
    checkIds(userId, referralId);
    const validation = validateCorrectOutcome(body);
    if (!validation.ok) throwInvalid(validation);
    const { outcome, version } = validation.value;

    return store.withTransaction(async (tx) => {
      const { row, canView } = await authorize(tx, userId, referralId, CORRECT_OUTCOME);

      if (row.version !== version) throw await staleError(tx, referralId, canView);
      if (row.decision !== 'ACCEPTED') throw referralErrors.outcomeNeedsAcceptance();
      if (row.serviceOutcome === 'NOT_RECORDED') throw referralErrors.outcomeNotRecorded();
      if (row.serviceOutcome === outcome) throw referralErrors.noChange();

      const recorded = outcome !== 'NOT_RECORDED';
      const updated = await tx.updateReferral({
        referralId,
        when: { version },
        set: {
          serviceOutcome: outcome,
          outcomeRecordedByUserId: recorded ? userId : null,
          ...(recorded ? {} : { outcomeRecordedAt: null }),
        },
        setNow: recorded ? ['outcomeRecordedAt'] : [],
        // Set the first time service is recorded; never rewritten (PRD 12.4).
        setNowIfNull: outcome === 'RESULTED_IN_SERVICE' ? ['firstResultedInServiceAt'] : [],
      });
      if (!updated) throw await staleError(tx, referralId, canView);

      await tx.appendAuditEvent({
        entityType: 'REFERRAL',
        entityId: referralId,
        action: 'CORRECTED',
        actorUserId: userId,
        before: { field: 'SERVICE_OUTCOME', service_outcome: row.serviceOutcome },
        after: { field: 'SERVICE_OUTCOME', service_outcome: outcome },
        correlationId,
      });

      return { status: 'CORRECTED', referral: confirmation(updated, await reasonFor(tx, updated.notAppropriateReasonId)) };
    });
  }

  // 3. Correct the Response/Decision (UPDATE_RECEIVED_REFERRAL).
  async function correctResponse(userId, referralId, body, { correlationId = null } = {}) {
    checkIds(userId, referralId);
    const validation = validateCorrectResponse(body);
    if (!validation.ok) throwInvalid(validation);
    const { decision, reasonId, explanation, version } = validation.value;

    return store.withTransaction(async (tx) => {
      const { row, canView } = await authorize(tx, userId, referralId, UPDATE_RECEIVED);

      if (row.version !== version) throw await staleError(tx, referralId, canView);
      if (row.responseStatus !== 'RESPONDED') throw referralErrors.notResponded();

      let reason = null;
      if (decision === 'NOT_APPROPRIATE') {
        if (row.serviceOutcome !== 'NOT_RECORDED') throw referralErrors.outcomeBlocksDecision();
        reason = await tx.getNotAppropriateReason(reasonId);
        // Keeping the same, now discontinued, reason is allowed only when
        // nothing about the reason changes; choosing it anew is not (PRD 4.4).
        const keepsCurrentReason = row.decision === 'NOT_APPROPRIATE' && row.notAppropriateReasonId === reasonId;
        if (!reason || (reason.lifecycleStatus !== 'ACTIVE' && !keepsCurrentReason)) {
          throw referralErrors.reasonNotSelectable();
        }
        if (reason.requiresExplanation && !explanation) throw referralErrors.invalidRequest(['explanation']);
      }

      const next = {
        decision,
        notAppropriateReasonId: reason?.reasonId ?? null,
        notAppropriateExplanation: decision === 'NOT_APPROPRIATE' ? explanation : null,
      };
      const unchanged = row.decision === next.decision
        && (row.notAppropriateReasonId ?? null) === next.notAppropriateReasonId
        && (row.notAppropriateExplanation ?? null) === next.notAppropriateExplanation;
      if (unchanged) throw referralErrors.noChange();

      // Response stays RESPONDED; first_responded_at is untouched (PRD 12.4).
      const updated = await tx.updateReferral({ referralId, when: { version }, set: next });
      if (!updated) throw await staleError(tx, referralId, canView);

      await tx.appendAuditEvent({
        entityType: 'REFERRAL',
        entityId: referralId,
        action: 'CORRECTED',
        actorUserId: userId,
        before: {
          field: 'DECISION',
          decision: row.decision,
          not_appropriate_reason_id: row.notAppropriateReasonId ?? null,
          has_explanation: Boolean(row.notAppropriateExplanation),
        },
        after: {
          field: 'DECISION',
          decision,
          not_appropriate_reason_id: next.notAppropriateReasonId,
          has_explanation: Boolean(next.notAppropriateExplanation),
        },
        correlationId,
      });

      return { status: 'CORRECTED', referral: confirmation(updated, reason) };
    });
  }

  return Object.freeze({ recordOutcome, correctOutcome, correctResponse });
}
