// Where GPME (card 10) meets Program Management (card 14): both read and
// change the same Program rows. All data is SYNTHETIC.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';

const FOOD = 1;
const ORG_ADMIN = 200;
const PM = 201; // MANAGE_PROGRAM for Program 11

function setup() {
  const store = createMemoryReferralStore({
    departments: [
      { departmentId: 1, name: 'Synthetic Dept A', lifecycleStatus: 'ACTIVE' },
      { departmentId: 2, name: 'Synthetic Dept B', lifecycleStatus: 'ACTIVE' },
    ],
    programs: [
      { programId: 11, departmentId: 1, name: 'Synthetic Pantry', site: null, lifecycleStatus: 'ACTIVE',
        needCategoryIds: [FOOD], ageLimitState: 'NO_RESTRICTION', serviceAreaState: 'NO_RESTRICTION' },
      { programId: 12, departmentId: 2, name: 'Synthetic Meals', site: null, lifecycleStatus: 'ACTIVE',
        needCategoryIds: [FOOD], ageLimitState: 'NO_RESTRICTION', serviceAreaState: 'NO_RESTRICTION' },
    ],
    needCategories: [{ needCategoryId: FOOD, name: 'Food' }],
    users: [{ userId: ORG_ADMIN, isActive: true }, { userId: PM, isActive: true }],
    grants: [
      { userId: ORG_ADMIN, permission: 'MANAGE_ORGANIZATION', scopeType: 'ORG', programId: null, departmentId: null, grantSource: 'IN_APP' },
      { userId: PM, permission: 'MANAGE_PROGRAM', scopeType: 'PROGRAM', programId: 11, departmentId: null, grantSource: 'IN_APP' },
    ],
  });
  let userId = ORG_ADMIN;
  const app = createApp({ affiliationStore: store, referralStore: store, resolveIdentity: () => ({ userId }), nodeEnv: 'test' });
  return { store, app, as: (id) => { userId = id; } };
}

const match = (app) => request(app).post('/api/gpme/match').send({ needCategoryIds: [FOOD] });
const matchedIds = (body) => [...body.plausible, ...body.possible].map((p) => p.programId).sort((a, b) => a - b);

describe('GPME and Program Management share Program rows', () => {
  test('a Program created in 14C starts with matching facts "not on file" and is not matched on need yet', async () => {
    const { store, app } = setup();
    const created = await request(app).post('/api/program-management/programs').send({ departmentId: 1, name: 'Synthetic New Pantry' });
    assert.equal(created.status, 201);
    const row = await store.getProgram(created.body.program.programId);
    assert.deepEqual(
      [row.needCategoryIds, row.ageLimitState, row.serviceAreaState, row.serviceAreaZips],
      [[], 'NOT_ON_FILE', 'NOT_ON_FILE', []],
    );
    const res = await match(app);
    assert.equal(res.status, 200);
    assert.deepEqual(matchedIds(res.body), [11, 12]);
  });

  test('a Program in a discontinued Department drops out of GPME results', async () => {
    const { store, app, as } = setup();
    as(ORG_ADMIN);
    const moved = await request(app).post('/api/program-management/programs/12/move')
      .send({ version: (await store.getProgram(12)).version, departmentId: 1 });
    assert.equal(moved.body.status, 'MOVED');
    assert.equal((await request(app).post('/api/program-management/departments/2/discontinue')
      .send({ version: (await store.getDepartment(2)).version })).body.status, 'DISCONTINUED');
    assert.deepEqual(matchedIds((await match(app)).body), [11, 12], 'moved Program still matched');
    // Discontinue the Program the Director manages: it leaves GPME results too.
    as(PM);
    await request(app).post('/api/program-management/programs/11/discontinue').send({ version: (await store.getProgram(11)).version });
    assert.deepEqual(matchedIds((await match(app)).body), [12]);
  });

  test('changing matching facts moves the Program version, so a stale Program edit is refused', async () => {
    const { store, app, as } = setup();
    as(PM);
    const seen = (await store.getProgram(11)).version;
    await store.updateProgramMatchingFacts({ programId: 11, serviceAreaState: 'SET', serviceAreaZips: ['99901'] });
    assert.notEqual((await store.getProgram(11)).version, seen);
    const stale = await request(app).patch('/api/program-management/programs/11').send({ version: seen, description: 'Synthetic' });
    assert.deepEqual([stale.status, stale.body.code], [409, 'PROGRAM_CHANGED']);
  });

  test('a Program edit keeps matching facts, and reads cannot change the stored lists', async () => {
    const { store, app, as } = setup();
    as(PM);
    const res = await request(app).patch('/api/program-management/programs/11')
      .send({ version: (await store.getProgram(11)).version, description: 'Synthetic description' });
    assert.equal(res.body.status, 'UPDATED');
    const row = await store.getProgram(11);
    assert.deepEqual(row.needCategoryIds, [FOOD]);
    row.needCategoryIds.push(999);
    assert.deepEqual((await store.getProgram(11)).needCategoryIds, [FOOD]);
    assert.equal(res.body.program.needCategoryIds, undefined, 'the maintenance view does not expose GPME facts');
  });
});
