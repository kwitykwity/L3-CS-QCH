// Referral view authorization: capability + resource + scope
// (Final Technical PRD 3.2, 3.3, 3.4, 3.6, 3.8, 3.9, 16.1).
//
// Who may view a submitted referral (PRD 3.4, CLIENT CONFIRMED):
// - VIEW_CREATED_REFERRAL: the referral's creator. Derived from the
//   referral's created_by_user_id; it is never a grant (PRD 3.6 scope is
//   "Referral creator").
// - VIEW_RECEIVED_REFERRAL: users holding an active receiving-Program
//   grant for the referral's receiving Program (PRD 3.4: one Program
//   Director or multiple designated staff).
// Nobody else. In particular these do NOT grant view access (PRD 3.8,
// 3.9): ADMINISTER_PERMISSIONS, MANAGE_PROGRAM, MANAGE_ORGANIZATION,
// VIEW_AGGREGATE_REPORTING, a Program affiliation, or knowing a
// Referral ID or URL (PRD 3.3).
//
// Inputs are always server-side: the user ID from validated identity and
// grants read from the database. Nothing here reads the request.
//
// Grant rules (dbo.user_grants in the migration baseline, PR #4):
// - Only grants with revokedAt == null count.
// - grantSource IN_APP counts. DEMO grants count only when the caller
//   explicitly allows them (non-production); otherwise they are ignored,
//   so demo access fails closed (PRD 16.1, 17.4).
// - scopeType PROGRAM is honored. DEPARTMENT and ORG scopes exist in the
//   schema, but the PRD defines receiving access at the Program level and
//   does not say what a Department- or ORG-wide receiving grant means.
//   Until the team decides, those grants grant nothing (fail closed).

export const RECEIVING_VIEW = 'VIEW_RECEIVED_REFERRAL';

// The only environments where DEMO grants may be honored (PRD 16.1, 17.4).
export const DEMO_GRANT_ENVS = Object.freeze(['development', 'test']);

// Fails closed at start-up: asking to honor DEMO grants in production, in
// an unknown environment, or without naming the environment throws.
export function assertDemoGrantsAllowed(allowDemoGrants, nodeEnv) {
  if (allowDemoGrants === true && !DEMO_GRANT_ENVS.includes(nodeEnv)) {
    throw new Error(`DEMO grants can only be enabled when NODE_ENV is ${DEMO_GRANT_ENVS.join(' or ')}`);
  }
}

function isUsable(grant, { allowDemoGrants }) {
  if (!grant || grant.revokedAt != null) return false;
  if (grant.grantSource === 'IN_APP') return true;
  return grant.grantSource === 'DEMO' && allowDemoGrants === true;
}

// Respond to a received referral: Accepted or Not Appropriate (PRD 3.6).
// A separate capability from viewing: view never implies modify (PRD 3.3).
export const RESPOND = 'RESPOND_TO_REFERRAL';

// Card 8 (PRD 3.6). Each is its own capability for the receiving Program;
// none implies another, and none implies view (PRD 3.3).
export const RECORD_OUTCOME = 'RECORD_OUTCOME';
// Correct an already recorded Service Outcome only.
export const CORRECT_OUTCOME = 'CORRECT_OUTCOME';
// Update a received referral, including correcting the Response/Decision.
export const UPDATE_RECEIVED = 'UPDATE_RECEIVED_REFERRAL';

// Program IDs for which this user holds `permission` as an active,
// usable, PROGRAM-scope grant.
export function programIdsWithCapability(grants, permission, { allowDemoGrants = false } = {}) {
  const ids = new Set();
  for (const grant of grants ?? []) {
    if (
      grant.permission === permission &&
      grant.scopeType === 'PROGRAM' &&
      Number.isSafeInteger(grant.programId) &&
      isUsable(grant, { allowDemoGrants })
    ) {
      ids.add(grant.programId);
    }
  }
  return ids;
}

// True when the user holds `permission` as an active, usable ORG-scope
// grant. Used for organization-wide capabilities such as
// MANAGE_ORGANIZATION (PRD 3.6). A PROGRAM- or DEPARTMENT-scope grant of
// the same permission does not count.
export function hasOrgScopeCapability(grants, permission, { allowDemoGrants = false } = {}) {
  return (grants ?? []).some((grant) =>
    grant.permission === permission &&
    grant.scopeType === 'ORG' &&
    isUsable(grant, { allowDemoGrants }));
}

// Program IDs whose received referrals this user may view.
export function receivingProgramIds(grants, options = {}) {
  return programIdsWithCapability(grants, RECEIVING_VIEW, options);
}

// How (if at all) this user may view this referral.
export function referralAccess(userId, referral, receivingIds) {
  const asCreator = Number.isSafeInteger(userId) && referral.createdByUserId === userId;
  const asReceiver = receivingIds.has(referral.receivingProgramId);
  return { asCreator, asReceiver, canView: asCreator || asReceiver };
}
