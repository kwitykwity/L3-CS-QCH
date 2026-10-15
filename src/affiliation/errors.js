// Domain errors for Program listing and staff Program affiliation.
//
// Each error carries an HTTP status and a stable machine-readable code the
// frontend can branch on. Messages are fixed strings: they never include
// request values, names, or other data (PRD 10.4, 15.4).

export class AffiliationError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'AffiliationError';
    this.status = status;
    this.code = code;
  }
}

export const errors = Object.freeze({
  invalidRequest: () =>
    new AffiliationError(400, 'INVALID_REQUEST', 'The request is not valid.'),
  notAuthenticated: () =>
    new AffiliationError(401, 'NOT_AUTHENTICATED', 'Sign-in is required.'),
  userNotActive: () =>
    new AffiliationError(403, 'USER_NOT_ACTIVE', 'This account does not have access.'),
  programNotSelectable: () =>
    new AffiliationError(422, 'PROGRAM_NOT_SELECTABLE', 'That Program cannot be selected.'),
  affiliationRequired: () =>
    new AffiliationError(409, 'AFFILIATION_REQUIRED', 'Choose your Program affiliation first.'),
  affiliationProgramNotActive: () =>
    new AffiliationError(
      409,
      'AFFILIATION_PROGRAM_NOT_ACTIVE',
      'Your Program affiliation is no longer active. Choose your Program affiliation again.',
    ),
  referringProgramMismatch: () =>
    new AffiliationError(
      422,
      'REFERRING_PROGRAM_MISMATCH',
      'The Referring Program must be your current Program affiliation.',
    ),
  storeUnavailable: () =>
    new AffiliationError(503, 'NOT_CONFIGURED', 'This service is not available.'),
});
