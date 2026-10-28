// Trello Task CC: independent adversarial review of permission management
// (Task Y, PR #63; Handoff PRD §22, §23, §24, §32, §34, §36).
//
// Written by someone other than the Task Y builder, to attack it rather
// than describe it. Allowed and denied cases for every role, self-change,
// audit rollback, DEMO grants, duplicate and repeated removal are already
// in test/permissionAdministration.test.js and the security suites; this
// file goes after what those do not try:
//   - forged cross-site requests (a plain HTML form, no JSON)
//   - other HTTP methods on the permission routes
//   - hostile request bodies (prototype keys, wrong types, huge values)
//   - disguised IDs aimed at the administrator's own account
//   - scope boundaries in effect after a grant, and removal in effect
//   - refusals that look the same whether a person or grant exists
//   - inactive users holding grants, and audit failure over HTTP
// Every attack checks that nothing changed. SYNTHETIC data only.
//
// Requirements basis (the Frozen Handoff PRD governs; MVP sections in
// brackets): PRD §22 identity [MVP §22] (server-derived identity, no trust
// in client-supplied claims); PRD §23 authorization (server-side, current
// permission checked on each operation, Program affiliation validated, no
// self-elevation, permission management itself needs an administrative
// capability); PRD §24 permission administration [MVP §23] (server-side
// authorization, target user and Program scope validated, least privilege,
// audit evidence, no self-elevation); PRD §32 server authority; PRD §34
// secure error handling [MVP §25].
// PRD §24 also says implementation-specific restrictions beyond these must
// not be treated as QCH policy unless QCH approves them, so this file does
// NOT assert Task Y's team restrictions (refusing self-REMOVAL, never
// granting ADMINISTER_PERMISSIONS here, IN_APP-only removal, active-only
// targets, ORG-scope-only administrators). Those stay in Task Y's own tests
// while QCH confirms them.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createMemoryReferralStore } from '../../src/referrals/memoryReferralStore.js';

const ADMIN = 1;            // ADMINISTER_PERMISSIONS, ORG scope
const PROGRAM_ADMIN = 3;    // ADMINISTER_PERMISSIONS at PROGRAM scope only (not honored)
const ORG_MANAGER = 5;      // MANAGE_ORGANIZATION: not an administrator
const STAFF = 6;            // no grants
const FORMER = 7;           // inactive, still holds MANAGE_PROGRAM for 11
const INACTIVE_ADMIN = 8;   // inactive, still holds ADMINISTER_PERMISSIONS
const RECEIVER = 9;         // receives for Program 11, plus one IN_APP grant to remove
const NOBODY_ID = 999;      // no such person

const org = (userId, permission) => ({
  userId, permission, scopeType: 'ORG', programId: null, departmentId: null, grantSource: 'IN_APP',
});
const prog = (userId, permission, programId) => ({
  userId, permission, scopeType: 'PROGRAM', programId, departmentId: null, grantSource: 'IN_APP',
});

function setup() {
  const store = createMemoryReferralStore({
    departments: [{ departmentId: 1, name: 'Synthetic Department', lifecycleStatus: 'ACTIVE' }],
    programs: [
      { programId: 10, departmentId: 1, name: 'Synthetic Referring', site: null, lifecycleStatus: 'ACTIVE' },
      { programId: 11, departmentId: 1, name: 'Synthetic Receiving', site: null, lifecycleStatus: 'ACTIVE' },
    ],
    users: [
      { userId: ADMIN, isActive: true, displayName: 'Synthetic Admin' },
      { userId: PROGRAM_ADMIN, isActive: true },
      { userId: ORG_MANAGER, isActive: true },
      { userId: STAFF, isActive: true, displayName: 'Synthetic Staff' },
      { userId: FORMER, isActive: false },
      { userId: INACTIVE_ADMIN, isActive: false },
      { userId: RECEIVER, isActive: true, displayName: 'Synthetic Receiver' },
    ],
    grants: [
      org(ADMIN, 'ADMINISTER_PERMISSIONS'),
      prog(ADMIN, 'VIEW_RECEIVED_REFERRAL', 11),
      prog(PROGRAM_ADMIN, 'ADMINISTER_PERMISSIONS', 11),
      org(ORG_MANAGER, 'MANAGE_ORGANIZATION'),
      prog(FORMER, 'MANAGE_PROGRAM', 11),
      org(INACTIVE_ADMIN, 'ADMINISTER_PERMISSIONS'),
      prog(RECEIVER, 'VIEW_RECEIVED_REFERRAL', 11),
      prog(RECEIVER, 'CORRECT_OUTCOME', 11),
    ],
  });
  const as = (userId) => request(createApp({
    affiliationStore: store, referralStore: store, resolveIdentity: () => ({ userId }), nodeEnv: 'test',
  }));
  return { store, as };
}

const state = (store) => JSON.stringify([store._grants, store._referralAuditEvents]);
const grantIdOf = (store, userId, permission) => store._grants
  .find((g) => g.userId === userId && g.permission === permission && g.revokedAt == null).grantId;
const URL = {
  grants: (userId) => `/api/permissions/users/${userId}/grants`,
  revoke: (userId, grantId) => `/api/permissions/users/${userId}/grants/${grantId}/revoke`,
};

describe('Task CC: forged and malformed requests change nothing', () => {
  // FINDING F1 (reported on PR #63, fixed in Task Y 83501ce): revoke took
  // an empty body, so a non-JSON request (a plain cross-site HTML form)
  // could remove a permission. Permission changes now require JSON (415).
  test('a plain HTML form (no JSON) cannot remove a permission', async () => {
    for (const [type, body] of [
      ['application/x-www-form-urlencoded', ''], ['application/x-www-form-urlencoded', 'x'],
      ['text/plain', ''], ['multipart/form-data; boundary=x', ''],
    ]) {
      const { store, as } = setup();
      const before = state(store);
      const res = await as(ADMIN).post(URL.revoke(RECEIVER, grantIdOf(store, RECEIVER, 'CORRECT_OUTCOME')))
        .set('Content-Type', type).send(body);
      assert.equal(res.status, 415, `${type}: ${res.status}`);
      assert.equal(res.body.code, 'UNSUPPORTED_MEDIA_TYPE');
      assert.equal(state(store), before, `${type}: the permission was removed`);
    }
  });

  test('a plain HTML form cannot add a permission', async () => {
    const { store, as } = setup();
    const before = state(store);
    for (const [type, body] of [
      ['application/x-www-form-urlencoded', 'permission=MANAGE_ORGANIZATION'],
      ['text/plain', '{"permission":"MANAGE_ORGANIZATION"}'],
    ]) {
      const res = await as(ADMIN).post(URL.grants(STAFF)).set('Content-Type', type).send(body);
      assert.equal(res.status, 415, type);
    }
    assert.equal(state(store), before);
  });

  test('other HTTP methods on the permission routes do nothing', async () => {
    const { store, as } = setup();
    const before = state(store);
    const grantId = grantIdOf(store, RECEIVER, 'CORRECT_OUTCOME');
    const attempts = [
      ['put', URL.grants(STAFF)], ['patch', URL.grants(STAFF)], ['delete', URL.grants(STAFF)],
      ['delete', `${URL.grants(RECEIVER)}/${grantId}`], ['put', `${URL.grants(RECEIVER)}/${grantId}`],
      ['patch', `${URL.grants(RECEIVER)}/${grantId}`], ['get', URL.revoke(RECEIVER, grantId)],
      ['put', URL.revoke(RECEIVER, grantId)], ['delete', URL.revoke(RECEIVER, grantId)],
    ];
    for (const [method, url] of attempts) {
      const res = await as(ADMIN)[method](url).send({ permission: 'MANAGE_ORGANIZATION' });
      assert.ok(res.status >= 400, `${method.toUpperCase()} ${url}: ${res.status}`);
    }
    assert.equal(state(store), before);
  });

  test('hostile bodies are refused before anything is stored', async () => {
    const { store, as } = setup();
    const before = state(store);
    const bodies = [
      { permission: '__proto__' }, { permission: 'constructor' }, { permission: 'toString' },
      { permission: 'hasOwnProperty' },
      { permission: 'manage_organization' }, { permission: 'MANAGE_ORGANIZATION ' },
      { permission: ['MANAGE_ORGANIZATION'] }, { permission: null }, {},
      { permission: 'MANAGE_PROGRAM', programId: '11' }, { permission: 'MANAGE_PROGRAM', programId: 11.5 },
      { permission: 'MANAGE_PROGRAM', programId: -11 }, { permission: 'MANAGE_PROGRAM', programId: 0 },
      { permission: 'MANAGE_PROGRAM', programId: 2 ** 53 }, { permission: 'MANAGE_PROGRAM', programId: [11] },
      { permission: 'MANAGE_PROGRAM', programId: { id: 11 } }, { permission: 'MANAGE_PROGRAM', programId: true },
      { permission: 'MANAGE_PROGRAM' }, { permission: 'MANAGE_ORGANIZATION', programId: 11 },
      { permission: 'MANAGE_PROGRAM', programId: 11, departmentId: 1 },
    ];
    for (const body of bodies) {
      const res = await as(ADMIN).post(URL.grants(STAFF)).send(body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    for (const raw of [
      '{"__proto__":{"isAdmin":true},"permission":"MANAGE_PROGRAM","programId":11}',
      '{"constructor":{"prototype":{"isAdmin":true}},"permission":"MANAGE_PROGRAM","programId":11}',
      '[{"permission":"MANAGE_ORGANIZATION"}]', '"MANAGE_ORGANIZATION"', '{"permission":', 'null',
      JSON.stringify({ permission: 'MANAGE_PROGRAM', programId: 11, pad: 'x'.repeat(2000) }),
    ]) {
      const res = await as(ADMIN).post(URL.grants(STAFF)).set('Content-Type', 'application/json').send(raw);
      assert.equal(res.status, 400, raw.slice(0, 60));
    }
    assert.equal({}.isAdmin, undefined, 'no prototype was polluted');
    // PRD §24 [MVP §23]: the Program in a Program-scope grant must exist.
    const noProgram = await as(ADMIN).post(URL.grants(STAFF)).send({ permission: 'MANAGE_PROGRAM', programId: 999 });
    assert.deepEqual([noProgram.status, noProgram.body.code, noProgram.body.fields], [400, 'INVALID_REQUEST', ['programId']]);
    // PRD §24 [MVP §23]: the target user must exist.
    for (const target of [NOBODY_ID, 0, 'abc']) {
      const res = await as(ADMIN).post(URL.grants(target)).send({ permission: 'MANAGE_PROGRAM', programId: 11 });
      assert.deepEqual([res.status, res.body.code], [404, 'USER_NOT_FOUND'], `target ${target}`);
    }
    // (A non-JSON revoke body is finding F1, tested above.)
    for (const body of [{ grantId: 1 }, { userId: STAFF }, []]) {
      const res = await as(ADMIN).post(URL.revoke(RECEIVER, grantIdOf(store, RECEIVER, 'CORRECT_OUTCOME'))).send(body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    assert.equal(state(store), before);
  });
});

describe('Task CC: self-elevation and scope boundaries', () => {
  test('disguised forms of the administrator\'s own ID never change the administrator', async () => {
    const { store, as } = setup();
    const ownGrant = grantIdOf(store, ADMIN, 'VIEW_RECEIVED_REFERRAL');
    const before = state(store);
    const disguises = ['01', '001', '1.0', '1e0', '+1', '%31', '%2B1', '0x1', '1%00', '%EF%BC%91', '1%20', '%201',
      '1;', '1,2', '9007199254740993', '-1', '0'];
    for (const id of disguises) {
      // No self-elevation (PRD §23, §24), however the ID is written.
      const add = await as(ADMIN).post(`/api/permissions/users/${id}/grants`).send({ permission: 'MANAGE_ORGANIZATION' });
      assert.ok(add.status >= 400, `add as ${id}: ${add.status}`);
      // A disguise must never reach the admin's account by another route.
      // ('%31' is simply the admin's own ID, 1; whether someone may remove
      // their OWN permission is Task Y team restriction 1, not tested here.)
      if (decodeURIComponent(id) === String(ADMIN)) continue;
      const remove = await as(ADMIN).post(`/api/permissions/users/${id}/grants/${ownGrant}/revoke`).send({});
      assert.ok(remove.status >= 400, `remove as ${id}: ${remove.status}`);
    }
    for (const grantId of ['01', '%31', '1e0', '0x1', '-1', '0', 'abc']) {
      const res = await as(ADMIN).post(`/api/permissions/users/${RECEIVER}/grants/${grantId}/revoke`).send({});
      assert.ok(res.status >= 400, `grant ID ${grantId}: ${res.status}`);
    }
    assert.equal(state(store), before);
  });

  test('no other capability can reach permission administration, even for the holder\'s own Program', async () => {
    const { store, as } = setup();
    const before = state(store);
    // (A Program-scope ADMINISTER_PERMISSIONS holder is left to Task Y's
    // tests: whether administrators are ORG-scope only is Task Y's reading
    // of the PRD.) These hold no administrator right at all.
    for (const userId of [ORG_MANAGER, RECEIVER, STAFF]) {
      const own = await as(userId).post(URL.grants(userId)).send({ permission: 'MANAGE_PROGRAM', programId: 11 });
      const other = await as(userId).post(URL.grants(STAFF)).send({ permission: 'RESPOND_TO_REFERRAL', programId: 11 });
      assert.deepEqual([own.status, other.status], [403, 403], `user ${userId}`);
    }
    assert.equal(state(store), before);
  });

  test('a grant reaches only its own scope, and a removal takes effect on the next request', async () => {
    const { store, as } = setup();
    const pm = (programId) => as(STAFF).get(`/api/program-management/programs/${programId}`);
    const granted = await as(ADMIN).post(URL.grants(STAFF)).send({ permission: 'MANAGE_PROGRAM', programId: 11 });
    assert.equal(granted.status, 201);
    assert.equal((await pm(11)).status, 200);
    assert.equal((await pm(10)).status, 403, 'Program 11 does not reach Program 10');
    assert.equal((await as(STAFF).post('/api/program-management/departments').send({ name: 'Synthetic New' })).status, 403,
      'Program scope does not reach organization management');
    assert.equal((await as(STAFF).get('/api/permissions/overview')).status, 403, 'nor permission administration');

    const removed = await as(ADMIN).post(URL.revoke(STAFF, granted.body.grant.grantId)).send({});
    assert.equal(removed.status, 200);
    assert.equal((await pm(11)).status, 403, 'removed means removed, with no stale access');
  });

  test('an inactive person\'s grants give no access, and an inactive administrator cannot act', async () => {
    const { store, as } = setup();
    const before = state(store);
    assert.equal((await as(FORMER).get('/api/program-management/programs/11')).status, 403);
    assert.equal((await as(INACTIVE_ADMIN).get('/api/permissions/overview')).status, 403);
    assert.equal((await as(INACTIVE_ADMIN).post(URL.grants(STAFF)).send({ permission: 'MANAGE_ORGANIZATION' })).status, 403);
    assert.equal(state(store), before);
  });
});

describe('Task CC: refusals reveal nothing; failures roll back', () => {
  test('to a non-administrator, every refusal looks the same whether the person or grant exists', async () => {
    const { store, as } = setup();
    const realGrant = grantIdOf(store, RECEIVER, 'CORRECT_OUTCOME');
    for (const userId of [STAFF, ORG_MANAGER, INACTIVE_ADMIN]) {
      const answers = new Set();
      for (const target of [RECEIVER, FORMER, NOBODY_ID, 'abc']) {
        answers.add(JSON.stringify((await as(userId).get(URL.grants(target))).body));
        answers.add(JSON.stringify((await as(userId).post(URL.grants(target)).send({ permission: 'MANAGE_ORGANIZATION' })).body));
        for (const grantId of [realGrant, 424242]) {
          answers.add(JSON.stringify((await as(userId).post(URL.revoke(target, grantId)).send({})).body));
        }
      }
      answers.add(JSON.stringify((await as(userId).get('/api/permissions/overview')).body));
      assert.equal(answers.size, 1, `user ${userId} saw ${[...answers].join(' | ')}`);
      const [only] = answers;
      assert.doesNotMatch(only, /Receiver|CORRECT_OUTCOME|MANAGE_PROGRAM|current|grant/i);
    }
  });

  test('an administrator naming someone else\'s grant learns nothing about it', async () => {
    const { store, as } = setup();
    const before = state(store);
    const othersGrant = grantIdOf(store, RECEIVER, 'CORRECT_OUTCOME');
    const res = await as(ADMIN).post(URL.revoke(STAFF, othersGrant)).send({});
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'GRANT_CHANGED');
    assert.doesNotMatch(JSON.stringify(res.body), /CORRECT_OUTCOME|Receiver/);
    assert.equal(state(store), before);
  });

  test('if the audit write fails over HTTP, nothing changes, and a retry applies exactly once', async () => {
    const { store, as } = setup();
    const before = state(store);
    store._failNextAudit();
    const failed = await as(ADMIN).post(URL.grants(STAFF)).send({ permission: 'RECORD_OUTCOME', programId: 11 });
    assert.equal(failed.status, 500);
    assert.doesNotMatch(failed.text, /RECORD_OUTCOME|audit|Synthetic Staff|stack/i);
    assert.equal(state(store), before);
    const retried = await as(ADMIN).post(URL.grants(STAFF)).send({ permission: 'RECORD_OUTCOME', programId: 11 });
    assert.equal(retried.status, 201);
    assert.equal(store._grants.filter((g) => g.userId === STAFF && g.permission === 'RECORD_OUTCOME').length, 1);

    const grantId = retried.body.grant.grantId;
    const afterGrant = state(store);
    store._failNextAudit();
    assert.equal((await as(ADMIN).post(URL.revoke(STAFF, grantId)).send({})).status, 500);
    assert.equal(state(store), afterGrant, 'the removal rolled back with its audit');
    assert.equal((await as(ADMIN).post(URL.revoke(STAFF, grantId)).send({})).status, 200);
    assert.equal(store._referralAuditEvents.filter((e) => e.entityType === 'USER_GRANT').length, 2);
  });
});
