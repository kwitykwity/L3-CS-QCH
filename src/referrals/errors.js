// Domain errors for referral creation.
//
// Each error has an HTTP status and a stable code the frontend can branch
// on. Messages are fixed strings. They never contain request values,
// participant data, or other user input (PRD 5.4, 10.4, 15.4).

export class ReferralError extends Error {
  constructor(status, code, message, { fields, current } = {}) {
    super(message);
    this.name = 'ReferralError';
    this.status = status;
    this.code = code;
    // Names of invalid fields only, never their values. Lets the UI move
    // focus to the first invalid field (PRD 14.3).
    if (fields) this.fields = fields;
    // For a stale update (409): the current authoritative state, so the
    // UI can show it and ask the worker to review (PRD 9.4, 13.4).
    if (current) this.current = current;
  }
}

export const referralErrors = Object.freeze({
  invalidRequest: (fields) =>
    new ReferralError(400, 'INVALID_REQUEST', 'The referral is not valid.', { fields }),
  // A property outside the allowlist. Its name is never echoed (PRD 10.4).
  unexpectedField: () =>
    new ReferralError(400, 'UNEXPECTED_FIELD', 'The request contains a field that is not allowed.'),
  notAuthenticated: () =>
    new ReferralError(401, 'NOT_AUTHENTICATED', 'Sign-in is required.'),
  receivingProgramNotSelectable: () =>
    new ReferralError(
      422,
      'RECEIVING_PROGRAM_NOT_SELECTABLE',
      'That Program cannot receive referrals right now.',
    ),
  // The Submission ID is already attached to a different referral. The
  // caller first checks whether its own earlier attempt was received
  // (GET /api/referrals/submissions/:id, PRD 7.4) before deliberately
  // starting a new referral; nothing about the other referral is revealed.
  submissionIdConflict: () =>
    new ReferralError(
      409,
      'SUBMISSION_ID_CONFLICT',
      'This Submission ID is already in use. Check whether the earlier referral was received before sending a new one.',
    ),
  // Used both for "does not exist" and "you may not see it" (PRD 3.3).
  referralNotFound: () =>
    new ReferralError(404, 'REFERRAL_NOT_FOUND', 'Referral not found.'),
  notAuthorizedForProgram: () =>
    new ReferralError(403, 'NOT_AUTHORIZED', 'You do not have access to referrals for that Program.'),
  notAuthorizedToRespond: () =>
    new ReferralError(403, 'NOT_AUTHORIZED', 'You do not have permission to respond to referrals for this Program.'),
  alreadyResponded: () =>
    new ReferralError(409, 'ALREADY_RESPONDED', 'This referral already has a response. Reload it to see the current response.'),
  // Card 8: service outcome and corrections (PRD 6.2, 6.5).
  notAuthorizedForAction: () =>
    new ReferralError(403, 'NOT_AUTHORIZED', 'You do not have permission to make this change for this Program.'),
  outcomeNeedsAcceptance: () =>
    new ReferralError(
      409,
      'OUTCOME_NOT_ALLOWED',
      'A service outcome can only be recorded for an accepted referral. A Not Appropriate referral needs its decision corrected first.',
    ),
  outcomeAlreadyRecorded: () =>
    new ReferralError(409, 'OUTCOME_ALREADY_RECORDED', 'A service outcome is already recorded. Use a correction to change it.'),
  outcomeNotRecorded: () =>
    new ReferralError(409, 'OUTCOME_NOT_RECORDED', 'No service outcome is recorded yet, so there is nothing to correct.'),
  notResponded: () =>
    new ReferralError(409, 'NOT_RESPONDED', 'This referral has no response yet, so there is nothing to correct.'),
  outcomeBlocksDecision: () =>
    new ReferralError(
      409,
      'OUTCOME_RECORDED',
      'This referral has a recorded service outcome. Correct the outcome to "not recorded" before changing the decision to Not Appropriate.',
    ),
  noChange: () =>
    new ReferralError(409, 'NO_CHANGE', 'The correction is the same as the current value. Nothing was changed.'),
  referralChanged: (current) =>
    new ReferralError(
      409,
      'REFERRAL_CHANGED',
      'This referral was changed by someone else. Review the current information before making a correction.',
      { current },
    ),
  reasonNotSelectable: () =>
    new ReferralError(422, 'REASON_NOT_SELECTABLE', 'That reason cannot be selected. Choose another reason.'),
  storeUnavailable: () =>
    new ReferralError(503, 'NOT_CONFIGURED', 'This service is not available.'),
});

// Thrown by a store when the database unique constraint on submission_id
// rejects an insert (a concurrent duplicate). The service handles it.
export class DuplicateSubmissionError extends Error {
  constructor() {
    super('duplicate submission_id');
    this.name = 'DuplicateSubmissionError';
  }
}
