// Trello Task Y: designated administrators grant and remove application
// permissions (Final Technical PRD 3.2, 3.3, 3.6, 3.8, 9.3, 9.6, 13.4).
//
// Each card acceptance criterion has its own test here. Route-level
// allowed/denied checks for every person also live in
// test/regression/securityRegression.test.js and test/securityPass.test.js.
// SYNTHETIC data only.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
import { createPermissionService } from '../src/permissions/permissionService.js';
import { GRANTABLE } from '../src/permissions/validatePermissionChange.js';

const ADMIN = 1;            // ADMINISTER_PERMISSIONS, ORG scope
const ADMIN_TWO = 2;        // ADMINISTER_PERMISSIONS, ORG scope
const PROGRAM_ADMIN = 3;    // ADMINISTER_PERMISSIONS at PROGRAM scope only (not honored)
const DEMO_ADMIN = 4;       // ADMINISTER_PERMISSIONS, DEMO grant
const ORG_MANAGER = 5;      // MANAGE_ORGANIZATION: not an administrator
const STAFF = 6;            // no grants
const FORMER = 7;           // inactive, still holds MANAGE_PROGRAM for 11
const INACTIVE_ADMIN = 8;   // inactive, still holds ADMINISTER_PERMISSIONS

const org = (userId, permission, extra = {}) => ({
  userId, permission, scopeType: 'ORG', programId: null, departmentId: null, grantSource: 'IN_APP', ...extra,
});
const prog = (userId, permission, programId, extra = {}) => ({
  userId, permission, scopeType: 'PROGRAM', programId, departmentId: null, grantSource: 'IN_APP', ...extra,
});

function setup() {
  const store = createMemoryReferralStore({
    departments: [{ departmentId: 1, name: 'Synthetic Department', lifecycleStatus: 'ACTIVE' }],
    programs: [
      { programId: 10, departmentId: 1, name: 'Synthetic Referring', site: null, lifecycleStatus: 'ACTIVE' },
      { programId: 11, departmentId: 1, name: 'Synthetic Receiving', site: 'Site A', lifecycleStatus: 'ACTIVE' },
      { programId: 12, departmentId: 1, name: 'Synthetic Paused', site: null, lifecycleStatus: 'DISCONTINUED' },
      { programId: 13, departmentId: 1, name: 'Synthetic Retired', site: null, lifecycleStatus: 'RETIRED' },
    ],
    users: [
      { userId: ADMIN, isActive: true, displayName: 'Synthetic Admin' },
      { userId: ADMIN_TWO, isActive: true, displayName: 'Synthetic Admin Two' },
      { userId: PROGRAM_ADMIN, isActive: true },
      { userId: DEMO_ADMIN, isActive: true },
      { userId: ORG_MANAGER, isActive: true },
      { userId: STAFF, isActive: true, currentProgramId: 10, displayName: 'Synthetic Staff' },
      { userId: FORMER, isActive: false },
      { userId: INACTIVE_ADMIN, isActive: false },
    ],
    grants: [
      org(ADMIN, 'ADMINISTER_PERMISSIONS'),
      org(ADMIN_TWO, 'ADMINISTER_PERMISSIONS'),
      prog(PROGRAM_ADMIN, 'ADMINISTER_PERMISSIONS', 11),
      org(DEMO_ADMIN, 'ADMINISTER_PERMISSIONS', { grantSource: 'DEMO' }),
      org(ORG_MANAGER, 'MANAGE_ORGANIZATION'),
      prog(FORMER, 'MANAGE_PROGRAM', 11),
      org(INACTIVE_ADMIN, 'ADMINISTER_PERMISSIONS'),
      prog(STAFF, 'VIEW_RECEIVED_REFERRAL', 11, { grantSource: 'DEMO' }),
    ],
  });
  return { store, service: createPermissionService({ store }) };
}

const appAs = (store, userId, extra = {}) => createApp({
  affiliationStore: store, referralStore: store, resolveIdentity: () => ({ userId }), nodeEnv: 'test', ...extra,
});
const state = (store) => JSON.stringify([store._grants, store._referralAuditEvents]);
const refused = (promise, code) => assert.rejects(promise, (error) => error.code === code);
const active = (store, userId) => store._grants.filter((g) => g.userId === userId && g.revokedAt == null);
const grantIdOf = (store, userId, permission) => active(store, userId).find((g) => g.permission === permission).grantId;

describe('Task Y: administrators grant and remove permissions', () => {
  test('a grant is created, returned, audited, and attributed to the administrator', async () => {
    const { store, service } = setup();
    const result = await service.grant(ADMIN, STAFF, { permission: 'MANAGE_PROGRAM', programId: 11 },
      { correlationId: 'synthetic-grant' });
    assert.equal(result.status, 'GRANTED');
    assert.equal(result.grant.permission, 'MANAGE_PROGRAM');
    assert.equal(result.grant.scopeType, 'PROGRAM');
    assert.equal(result.grant.programName, 'Synthetic Receiving');
    assert.equal(result.grant.grantSource, 'IN_APP');
    assert.ok(result.grants.some((g) => g.grantId === result.grant.grantId));

    const saved = store._grants.find((g) => g.grantId === result.grant.grantId);
    assert.equal(saved.userId, STAFF);
    assert.equal(saved.revokedAt, null);
    const [event] = store._referralAuditEvents;
    assert.equal(event.entityType, 'USER_GRANT');
    assert.equal(event.entityId, result.grant.grantId);
    assert.equal(event.action, 'GRANTED');
    assert.equal(event.actorUserId, ADMIN);
    assert.equal(event.correlationId, 'synthetic-grant');
    assert.deepEqual(event.after, {
      user_id: STAFF, permission: 'MANAGE_PROGRAM', scope_type: 'PROGRAM', program_id: 11, grant_source: 'IN_APP',
    });
  });

  test('Manage Organization is granted org-wide; a Program would mean nothing and is refused', async () => {
    const { store, service } = setup();
    const result = await service.grant(ADMIN, STAFF, { permission: 'MANAGE_ORGANIZATION' });
    assert.equal(result.grant.scopeType, 'ORG');
    assert.equal(result.grant.programId, null);
    const before = state(store);
    await refused(service.grant(ADMIN, STAFF, { permission: 'MANAGE_ORGANIZATION', programId: 11 }), 'INVALID_REQUEST');
    assert.equal(state(store), before);
  });

  test('a removal is applied, audited, and the grant leaves the list', async () => {
    const { store, service } = setup();
    const grantId = grantIdOf(store, FORMER, 'MANAGE_PROGRAM');
    const result = await service.revoke(ADMIN, FORMER, grantId, {}, { correlationId: 'synthetic-revoke' });
    assert.equal(result.status, 'REVOKED');
    assert.ok(!result.grants.some((g) => g.grantId === grantId));
    assert.ok(store._grants.find((g) => g.grantId === grantId).revokedAt);
    const [event] = store._referralAuditEvents;
    assert.equal(event.entityType, 'USER_GRANT');
    assert.equal(event.entityId, grantId);
    assert.equal(event.action, 'REVOKED');
    assert.equal(event.actorUserId, ADMIN);
    assert.equal(event.before.revoked_at, null);
    assert.equal(event.before.permission, 'MANAGE_PROGRAM');
    assert.ok(event.after.revoked_at);
  });

  test('a granted permission really works, and a removed one really stops working', async () => {
    const { store } = setup();
    const admin = request(appAs(store, ADMIN));
    const asStaff = () => request(appAs(store, STAFF));
    const read = () => asStaff().get('/api/program-management/programs/11');
    assert.equal((await read()).status, 403);

    const granted = await admin.post(`/api/permissions/users/${STAFF}/grants`)
      .send({ permission: 'MANAGE_PROGRAM', programId: 11 });
    assert.equal(granted.status, 201);
    assert.equal((await read()).status, 200);

    const revoked = await admin.post(`/api/permissions/users/${STAFF}/grants/${granted.body.grant.grantId}/revoke`).send({});
    assert.equal(revoked.status, 200);
    assert.equal((await read()).status, 403);
  });

  test('every grantable permission can be granted in its one scope', async () => {
    const { service } = setup();
    for (const [permission, rule] of Object.entries(GRANTABLE)) {
      const body = rule.scopeType === 'PROGRAM' ? { permission, programId: 11 } : { permission };
      const result = await service.grant(ADMIN, STAFF, body);
      assert.equal(result.grant.scopeType, rule.scopeType, permission);
    }
  });

  test('a discontinued Program can be granted; a retired or unknown one cannot', async () => {
    const { store, service } = setup();
    await service.grant(ADMIN, STAFF, { permission: 'MANAGE_PROGRAM', programId: 12 });
    const before = state(store);
    for (const programId of [13, 999]) {
      await refused(service.grant(ADMIN, STAFF, { permission: 'MANAGE_PROGRAM', programId }), 'INVALID_REQUEST');
    }
    assert.equal(state(store), before);
  });
});

describe('Task Y: unauthorized users cannot change permissions', () => {
  test('non-administrators, Program-scope and inactive administrators are refused; nothing changes', async () => {
    const { store, service } = setup();
    const before = state(store);
    for (const actor of [ORG_MANAGER, STAFF, PROGRAM_ADMIN, DEMO_ADMIN]) {
      await refused(service.grant(actor, FORMER, { permission: 'RECORD_OUTCOME', programId: 11 }), 'NOT_AUTHORIZED');
      await refused(service.overview(actor), 'NOT_AUTHORIZED');
      await refused(service.getUserGrants(actor, STAFF), 'NOT_AUTHORIZED');
    }
    for (const actor of [INACTIVE_ADMIN, 999]) {
      await refused(service.grant(actor, STAFF, { permission: 'RECORD_OUTCOME', programId: 11 }), 'USER_NOT_ACTIVE');
    }
    assert.equal(state(store), before);
  });

  test('a DEMO administrator grant counts only when demo grants are allowed (non-production)', async () => {
    const { store } = setup();
    const demoService = createPermissionService({ store, allowDemoGrants: true });
    const result = await demoService.grant(DEMO_ADMIN, STAFF, { permission: 'MANAGE_PROGRAM', programId: 11 });
    assert.equal(result.status, 'GRANTED');
    assert.throws(() => appAs(store, DEMO_ADMIN, { allowDemoGrants: true, nodeEnv: 'production' }));
  });

  test('an administrator whose access was just removed cannot act on it (no stale authority)', async () => {
    const { store, service } = setup();
    await store._revokeGrants(ADMIN, 'ADMINISTER_PERMISSIONS');
    const before = state(store);
    await refused(service.grant(ADMIN, STAFF, { permission: 'MANAGE_PROGRAM', programId: 11 }), 'NOT_AUTHORIZED');
    assert.equal(state(store), before);
  });
});

describe('Task Y: identity and self-elevation', () => {
  test('nobody can change their own permissions, either way', async () => {
    const { store, service } = setup();
    const before = state(store);
    await refused(service.grant(ADMIN, ADMIN, { permission: 'MANAGE_ORGANIZATION' }), 'SELF_CHANGE_NOT_ALLOWED');
    await refused(service.revoke(ADMIN, ADMIN, grantIdOf(store, ADMIN, 'ADMINISTER_PERMISSIONS'), {}), 'SELF_CHANGE_NOT_ALLOWED');
    assert.equal(state(store), before);
    const view = await service.getUserGrants(ADMIN, ADMIN);
    assert.equal(view.canChange, false);
    assert.equal(view.user.isYou, true);
  });

  test('administrator rights cannot be granted or removed here (PRD 3.8)', async () => {
    const { store, service } = setup();
    const before = state(store);
    await refused(service.grant(ADMIN, STAFF, { permission: 'ADMINISTER_PERMISSIONS' }), 'INVALID_REQUEST');
    await refused(service.revoke(ADMIN, ADMIN_TWO, grantIdOf(store, ADMIN_TWO, 'ADMINISTER_PERMISSIONS'), {}), 'NOT_REVOCABLE');
    for (const permission of ['VIEW_UNDERLYING_REFERRAL', 'VIEW_CREATED_REFERRAL', 'CREATE_REFERRAL', 'SYSTEM_ADMIN']) {
      await refused(service.grant(ADMIN, STAFF, { permission, programId: 11 }), 'INVALID_REQUEST');
    }
    assert.equal(state(store), before);
  });

  test('browser-supplied identity and scope are never authoritative', async () => {
    const { store } = setup();
    const before = state(store);
    const asStaff = request(appAs(store, STAFF));
    // STAFF claims to be the administrator in every way a browser could.
    const forged = await asStaff.post(`/api/permissions/users/${STAFF}/grants`)
      .set('X-User-Id', String(ADMIN)).set('X-Role', 'ADMIN')
      .send({ permission: 'MANAGE_ORGANIZATION' });
    assert.equal(forged.status, 403);
    for (const extra of [{ actorUserId: ADMIN }, { scopeType: 'ORG' }, { grantSource: 'DEMO' }, { userId: ADMIN }, { role: 'ADMIN' }]) {
      const res = await request(appAs(store, ADMIN)).post(`/api/permissions/users/${STAFF}/grants`)
        .send({ permission: 'MANAGE_PROGRAM', programId: 11, ...extra });
      assert.equal(res.status, 400, JSON.stringify(extra));
      assert.equal(res.body.code, 'UNEXPECTED_FIELD');
    }
    assert.equal(state(store), before);
  });
});

describe('Task Y: target users and DEMO grants', () => {
  test('new access goes only to active users; removal works for inactive users', async () => {
    const { store, service } = setup();
    await refused(service.grant(ADMIN, FORMER, { permission: 'RECORD_OUTCOME', programId: 11 }), 'TARGET_NOT_ACTIVE');
    await refused(service.grant(ADMIN, 999, { permission: 'RECORD_OUTCOME', programId: 11 }), 'USER_NOT_FOUND');
    const removed = await service.revoke(ADMIN, FORMER, grantIdOf(store, FORMER, 'MANAGE_PROGRAM'), {});
    assert.equal(removed.status, 'REVOKED');
  });

  test('DEMO grants are shown read-only and cannot be removed here', async () => {
    const { store, service } = setup();
    const view = await service.getUserGrants(ADMIN, STAFF);
    const demo = view.grants.find((g) => g.grantSource === 'DEMO');
    assert.equal(demo.revocable, false);
    await refused(service.revoke(ADMIN, STAFF, demo.grantId, {}), 'NOT_REVOCABLE');
  });

  test('a DEMO grant does not count as a duplicate: the real grant can still be made', async () => {
    // STAFF holds VIEW_RECEIVED_REFERRAL for 11 only as a DEMO grant, which
    // production ignores. Saying "already granted" would leave them without it.
    const { store, service } = setup();
    const result = await service.grant(ADMIN, STAFF, { permission: 'VIEW_RECEIVED_REFERRAL', programId: 11 });
    assert.equal(result.grant.grantSource, 'IN_APP');
    assert.equal(active(store, STAFF).filter((g) => g.permission === 'VIEW_RECEIVED_REFERRAL').length, 2);
  });

  test('a grant ID that belongs to someone else is refused, not removed', async () => {
    const { store, service } = setup();
    const before = state(store);
    await refused(service.revoke(ADMIN, STAFF, grantIdOf(store, FORMER, 'MANAGE_PROGRAM'), {}), 'GRANT_CHANGED');
    assert.equal(state(store), before);
  });
});

describe('Task Y: conflicts, failures and stale changes fail safely', () => {
  test('a duplicate grant is refused with the current permissions', async () => {
    const { store, service } = setup();
    await service.grant(ADMIN, STAFF, { permission: 'RECORD_OUTCOME', programId: 11 });
    const before = state(store);
    await assert.rejects(service.grant(ADMIN_TWO, STAFF, { permission: 'RECORD_OUTCOME', programId: 11 }), (error) => {
      assert.equal(error.code, 'ALREADY_GRANTED');
      assert.ok(error.current.some((g) => g.permission === 'RECORD_OUTCOME'));
      return true;
    });
    assert.equal(state(store), before);
  });

  test('removing a grant someone else already removed is refused, not repeated', async () => {
    const { store, service } = setup();
    const grantId = grantIdOf(store, FORMER, 'MANAGE_PROGRAM');
    await service.revoke(ADMIN, FORMER, grantId, {});
    const before = state(store);
    await assert.rejects(service.revoke(ADMIN_TWO, FORMER, grantId, {}), (error) => {
      assert.equal(error.code, 'GRANT_CHANGED');
      assert.ok(!error.current.some((g) => g.grantId === grantId));
      return true;
    });
    assert.equal(state(store), before);
    assert.equal(store._referralAuditEvents.length, 1);
  });

  test('two administrators at once: exactly one grant and one audit event', async () => {
    const { store, service } = setup();
    const body = { permission: 'CORRECT_OUTCOME', programId: 11 };
    const results = await Promise.allSettled([service.grant(ADMIN, STAFF, body), service.grant(ADMIN_TWO, STAFF, body)]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'ALREADY_GRANTED');
    assert.equal(active(store, STAFF).filter((g) => g.permission === 'CORRECT_OUTCOME').length, 1);
    assert.equal(store._referralAuditEvents.length, 1);
  });

  test('two administrators editing each other at the same moment both finish (no deadlock)', async () => {
    const { store, service } = setup();
    const results = await Promise.all([
      service.grant(ADMIN, ADMIN_TWO, { permission: 'MANAGE_PROGRAM', programId: 11 }),
      service.grant(ADMIN_TWO, ADMIN, { permission: 'MANAGE_PROGRAM', programId: 11 }),
    ]);
    assert.deepEqual(results.map((r) => r.status), ['GRANTED', 'GRANTED']);
    assert.equal(store._referralAuditEvents.length, 2);
  });

  test('if the audit write fails, no grant is created and none is removed', async () => {
    const { store, service } = setup();
    const before = state(store);
    store._failNextAudit();
    await assert.rejects(service.grant(ADMIN, STAFF, { permission: 'MANAGE_PROGRAM', programId: 11 }));
    assert.equal(state(store), before);
    store._failNextAudit();
    await assert.rejects(service.revoke(ADMIN, FORMER, grantIdOf(store, FORMER, 'MANAGE_PROGRAM'), {}));
    assert.equal(state(store), before);
    // And it works on retry.
    assert.equal((await service.grant(ADMIN, STAFF, { permission: 'MANAGE_PROGRAM', programId: 11 })).status, 'GRANTED');
  });

  test('a removal waits for a receiving response that already read the grant', async () => {
    // The response reads RECEIVER's grants inside its transaction; the
    // removal must not land in the middle of it (same rule as card 7).
    const store = createMemoryReferralStore({
      departments: [{ departmentId: 1, name: 'Synthetic Department', lifecycleStatus: 'ACTIVE' }],
      programs: [
        { programId: 10, departmentId: 1, name: 'Synthetic Referring', lifecycleStatus: 'ACTIVE' },
        { programId: 11, departmentId: 1, name: 'Synthetic Receiving', lifecycleStatus: 'ACTIVE' },
      ],
      users: [
        { userId: ADMIN, isActive: true }, { userId: 20, isActive: true, currentProgramId: 10 },
        { userId: 21, isActive: true },
      ],
      grants: [
        org(ADMIN, 'ADMINISTER_PERMISSIONS'),
        ...['VIEW_RECEIVED_REFERRAL', 'RESPOND_TO_REFERRAL'].map((p) => prog(21, p, 11)),
      ],
      notAppropriateReasons: [{ reasonId: 1, code: 'OTHER', label: 'Other', displayOrder: 1 }],
    });
    const sent = await request(appAs(store, 20)).post('/api/referrals').send({
      submissionId: randomUUID(), receivingProgramId: 11, participantName: 'Synthetic Person Y',
      contactMethod: 'NOT_AVAILABLE', referralContext: 'Synthetic context',
    });
    assert.equal(sent.status, 201);
    const respondGrant = active(store, 21).find((g) => g.permission === 'RESPOND_TO_REFERRAL').grantId;
    const [response, removal] = await Promise.all([
      request(appAs(store, 21)).post(`/api/referrals/${sent.body.referral.referralId}/response`).send({ decision: 'ACCEPTED' }),
      createPermissionService({ store }).revoke(ADMIN, 21, respondGrant, {}),
    ]);
    // Either order is fine; what matters is that both committed whole.
    assert.equal(removal.status, 'REVOKED');
    assert.ok([200, 403].includes(response.status));
    const after = await request(appAs(store, 21)).post(`/api/referrals/${sent.body.referral.referralId}/response`)
      .send({ decision: 'ACCEPTED' });
    assert.ok([403, 404, 409].includes(after.status), 'no further responses after removal');
  });
});

describe('Task Y: what administrators see, and what nobody else learns', () => {
  test('the overview lists people by name (no email), Programs, and what can be granted', async () => {
    const { service } = setup();
    const view = await service.overview(ADMIN);
    assert.deepEqual(Object.keys(view.users[0]).sort(), ['displayName', 'isActive', 'isYou', 'userId']);
    assert.equal(view.users.find((u) => u.userId === ADMIN).isYou, true);
    assert.equal(view.users.find((u) => u.userId === PROGRAM_ADMIN).displayName, `Staff member ${PROGRAM_ADMIN}`);
    assert.ok(!view.programs.some((p) => p.lifecycleStatus === 'RETIRED'));
    assert.deepEqual(view.grantable.map((g) => g.permission).sort(), Object.keys(GRANTABLE).sort());
  });

  test('refusals say nothing about the person or their permissions', async () => {
    const { store } = setup();
    for (const path of [`/api/permissions/users/${FORMER}/grants`, '/api/permissions/users/999/grants', '/api/permissions/users/abc/grants']) {
      const res = await request(appAs(store, STAFF)).get(path);
      assert.equal(res.status, 403, path);
      assert.deepEqual(Object.keys(res.body).sort(), ['code', 'error']);
      assert.ok(!res.text.includes('MANAGE_PROGRAM'));
    }
  });
});

describe('Task Y: Permissions screen wording (public/permissions/logic.js)', async () => {
  const logic = await import('../public/permissions/logic.js');
  const grantView = (extra = {}) => ({
    grantId: 5, permission: 'MANAGE_PROGRAM', label: 'Manage Program information', scopeType: 'PROGRAM',
    programId: 11, programName: 'Synthetic Receiving', programSite: 'Site A', grantSource: 'IN_APP', revocable: true, ...extra,
  });

  test('grants read plainly, org-wide or for one Program', () => {
    assert.equal(logic.describeGrant(grantView()), 'Manage Program information: Synthetic Receiving (Site A)');
    assert.equal(logic.describeGrant(grantView({ scopeType: 'ORG', programId: null, programName: null, label: 'Manage the organization' })),
      'Manage the organization: Organization-wide');
    assert.equal(logic.readOnlyReason(grantView()), null);
    assert.equal(logic.readOnlyReason(grantView({ revocable: false, grantSource: 'DEMO' })), 'Demo data; not managed here');
    assert.equal(logic.readOnlyReason(grantView({ revocable: false, permission: 'ADMINISTER_PERMISSIONS' })), 'Managed outside this screen');
    assert.equal(logic.personHeading({ displayName: 'Synthetic A', isYou: true, isActive: true }), 'Permissions for Synthetic A (you)');
  });

  test('each server answer becomes the right message, and conflicts show the current list', () => {
    const ok = logic.interpretChange({ status: 201, body: { status: 'GRANTED', grant: grantView(), grants: [grantView()] } });
    assert.equal(ok.state, 'GRANTED');
    assert.match(ok.message, /^Added: Manage Program information/);
    const conflict = logic.interpretChange({ status: 409, body: { code: 'ALREADY_GRANTED', current: [grantView()] } });
    assert.equal(conflict.state, 'CONFLICT');
    assert.equal(conflict.grants.length, 1);
    assert.equal(logic.interpretChange({ status: 409, body: { code: 'GRANT_CHANGED', current: [] } }).message, logic.MESSAGES.CHANGED);
    assert.equal(logic.interpretChange({ status: 403, body: { code: 'SELF_CHANGE_NOT_ALLOWED' } }).message, logic.MESSAGES.SELF);
    assert.equal(logic.interpretChange({ status: 403, body: { code: 'NOT_AUTHORIZED' } }).state, 'NOT_ADMIN');
    for (const response of [{ unknown: true }, { status: 503, body: {} }, { status: 200, body: { status: 'GRANTED' } }]) {
      assert.equal(logic.interpretChange(response).state, response.status === 200 ? 'REFUSED' : 'UNKNOWN', JSON.stringify(response));
    }
  });

  test('the add form needs a permission, and a Program only when the permission is per Program', () => {
    const grantable = [{ permission: 'MANAGE_PROGRAM', scopeType: 'PROGRAM' }, { permission: 'MANAGE_ORGANIZATION', scopeType: 'ORG' }];
    assert.equal(logic.validateAdd({ permission: '' }, grantable).field, 'permission');
    assert.equal(logic.validateAdd({ permission: 'MANAGE_PROGRAM', programId: '' }, grantable).field, 'program');
    assert.deepEqual(logic.validateAdd({ permission: 'MANAGE_PROGRAM', programId: '11' }, grantable).body,
      { permission: 'MANAGE_PROGRAM', programId: 11 });
    assert.deepEqual(logic.validateAdd({ permission: 'MANAGE_ORGANIZATION', programId: '11' }, grantable).body,
      { permission: 'MANAGE_ORGANIZATION' });
  });
});
