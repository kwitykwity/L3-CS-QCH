// Task 204: fixed Program fields in Find a Program results.
// Supported by Handoff PRD 8, 9 and Handoff MVP 10: Program Description,
// Schedule, Eligibility notes. Cost notes is not named there: not shown.
// All data is SYNTHETIC.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
import { toResultInformation, FIXED_INFORMATION } from '../src/gpme/programInformationForResults.js';

const FOOD = 1;
const PM = 201;
const DESC = 'Synthetic description: weekly pantry for families.';
const SCHED = 'Synthetic schedule: Tuesdays and Thursdays, 9 to 12.';
const ELIG = 'Synthetic eligibility note: Queens residents.';
const COST = 'Synthetic cost note: free of charge.';

function setup(extra = {}) {
  const store = createMemoryReferralStore({
    departments: [{ departmentId: 1, name: 'Synthetic Dept', lifecycleStatus: 'ACTIVE' }],
    programs: [
      { programId: 11, departmentId: 1, name: 'Synthetic Pantry', site: null, lifecycleStatus: 'ACTIVE',
        needCategoryIds: [FOOD], ageLimitState: 'NO_RESTRICTION', serviceAreaState: 'NO_RESTRICTION', ...extra },
      { programId: 12, departmentId: 1, name: 'Synthetic Meals', site: null, lifecycleStatus: 'ACTIVE',
        needCategoryIds: [FOOD], ageLimitState: 'NO_RESTRICTION', serviceAreaState: 'NO_RESTRICTION' },
    ],
    needCategories: [{ needCategoryId: FOOD, name: 'Food' }],
    users: [{ userId: PM, isActive: true }],
  });
  const app = createApp({ affiliationStore: store, referralStore: store, resolveIdentity: () => ({ userId: PM }), nodeEnv: 'test' });
  return { app };
}
const match = (app) => request(app).post('/api/gpme/match').send({ needCategoryIds: [FOOD] });
const allItems = (body) => [...body.plausible, ...body.possible];
const item = (body, id) => allItems(body).find((p) => p.programId === id);
const withoutInfo = (body) => allItems(body).map(({ programInformation, ...rest }) => rest);

describe('toResultInformation: fixed fields', () => {
  const base = { fields: [] };

  test('shows Description, Schedule and Eligibility notes with clear labels, in order', () => {
    const rows = toResultInformation({ ...base, description: DESC, scheduleNotes: SCHED, eligibilityNotes: ELIG });
    assert.deepEqual(rows, [
      { label: 'Program Description', value: DESC },
      { label: 'Schedule', value: SCHED },
      { label: 'Eligibility notes (information only, not an eligibility decision)', value: ELIG },
    ]);
  });

  test('a blank or missing fixed field is omitted, never shown as a value', () => {
    assert.deepEqual(toResultInformation({ ...base, description: null, scheduleNotes: '   ', eligibilityNotes: undefined }), []);
    assert.deepEqual(toResultInformation({ ...base, description: DESC }).map((r) => r.label), ['Program Description']);
  });

  test('Cost notes is never shown (not named in Handoff PRD 8, 9 or MVP 10)', () => {
    const rows = toResultInformation({ ...base, description: DESC, costNotes: COST });
    assert.equal(JSON.stringify(rows).includes(COST), false);
    assert.equal(FIXED_INFORMATION.some((f) => /cost/i.test(f.key + f.label)), false);
  });

  test('fixed rows come before flexible fields, which are unchanged', () => {
    const rows = toResultInformation({
      description: DESC,
      fields: [{ label: 'Current availability', dataType: 'TEXT', value: 'Synthetic open', options: [] }],
    });
    assert.deepEqual(rows, [
      { label: 'Program Description', value: DESC },
      { label: 'Current availability', value: 'Synthetic open' },
    ]);
  });
});

describe('Find a Program API: fixed fields', () => {
  test('required information appears; Cost notes does not; matching is unchanged', async () => {
    const before = (await match(setup().app)).body;
    const { app } = setup({ description: DESC, scheduleNotes: SCHED, eligibilityNotes: ELIG, costNotes: COST });
    const res = await match(app);
    assert.equal(res.status, 200);

    const labels = item(res.body, 11).programInformation.map((r) => r.label);
    assert.deepEqual(labels, [
      'Program Description', 'Schedule',
      'Eligibility notes (information only, not an eligibility decision)',
    ]);
    assert.equal(JSON.stringify(res.body).includes(COST), false);

    // Blank fixed fields: omitted, so the existing empty state still applies.
    assert.deepEqual(item(res.body, 12).programInformation, []);

    // Matching untouched: same Programs, order, explanations, rule version.
    assert.deepEqual(withoutInfo(res.body), withoutInfo(before));
    assert.equal(res.body.ruleVersion, before.ruleVersion);
  });
});
