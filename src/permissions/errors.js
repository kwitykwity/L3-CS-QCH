// Domain errors for permission administration (Trello Task Y, PRD 3.8).
//
// Fixed messages and stable codes. Messages never contain request values,
// user names or grant details (PRD 10.4, 15.4). `current` (the target's
// current grants) is only attached for administrators, who may see it.

export class PermissionError extends Error {
  constructor(status, code, message, { fields, current } = {}) {
    super(message);
    this.name = 'PermissionError';
    this.status = status;
    this.code = code;
    if (fields) this.fields = fields;
    if (current) this.current = current;
  }
}

export const permissionErrors = Object.freeze({
  invalidRequest: (fields) =>
    new PermissionError(400, 'INVALID_REQUEST', 'The permission change is not valid.', { fields }),
  unexpectedField: () =>
    new PermissionError(400, 'UNEXPECTED_FIELD', 'The request contains a field that is not allowed.'),
  unsupportedMediaType: () =>
    new PermissionError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send this request as JSON.'),
  notAuthenticated: () =>
    new PermissionError(401, 'NOT_AUTHENTICATED', 'Sign-in is required.'),
  userNotActive: () =>
    new PermissionError(403, 'USER_NOT_ACTIVE', 'This account does not have access.'),
  notAuthorized: () =>
    new PermissionError(403, 'NOT_AUTHORIZED', 'You do not have permission to administer permissions.'),
  selfElevation: () =>
    new PermissionError(403, 'SELF_ELEVATION_NOT_ALLOWED', 'You cannot add permissions to yourself. Ask another administrator.'),
  notRevocable: (current) =>
    new PermissionError(403, 'NOT_REVOCABLE', 'This permission is not managed here.', { current }),
  userNotFound: () =>
    new PermissionError(404, 'USER_NOT_FOUND', 'Staff member not found.'),
  targetNotActive: () =>
    new PermissionError(409, 'TARGET_NOT_ACTIVE', 'This staff member is not active, so no permission can be added.'),
  alreadyGranted: (current) =>
    new PermissionError(409, 'ALREADY_GRANTED', 'This staff member already has that permission.', { current }),
  grantChanged: (current) =>
    new PermissionError(
      409,
      'GRANT_CHANGED',
      'This permission was already removed or changed. Review the current permissions.',
      { current },
    ),
  storeUnavailable: () =>
    new PermissionError(503, 'NOT_CONFIGURED', 'This service is not available.'),
});
