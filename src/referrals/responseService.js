// Receiving-Program response: Awaiting Response -> Accepted / Not Appropriate
// (Final Technical PRD 2.3, 3.3, 3.6, 5.4, 6.2, 6.4, 6.5, 9.1, 9.3, 9.6, 10.3).
//
// Server-side state authority (PRD 6.4): the browser asks; the server loads
// the authoritative referral, checks authorization, validates the
// transition, commits the change and its audit event in one transaction,
// and returns the confirmed state.
//
// Allowed transitions in this card (PRD 6.2):
//   AWAITING_RESPONSE -> RESPONDED + ACCEPTED
//   AWAITING_RESPONSE -> RESPONDED + NOT_APPROPRIATE (standard reason required)
// Anything already RESPONDED is refused (409). Changing an existing
// response is an "authorized correction" (PRD 6.5, UPDATE_RECEIVED_REFERRAL),
// which is a separate card. Nothing here or anywhere else changes state
// because time has passed (PRD 2.3, 6.2).
//
// Not Appropriate (PRD 6.5, CLIENT CONFIRMED Oct 14): a required standard
// reason from the configurable list, plus an optional free-text explanation
// that is sensitive like Notes: never logged, never copied into audit
// history, and returned only to users who may view the referral.
//
// Authorization (PRD 3.4, 3.6): RESPOND_TO_REFERRAL for the referral's
// receiving Program. Users who cannot view the referral at all get the same
// 404 as a missing referral (PRD 3.3).

import { errors as affiliationErrors } from '../affiliation/errors.js';
import {
  RESPOND, programIdsWithCapability, receivingProgramIds, referralAccess,
} from '../authorization/referralAccess.js';
import { referralErrors } from './errors.js';
import { stageOf } from './stage.js';

export const EXPLANATION_MAX = 1000; // dbo.referrals.not_appropriate_explanation NVARCHAR(1000)
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

// Returns { ok: true, value }, { ok: false, fields } naming allowlisted
// fields only, or { ok: false, unexpectedField: true } for a property
// outside the allowlist, whose name is never echoed (PRD 10.4, 15.4).
//
// explanation: omitted, null, '' or whitespace-only all mean "no
// explanation". Any other non-string (number, boolean, object, array) is
// an error, never silently dropped.
export function validateResponse(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false, fields: [] };

  const allowed = new Set(['decision', 'reasonId', 'explanation']);
  if (Object.keys(body).some((k) => !allowed.has(k))) return { ok: false, unexpectedField: true };

  const { decision } = body;
  if (decision === 'ACCEPTED') {
    // A reason or explanation only belongs to Not Appropriate. A blank or
    // whitespace-only explanation means "no explanation", exactly as it
    // does for Not Appropriate.
    const absent = (v) => v === undefined || v === null || v === '';
    const blankText = (v) => absent(v) || (typeof v === 'string' && v.trim() === '');
    const extra = [];
    if (!absent(body.reasonId)) extra.push('reasonId');
    if (!blankText(body.explanation)) extra.push('explanation');
    if (extra.length > 0) return { ok: false, fields: extra };
    return { ok: true, value: { decision, reasonId: null, explanation: null } };
  }

  if (decision !== 'NOT_APPROPRIATE') return { ok: false, fields: ['decision'] };

  const fields = [];
  const reasonId = Number.isSafeInteger(body.reasonId) && body.reasonId > 0 ? body.reasonId : null;
  if (reasonId === null) fields.push('reasonId');

  let explanation = null;
  if (body.explanation !== undefined && body.explanation !== null) {
    if (typeof body.explanation !== 'string') {
      fields.push('explanation');
    } else if (body.explanation.length > EXPLANATION_MAX) {
      // Counted as sent, like referral fields, so padding cannot exceed it.
      fields.push('explanation');
    } else {
      const text = body.explanation.trim();
      if (text.length > 0 && CONTROL_CHARS.test(text)) fields.push('explanation');
      else explanation = text.length > 0 ? text : null;
    }
  }

  if (fields.length > 0) return { ok: false, fields };
  return { ok: true, value: { decision, reasonId, explanation } };
}

export function createResponseService({ store, allowDemoGrants = false }) {
  if (!store) throw new Error('createResponseService requires a store');

  async function requireActiveUser(reader, userId) {
    if (!Number.isSafeInteger(userId) || userId <= 0) throw referralErrors.notAuthenticated();
    const user = await reader.getUser(userId);
    if (!user || !user.isActive) throw affiliationErrors.userNotActive();
    return user;
  }

  // The configured list staff choose from (PRD 6.5). Active reasons only.
  async function listReasons(userId) {
    await requireActiveUser(store, userId);
    const reasons = await store.listActiveNotAppropriateReasons();
    return { reasons: reasons.map(({ reasonId, label, requiresExplanation }) => ({ reasonId, label, requiresExplanation })) };
  }

  async function respond(userId, referralId, body, { correlationId = null } = {}) {
    if (!Number.isSafeInteger(userId) || userId <= 0) throw referralErrors.notAuthenticated();
    if (!Number.isSafeInteger(referralId) || referralId <= 0) throw referralErrors.referralNotFound();

    const validation = validateResponse(body);
    if (!validation.ok) {
      throw validation.unexpectedField
        ? referralErrors.unexpectedField()
        : referralErrors.invalidRequest(validation.fields);
    }
    const request = validation.value;

    return store.withTransaction(async (tx) => {
      await requireActiveUser(tx, userId);

      // 1. Authoritative state.
      const row = await tx.getReferralById(referralId);
      if (!row) throw referralErrors.referralNotFound();

      // 2. Authorization for this resource and action. Grants and the
      //    reason are read through the transaction with locking reads, so
      //    a revocation or reason discontinuation that starts now waits
      //    until this response commits or rolls back (see the store
      //    contract); one that committed earlier is seen here and refuses.
      const grants = await tx.getActiveGrants(userId);
      const access = referralAccess(userId, row, receivingProgramIds(grants, { allowDemoGrants }));
      const canRespond = programIdsWithCapability(grants, RESPOND, { allowDemoGrants }).has(row.receivingProgramId);
      if (!canRespond) {
        throw access.canView ? referralErrors.notAuthorizedToRespond() : referralErrors.referralNotFound();
      }

      // 3. Transition rules.
      if (row.responseStatus !== 'AWAITING_RESPONSE') throw referralErrors.alreadyResponded();

      let reason = null;
      if (request.decision === 'NOT_APPROPRIATE') {
        reason = await tx.getNotAppropriateReason(request.reasonId);
        if (!reason || reason.lifecycleStatus !== 'ACTIVE') throw referralErrors.reasonNotSelectable();
        if (reason.requiresExplanation && !request.explanation) throw referralErrors.invalidRequest(['explanation']);
      }

      // 4. Conditional update: only succeeds if still AWAITING_RESPONSE.
      const updated = await tx.recordFirstResponse({
        referralId,
        decision: request.decision,
        notAppropriateReasonId: reason?.reasonId ?? null,
        notAppropriateExplanation: request.explanation,
        respondedByUserId: userId,
      });
      if (!updated) throw referralErrors.alreadyResponded(); // someone else responded first

      // 5. Audit, same transaction. The explanation text is never copied.
      await tx.appendAuditEvent({
        entityType: 'REFERRAL',
        entityId: referralId,
        action: request.decision, // 'ACCEPTED' | 'NOT_APPROPRIATE'
        actorUserId: userId,
        before: { response_status: 'AWAITING_RESPONSE', decision: null },
        after: {
          response_status: 'RESPONDED',
          decision: request.decision,
          not_appropriate_reason_id: reason?.reasonId ?? null,
          has_explanation: Boolean(request.explanation),
        },
        correlationId,
      });

      // 6. Confirmed state (PRD 13.3), minimum necessary (PRD 10.5): the
      //    decision the server recorded, never participant data. Responding
      //    does not grant view access; the referral itself is still read
      //    through GET /api/referrals/:id with its own check.
      return {
        status: 'RESPONDED',
        referral: {
          referralId,
          responseStatus: updated.responseStatus,
          decision: updated.decision,
          serviceOutcome: updated.serviceOutcome,
          stage: stageOf(updated),
          firstRespondedAt: updated.firstRespondedAt,
          notAppropriateReason: reason ? { reasonId: reason.reasonId, label: reason.label } : null,
          hasExplanation: Boolean(updated.notAppropriateExplanation),
        },
      };
    });
  }

  return Object.freeze({ listReasons, respond });
}
