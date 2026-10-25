// SYNTHETIC data for local development and tests only (PRD 15.5, 16.2).
// Names are invented samples, not the QCH Program Directory (PRD 4.5).
// No real people, Programs, or referrals.

export const DEV_USER_ID = 1;

const NO_AGE_LIMIT = { ageLimitState: 'NO_RESTRICTION', ageMin: null, ageMax: null };
const NO_AREA_LIMIT = { serviceAreaState: 'NO_RESTRICTION', serviceAreaZips: [] };

// The receiving-side capabilities (PRD 3.6), each granted on its own.
export const RECEIVING_CAPABILITIES = Object.freeze([
  'VIEW_RECEIVED_REFERRAL', 'RESPOND_TO_REFERRAL', 'RECORD_OUTCOME', 'CORRECT_OUTCOME', 'UPDATE_RECEIVED_REFERRAL',
]);
// The sample Program the developer receives referrals for (receiving: true).
export const DEV_RECEIVING_PROGRAM_ID = 4;

// The initial Not Appropriate reasons from db/migrations/002_reference_data.sql.
export const NOT_APPROPRIATE_REASONS = Object.freeze([
  { reasonId: 1, code: 'PROGRAM_CRITERIA_NOT_MET', label: 'Program criteria not met', displayOrder: 1 },
  { reasonId: 2, code: 'PROGRAM_UNAVAILABLE', label: 'Program currently unavailable', displayOrder: 2 },
  { reasonId: 3, code: 'NOT_APPROPRIATE_FOR_NEED', label: 'Program not appropriate for identified need', displayOrder: 3 },
  { reasonId: 4, code: 'UNABLE_TO_PROCEED', label: 'Unable to proceed with referral', displayOrder: 4 },
  { reasonId: 5, code: 'OTHER', label: 'Other', displayOrder: 5 },
]);

export function syntheticSeed({ programManagement = false, organizationManagement = false, receiving = false } = {}) {
  return {
    departments: [
      { departmentId: 1, name: 'Youth Services (sample)', lifecycleStatus: 'ACTIVE' },
      { departmentId: 2, name: 'Adult Services (sample)', lifecycleStatus: 'ACTIVE' },
      { departmentId: 3, name: 'Older Adult Services (sample)', lifecycleStatus: 'ACTIVE' },
    ],
    // Need categories and matching facts for guided matching (GPME, card
    // 11). Invented, like everything here; ZIP codes are from outside New
    // York on purpose.
    needCategories: [
      { needCategoryId: 1, name: 'Childcare (sample)', lifecycleStatus: 'ACTIVE' },
      { needCategoryId: 2, name: 'Education (sample)', lifecycleStatus: 'ACTIVE' },
      { needCategoryId: 3, name: 'Employment (sample)', lifecycleStatus: 'ACTIVE' },
      { needCategoryId: 4, name: 'Housing (sample)', lifecycleStatus: 'ACTIVE' },
      { needCategoryId: 5, name: 'Older adult support (sample)', lifecycleStatus: 'ACTIVE' },
    ],
    programs: [
      { programId: 1, departmentId: 1, name: 'Early Childhood Playgroup (sample)', site: 'Site A', lifecycleStatus: 'ACTIVE',
        needCategoryIds: [1], ageLimitState: 'SET', ageMin: 0, ageMax: 5, ...NO_AREA_LIMIT },
      { programId: 2, departmentId: 1, name: 'After-School Homework Club (sample)', site: 'Site B', lifecycleStatus: 'ACTIVE',
        needCategoryIds: [2], ageLimitState: 'SET', ageMin: 6, ageMax: 13,
        serviceAreaState: 'SET', serviceAreaZips: ['99901', '99902'] },
      { programId: 3, departmentId: 2, name: 'Adult Evening Classes (sample)', site: 'Site A', lifecycleStatus: 'ACTIVE',
        needCategoryIds: [2, 3], ageLimitState: 'SET', ageMin: 18, ageMax: null, ...NO_AREA_LIMIT },
      { programId: 4, departmentId: 2, name: 'Housing Help Desk (sample)', site: 'Site C', lifecycleStatus: 'ACTIVE',
        needCategoryIds: [4], ...NO_AGE_LIMIT, serviceAreaState: 'OTHER_LIMIT', serviceAreaZips: [] },
      { programId: 5, departmentId: 2, name: 'Job Readiness Workshop (sample)', site: 'Site B', lifecycleStatus: 'ACTIVE',
        needCategoryIds: [3], ageLimitState: 'NOT_ON_FILE', ageMin: null, ageMax: null, ...NO_AREA_LIMIT },
      { programId: 6, departmentId: 3, name: 'Older Adult Wellness Center (sample)', site: 'Site D', lifecycleStatus: 'ACTIVE',
        needCategoryIds: [5], ageLimitState: 'SET', ageMin: 60, ageMax: null, ...NO_AREA_LIMIT },
      { programId: 7, departmentId: 3, name: 'Retired Sample Program', site: 'Site D', lifecycleStatus: 'DISCONTINUED',
        needCategoryIds: [5], ...NO_AGE_LIMIT, ...NO_AREA_LIMIT },
    ],
    // Where each sample Program's new-referral notification goes (Task E).
    // Invented addresses on the reserved example.org domain; the dev server
    // only puts them in the simulated outbox, never in a real email.
    // Program 5 has none on purpose, to show the NO_RECIPIENT failure.
    programNotificationEmails: {
      1: 'playgroup.sample@example.org',
      2: 'homework-club.sample@example.org',
      3: 'evening-classes.sample@example.org',
      4: 'housing-help.sample@example.org',
      6: 'wellness-center.sample@example.org',
    },
    // No affiliation yet, so the first-use affiliation step is visible.
    users: [{ userId: DEV_USER_ID, isActive: true }],
    // Explicit synthetic permissions for the local management UI.
    // Default callers keep an unprivileged seed. No real QCH mappings.
    grants: [...(programManagement ? [3, 7].map((programId) => ({
      userId: DEV_USER_ID,
      permission: 'MANAGE_PROGRAM',
      scopeType: 'PROGRAM',
      programId,
      departmentId: null,
      grantSource: 'IN_APP',
    })) : []),
      ...(organizationManagement ? [{
        userId: DEV_USER_ID,
        permission: 'MANAGE_ORGANIZATION',
        scopeType: 'ORG',
        programId: null,
        departmentId: null,
        grantSource: 'IN_APP',
      }] : []),
      // Receiving side for one sample Program (Task A screens).
      ...(receiving ? RECEIVING_CAPABILITIES.map((permission) => ({
        userId: DEV_USER_ID,
        permission,
        scopeType: 'PROGRAM',
        programId: DEV_RECEIVING_PROGRAM_ID,
        departmentId: null,
        grantSource: 'IN_APP',
      })) : []),
    ],
    ...(receiving ? { notAppropriateReasons: NOT_APPROPRIATE_REASONS.map((r) => ({ ...r })) } : {}),
  };
}
