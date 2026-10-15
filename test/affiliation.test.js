// Program listing and staff Program affiliation (Trello card 2).
// All data below is SYNTHETIC.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createAffiliationService } from '../src/affiliation/affiliationService.js';
import { createMemoryStore } from '../src/affiliation/memoryStore.js';

function seed() {
  return createMemoryStore({
    departments: [
      { departmentId: 1, name: 'Synthetic Dept A', lifecycleStatus: 'ACTIVE' },
      { departmentId: 2, name: 'Synthetic Dept B', lifecycleStatus: 'ACTIVE' },
      { departmentId: 3, name: 'Synthetic Dept Closed', lifecycleStatus: 'DISCONTINUED' },
    ],
    programs: [
      { programId: 10, departmentId: 1, name: 'Zeta Program', site: 'Site 1', lifecycleStatus: 'ACTIVE', notificationEmail: 'inbox@example.test' },
      { programId: 11, departmentId: 2, name: 'Alpha Program', site: null, lifecycleStatus: 'ACTIVE', notificationEmail: 'inbox@example.test' },
      { programId: 12, departmentId: 1, name: 'Old Program', site: 'Site 2', lifecycleStatus: 'DISCONTINUED' },
      { programId: 13, departmentId: 1, name: 'Retired Program', site: 'Site 3', lifecycleStatus: 'RETIRED' },
      { programId: 14, departmentId: 3, name: 'Program In Closed Dept', site: null, lifecycleStatus: 'ACTIVE' },
    ],
    users: [
      { userId: 100, isActive: true },
      { userId: 101, isActive: true },
      { userId: 102, isActive: false },
    ],
  });
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code);
    return true;
  });
}

describe('active Program retrieval', () => {
  test('lists only ACTIVE Programs in ACTIVE Departments, sorted by name', async () => {
    const service = createAffiliationService({ store: seed() });
    const programs = await service.listActivePrograms();

    assert.deepEqual(programs.map((p) => p.programId), [11, 10]);
  });

  test('returns minimum-necessary fields only (no routing or notification data)', async () => {
    const service = createAffiliationService({ store: seed() });
    const [first] = await service.listActivePrograms();

    assert.deepEqual(Object.keys(first).sort(), ['departmentId', 'departmentName', 'name', 'programId', 'site']);
  });
});

describe('staff-selected Program affiliation', () => {
  test('a new user has no affiliation and nothing is preselected', async () => {
    const service = createAffiliationService({ store: seed() });

    assert.deepEqual(await service.getAffiliation(100), { status: 'NOT_SET', program: null });
  });

  test('a user can choose an active Program; the change is audited', async () => {
    const store = seed();
    const service = createAffiliationService({ store });

    const result = await service.setAffiliation(100, { programId: 10 }, { correlationId: 'c-1' });

    assert.equal(result.status, 'SET');
    assert.equal(result.program.programId, 10);
    assert.deepEqual(await service.getAffiliation(100), result);
    assert.deepEqual(store._auditEvents, [{
      entityType: 'USER',
      entityId: 100,
      action: 'UPDATED',
      actorUserId: 100,
      before: { current_program_id: null },
      after: { current_program_id: 10 },
      correlationId: 'c-1',
    }]);
  });

  test('choosing the same Program again writes no new audit event', async () => {
    const store = seed();
    const service = createAffiliationService({ store });

    await service.setAffiliation(100, { programId: 10 });
    await service.setAffiliation(100, { programId: 10 });

    assert.equal(store._auditEvents.length, 1);
  });

  for (const [label, programId] of [
    ['a discontinued Program', 12],
    ['a retired Program', 13],
    ['an active Program in a discontinued Department', 14],
    ['a Program that does not exist', 999],
  ]) {
    test(`rejects ${label}`, async () => {
      const store = seed();
      const service = createAffiliationService({ store });

      await rejectsWith(service.setAffiliation(100, { programId }), 'PROGRAM_NOT_SELECTABLE');
      assert.equal((await service.getAffiliation(100)).status, 'NOT_SET');
      assert.equal(store._auditEvents.length, 0);
    });
  }

  for (const [label, body] of [
    ['a body with an extra userId field', { programId: 10, userId: 101 }],
    ['a body with an extra referringProgramId field', { programId: 10, referringProgramId: 11 }],
    ['a string programId', { programId: '10' }],
    ['a decimal programId', { programId: 10.5 }],
    ['a zero programId', { programId: 0 }],
    ['a negative programId', { programId: -10 }],
    ['an empty body', {}],
    ['a null body', null],
    ['an array body', [10]],
  ]) {
    test(`rejects ${label}`, async () => {
      const store = seed();
      const service = createAffiliationService({ store });

      await rejectsWith(service.setAffiliation(100, body), 'INVALID_REQUEST');
      assert.equal(store._auditEvents.length, 0);
    });
  }

  test('an inactive user cannot read or set an affiliation', async () => {
    const service = createAffiliationService({ store: seed() });

    await rejectsWith(service.getAffiliation(102), 'USER_NOT_ACTIVE');
    await rejectsWith(service.setAffiliation(102, { programId: 10 }), 'USER_NOT_ACTIVE');
  });

  test('if the chosen Program is later discontinued, the user must choose again', async () => {
    const store = seed();
    const service = createAffiliationService({ store });
    await service.setAffiliation(100, { programId: 10 });

    store._setProgramStatus(10, 'DISCONTINUED');

    assert.deepEqual(await service.getAffiliation(100), { status: 'PROGRAM_NOT_ACTIVE', program: null });
  });
});

describe('Referring Program for a new referral', () => {
  test('is the submitter\'s current affiliation, with its Department', async () => {
    const service = createAffiliationService({ store: seed() });
    await service.setAffiliation(100, { programId: 11 });

    assert.deepEqual(await service.resolveReferringProgram(100), {
      referringProgramId: 11,
      referringDepartmentId: 2,
    });
  });

  test('a matching submitted Referring Program is accepted', async () => {
    const service = createAffiliationService({ store: seed() });
    await service.setAffiliation(100, { programId: 11 });

    const result = await service.resolveReferringProgram(100, 11);
    assert.equal(result.referringProgramId, 11);
  });

  test('a referral cannot select a different Referring Program', async () => {
    const service = createAffiliationService({ store: seed() });
    await service.setAffiliation(100, { programId: 11 });

    await rejectsWith(service.resolveReferringProgram(100, 10), 'REFERRING_PROGRAM_MISMATCH');
    await rejectsWith(service.resolveReferringProgram(100, '11'), 'REFERRING_PROGRAM_MISMATCH');
  });

  test('fails closed when the user has no affiliation', async () => {
    const service = createAffiliationService({ store: seed() });

    await rejectsWith(service.resolveReferringProgram(100), 'AFFILIATION_REQUIRED');
  });

  test('fails closed when the affiliated Program is no longer active', async () => {
    const store = seed();
    const service = createAffiliationService({ store });
    await service.setAffiliation(100, { programId: 10 });
    store._setProgramStatus(10, 'DISCONTINUED');

    await rejectsWith(service.resolveReferringProgram(100), 'AFFILIATION_PROGRAM_NOT_ACTIVE');
  });

  test('changing affiliation affects future referrals only', async () => {
    const service = createAffiliationService({ store: seed() });
    await service.setAffiliation(100, { programId: 10 });
    const earlierReferral = await service.resolveReferringProgram(100);

    await service.setAffiliation(100, { programId: 11 });
    const laterReferral = await service.resolveReferringProgram(100);

    assert.equal(earlierReferral.referringProgramId, 10, 'earlier value is unchanged');
    assert.ok(Object.isFrozen(earlierReferral));
    assert.equal(laterReferral.referringProgramId, 11);
  });

  test('one user\'s affiliation does not affect another user', async () => {
    const service = createAffiliationService({ store: seed() });
    await service.setAffiliation(100, { programId: 10 });

    await rejectsWith(service.resolveReferringProgram(101), 'AFFILIATION_REQUIRED');
  });
});

describe('HTTP routes', () => {
  const asUser = (userId) => () => ({ userId });

  test('every route fails closed with 401 when no sign-in is configured', async () => {
    const app = createApp({ affiliationStore: seed() });

    for (const [method, path] of [['get', '/api/programs'], ['get', '/api/me/affiliation'], ['put', '/api/me/affiliation']]) {
      const response = await request(app)[method](path).send({ programId: 10 });
      assert.equal(response.status, 401, `${method} ${path}`);
      assert.equal(response.body.code, 'NOT_AUTHENTICATED');
      assert.equal(response.body.programs, undefined);
    }
  });

  test('createApp() with no arguments still fails closed on /api', async () => {
    const response = await request(createApp()).get('/api/programs');
    assert.equal(response.status, 401);
  });

  test('answers 503 when signed in but no data store is configured', async () => {
    const response = await request(createApp({ resolveIdentity: asUser(100) })).get('/api/programs');
    assert.equal(response.status, 503);
    assert.equal(response.body.code, 'NOT_CONFIGURED');
  });

  test('GET /api/programs returns active Programs and is not cacheable', async () => {
    const app = createApp({ affiliationStore: seed(), resolveIdentity: asUser(100) });
    const response = await request(app).get('/api/programs');

    assert.equal(response.status, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(response.body.programs.map((p) => p.programId), [11, 10]);
    assert.ok(!response.text.includes('example.test'), 'no notification email in output');
  });

  test('PUT then GET /api/me/affiliation for the signed-in user', async () => {
    const app = createApp({ affiliationStore: seed(), resolveIdentity: asUser(100) });

    const put = await request(app).put('/api/me/affiliation').send({ programId: 10 });
    assert.equal(put.status, 200);
    assert.equal(put.body.program.programId, 10);

    const get = await request(app).get('/api/me/affiliation');
    assert.deepEqual(get.body, put.body);
  });

  test('the user is never taken from the body or query string', async () => {
    const store = seed();
    const app = createApp({ affiliationStore: store, resolveIdentity: asUser(100) });

    const withBodyUser = await request(app).put('/api/me/affiliation').send({ programId: 10, userId: 101 });
    assert.equal(withBodyUser.status, 400);
    assert.equal(withBodyUser.body.code, 'INVALID_REQUEST');

    await request(app).put('/api/me/affiliation?userId=101').send({ programId: 10 });
    assert.equal((await store.getUser(100)).currentProgramId, 10);
    assert.equal((await store.getUser(101)).currentProgramId, null);
  });

  test('rejects an inactive Program with 422', async () => {
    const app = createApp({ affiliationStore: seed(), resolveIdentity: asUser(100) });
    const response = await request(app).put('/api/me/affiliation').send({ programId: 12 });

    assert.equal(response.status, 422);
    assert.equal(response.body.code, 'PROGRAM_NOT_SELECTABLE');
  });

  test('malformed JSON returns 400 without echoing the input', async () => {
    const app = createApp({ affiliationStore: seed(), resolveIdentity: asUser(100) });
    const response = await request(app)
      .put('/api/me/affiliation')
      .set('Content-Type', 'application/json')
      .send('{"programId": SECRET-123');

    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'INVALID_REQUEST');
    assert.ok(!response.text.includes('SECRET-123'));
  });
});
