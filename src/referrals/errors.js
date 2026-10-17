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
  notAuthenticated: () =>
    new ReferralError(401, 'NOT_AUTHENTICATED', 'Sign-in is required.'),
  receivingProgramNotSelectable: () =>
    new ReferralError(
      422,
      'RECEIVING_PROGRAM_NOT_SELECTABLE',
      'That Program cannot receive referrals right now.',
    ),
  submissionIdConflict: () =>
    new ReferralError(
      409,
      'SUBMISSION_ID_CONFLICT',
      'This submission ID was already used for a different referral. Start a new referral.',
    ),
  // Used both for "does not exist" and "you may not see it" (PRD 3.3).
  referralNotFound: () =>
    new ReferralError(404, 'REFERRAL_NOT_FOUND', 'Referral not found.'),
  notAuthorizedForProgram: () =>
    new ReferralError(403, 'NOT_AUTHORIZED', 'You do not have access to referrals for that Program.'),
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
