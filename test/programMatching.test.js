import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
import { createProgramService } from '../src/programs/programService.js';
import { validateMatchingChange } from '../src/programs/validateMatchingChange.js';

const original = {
  needCategoryIds: [1], ageLimitState: 'SET', ageMin: 18, ageMax: null,
  serviceAreaState: 'SET', serviceAreaZips: ['99901'],
};
const changed = {
  needCategoryIds: [2], ageLimitState: 'SET', ageMin: 21, ageMax: 60,
  serviceAreaState: 'SET', serviceAreaZips: ['99902'],
};
// Saved facts always include languageIds (Task W). These bodies leave it
// out, so the Program's languages (none on file here) are kept.
const NO_LANGUAGES = { languageIds: [] };
function setup() {
  const grant = (userId, permission, programId = 11, scopeType = 'PROGRAM') => ({
    userId, permission, programId, scopeType, departmentId: null, grantSource: 'IN_APP',
  });
  const store = createMemoryReferralStore({
    departments: [{ departmentId: 1, name: 'Synthetic Department', lifecycleStatus: 'ACTIVE' }],
    programs: [
      { programId: 11, departmentId: 1, name: 'Synthetic managed Program', lifecycleStatus: 'ACTIVE', ...original },
      { programId: 12, departmentId: 1, name: 'Synthetic other Program', lifecycleStatus: 'ACTIVE' },
    ],
    users: [1, 2, 3, 4].map((userId) => ({ userId, isActive: userId !== 4 })),
    grants: [
      grant(1, 'MANAGE_PROGRAM'), grant(2, 'MANAGE_PROGRAM', 12),
      grant(3, 'MANAGE_ORGANIZATION', null, 'ORG'), grant(4, 'MANAGE_PROGRAM'),
    ],
    needCategories: [
      { needCategoryId: 1, name: 'Synthetic category one', lifecycleStatus: 'ACTIVE' },
      { needCategoryId: 2, name: 'Synthetic category two', lifecycleStatus: 'ACTIVE' },
      { needCategoryId: 3, name: 'Synthetic discontinued category', lifecycleStatus: 'DISCONTINUED' },
    ],
  });
  return { store, service: createProgramService({ store }) };
}
const state = (store) => JSON.stringify([store._allPrograms(), store._referralAuditEvents]);
const refused = (promise, code) => assert.rejects(promise, (error) => error.code === code);

test('matching edits require the specific Program grant before body validation', async () => {
  const { store, service } = setup();
  const before = state(store);
  for (const user of [2, 3]) {
    await refused(service.getMatchingFacts(user, 11), 'NOT_AUTHORIZED');
    await refused(service.updateMatchingFacts(user, 11, {}), 'NOT_AUTHORIZED');
  }
  for (const user of [4, 999]) {
    await refused(service.updateMatchingFacts(user, 11, {}), 'USER_NOT_ACTIVE');
  }
  assert.equal(state(store), before);
});

test('valid matching changes update facts and version with one atomic audit event', async () => {
  const { store, service } = setup();
  const initial = await service.getMatchingFacts(1, 11);
  const result = await service.updateMatchingFacts(1, 11,
    { version: initial.program.version, ...changed }, { correlationId: 'synthetic-matching-change' });
  assert.deepEqual(result.facts, { ...changed, ...NO_LANGUAGES });
  assert.notEqual(result.program.version, initial.program.version);
  const events = store._referralAuditEvents;
  assert.equal(events.length, 1);
  assert.equal(events[0].entityType, 'PROGRAM');
  assert.equal(events[0].entityId, 11);
  assert.equal(events[0].action, 'UPDATED');
  assert.equal(events[0].actorUserId, 1);
  assert.equal(events[0].correlationId, 'synthetic-matching-change');
  assert.deepEqual(events[0].before, { matching_facts: { ...original, ...NO_LANGUAGES } });
  assert.deepEqual(events[0].after, { matching_facts: { ...changed, ...NO_LANGUAGES } });
  assert.match(events[0].occurredAt, /Z$/);
  const matchable = await store.listMatchablePrograms();
  assert.equal(matchable.find((row) => row.program.programId === 11).program.ageMin, 21);
  await refused(service.updateDetails(1, 11,
    { version: initial.program.version, description: 'Synthetic stale common edit' }), 'PROGRAM_CHANGED');
});

test('invalid limits, duplicate lists and unknown categories write nothing', async () => {
  const { store, service } = setup();
  const version = (await store.getProgram(11)).version;
  const before = state(store);
  for (const patch of [
    { ageMin: 70, ageMax: 20 },
    { ageLimitState: 'NO_RESTRICTION' },
    { serviceAreaZips: [] },
    { serviceAreaZips: ['bad'] },
    { serviceAreaZips: ['99902', '99902'] },
    { needCategoryIds: [2, 2] },
    { needCategoryIds: [999] },
    { needCategoryIds: [3] },
  ]) {
    await refused(service.updateMatchingFacts(1, 11, { version, ...changed, ...patch }), 'INVALID_REQUEST');
    assert.equal(state(store), before);
  }
  assert.equal(validateMatchingChange({ version, ...changed, ageMin: undefined }).ok, false);
  assert.equal(validateMatchingChange({ version, ...changed, needCategoryIds: undefined }).ok, false);
  assert.equal(validateMatchingChange({ version, ...changed, serviceAreaState: undefined }).ok, false);
});

test('audit failure rolls matching facts and Program version back together', async () => {
  const { store, service } = setup();
  const version = (await store.getProgram(11)).version;
  const before = state(store);
  store._failNextAudit();
  await assert.rejects(service.updateMatchingFacts(1, 11, { version, ...changed }));
  assert.equal(state(store), before);
  const retried = await service.updateMatchingFacts(1, 11, { version, ...changed });
  assert.deepEqual(retried.facts, { ...changed, ...NO_LANGUAGES });
});

test('two matching writers with one version cannot silently overwrite each other', async () => {
  const { store, service } = setup();
  const version = (await store.getProgram(11)).version;
  const results = await Promise.allSettled([
    service.updateMatchingFacts(1, 11, { version, ...changed }),
    service.updateMatchingFacts(1, 11, { version, ...changed, ageMin: 30 }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const failure = results.find((result) => result.status === 'rejected');
  assert.equal(failure.reason.code, 'PROGRAM_CHANGED');
  assert.ok(failure.reason.current.matchingFacts);
  assert.equal(store._referralAuditEvents.length, 1);
});

test('HTTP matching updates are no-store and reject unexpected fields without echo', async () => {
  const { store } = setup();
  const app = createApp({
    affiliationStore: store, referralStore: store,
    resolveIdentity: () => ({ userId: 1 }), nodeEnv: 'test',
  });
  const url = '/api/program-management/programs/11/matching-facts';
  const read = await request(app).get(url);
  assert.equal(read.status, 200);
  assert.equal(read.headers['cache-control'], 'no-store');
  const before = state(store);
  const marker = 'SyntheticUnexpectedMatchingMarker';
  const invalid = await request(app).put(url).send({
    version: read.body.program.version, ...changed, [marker]: marker,
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, 'UNEXPECTED_FIELD');
  assert.ok(!invalid.text.includes(marker));
  assert.equal(state(store), before);
  const saved = await request(app).put(url).send({ version: read.body.program.version, ...changed });
  assert.equal(saved.status, 200);
  assert.equal(saved.headers['cache-control'], 'no-store');
  assert.deepEqual(saved.body.facts, { ...changed, ...NO_LANGUAGES });
});
