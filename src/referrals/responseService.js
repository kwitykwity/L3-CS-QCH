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

// Returns { ok: true, value } or { ok: false, fields }.
export function validateResponse(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false, fields: [] };

  const allowed = new Set(['decision', 'reasonId', 'explanation']);
  const unknown = Object.keys(body).filter((k) => !allowed.has(k));
  if (unknown.length > 0) return { ok: false, fields: unknown.sort() };

  const { decision } = body;
  if (decision === 'ACCEPTED') {
    // A reason or explanation only belongs to Not Appropriate.
    const extra = ['reasonId', 'explanation'].filter((k) => body[k] !== undefined && body[k] !== null && body[k] !== '');
    if (extra.length > 0) return { ok: false, fields: extra };
    return { ok: true, value: { decision, reasonId: null, explanation: null } };
  }

  if (decision !== 'NOT_APPROPRIATE') return { ok: false, fields: ['decision'] };

  const fields = [];
  const reasonId = Number.isSafeInteger(body.reasonId) && body.reasonId > 0 ? body.reasonId : null;
  if (reasonId === null) fields.push('reasonId');

  let explanation = null;
  if (body.explanation !== undefined && body.explanation !== null && body.explanation !== '') {
    const text = typeof body.explanation === 'string' ? body.explanation.trim() : '';
    if (text.length === 0) explanation = null;
    else if (text.length > EXPLANATION_MAX || CONTROL_CHARS.test(text)) fields.push('explanation');
    else explanation = text;
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
    if (!validation.ok) throw referralErrors.invalidRequest(validation.fields);
    const request = validation.value;

    return store.withTransaction(async (tx) => {
      await requireActiveUser(tx, userId);

      // 1. Authoritative state.
      const row = await tx.getReferralById(referralId);
      if (!row) throw referralErrors.referralNotFound();

      // 2. Authorization for this resource and action.
      const grants = await store.getActiveGrants(userId);
      const access = referralAccess(userId, row, receivingProgramIds(grants, { allowDemoGrants }));
      const canRespond = programIdsWithCapability(grants, RESPOND, { allowDemoGrants }).has(row.receivingProgramId);
      if (!canRespond) {
        throw access.canView ? referralErrors.notAuthorizedToRespond() : referralErrors.referralNotFound();
      }

      // 3. Transition rules.
      if (row.responseStatus !== 'AWAITING_RESPONSE') throw referralErrors.alreadyResponded();

      let reason = null;
      if (request.decision === 'NOT_APPROPRIATE') {
        reason = await store.getNotAppropriateReason(request.reasonId);
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

      // 6. Confirmed state (PRD 13.3).
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
          notAppropriateExplanation: updated.notAppropriateExplanation,
        },
      };
    });
  }

  return Object.freeze({ listReasons, respond });
}
