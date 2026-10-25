// GET /api/reports/departments: every Department for the report filter,
// including ones with no referrals and ones no longer active. SYNTHETIC data.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';

const MARKER = 'SyntheticMarkerQuery';

function build() {
  return createMemoryReferralStore({
    departments: [
      { departmentId: 1, name: 'Synthetic Dept Beta', lifecycleStatus: 'ACTIVE' },
      { departmentId: 2, name: 'Synthetic Dept Alpha', lifecycleStatus: 'ACTIVE' },
      { departmentId: 3, name: 'Synthetic Dept Gamma (old)', lifecycleStatus: 'DISCONTINUED' },
    ],
    programs: [],
    users: [
      { userId: 100, isActive: true },
      { userId: 900, isActive: false },
    ],
    grants: [],
  });
}

const appAs = (store, userId) => createApp({
  affiliationStore: store,
  referralStore: store,
  resolveIdentity: userId === null ? undefined : () => ({ userId }),
});

describe('GET /api/reports/departments', () => {
  test('lists every Department, with no referrals and any status, by name, with three fields only', async () => {
    const res = await request(appAs(build(), 100)).get('/api/reports/departments');
    assert.equal(res.status, 200);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.deepEqual(res.body, {
      departments: [
        { departmentId: 2, name: 'Synthetic Dept Alpha', lifecycleStatus: 'ACTIVE' },
        { departmentId: 1, name: 'Synthetic Dept Beta', lifecycleStatus: 'ACTIVE' },
        { departmentId: 3, name: 'Synthetic Dept Gamma (old)', lifecycleStatus: 'DISCONTINUED' },
      ],
    });
  });

  test('a Department with no referrals can be reported on: zero, with no data rates', async () => {
    const app = appAs(build(), 100);
    const total = await request(app).get('/api/reports/total-referrals?period=MONTHLY&departmentId=2');
    assert.equal(total.status, 200);
    assert.equal(total.body.value, 0);
    const activity = await request(app).get('/api/reports/referral-activity?period=MONTHLY&departmentId=2');
    assert.equal(activity.status, 200);
    assert.equal(activity.body.summary.totalReferrals, 0);
    assert.equal(activity.body.summary.acceptanceRate.state, 'NO_DATA');
  });

  test('no sign-in is 401, an inactive user is 403, and nothing is returned', async () => {
    const none = await request(appAs(build(), null)).get('/api/reports/departments');
    assert.equal(none.status, 401);
    assert.equal(none.body.departments, undefined);
    const inactive = await request(appAs(build(), 900)).get('/api/reports/departments');
    assert.equal(inactive.status, 403);
    assert.equal(inactive.body.departments, undefined);
  });

  test('no store configured is 503', async () => {
    const res = await request(createApp({ resolveIdentity: () => ({ userId: 100 }) })).get('/api/reports/departments');
    assert.equal(res.status, 503);
  });

  test('any query parameter is refused without echoing it', async () => {
    const app = appAs(build(), 100);
    for (const url of [`/api/reports/departments?${MARKER}=1`, `/api/reports/departments?x=${MARKER}`, '/api/reports/departments?userId=5']) {
      const res = await request(app).get(url);
      assert.equal(res.status, 400, url);
      assert.doesNotMatch(res.text, new RegExp(MARKER));
      assert.equal(res.body.departments, undefined);
    }
  });

  test('the response is IDs, names and status only', async () => {
    const res = await request(appAs(build(), 100)).get('/api/reports/departments');
    assert.doesNotMatch(res.text, /referralId|submissionId|participant|contact|email|count/i);
  });
});
