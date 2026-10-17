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

function isUsable(grant, { allowDemoGrants }) {
  if (!grant || grant.revokedAt != null) return false;
  if (grant.grantSource === 'IN_APP') return true;
  return grant.grantSource === 'DEMO' && allowDemoGrants === true;
}

// Program IDs whose received referrals this user may view.
export function receivingProgramIds(grants, { allowDemoGrants = false } = {}) {
  const ids = new Set();
  for (const grant of grants ?? []) {
    if (
      grant.permission === RECEIVING_VIEW &&
      grant.scopeType === 'PROGRAM' &&
      Number.isSafeInteger(grant.programId) &&
      isUsable(grant, { allowDemoGrants })
    ) {
      ids.add(grant.programId);
    }
  }
  return ids;
}

// How (if at all) this user may view this referral.
export function referralAccess(userId, referral, receivingIds) {
  const asCreator = Number.isSafeInteger(userId) && referral.createdByUserId === userId;
  const asReceiver = receivingIds.has(referral.receivingProgramId);
  return { asCreator, asReceiver, canView: asCreator || asReceiver };
}
