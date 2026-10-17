// Program listing and staff Program affiliation (Trello card 2).
// All data below is SYNTHETIC.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createAffiliationService } from '../src/affiliation/affiliationService.js';
import { createMemoryStore } from '../src/affiliation/memoryStore.js';

function seed(options) {
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
  }, options);
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code);
    return true;
  });
}

// Reads the current version first, as the UI does, then changes it.
async function choose(service, userId, programId, options) {
  const { version } = await service.getAffiliation(userId);
  return service.setAffiliation(userId, { programId, version }, options);
}

describe('active Program retrieval', () => {
  test('lists only ACTIVE Programs in ACTIVE Departments, sorted by name', async () => {
    const service = createAffiliationService({ store: seed() });
    const programs = await service.listActivePrograms(100);

    assert.deepEqual(programs.map((p) => p.programId), [11, 10]);
  });

  test('returns minimum-necessary fields only (no routing or notification data)', async () => {
    const service = createAffiliationService({ store: seed() });
    const [first] = await service.listActivePrograms(100);

    assert.deepEqual(Object.keys(first).sort(), ['departmentId', 'departmentName', 'name', 'programId', 'site']);
  });

  test('inactive and unknown users cannot list Programs', async () => {
    const service = createAffiliationService({ store: seed() });
    await rejectsWith(service.listActivePrograms(102), 'USER_NOT_ACTIVE');
    await rejectsWith(service.listActivePrograms(999), 'USER_NOT_ACTIVE');
  });
});

describe('staff-selected Program affiliation', () => {
  test('a new user has no affiliation and nothing is preselected', async () => {
    const service = createAffiliationService({ store: seed() });
    const result = await service.getAffiliation(100);

    assert.equal(result.status, 'NOT_SET');
    assert.equal(result.program, null);
    assert.equal(typeof result.version, 'string');
  });

  test('a user can choose an active Program; the change is audited with a store timestamp', async () => {
    const store = seed({ now: () => new Date('2026-10-17T14:00:00.000Z') });
    const service = createAffiliationService({ store });

    const result = await choose(service, 100, 10, { correlationId: 'c-1' });

    assert.equal(result.status, 'SET');
    assert.equal(result.program.programId, 10);
    assert.deepEqual(await service.getAffiliation(100), result);
    assert.deepEqual(store._auditEvents, [{
      entityType: 'USER',
      entityId: 100,
      action: 'UPDATED',
      actorUserId: 100,
      occurredAt: '2026-10-17T14:00:00.000Z',
      before: { current_program_id: null },
      after: { current_program_id: 10 },
      correlationId: 'c-1',
    }]);
  });

  test('choosing the same Program again writes no new audit event', async () => {
    const store = seed();
    const service = createAffiliationService({ store });

    await choose(service, 100, 10);
    await choose(service, 100, 10);

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

      await rejectsWith(choose(service, 100, programId), 'PROGRAM_NOT_SELECTABLE');
      assert.equal((await service.getAffiliation(100)).status, 'NOT_SET');
      assert.equal(store._auditEvents.length, 0);
    });
  }

  for (const [label, body] of [
    ['a body with an extra userId field', { programId: 10, version: 'v1', userId: 101 }],
    ['a body with an extra referringProgramId field', { programId: 10, version: 'v1', referringProgramId: 11 }],
    ['a body without a version', { programId: 10 }],
    ['a numeric version', { programId: 10, version: 1 }],
    ['an empty version', { programId: 10, version: '' }],
    ['an oversized version', { programId: 10, version: 'v'.repeat(65) }],
    ['a string programId', { programId: '10', version: 'v1' }],
    ['a decimal programId', { programId: 10.5, version: 'v1' }],
    ['a zero programId', { programId: 0, version: 'v1' }],
    ['a negative programId', { programId: -10, version: 'v1' }],
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
    await rejectsWith(service.setAffiliation(102, { programId: 10, version: 'v1' }), 'USER_NOT_ACTIVE');
  });

  test('if the chosen Program is later discontinued, the user must choose again', async () => {
    const store = seed();
    const service = createAffiliationService({ store });
    await choose(service, 100, 10);

    store._setProgramStatus(10, 'DISCONTINUED');

    const result = await service.getAffiliation(100);
    assert.equal(result.status, 'PROGRAM_NOT_ACTIVE');
    assert.equal(result.program, null);
  });
});

describe('stale updates are rejected (PRD 9.4)', () => {
  test('a version the client did not see is refused with the current affiliation; nothing changes', async () => {
    const store = seed();
    const service = createAffiliationService({ store });
    const { version: seenByTabA } = await service.getAffiliation(100);
    await choose(service, 100, 11); // another tab changes it

    await assert.rejects(service.setAffiliation(100, { programId: 10, version: seenByTabA }), (err) => {
      assert.equal(err.code, 'AFFILIATION_CHANGED');
      assert.equal(err.status, 409);
      assert.equal(err.current.status, 'SET');
      assert.equal(err.current.program.programId, 11, 'conflict shows the authoritative current state');
      return true;
    });
    assert.equal((await store.getUser(100)).currentProgramId, 11, 'unchanged');
    assert.equal(store._auditEvents.length, 1, 'no audit event for the refused update');
  });

  test('even re-selecting the same Program with a stale version is refused', async () => {
    const service = createAffiliationService({ store: seed() });
    const { version: stale } = await service.getAffiliation(100);
    await choose(service, 100, 11);
    await rejectsWith(service.setAffiliation(100, { programId: 11, version: stale }), 'AFFILIATION_CHANGED');
  });

  test('every successful change returns a new version', async () => {
    const service = createAffiliationService({ store: seed() });
    const first = await choose(service, 100, 10);
    const second = await service.setAffiliation(100, { programId: 11, version: first.version });
    assert.notEqual(second.version, first.version);
    assert.equal((await service.getAffiliation(100)).version, second.version);
  });

  test('overlapping updates with the same version: exactly one wins, one audit event', async () => {
    const store = seed();
    const service = createAffiliationService({ store });
    const { version } = await service.getAffiliation(100);

    const results = await Promise.allSettled([
      service.setAffiliation(100, { programId: 10, version }),
      service.setAffiliation(100, { programId: 11, version }),
    ]);

    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');
    assert.equal(won.length, 1);
    assert.equal(lost.length, 1);
    assert.equal(lost[0].reason.code, 'AFFILIATION_CHANGED');
    assert.equal((await store.getUser(100)).currentProgramId, won[0].value.program.programId, 'stored state = the winner');
    assert.equal(store._auditEvents.length, 1);
    assert.deepEqual(store._auditEvents[0].after, { current_program_id: won[0].value.program.programId });
  });

  test('the store refuses a stale version even if the service check is bypassed', async () => {
    const store = seed();
    const result = await store.updateUserProgramAffiliation({
      userId: 100, expectedVersion: 'v999', fromProgramId: null, toProgramId: 10, actorUserId: 100, correlationId: null,
    });
    assert.equal(result, null);
    assert.equal((await store.getUser(100)).currentProgramId, null);
    assert.equal(store._auditEvents.length, 0);
  });
});

describe('update and audit are atomic (PRD 9.3, 9.6)', () => {
  test('if the audit write fails, the affiliation does not change', async () => {
    const store = seed();
    const service = createAffiliationService({ store });
    const before = await service.getAffiliation(100);

    store._failNextAudit();
    await assert.rejects(service.setAffiliation(100, { programId: 10, version: before.version }));

    const after = await service.getAffiliation(100);
    assert.deepEqual(after, before, 'affiliation and version unchanged');
    assert.equal(store._auditEvents.length, 0, 'no audit event either');
  });

  test('after a failed attempt the same version can be retried', async () => {
    const store = seed();
    const service = createAffiliationService({ store });
    const { version } = await service.getAffiliation(100);

    store._failNextAudit();
    await assert.rejects(service.setAffiliation(100, { programId: 10, version }));
    const retry = await service.setAffiliation(100, { programId: 10, version });

    assert.equal(retry.program.programId, 10);
    assert.equal(store._auditEvents.length, 1);
  });

  test('audit timestamps come from the store clock, not the caller', async () => {
    const store = seed({ now: () => new Date('2026-10-17T15:30:00.000Z') });
    const service = createAffiliationService({ store });
    await choose(service, 100, 10, { correlationId: 'c-2', occurredAt: '1999-01-01T00:00:00Z' });
    assert.equal(store._auditEvents[0].occurredAt, '2026-10-17T15:30:00.000Z');
  });
});

describe('Referring Program for a new referral', () => {
  test('is the submitter\'s current affiliation, with its Department', async () => {
    const service = createAffiliationService({ store: seed() });
    await choose(service, 100, 11);

    assert.deepEqual(await service.resolveReferringProgram(100), {
      referringProgramId: 11,
      referringDepartmentId: 2,
    });
  });

  test('a matching submitted Referring Program is accepted', async () => {
    const service = createAffiliationService({ store: seed() });
    await choose(service, 100, 11);

    const result = await service.resolveReferringProgram(100, 11);
    assert.equal(result.referringProgramId, 11);
  });

  test('a referral cannot select a different Referring Program', async () => {
    const service = createAffiliationService({ store: seed() });
    await choose(service, 100, 11);

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
    await choose(service, 100, 10);
    store._setProgramStatus(10, 'DISCONTINUED');

    await rejectsWith(service.resolveReferringProgram(100), 'AFFILIATION_PROGRAM_NOT_ACTIVE');
  });

  test('changing affiliation affects future referrals only', async () => {
    const service = createAffiliationService({ store: seed() });
    await choose(service, 100, 10);
    const earlierReferral = await service.resolveReferringProgram(100);

    await choose(service, 100, 11);
    const laterReferral = await service.resolveReferringProgram(100);

    assert.equal(earlierReferral.referringProgramId, 10, 'earlier value is unchanged');
    assert.ok(Object.isFrozen(earlierReferral));
    assert.equal(laterReferral.referringProgramId, 11);
  });

  test('one user\'s affiliation does not affect another user', async () => {
    const service = createAffiliationService({ store: seed() });
    await choose(service, 100, 10);

    await rejectsWith(service.resolveReferringProgram(101), 'AFFILIATION_REQUIRED');
  });
});

describe('HTTP routes', () => {
  const asUser = (userId) => () => ({ userId });
  const routes = [['get', '/api/programs'], ['get', '/api/me/affiliation'], ['put', '/api/me/affiliation']];

  test('every route fails closed with 401 when no sign-in is configured', async () => {
    const app = createApp({ affiliationStore: seed() });

    for (const [method, path] of routes) {
      const response = await request(app)[method](path).send({ programId: 10, version: 'v1' });
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

  for (const [label, userId] of [['an inactive user', 102], ['an identity with no user record', 999]]) {
    test(`${label} gets 403 on every route and no data (application access boundary)`, async () => {
      const store = seed();
      const app = createApp({ affiliationStore: store, resolveIdentity: asUser(userId) });
      for (const [method, path] of routes) {
        const response = await request(app)[method](path).send({ programId: 10, version: 'v1' });
        assert.equal(response.status, 403, `${method} ${path}`);
        assert.equal(response.body.code, 'USER_NOT_ACTIVE');
        assert.equal(response.body.programs, undefined);
        assert.ok(!response.text.includes('Program'), `${method} ${path} leaks no Program data`);
      }
      assert.equal(store._auditEvents.length, 0);
    });
  }

  test('GET /api/programs returns active Programs and is not cacheable', async () => {
    const app = createApp({ affiliationStore: seed(), resolveIdentity: asUser(100) });
    const response = await request(app).get('/api/programs');

    assert.equal(response.status, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(response.body.programs.map((p) => p.programId), [11, 10]);
    assert.ok(!response.text.includes('example.test'), 'no notification email in output');
  });

  test('GET returns a version; PUT with it saves; GET shows the result', async () => {
    const app = createApp({ affiliationStore: seed(), resolveIdentity: asUser(100) });

    const { body: current } = await request(app).get('/api/me/affiliation');
    const put = await request(app).put('/api/me/affiliation').send({ programId: 10, version: current.version });
    assert.equal(put.status, 200);
    assert.equal(put.body.program.programId, 10);

    const get = await request(app).get('/api/me/affiliation');
    assert.deepEqual(get.body, put.body);
  });

  test('a stale PUT returns 409 with the current affiliation and saves nothing', async () => {
    const store = seed();
    const app = createApp({ affiliationStore: store, resolveIdentity: asUser(100) });
    const { body: seen } = await request(app).get('/api/me/affiliation');
    await request(app).put('/api/me/affiliation').send({ programId: 11, version: seen.version });

    const stale = await request(app).put('/api/me/affiliation').send({ programId: 10, version: seen.version });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'AFFILIATION_CHANGED');
    assert.equal(stale.body.current.program.programId, 11);
    assert.equal((await store.getUser(100)).currentProgramId, 11);
    assert.equal(store._auditEvents.length, 1);
  });

  test('the user is never taken from the body or query string', async () => {
    const store = seed();
    const app = createApp({ affiliationStore: store, resolveIdentity: asUser(100) });
    const { body: current } = await request(app).get('/api/me/affiliation');

    const withBodyUser = await request(app).put('/api/me/affiliation').send({ programId: 10, version: current.version, userId: 101 });
    assert.equal(withBodyUser.status, 400);
    assert.equal(withBodyUser.body.code, 'INVALID_REQUEST');

    await request(app).put('/api/me/affiliation?userId=101').send({ programId: 10, version: current.version });
    assert.equal((await store.getUser(100)).currentProgramId, 10);
    assert.equal((await store.getUser(101)).currentProgramId, null);
  });

  test('rejects an inactive Program with 422', async () => {
    const app = createApp({ affiliationStore: seed(), resolveIdentity: asUser(100) });
    const response = await request(app).put('/api/me/affiliation').send({ programId: 12, version: 'v1' });

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

  test('the sign-in check and 1kb body limit apply only to this router\'s own paths', async () => {
    // Without scoping, any other /api request would get 401 here (or 400
    // for a body over 1kb) instead of reaching the router meant for it.
    const app = createApp({ affiliationStore: seed() }); // no sign-in configured
    const other = await request(app).post('/api/some-other-feature').send({ text: 'x'.repeat(5000) });
    assert.notEqual(other.status, 401);
    assert.notEqual(other.status, 400);
    assert.equal(other.status, 404);
  });
});
