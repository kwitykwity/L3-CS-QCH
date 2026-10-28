// What a designated administrator may grant in QCH Connect, and request
// validation (Trello Task Y; Final Technical PRD 3.6, 3.8, 10.3).
//
// GRANTABLE is the PRD 3.6 list for ADMINISTER_PERMISSIONS ("assigns or
// revokes application-level receiving-Program and Program-management
// permissions") plus MANAGE_ORGANIZATION ("Assigned by designated QCH
// administrators"). Each has exactly ONE scope: the scope the application
// actually honors (src/authorization/referralAccess.js). So a grant that
// would silently do nothing cannot be created.
//
// Not grantable here, on purpose:
// - ADMINISTER_PERMISSIONS: TEAM RESTRICTION, not approved QCH policy
//   (register R26). The team reads PRD 3.8 ("a controlled, documented,
//   QCH-approved process") as administrators being set up outside this
//   screen; QCH has not approved that rule for this screen.
// - VIEW_CREATED_REFERRAL: derived from being the referral's creator.
// - VIEW_UNDERLYING_REFERRAL: no feature reads it.
// - CREATE_REFERRAL, VIEW_AGGREGATE_REPORTING: every user with app access.
//
// The browser never chooses the scope. It sends a permission and, for
// Program-scope permissions, a Program ID; the server decides the rest.

export const ADMINISTER_PERMISSIONS = 'ADMINISTER_PERMISSIONS';

export const GRANTABLE = Object.freeze({
  VIEW_RECEIVED_REFERRAL: { scopeType: 'PROGRAM', label: 'View received referrals' },
  RESPOND_TO_REFERRAL: { scopeType: 'PROGRAM', label: 'Respond to referrals (Accept or Not appropriate)' },
  UPDATE_RECEIVED_REFERRAL: { scopeType: 'PROGRAM', label: 'Correct a response or decision' },
  RECORD_OUTCOME: { scopeType: 'PROGRAM', label: 'Record the service outcome' },
  CORRECT_OUTCOME: { scopeType: 'PROGRAM', label: 'Correct the service outcome' },
  MANAGE_PROGRAM: { scopeType: 'PROGRAM', label: 'Manage Program information' },
  MANAGE_ORGANIZATION: { scopeType: 'ORG', label: 'Manage the organization (Programs, Departments, field retirement)' },
});

// Labels for permissions shown but not managed here.
export const OTHER_LABELS = Object.freeze({
  [ADMINISTER_PERMISSIONS]: 'Administer permissions',
  VIEW_UNDERLYING_REFERRAL: 'View underlying referrals',
  VIEW_CREATED_REFERRAL: 'View created referrals',
});

export const labelOf = (permission) => GRANTABLE[permission]?.label ?? OTHER_LABELS[permission] ?? permission;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const positiveInt = (v) => Number.isSafeInteger(v) && v > 0;

// POST body: { permission, programId? }.
export function validateGrantRequest(body) {
  if (!isPlainObject(body)) return { ok: false, fields: [] };
  if (Object.keys(body).some((key) => key !== 'permission' && key !== 'programId')) {
    return { ok: false, unexpectedField: true };
  }
  const rule = typeof body.permission === 'string' && Object.hasOwn(GRANTABLE, body.permission)
    ? GRANTABLE[body.permission]
    : null;
  if (!rule) return { ok: false, fields: ['permission'] };

  if (rule.scopeType === 'PROGRAM') {
    if (!positiveInt(body.programId)) return { ok: false, fields: ['programId'] };
    return { ok: true, value: { permission: body.permission, scopeType: 'PROGRAM', programId: body.programId } };
  }
  // ORG scope: a Program would mean nothing, so sending one is an error.
  if (body.programId !== undefined && body.programId !== null) return { ok: false, fields: ['programId'] };
  return { ok: true, value: { permission: body.permission, scopeType: 'ORG', programId: null } };
}

// Revoke body: exactly an empty JSON object, {}. A missing body (undefined,
// which is what a non-JSON request leaves behind), null, or anything else
// is refused, so a revocation is always a deliberate JSON request. The
// route also refuses non-JSON requests with 415 before getting here.
export function validateRevokeRequest(body) {
  if (!isPlainObject(body)) return { ok: false, fields: [] };
  if (Object.keys(body).length > 0) return { ok: false, unexpectedField: true };
  return { ok: true };
}

// Grants that can be removed here: IN_APP grants of a grantable permission.
// DEMO grants (non-production seed), seeded grants and
// ADMINISTER_PERMISSIONS are shown read-only. TEAM RESTRICTION, not
// approved QCH policy (register R26).
export function isRevocable(grant) {
  return grant.grantSource === 'IN_APP' && Object.hasOwn(GRANTABLE, grant.permission);
}
