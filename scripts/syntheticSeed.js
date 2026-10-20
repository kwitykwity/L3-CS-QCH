// SYNTHETIC data for local development and tests only (PRD 15.5, 16.2).
// Names are invented samples, not the QCH Program Directory (PRD 4.5).
// No real people, Programs, or referrals.

export const DEV_USER_ID = 1;

const NO_AGE_LIMIT = { ageLimitState: 'NO_RESTRICTION', ageMin: null, ageMax: null };
const NO_AREA_LIMIT = { serviceAreaState: 'NO_RESTRICTION', serviceAreaZips: [] };

export function syntheticSeed() {
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
    // No affiliation yet, so the first-use affiliation step is visible.
    users: [{ userId: DEV_USER_ID, isActive: true }],
  };
}
