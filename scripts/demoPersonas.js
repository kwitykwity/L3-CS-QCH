// SYNTHETIC demo people for the non-production demo sign-in (Task O, PRD 16.1).
// Invented, not real QCH staff. The names describe what each person can do in
// the demo; they do not assign QCH job titles (PRD 3.6). Never imported by
// production (src/ may not import from scripts/).
//
// What each person can do comes only from the grants below, which the backend
// checks on every request like any other user. Signing in as a person changes
// WHO the backend sees, never what that person is allowed to do.

import { RECEIVING_CAPABILITIES } from './syntheticSeed.js';

// Sample Program IDs from scripts/syntheticSeed.js.
const ADULT_EVENING_CLASSES = 3;
const HOUSING_HELP_DESK = 4;
const OLDER_ADULT_WELLNESS = 6;

export const DEMO_PERSONAS = Object.freeze([
  {
    key: 'referring-worker',
    userId: 11,
    displayName: 'Referring Worker (demo)',
    description: 'Sends referrals from Adult Evening Classes and sees the status of the referrals they sent. Cannot see or answer referrals sent to other people.',
    landing: '/referral/',
    currentProgramId: ADULT_EVENING_CLASSES,
    receivesFor: null,
  },
  {
    key: 'housing-receiver',
    userId: 12,
    displayName: 'Housing Help Desk Staff (demo)',
    description: 'Receives referrals sent to Housing Help Desk, answers them, and records the Service Outcome.',
    landing: '/receiving/',
    currentProgramId: HOUSING_HELP_DESK,
    receivesFor: HOUSING_HELP_DESK,
  },
  {
    key: 'wellness-receiver',
    userId: 13,
    displayName: 'Older Adult Wellness Center Staff (demo)',
    description: 'Receives referrals for Older Adult Wellness Center only. Shows that receiving rights for one Program give nothing on another: a Housing Help Desk referral is not visible here.',
    landing: '/receiving/',
    currentProgramId: OLDER_ADULT_WELLNESS,
    receivesFor: OLDER_ADULT_WELLNESS,
  },
]);

// The demo store's people and permissions: only the demo people, with
// receiving rights where listed. Everything else in the synthetic seed is kept.
export function withDemoPeople(seed) {
  return {
    ...seed,
    users: [
      ...seed.users,
      ...DEMO_PERSONAS.map((p) => ({
        userId: p.userId, isActive: true, currentProgramId: p.currentProgramId, displayName: p.displayName,
      })),
    ],
    grants: [
      ...seed.grants,
      ...DEMO_PERSONAS.filter((p) => p.receivesFor !== null).flatMap((p) => RECEIVING_CAPABILITIES.map((permission) => ({
        userId: p.userId,
        permission,
        scopeType: 'PROGRAM',
        programId: p.receivesFor,
        departmentId: null,
        grantSource: 'IN_APP',
      }))),
    ],
  };
}
