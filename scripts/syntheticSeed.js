// SYNTHETIC data for local development and tests only (PRD 15.5, 16.2).
// Names are invented samples, not the QCH Program Directory (PRD 4.5).
// No real people, Programs, or referrals.

export const DEV_USER_ID = 1;

export function syntheticSeed() {
  return {
    departments: [
      { departmentId: 1, name: 'Youth Services (sample)', lifecycleStatus: 'ACTIVE' },
      { departmentId: 2, name: 'Adult Services (sample)', lifecycleStatus: 'ACTIVE' },
      { departmentId: 3, name: 'Older Adult Services (sample)', lifecycleStatus: 'ACTIVE' },
    ],
    programs: [
      { programId: 1, departmentId: 1, name: 'Early Childhood Playgroup (sample)', site: 'Site A', lifecycleStatus: 'ACTIVE' },
      { programId: 2, departmentId: 1, name: 'After-School Homework Club (sample)', site: 'Site B', lifecycleStatus: 'ACTIVE' },
      { programId: 3, departmentId: 2, name: 'Adult Evening Classes (sample)', site: 'Site A', lifecycleStatus: 'ACTIVE' },
      { programId: 4, departmentId: 2, name: 'Housing Help Desk (sample)', site: 'Site C', lifecycleStatus: 'ACTIVE' },
      { programId: 5, departmentId: 2, name: 'Job Readiness Workshop (sample)', site: 'Site B', lifecycleStatus: 'ACTIVE' },
      { programId: 6, departmentId: 3, name: 'Older Adult Wellness Center (sample)', site: 'Site D', lifecycleStatus: 'ACTIVE' },
      { programId: 7, departmentId: 3, name: 'Retired Sample Program', site: 'Site D', lifecycleStatus: 'DISCONTINUED' },
    ],
    // No affiliation yet, so the first-use affiliation step is visible.
    users: [{ userId: DEV_USER_ID, isActive: true }],
  };
}
