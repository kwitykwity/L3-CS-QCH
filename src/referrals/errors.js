// Domain errors for referral creation.
//
// Each error has an HTTP status and a stable code the frontend can branch
// on. Messages are fixed strings. They never contain request values,
// participant data, or other user input (PRD 5.4, 10.4, 15.4).

export class ReferralError extends Error {
  constructor(status, code, message, { fields } = {}) {
    super(message);
    this.name = 'ReferralError';
    this.status = status;
    this.code = code;
    // Names of invalid fields only, never their values. Lets the UI move
    // focus to the first invalid field (PRD 14.3).
    if (fields) this.fields = fields;
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
