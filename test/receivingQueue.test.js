// Receiving queue + referral view authorization (Trello card 6).
// All data is SYNTHETIC.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
import { createReferralService } from '../src/referrals/referralService.js';
import { createReferralQueryService, LIST_LIMIT } from '../src/referrals/referralQueryService.js';
import { receivingProgramIds, referralAccess, assertDemoGrantsAllowed } from '../src/authorization/referralAccess.js';
import { stageOf } from '../src/referrals/stage.js';
import { decodeCursor, encodeCursor } from '../src/referrals/cursor.js';

const CREATOR = 100;          // affiliated with Program 10; no grants
const RECEIVER_11 = 200;      // IN_APP receiving grant for Program 11
const RECEIVER_12 = 201;      // IN_APP receiving grant for Program 12
const REVOKED = 202;          // receiving grant for 11, revoked
const DEMO = 203;             // DEMO receiving grant for 11
const ADMIN = 204;            // admin/management grants, no receiving grant
const WIDE_SCOPE = 205;       // receiving grants at DEPARTMENT and ORG scope
const AFFILIATED_11 = 206;    // affiliated with Program 11, no grants
const INACTIVE = 207;         // receiving grant for 11, inactive account

const grant = (userId, permission, extra = {}) => ({
  userId, permission, scopeType: 'PROGRAM', programId: 11, departmentId: null, grantSource: 'IN_APP', ...extra,
});

function seed() {
  return createMemoryReferralStore({
    departments: [
      { departmentId: 1, name: 'Synthetic Dept A', lifecycleStatus: 'ACTIVE' },
      { departmentId: 2, name: 'Synthetic Dept B', lifecycleStatus: 'ACTIVE' },
    ],
    programs: [
      { programId: 10, departmentId: 1, name: 'Program Ten', site: null, lifecycleStatus: 'ACTIVE' },
      { programId: 11, departmentId: 2, name: 'Program Eleven', site: null, lifecycleStatus: 'ACTIVE' },
      { programId: 12, departmentId: 2, name: 'Program Twelve', site: null, lifecycleStatus: 'ACTIVE' },
    ],
    users: [
      { userId: CREATOR, isActive: true, currentProgramId: 10, displayName: 'Synthetic Referrer', email: 'referrer@example.test' },
      { userId: RECEIVER_11, isActive: true, currentProgramId: 11 },
      { userId: RECEIVER_12, isActive: true, currentProgramId: 12 },
      { userId: REVOKED, isActive: true },
      { userId: DEMO, isActive: true },
      { userId: ADMIN, isActive: true },
      { userId: WIDE_SCOPE, isActive: true },
      { userId: AFFILIATED_11, isActive: true, currentProgramId: 11 },
      { userId: INACTIVE, isActive: false },
    ],
    grants: [
      grant(RECEIVER_11, 'VIEW_RECEIVED_REFERRAL'),
      grant(RECEIVER_12, 'VIEW_RECEIVED_REFERRAL', { programId: 12 }),
      grant(REVOKED, 'VIEW_RECEIVED_REFERRAL', { revokedAt: '2026-10-01T00:00:00.000Z' }),
      grant(DEMO, 'VIEW_RECEIVED_REFERRAL', { grantSource: 'DEMO' }),
      grant(ADMIN, 'ADMINISTER_PERMISSIONS', { scopeType: 'ORG', programId: null }),
      grant(ADMIN, 'MANAGE_ORGANIZATION', { scopeType: 'ORG', programId: null }),
      grant(ADMIN, 'MANAGE_PROGRAM'),
      grant(ADMIN, 'VIEW_UNDERLYING_REFERRAL'),
      grant(WIDE_SCOPE, 'VIEW_RECEIVED_REFERRAL', { scopeType: 'DEPARTMENT', programId: null, departmentId: 2 }),
      grant(WIDE_SCOPE, 'VIEW_RECEIVED_REFERRAL', { scopeType: 'ORG', programId: null }),
      grant(INACTIVE, 'VIEW_RECEIVED_REFERRAL'),
    ],
  });
}

const body = (overrides = {}) => ({
  submissionId: randomUUID(),
  receivingProgramId: 11,
  participantName: 'Synthetic Person',
  contactMethod: 'PHONE_CALL',
  contactValue: '555-010-0147',
  participantZip: '11375',
  referralContext: 'Synthetic need',
  notes: 'Synthetic note',
  ...overrides,
});

// Referrals: CREATOR -> 11 (x3), CREATOR -> 12, AFFILIATED_11 -> 12.
async function populated() {
  const store = seed();
  const create = createReferralService({ store });
  const ids = {};
  ids.a = (await create.createDirectReferral(CREATOR, body({ participantName: 'Synthetic A' }))).referral.referralId;
  ids.b = (await create.createDirectReferral(CREATOR, body({ participantName: 'Synthetic B' }))).referral.referralId;
  ids.c = (await create.createDirectReferral(CREATOR, body({ participantName: 'Synthetic C' }))).referral.referralId;
  ids.d = (await create.createDirectReferral(CREATOR, body({ participantName: 'Synthetic D', receivingProgramId: 12 }))).referral.referralId;
  ids.e = (await create.createDirectReferral(AFFILIATED_11, body({ participantName: 'Synthetic E', receivingProgramId: 12 }))).referral.referralId;
  return { store, ids, queries: createReferralQueryService({ store }) };
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code);
    return true;
  });
}

describe('authorization rules (capability + resource + scope)', () => {
  const g = (extra) => ({ permission: 'VIEW_RECEIVED_REFERRAL', scopeType: 'PROGRAM', programId: 11, grantSource: 'IN_APP', revokedAt: null, ...extra });

  test('an active IN_APP Program grant gives receiving view for that Program only', () => {
    assert.deepEqual([...receivingProgramIds([g()])], [11]);
  });

  test('revoked grants, other capabilities, and wider scopes give nothing', () => {
    assert.equal(receivingProgramIds([g({ revokedAt: '2026-10-01T00:00:00Z' })]).size, 0);
    for (const permission of ['ADMINISTER_PERMISSIONS', 'MANAGE_PROGRAM', 'MANAGE_ORGANIZATION', 'VIEW_AGGREGATE_REPORTING', 'VIEW_UNDERLYING_REFERRAL', 'VIEW_CREATED_REFERRAL']) {
      assert.equal(receivingProgramIds([g({ permission })]).size, 0, permission);
    }
    assert.equal(receivingProgramIds([g({ scopeType: 'DEPARTMENT', programId: null, departmentId: 2 })]).size, 0);
    assert.equal(receivingProgramIds([g({ scopeType: 'ORG', programId: null })]).size, 0);
  });

  test('the scope type itself is checked, even on a malformed grant carrying a programId', () => {
    // The schema forbids these combinations; the check must not rely on that.
    assert.equal(receivingProgramIds([g({ scopeType: 'DEPARTMENT', departmentId: 2 })]).size, 0);
    assert.equal(receivingProgramIds([g({ scopeType: 'ORG' })]).size, 0);
    assert.equal(receivingProgramIds([g({ scopeType: undefined })]).size, 0);
  });

  test('DEMO grants count only when explicitly allowed (fail closed)', () => {
    assert.equal(receivingProgramIds([g({ grantSource: 'DEMO' })]).size, 0);
    assert.equal(receivingProgramIds([g({ grantSource: 'DEMO' })], { allowDemoGrants: 'true' }).size, 0, 'must be exactly true');
    assert.deepEqual([...receivingProgramIds([g({ grantSource: 'DEMO' })], { allowDemoGrants: true })], [11]);
  });

  test('unknown grant sources give nothing', () => {
    assert.equal(receivingProgramIds([g({ grantSource: 'ENTRA_GROUP' })], { allowDemoGrants: true }).size, 0);
  });

  test('creator and receiver access are evaluated per referral', () => {
    const referral = { createdByUserId: 100, receivingProgramId: 11 };
    assert.deepEqual(referralAccess(100, referral, new Set()), { asCreator: true, asReceiver: false, canView: true });
    assert.deepEqual(referralAccess(200, referral, new Set([11])), { asCreator: false, asReceiver: true, canView: true });
    assert.deepEqual(referralAccess(201, referral, new Set([12])), { asCreator: false, asReceiver: false, canView: false });
  });
});

describe('receiving queue', () => {
  let ctx;
  before(async () => { ctx = await populated(); });

  test('a receiver sees only referrals sent to their Program, newest first', async () => {
    const result = await ctx.queries.listReceived(RECEIVER_11);
    assert.deepEqual(result.programs, [{ programId: 11, name: 'Program Eleven' }]);
    assert.deepEqual(result.referrals.map((r) => r.referralId), [ctx.ids.c, ctx.ids.b, ctx.ids.a]);
    assert.equal(result.hasMore, false);
  });

  test('another Program\'s receiver sees only their own Program\'s referrals', async () => {
    const result = await ctx.queries.listReceived(RECEIVER_12);
    assert.deepEqual(result.referrals.map((r) => r.referralId).sort(), [ctx.ids.d, ctx.ids.e].sort());
  });

  test('queue items show the need but never contact details or notes', async () => {
    const [item] = (await ctx.queries.listReceived(RECEIVER_11)).referrals;
    assert.equal(item.referralContext, 'Synthetic need');
    assert.equal(item.referringProgram.name, 'Program Ten');
    assert.equal(item.stage, 'AWAITING_RESPONSE');
    for (const key of ['contactValue', 'contactMethod', 'notes', 'participantZip', 'createdByUserId', 'submissionId']) {
      assert.ok(!(key in item), `queue item must not include ${key}`);
    }
  });

  for (const [label, userId] of [
    ['the creator (no receiving grant)', CREATOR],
    ['a user with a revoked grant', REVOKED],
    ['a DEMO grant when demo grants are off', DEMO],
    ['an administrator / Program manager / org manager', ADMIN],
    ['DEPARTMENT- and ORG-scope receiving grants', WIDE_SCOPE],
    ['Program affiliation alone', AFFILIATED_11],
  ]) {
    test(`${label} sees an empty queue`, async () => {
      const result = await ctx.queries.listReceived(userId);
      assert.deepEqual(result, { programs: [], referrals: [], hasMore: false, nextCursor: null });
    });
  }

  test('DEMO grants work when the non-production caller allows them', async () => {
    const queries = createReferralQueryService({ store: ctx.store, allowDemoGrants: true });
    assert.equal((await queries.listReceived(DEMO)).referrals.length, 3);
  });

  test('an inactive user is refused', async () => {
    await rejectsWith(ctx.queries.listReceived(INACTIVE), 'USER_NOT_ACTIVE');
  });

  test('programId filter must be a Program the user may receive for', async () => {
    assert.equal((await ctx.queries.listReceived(RECEIVER_11, { programId: 11 })).referrals.length, 3);
    await rejectsWith(ctx.queries.listReceived(RECEIVER_11, { programId: 12 }), 'NOT_AUTHORIZED');
  });

  test('stage filter follows the derived lifecycle (PRD 6.5)', async () => {
    const { store, ids, queries } = await populated();
    store._setReferralState(ids.a, { responseStatus: 'RESPONDED', decision: 'ACCEPTED' });
    store._setReferralState(ids.b, { responseStatus: 'RESPONDED', decision: 'NOT_APPROPRIATE' });

    const stage = async (s) => (await queries.listReceived(RECEIVER_11, { stage: s })).referrals.map((r) => r.referralId);
    assert.deepEqual(await stage('AWAITING_RESPONSE'), [ids.c]);
    assert.deepEqual(await stage('ACCEPTED_OUTCOME_PENDING'), [ids.a]);
    assert.deepEqual(await stage('COMPLETE'), [ids.b]);

    store._setReferralState(ids.a, { serviceOutcome: 'RESULTED_IN_SERVICE' });
    assert.deepEqual((await stage('COMPLETE')).sort(), [ids.a, ids.b].sort());
  });

  test(`lists are bounded to ${LIST_LIMIT} with hasMore`, async () => {
    const store = seed();
    const create = createReferralService({ store });
    for (let i = 0; i < LIST_LIMIT + 3; i += 1) await create.createDirectReferral(CREATOR, body());
    const result = await createReferralQueryService({ store }).listReceived(RECEIVER_11);
    assert.equal(result.referrals.length, LIST_LIMIT);
    assert.equal(result.hasMore, true);
  });
});

describe('creator\'s own referrals', () => {
  let ctx;
  before(async () => { ctx = await populated(); });

  test('the creator sees every referral they created, and nobody else\'s', async () => {
    const result = await ctx.queries.listSent(CREATOR);
    assert.deepEqual(result.referrals.map((r) => r.referralId).sort(), [ctx.ids.a, ctx.ids.b, ctx.ids.c, ctx.ids.d].sort());
    assert.deepEqual((await ctx.queries.listSent(AFFILIATED_11)).referrals.map((r) => r.referralId), [ctx.ids.e]);
  });

  test('a receiver\'s "sent" list does not include what they received', async () => {
    assert.deepEqual((await ctx.queries.listSent(RECEIVER_11)).referrals, []);
  });

  test('sent items omit the need, contact details and notes', async () => {
    const [item] = (await ctx.queries.listSent(CREATOR)).referrals;
    for (const key of ['referralContext', 'contactValue', 'notes']) assert.ok(!(key in item), key);
  });
});

describe('single referral', () => {
  let ctx;
  before(async () => { ctx = await populated(); });

  test('the creator can view it, as creator', async () => {
    const { referral, viewerAccess } = await ctx.queries.getReferral(CREATOR, ctx.ids.a);
    assert.equal(referral.participantName, 'Synthetic A');
    assert.deepEqual(viewerAccess, { asCreator: true, asReceiver: false, canRespond: false });
  });

  test('an authorized receiver can view it with contact details, as receiver', async () => {
    const { referral, viewerAccess } = await ctx.queries.getReferral(RECEIVER_11, ctx.ids.a);
    assert.equal(referral.contactValue, '555-010-0147');
    assert.equal(referral.notes, 'Synthetic note');
    assert.deepEqual(viewerAccess, { asCreator: false, asReceiver: true, canRespond: false });
  });

  test('someone who is both creator and receiver gets both', async () => {
    const store = seed();
    const id = (await createReferralService({ store }).createDirectReferral(RECEIVER_11, body())).referral.referralId;
    const { viewerAccess } = await createReferralQueryService({ store }).getReferral(RECEIVER_11, id);
    assert.deepEqual(viewerAccess, { asCreator: true, asReceiver: true, canRespond: false });
  });

  test('the creator is shown by display name only', async () => {
    const { referral } = await ctx.queries.getReferral(RECEIVER_11, ctx.ids.a);
    assert.deepEqual(referral.createdBy, { displayName: 'Synthetic Referrer' });
    assert.ok(!JSON.stringify(referral).includes('referrer@example.test'));
    assert.ok(!('createdByUserId' in referral));
  });

  for (const [label, userId] of [
    ['a receiver for a different Program', RECEIVER_12],
    ['a user with a revoked grant', REVOKED],
    ['a DEMO grant when demo grants are off', DEMO],
    ['an administrator holding VIEW_UNDERLYING_REFERRAL and management grants', ADMIN],
    ['DEPARTMENT/ORG-scope grants', WIDE_SCOPE],
    ['Program affiliation alone', AFFILIATED_11],
  ]) {
    test(`${label} gets "not found", exactly like a missing referral`, async () => {
      const denied = await ctx.queries.getReferral(userId, ctx.ids.a).catch((e) => e);
      const missing = await ctx.queries.getReferral(userId, 999999).catch((e) => e);
      assert.equal(denied.code, 'REFERRAL_NOT_FOUND');
      assert.deepEqual([denied.status, denied.code, denied.message], [missing.status, missing.code, missing.message]);
    });
  }
});

describe('HTTP routes', () => {
  let ctx;
  before(async () => { ctx = await populated(); });
  const appAs = (userId, extra = {}) => createApp({ referralStore: ctx.store, affiliationStore: ctx.store, resolveIdentity: () => ({ userId }), ...extra });

  test('all read routes fail closed with 401 without sign-in', async () => {
    const app = createApp({ referralStore: ctx.store });
    for (const path of ['/api/referrals/received', '/api/referrals/sent', `/api/referrals/${ctx.ids.a}`]) {
      const res = await request(app).get(path);
      assert.equal(res.status, 401, path);
      assert.ok(!res.text.includes('Synthetic'), path);
    }
  });

  test('GET /received returns the queue and is never cached', async () => {
    const res = await request(appAs(RECEIVER_11)).get('/api/referrals/received');
    assert.equal(res.status, 200);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.body.referrals.length, 3);
  });

  test('browser-supplied user IDs, roles or membership are rejected, not trusted', async () => {
    for (const query of ['userId=200', 'role=RECEIVER', 'receivingProgramIds=11', 'asUser=200']) {
      const res = await request(appAs(CREATOR)).get(`/api/referrals/received?${query}`);
      assert.equal(res.status, 400, query);
      assert.equal(res.body.code, 'UNEXPECTED_FIELD');
    }
    const headerAttempt = await request(appAs(CREATOR)).get('/api/referrals/received').set('X-User-Id', String(RECEIVER_11));
    assert.deepEqual(headerAttempt.body.referrals, [], 'headers do not change identity');
  });

  test('a programId outside the user\'s grants returns 403', async () => {
    const res = await request(appAs(RECEIVER_11)).get('/api/referrals/received?programId=12');
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'NOT_AUTHORIZED');
  });

  test('invalid filters return 400', async () => {
    for (const query of ['programId=abc', 'programId=0', 'programId=11&programId=12', 'stage=CLOSED']) {
      const res = await request(appAs(RECEIVER_11)).get(`/api/referrals/received?${query}`);
      assert.equal(res.status, 400, query);
    }
  });

  test('GET /sent returns only the signed-in user\'s referrals', async () => {
    const res = await request(appAs(CREATOR)).get('/api/referrals/sent?stage=AWAITING_RESPONSE');
    assert.equal(res.status, 200);
    assert.equal(res.body.referrals.length, 4);
  });

  test('GET /:id: unauthorized and non-existent look identical (404)', async () => {
    const denied = await request(appAs(RECEIVER_12)).get(`/api/referrals/${ctx.ids.a}`);
    const missing = await request(appAs(RECEIVER_12)).get('/api/referrals/999999');
    assert.equal(denied.status, 404);
    assert.deepEqual(denied.body, missing.body);
    assert.ok(!denied.text.includes('Synthetic'));
  });

  test('GET /:id: authorized receiver gets the referral', async () => {
    const res = await request(appAs(RECEIVER_11)).get(`/api/referrals/${ctx.ids.a}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.viewerAccess.asReceiver, true);
  });

  test('GET /:id: malformed IDs and extra query parameters are rejected', async () => {
    assert.equal((await request(appAs(CREATOR)).get('/api/referrals/abc')).status, 404);
    assert.equal((await request(appAs(CREATOR)).get(`/api/referrals/${ctx.ids.a}?asUser=200`)).status, 400);
  });

  test('createApp does not honor DEMO grants unless told to', async () => {
    assert.equal((await request(appAs(DEMO)).get('/api/referrals/received')).body.referrals.length, 0);
    assert.equal((await request(appAs(DEMO, { allowDemoGrants: true, nodeEnv: 'test' })).get('/api/referrals/received')).body.referrals.length, 3);
  });

  test('DEMO grants cannot be turned on outside development or test (PRD 16.1, 17.4)', () => {
    for (const nodeEnv of ['production', 'Production', 'staging', '', undefined]) {
      assert.throws(() => appAs(DEMO, { allowDemoGrants: true, nodeEnv }), /DEMO grants/, String(nodeEnv));
    }
    for (const nodeEnv of ['development', 'test']) {
      assert.doesNotThrow(() => appAs(DEMO, { allowDemoGrants: true, nodeEnv }));
    }
    assert.doesNotThrow(() => appAs(DEMO, { nodeEnv: 'production' }), 'demo off is always allowed');
    assert.throws(() => assertDemoGrantsAllowed(true, 'production'));
    assert.doesNotThrow(() => assertDemoGrantsAllowed(false, undefined));
  });

  test('IDs beyond the safe integer range are refused, never rounded', async () => {
    let seen = 'not called';
    const spy = { ...ctx.store, getReferralById: async (id) => { seen = id; return null; } };
    const app = createApp({ referralStore: spy, affiliationStore: spy, resolveIdentity: () => ({ userId: RECEIVER_11 }) });
    assert.equal((await request(app).get('/api/referrals/9007199254740993')).status, 404);
    assert.equal(seen, 'not called', 'the store is never asked for a rounded ID');
    assert.equal((await request(appAs(RECEIVER_11)).get('/api/referrals/received?programId=9007199254740993')).status, 400);
    assert.equal((await request(appAs(RECEIVER_11)).get('/api/referrals/received?programId=11')).status, 200);
  });

  test('existing routes still work alongside the new ones', async () => {
    const res = await request(appAs(CREATOR)).get(`/api/referrals/submissions/${randomUUID()}`);
    assert.equal(res.body.status, 'NOT_RECEIVED');
  });
});

test('stageOf matches PRD 6.2 states', () => {
  assert.equal(stageOf({ responseStatus: 'AWAITING_RESPONSE', decision: null, serviceOutcome: 'NOT_RECORDED' }), 'AWAITING_RESPONSE');
  assert.equal(stageOf({ responseStatus: 'RESPONDED', decision: 'ACCEPTED', serviceOutcome: 'NOT_RECORDED' }), 'ACCEPTED_OUTCOME_PENDING');
  assert.equal(stageOf({ responseStatus: 'RESPONDED', decision: 'ACCEPTED', serviceOutcome: 'RESULTED_IN_SERVICE' }), 'COMPLETE');
  assert.equal(stageOf({ responseStatus: 'RESPONDED', decision: 'ACCEPTED', serviceOutcome: 'DID_NOT_RESULT_IN_SERVICE' }), 'COMPLETE');
  assert.equal(stageOf({ responseStatus: 'RESPONDED', decision: 'NOT_APPROPRIATE', serviceOutcome: 'NOT_RECORDED' }), 'COMPLETE');
});

// ---------------------------------------------------------------------------
// PR #10 review: unknown query parameters (PRD 10.4, 15.4) and complete,
// paginated queue access (PRD 9.9).

describe('unknown query parameters are refused without echoing their names', () => {
  const MARKER = 'Synthetic Person Omega 555-0199';
  const appAs = (userId) => createApp({ referralStore: seed(), affiliationStore: seed(), resolveIdentity: () => ({ userId }) });

  for (const path of ['/api/referrals/received', '/api/referrals/sent', '/api/referrals/1']) {
    test(`${path}`, async () => {
      const res = await request(appAs(RECEIVER_11)).get(path).query({ [MARKER]: '1' });
      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'UNEXPECTED_FIELD');
      assert.equal(res.body.fields, undefined);
      assert.ok(!res.text.includes('Omega'));
      assert.ok(!res.text.includes('0199'));
    });
  }
});

describe('pagination: every authorized referral is reachable (PRD 9.9)', () => {
  // A fixed clock so many referrals share a timestamp: the referralId
  // tie-break must keep the order total.
  async function big({ toEleven = 2 * LIST_LIMIT + 37, toTwelve = 50 } = {}) {
    let tick = 0;
    const store = createMemoryReferralStore(seedData(), { now: () => new Date(Date.UTC(2026, 9, 1, 12, 0, Math.floor(tick++ / 7))) });
    const create = createReferralService({ store });
    const created = { 11: [], 12: [] };
    for (let i = 0; i < Math.max(toEleven, toTwelve); i += 1) {
      if (i < toEleven) created[11].push((await create.createDirectReferral(CREATOR, body())).referral.referralId);
      if (i < toTwelve) created[12].push((await create.createDirectReferral(AFFILIATED_11, body({ receivingProgramId: 12 }))).referral.referralId);
    }
    return { store, created, queries: createReferralQueryService({ store }) };
  }

  // Same users and grants as seed(), as plain data.
  function seedData() {
    const s = seed();
    return {
      departments: [{ departmentId: 1, name: 'Synthetic Dept A', lifecycleStatus: 'ACTIVE' }, { departmentId: 2, name: 'Synthetic Dept B', lifecycleStatus: 'ACTIVE' }],
      programs: [10, 11, 12].map((programId) => ({ programId, departmentId: programId === 10 ? 1 : 2, name: `Program ${programId}`, site: null, lifecycleStatus: 'ACTIVE' })),
      users: [CREATOR, RECEIVER_11, RECEIVER_12, AFFILIATED_11].map((userId) => ({
        userId, isActive: true, currentProgramId: { [CREATOR]: 10, [RECEIVER_11]: 11, [RECEIVER_12]: 12, [AFFILIATED_11]: 11 }[userId],
      })),
      grants: s._grants.filter((g) => [RECEIVER_11, RECEIVER_12].includes(g.userId)),
    };
  }

  async function allPages(fetchPage) {
    const pages = [];
    let cursor;
    do {
      const page = await fetchPage(cursor);
      pages.push(page);
      cursor = page.nextCursor ?? undefined;
      assert.equal(page.hasMore, page.nextCursor !== null);
      assert.ok(pages.length < 50, 'pagination terminates');
    } while (cursor);
    return pages;
  }

  const ordered = (items) => items.every((r, i) => i === 0
    || items[i - 1].createdAt > r.createdAt
    || (items[i - 1].createdAt === r.createdAt && items[i - 1].referralId > r.referralId));

  test('the receiving queue pages through every referral exactly once, in stable order', async () => {
    const { created, queries } = await big();
    const pages = await allPages((cursor) => queries.listReceived(RECEIVER_11, cursor ? { after: decodeCursor(cursor) } : {}));
    const ids = pages.flatMap((p) => p.referrals.map((r) => r.referralId));

    assert.equal(pages.length, 3);
    assert.ok(pages.every((p) => p.referrals.length <= LIST_LIMIT));
    assert.equal(new Set(ids).size, ids.length, 'no duplicates');
    assert.deepEqual([...ids].sort((a, b) => a - b), [...created[11]].sort((a, b) => a - b), 'every authorized referral, nothing else');
    assert.ok(ordered(pages.flatMap((p) => p.referrals)), 'one continuous newest-first order');
  });

  test('pages never cross scope: another Program\'s referrals never appear', async () => {
    const { created, queries } = await big();
    const pages = await allPages((cursor) => queries.listReceived(RECEIVER_12, cursor ? { after: decodeCursor(cursor) } : {}));
    assert.deepEqual(pages.flatMap((p) => p.referrals.map((r) => r.referralId)).sort((a, b) => a - b), created[12].sort((a, b) => a - b));
  });

  test('a cursor from someone else\'s list shows only the caller\'s own referrals', async () => {
    const { created, queries } = await big();
    const firstOfEleven = await queries.listReceived(RECEIVER_11);
    const borrowed = await queries.listReceived(RECEIVER_12, { after: decodeCursor(firstOfEleven.nextCursor) });
    assert.ok(borrowed.referrals.every((r) => created[12].includes(r.referralId)));
  });

  test('authorization is checked again on every page: revoking mid-way stops the next page', async () => {
    const { store, queries } = await big();
    const first = await queries.listReceived(RECEIVER_11);
    assert.equal(first.hasMore, true);
    store._grants.find((g) => g.userId === RECEIVER_11).revokedAt = '2026-10-17T00:00:00.000Z';
    const next = await queries.listReceived(RECEIVER_11, { after: decodeCursor(first.nextCursor) });
    assert.deepEqual(next.referrals, []);
    await assert.rejects(queries.listReceived(RECEIVER_11, { programId: 11, after: decodeCursor(first.nextCursor) }),
      (err) => err.code === 'NOT_AUTHORIZED');
  });

  test('referrals created between pages are not duplicated and do not shift later pages', async () => {
    const { store, created, queries } = await big();
    const first = await queries.listReceived(RECEIVER_11);
    await createReferralService({ store }).createDirectReferral(CREATOR, body());
    const rest = await allPages((cursor) => queries.listReceived(RECEIVER_11, { after: decodeCursor(cursor ?? first.nextCursor) }));
    const ids = [...first.referrals, ...rest.flatMap((p) => p.referrals)].map((r) => r.referralId);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(ids.sort((a, b) => a - b), created[11].sort((a, b) => a - b));
  });

  test('the creator\'s sent list pages the same way, with the stage filter kept', async () => {
    const { store, created, queries } = await big({ toEleven: LIST_LIMIT + 10, toTwelve: 0 });
    for (const id of created[11].slice(0, 5)) store._setReferralState(id, { responseStatus: 'RESPONDED', decision: 'ACCEPTED' });
    const all = await allPages((cursor) => queries.listSent(CREATOR, cursor ? { after: decodeCursor(cursor) } : {}));
    assert.equal(all.flatMap((p) => p.referrals).length, LIST_LIMIT + 10);
    const awaiting = await allPages((cursor) => queries.listSent(CREATOR, { stage: 'AWAITING_RESPONSE', ...(cursor ? { after: decodeCursor(cursor) } : {}) }));
    const awaitingIds = awaiting.flatMap((p) => p.referrals.map((r) => r.referralId));
    assert.equal(awaitingIds.length, LIST_LIMIT + 5);
    assert.ok(awaiting.flatMap((p) => p.referrals).every((r) => r.stage === 'AWAITING_RESPONSE'));
  });

  test('HTTP: following nextCursor returns every referral; the cursor holds no participant data', async () => {
    const { store, created } = await big({ toEleven: LIST_LIMIT + 25, toTwelve: 0 });
    const app = createApp({ referralStore: store, affiliationStore: store, resolveIdentity: () => ({ userId: RECEIVER_11 }) });
    const first = await request(app).get('/api/referrals/received');
    assert.equal(first.body.hasMore, true);
    assert.doesNotMatch(Buffer.from(first.body.nextCursor, 'base64url').toString(), /Synthetic|555/);
    const second = await request(app).get('/api/referrals/received').query({ cursor: first.body.nextCursor });
    assert.equal(second.status, 200);
    assert.equal(second.body.hasMore, false);
    assert.equal(second.body.nextCursor, null);
    const ids = [...first.body.referrals, ...second.body.referrals].map((r) => r.referralId);
    assert.deepEqual(ids.sort((a, b) => a - b), created[11].sort((a, b) => a - b));
  });

  test('HTTP: malformed or tampered cursors are refused with 400', async () => {
    const { store } = await big({ toEleven: 3, toTwelve: 0 });
    const app = createApp({ referralStore: store, affiliationStore: store, resolveIdentity: () => ({ userId: RECEIVER_11 }) });
    const bad = [
      'not a cursor',
      '!!!',
      'x'.repeat(500),
      Buffer.from('{"a":1}').toString('base64url'),
      Buffer.from('["2026-10-01T12:00:00Z"]').toString('base64url'),
      Buffer.from('["yesterday", 5]').toString('base64url'),
      Buffer.from('["2026-10-01T12:00:00Z", 0]').toString('base64url'),
      Buffer.from('["2026-10-01T12:00:00Z", 9007199254740993]').toString('base64url'),
      Buffer.from('["2026-10-01T12:00:00Z", "5"]').toString('base64url'),
    ];
    for (const cursor of bad) {
      const res = await request(app).get('/api/referrals/received').query({ cursor });
      assert.equal(res.status, 400, cursor);
      assert.deepEqual(res.body.fields, ['cursor']);
    }
    const repeated = await request(app).get(`/api/referrals/received?cursor=${encodeCursor({ createdAt: '2026-10-01T12:00:00.000Z', referralId: 5 })}&cursor=x`);
    assert.equal(repeated.status, 400);
  });

  test('cursor round trip keeps the exact timestamp text', () => {
    const position = { createdAt: '2026-10-01T12:00:00.1234567Z', referralId: 42 };
    assert.deepEqual(decodeCursor(encodeCursor(position)), position);
  });
});

describe('production startup wiring (PRD 16.1, 17.4, 18.5)', () => {
  test('server.js passes the validated NODE_ENV and never enables DEMO grants', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
    assert.match(src, /createApp\(\{[^}]*nodeEnv: config\.nodeEnv/);
    assert.doesNotMatch(src, /allowDemoGrants:\s*true/);
  });
});
