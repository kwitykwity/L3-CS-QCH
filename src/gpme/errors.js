// Domain errors for GPME matching.
//
// Each error has an HTTP status and a stable code the frontend can branch
// on. Messages are fixed strings. They never contain request values,
// participant data, or other user input (PRD 10.4, 15.4).
//
// "Unable to perform matching" is NOT an error here: it is a normal
// UNABLE_TO_MATCH result, kept separate from "no plausible match"
// (PRD 8.5, 8.8).

export class GpmeError extends Error {
  constructor(status, code, message, { fields } = {}) {
    super(message);
    this.name = 'GpmeError';
    this.status = status;
    this.code = code;
    // Names of invalid fields only, never their values (PRD 14.3).
    if (fields) this.fields = fields;
  }
}

export const gpmeErrors = Object.freeze({
  invalidRequest: (fields) =>
    new GpmeError(400, 'INVALID_REQUEST', 'The matching request is not valid.', { fields }),
  unexpectedField: () =>
    new GpmeError(400, 'UNEXPECTED_FIELD', 'The request contains a field that is not allowed.'),
  notAuthenticated: () =>
    new GpmeError(401, 'NOT_AUTHENTICATED', 'Sign-in is required.'),
  storeUnavailable: () =>
    new GpmeError(503, 'NOT_CONFIGURED', 'This service is not available.'),
});
