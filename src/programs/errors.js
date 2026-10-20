// Domain errors for Program maintenance (Trello card 14).
//
// Each error has an HTTP status and a stable code the frontend can branch
// on. Messages are fixed strings. They never contain request values,
// field names outside the allowlist, or Program data (PRD 10.4, 15.4).

export class ProgramError extends Error {
  constructor(status, code, message, { fields, current } = {}) {
    super(message);
    this.name = 'ProgramError';
    this.status = status;
    this.code = code;
    // Names of invalid fields only, never their values (PRD 14.3).
    if (fields) this.fields = fields;
    // For a stale update: the Program as it is now, so the UI can show it
    // before another try (PRD 13.4). Only for users who may manage it.
    if (current) this.current = current;
  }
}

export const programErrors = Object.freeze({
  invalidRequest: (fields) =>
    new ProgramError(400, 'INVALID_REQUEST', 'The Program change is not valid.', { fields }),
  unexpectedField: () =>
    new ProgramError(400, 'UNEXPECTED_FIELD', 'The request contains a field that is not allowed.'),
  notAuthenticated: () =>
    new ProgramError(401, 'NOT_AUTHENTICATED', 'Sign-in is required.'),
  userNotActive: () =>
    new ProgramError(403, 'USER_NOT_ACTIVE', 'This account does not have access.'),
  notAuthorized: () =>
    new ProgramError(403, 'NOT_AUTHORIZED', 'You do not have permission to manage this Program.'),
  programNotFound: () =>
    new ProgramError(404, 'PROGRAM_NOT_FOUND', 'Program not found.'),
  programChanged: (current) =>
    new ProgramError(
      409,
      'PROGRAM_CHANGED',
      'This Program was changed by someone else. Review the current information and try again.',
      { current },
    ),
  noChange: () =>
    new ProgramError(409, 'NO_CHANGE', 'Nothing was changed.'),
  programRetired: () =>
    new ProgramError(409, 'PROGRAM_RETIRED', 'This Program is retired and cannot be changed.'),
  alreadyInStatus: () =>
    new ProgramError(409, 'ALREADY_IN_STATUS', 'The Program is already in that status.'),
  departmentNotActive: () =>
    new ProgramError(
      409,
      'DEPARTMENT_NOT_ACTIVE',
      'This Program cannot be reactivated while its Department is not active.',
    ),
  storeUnavailable: () =>
    new ProgramError(503, 'NOT_CONFIGURED', 'This service is not available.'),
});
