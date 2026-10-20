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
  fieldNotFound: () =>
    new ProgramError(404, 'FIELD_NOT_FOUND', 'Field not found.'),
  optionNotFound: () =>
    new ProgramError(404, 'OPTION_NOT_FOUND', 'Option not found.'),
  fieldNotApplied: () =>
    new ProgramError(404, 'FIELD_NOT_APPLIED', 'That field is not used by this Program.'),
  fieldChanged: (current) =>
    new ProgramError(
      409,
      'FIELD_CHANGED',
      'This field was changed by someone else. Review the current field and try again.',
      { current },
    ),
  fieldNotActive: () =>
    new ProgramError(409, 'FIELD_NOT_ACTIVE', 'This field is not active.'),
  fieldRetired: () =>
    new ProgramError(409, 'FIELD_RETIRED', 'This field is retired and cannot be changed.'),
  fieldReplaced: () =>
    new ProgramError(
      409,
      'FIELD_REPLACED',
      'This field was replaced by a field with a new meaning and cannot be reactivated.',
    ),
  alreadyApplied: () =>
    new ProgramError(409, 'ALREADY_APPLIED', 'This Program already uses that field.'),
  notDiscontinued: () =>
    new ProgramError(409, 'NOT_DISCONTINUED', 'Only a discontinued field can be retired.'),
  retireNotYet: () =>
    new ProgramError(
      409,
      'RETIRE_NOT_YET',
      'A field can be retired only after its review period as a discontinued field.',
    ),
  optionsNotAllowed: () =>
    new ProgramError(409, 'OPTIONS_NOT_ALLOWED', 'This type of field does not have options.'),
  lastActiveOption: () =>
    new ProgramError(409, 'LAST_ACTIVE_OPTION', 'A choice field needs at least one active option.'),
  duplicateOption: () =>
    new ProgramError(409, 'DUPLICATE_OPTION', 'This field already has an option with that label.'),
  storeUnavailable: () =>
    new ProgramError(503, 'NOT_CONFIGURED', 'This service is not available.'),
});
