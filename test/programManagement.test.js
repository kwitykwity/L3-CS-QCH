// Program maintenance, slice 14A (Trello card 14).
// Final Technical PRD 3.2, 3.3, 3.6, 3.8, 3.9, 4.1, 4.2, 4.4, 6.4, 9.3,
// 9.4, 9.6, 10.3, 10.4, 10.5, 13.4, 16.1. All data is SYNTHETIC.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
import { createReferralService } from '../src/referrals/referralService.js';
import { createProgramService } from '../src/programs/programService.js';
import { validateProgramDetails } from '../src/programs/validateProgramChange.js';

const MANAGER = 100;        // MANAGE_PROGRAM for Program 11
const OTHER_MANAGER = 101;  // MANAGE_PROGRAM for Program 12 only
const NO_GRANTS = 102;      // affiliated with Program 11, no grants
const INACTIVE = 103;       // MANAGE_PROGRAM for 11, inactive account
const REVOKED = 104;        // MANAGE_PROGRAM for 11, revoked
const DEMO_USER = 105;      // DEMO MANAGE_PROGRAM for 11
const ADMIN_ONLY = 106;     // admin and other capabilities, no MANAGE_PROGRAM
const WIDE_SCOPE = 107;     // MANAGE_PROGRAM at DEPARTMENT and ORG scope only
const SECOND = 108;         // another MANAGE_PROGRAM holder for Program 11
const CREATOR = 109;        // makes referrals; affiliated with Program 10

const MARKER = 'SyntheticMarkerOmega';

const g = (userId, permission, extra = {}) => ({
  userId, permission, scopeType: 'PROGRAM', programId: 11, departmentId: null, grantSource: 'IN_APP', ...extra,
});

function seed({ now } = {}) {
  return createMemoryReferralStore({
    departments: [
      { departmentId: 1, name: 'Synthetic Dept A', lifecycleStatus: 'ACTIVE' },
      { departmentId: 2, name: 'Synthetic Dept Closed', lifecycleStatus: 'DISCONTINUED' },
    ],
    programs: [
      { programId: 10, departmentId: 1, name: 'Synthetic Referring Program', site: null, lifecycleStatus: 'ACTIVE' },
      { programId: 11, departmentId: 1, name: 'Synthetic Managed Program', site: 'Synthetic Site 1', lifecycleStatus: 'ACTIVE',
        description: 'Synthetic description', eligibilityNotes: 'Synthetic eligibility', notificationEmail: 'inbox@example.test' },
      { programId: 12, departmentId: 1, name: 'Synthetic Other Program', site: null, lifecycleStatus: 'ACTIVE' },
      { programId: 13, departmentId: 2, name: 'Synthetic Program In Closed Dept', site: null, lifecycleStatus: 'DISCONTINUED' },
      { programId: 14, departmentId: 1, name: 'Synthetic Retired Program', site: null, lifecycleStatus: 'RETIRED' },
    ],
    users: [MANAGER, OTHER_MANAGER, NO_GRANTS, REVOKED, DEMO_USER, ADMIN_ONLY, WIDE_SCOPE, SECOND, CREATOR]
      .map((userId) => ({
        userId,
        isActive: true,
        currentProgramId: userId === NO_GRANTS ? 11 : userId === CREATOR ? 10 : null,
        displayName: `Synthetic ${userId}`,
      }))
      .concat([{ userId: INACTIVE, isActive: false }]),
    grants: [
      ...[11, 13, 14].map((programId) => g(MANAGER, 'MANAGE_PROGRAM', { programId })),
      g(OTHER_MANAGER, 'MANAGE_PROGRAM', { programId: 12 }),
      g(INACTIVE, 'MANAGE_PROGRAM'),
      g(REVOKED, 'MANAGE_PROGRAM', { revokedAt: '2026-10-01T00:00:00.000Z' }),
      g(DEMO_USER, 'MANAGE_PROGRAM', { grantSource: 'DEMO' }),
      g(ADMIN_ONLY, 'ADMINISTER_PERMISSIONS', { scopeType: 'ORG', programId: null }),
      g(ADMIN_ONLY, 'MANAGE_ORGANIZATION', { scopeType: 'ORG', programId: null }),
      g(ADMIN_ONLY, 'VIEW_RECEIVED_REFERRAL'),
      g(ADMIN_ONLY, 'RESPOND_TO_REFERRAL'),
      g(WIDE_SCOPE, 'MANAGE_PROGRAM', { scopeType: 'DEPARTMENT', programId: null, departmentId: 1 }),
      g(WIDE_SCOPE, 'MANAGE_PROGRAM', { scopeType: 'ORG', programId: null }),
      g(SECOND, 'MANAGE_PROGRAM'),
    ],
  }, now ? { now } : undefined);
}

function setup(options = {}) {
  const store = seed();
  return { store, programs: createProgramService({ store, ...options }) };
}

async function rejectsWith(promise, code) {
  let caught;
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code);
    caught = err;
    return true;
  });
  return caught;
}

const versionOf = async (store, programId = 11) => (await store.getProgram(programId)).version;
const programAudit = (store) => store._referralAuditEvents.filter((e) => e.entityType === 'PROGRAM');

// ---------------------------------------------------------------------------

describe('editing Program information (MANAGE_PROGRAM)', () => {
  test('saves, bumps the version, and audits only the changed fields', async () => {
    const { store, programs } = setup();
    const version = await versionOf(store);

    const result = await programs.updateDetails(MANAGER, 11, {
      version,
      description: '  Synthetic new description  ',
      eligibilityNotes: 'Synthetic eligibility', // unchanged: not written or audited
      scheduleNotes: 'Synthetic Mondays',
    }, { correlationId: 'c-14a' });

    assert.equal(result.status, 'UPDATED');
    assert.equal(result.program.description, 'Synthetic new description', 'trimmed');
    assert.notEqual(result.program.version, version);
    const row = await store.getProgram(11);
    assert.equal(row.description, 'Synthetic new description');
    assert.equal(row.scheduleNotes, 'Synthetic Mondays');
    assert.equal(row.version, result.program.version, 'returned version is the stored one');
    assert.match(row.updatedAt, /Z$/);

    const [event] = programAudit(store);
    assert.deepEqual(
      [event.entityId, event.action, event.actorUserId, event.correlationId],
      [11, 'UPDATED', MANAGER, 'c-14a'],
    );
    assert.deepEqual(event.before, { description: 'Synthetic description', schedule_notes: null });
    assert.deepEqual(event.after, { description: 'Synthetic new description', schedule_notes: 'Synthetic Mondays' });
    assert.match(event.occurredAt, /Z$/, 'the store sets the audit time');
  });

  test('null or blank clears a field', async () => {
    const { store, programs } = setup();
    await programs.updateDetails(MANAGER, 11, { version: await versionOf(store), site: null, description: '   ' });
    const row = await store.getProgram(11);
    assert.equal(row.site, null);
    assert.equal(row.description, null);
  });

  test('the returned version works for the next edit', async () => {
    const { programs } = setup();
    const { program } = await programs.getProgram(MANAGER, 11);
    const first = await programs.updateDetails(MANAGER, 11, { version: program.version, costNotes: 'Synthetic free' });
    const second = await programs.updateDetails(MANAGER, 11, { version: first.program.version, costNotes: 'Synthetic sliding scale' });
    assert.equal(second.program.costNotes, 'Synthetic sliding scale');
  });

  test('a discontinued Program can still have its information maintained', async () => {
    const { store, programs } = setup();
    await programs.updateDetails(MANAGER, 13, { version: await versionOf(store, 13), costNotes: 'Synthetic note' });
    assert.equal((await store.getProgram(13)).costNotes, 'Synthetic note');
  });

  test('nothing changed -> 409 NO_CHANGE, nothing written, no audit', async () => {
    const { store, programs } = setup();
    const version = await versionOf(store);
    await rejectsWith(programs.updateDetails(MANAGER, 11, { version, description: 'Synthetic description' }), 'NO_CHANGE');
    assert.equal(await versionOf(store), version);
    assert.equal(programAudit(store).length, 0);
  });

  test('a retired Program cannot be edited', async () => {
    const { store, programs } = setup();
    await rejectsWith(programs.updateDetails(MANAGER, 14, { version: await versionOf(store, 14), costNotes: 'x' }), 'PROGRAM_RETIRED');
  });
});

describe('authorization: capability + resource + scope (PRD 3.6, 3.8, 3.9)', () => {
  const body = async (store) => ({ version: await versionOf(store), costNotes: 'Synthetic change' });

  for (const [label, userId, code] of [
    ['a MANAGE_PROGRAM grant for a different Program', OTHER_MANAGER, 'NOT_AUTHORIZED'],
    ['no grants, even when affiliated with the Program', NO_GRANTS, 'NOT_AUTHORIZED'],
    ['a revoked grant', REVOKED, 'NOT_AUTHORIZED'],
    ['a DEMO grant when demo grants are off', DEMO_USER, 'NOT_AUTHORIZED'],
    ['admin, organization, receiving and respond grants only', ADMIN_ONLY, 'NOT_AUTHORIZED'],
    ['MANAGE_PROGRAM at DEPARTMENT or ORG scope only', WIDE_SCOPE, 'NOT_AUTHORIZED'],
    ['an inactive account', INACTIVE, 'USER_NOT_ACTIVE'],
    ['an unknown user', 999, 'USER_NOT_ACTIVE'],
  ]) {
    test(`refused: ${label}`, async () => {
      const { store, programs } = setup();
      const before = await store.getProgram(11);
      await rejectsWith(programs.updateDetails(userId, 11, await body(store)), code);
      await rejectsWith(programs.discontinue(userId, 11, { version: before.version }), code);
      await rejectsWith(programs.getProgram(userId, 11), code);
      assert.deepEqual(await store.getProgram(11), before, 'nothing written');
      assert.equal(programAudit(store).length, 0);
    });
  }

  test('a DEMO grant works only when demo grants are explicitly allowed', async () => {
    const { store, programs } = setup({ allowDemoGrants: true });
    const result = await programs.updateDetails(DEMO_USER, 11, await body(store));
    assert.equal(result.status, 'UPDATED');
  });

  test('an unknown Program -> 404', async () => {
    const { programs } = setup();
    await rejectsWith(programs.updateDetails(MANAGER, 999, { version: 'v1', costNotes: 'x' }), 'PROGRAM_NOT_FOUND');
  });

  test('a grant revoked during an edit waits for it (grants are a locking read)', async () => {
    const { store, programs } = setup();
    let reached; let release;
    const reachedP = new Promise((r) => { reached = r; });
    const gate = new Promise((r) => { release = r; });
    let paused = false;
    store._afterLockingRead(async (kind, id) => {
      if (!paused && kind === 'grants' && id === MANAGER) { paused = true; reached(); await gate; }
    });
    const editing = programs.updateDetails(MANAGER, 11, await body(store));
    await reachedP;
    let revoked = false;
    const revoking = store._revokeGrants(MANAGER, 'MANAGE_PROGRAM').then(() => { revoked = true; });
    for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r));
    assert.equal(revoked, false, 'revocation waits for the edit');
    release();
    assert.equal((await editing).status, 'UPDATED');
    await revoking;
    await rejectsWith(programs.updateDetails(MANAGER, 11, await body(store)), 'NOT_AUTHORIZED');
  });

  test('an account deactivated during an edit waits for it, then is refused', async () => {
    const { store, programs } = setup();
    let reached; let release;
    const reachedP = new Promise((r) => { reached = r; });
    const gate = new Promise((r) => { release = r; });
    let paused = false;
    store._afterLockingRead(async (kind, id) => {
      if (!paused && kind === 'user' && id === MANAGER) { paused = true; reached(); await gate; }
    });
    const editing = programs.updateDetails(MANAGER, 11, await body(store));
    await reachedP;
    let done = false;
    const deactivating = store._setUserActive(MANAGER, false).then(() => { done = true; });
    for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r));
    assert.equal(done, false);
    release();
    await editing;
    await deactivating;
    await rejectsWith(programs.updateDetails(MANAGER, 11, await body(store)), 'USER_NOT_ACTIVE');
  });
});

describe('stale updates, concurrency, and rollback (PRD 9.3, 9.4, 13.4)', () => {
  test('a stale version -> 409 PROGRAM_CHANGED with the current Program; nothing written', async () => {
    const { store, programs } = setup();
    const seen = await versionOf(store);
    await programs.updateDetails(SECOND, 11, { version: seen, costNotes: 'Synthetic first' });
    const auditBefore = programAudit(store).length;

    const err = await rejectsWith(programs.updateDetails(MANAGER, 11, { version: seen, costNotes: 'Synthetic second' }), 'PROGRAM_CHANGED');
    assert.equal(err.current.costNotes, 'Synthetic first');
    assert.equal(err.current.version, await versionOf(store));
    assert.equal(!('notificationEmail' in err.current), true);
    assert.equal((await store.getProgram(11)).costNotes, 'Synthetic first');
    assert.equal(programAudit(store).length, auditBefore);
  });

  test('two editors at the same moment with the same version: exactly one wins', async () => {
    const { store, programs } = setup();
    const version = await versionOf(store);
    const results = await Promise.allSettled([
      programs.updateDetails(MANAGER, 11, { version, costNotes: 'Synthetic A' }),
      programs.updateDetails(SECOND, 11, { version, costNotes: 'Synthetic B' }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'PROGRAM_CHANGED');
    assert.equal(programAudit(store).length, 1);
  });

  test('an edit racing a discontinue: one wins, the other sees PROGRAM_CHANGED', async () => {
    const { store, programs } = setup();
    const version = await versionOf(store);
    const results = await Promise.allSettled([
      programs.updateDetails(MANAGER, 11, { version, costNotes: 'Synthetic A' }),
      programs.discontinue(SECOND, 11, { version }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'PROGRAM_CHANGED');
  });

  test('if the audit write fails, the change rolls back and can be retried', async () => {
    const { store, programs } = setup();
    const before = await store.getProgram(11);
    store._failNextAudit();
    await assert.rejects(programs.updateDetails(MANAGER, 11, { version: before.version, costNotes: 'Synthetic' }));
    assert.deepEqual(await store.getProgram(11), before, 'Program and version unchanged');
    assert.equal(programAudit(store).length, 0, 'no audit history either');
    const retry = await programs.updateDetails(MANAGER, 11, { version: before.version, costNotes: 'Synthetic' });
    assert.equal(retry.status, 'UPDATED');
  });

  test('audit failure on discontinue: still ACTIVE, still selectable', async () => {
    const { store, programs } = setup();
    const before = await store.getProgram(11);
    store._failNextAudit();
    await assert.rejects(programs.discontinue(MANAGER, 11, { version: before.version }));
    assert.equal((await store.getProgram(11)).lifecycleStatus, 'ACTIVE');
    assert.ok((await store.listActivePrograms()).some(({ program }) => program.programId === 11));
  });
});

describe('discontinue and reactivate (PRD 4.4)', () => {
  test('discontinue: excluded from new choices, audited, history untouched', async () => {
    const { store, programs } = setup();
    const referrals = createReferralService({ store });
    const sent = await referrals.createDirectReferral(CREATOR, {
      submissionId: randomUUID(), receivingProgramId: 11, participantName: 'Synthetic Person',
      contactMethod: 'NOT_AVAILABLE', referralContext: 'Synthetic need',
    });

    const result = await programs.discontinue(MANAGER, 11, { version: await versionOf(store) }, { correlationId: 'c-d' });
    assert.equal(result.status, 'DISCONTINUED');
    assert.equal(result.program.lifecycleStatus, 'DISCONTINUED');
    assert.ok(!(await store.listActivePrograms()).some(({ program }) => program.programId === 11));

    const event = programAudit(store).at(-1);
    assert.deepEqual([event.action, event.before, event.after], ['DISCONTINUED', { lifecycle_status: 'ACTIVE' }, { lifecycle_status: 'DISCONTINUED' }]);

    const existing = store._referrals.find((r) => r.referralId === sent.referral.referralId);
    assert.equal(existing.receivingProgramId, 11, 'past referral keeps its Program');
    await rejectsWith(referrals.createDirectReferral(CREATOR, {
      submissionId: randomUUID(), receivingProgramId: 11, participantName: 'Synthetic Person',
      contactMethod: 'NOT_AVAILABLE', referralContext: 'Synthetic need',
    }), 'RECEIVING_PROGRAM_NOT_SELECTABLE');
  });

  test('reactivate: back in new choices, audited as REACTIVATED', async () => {
    const { store, programs } = setup();
    const off = await programs.discontinue(MANAGER, 11, { version: await versionOf(store) });
    const on = await programs.reactivate(MANAGER, 11, { version: off.program.version });
    assert.equal(on.status, 'REACTIVATED');
    assert.ok((await store.listActivePrograms()).some(({ program }) => program.programId === 11));
    assert.equal(programAudit(store).at(-1).action, 'REACTIVATED');
  });

  test('reactivating in a discontinued Department is refused', async () => {
    const { store, programs } = setup();
    await rejectsWith(programs.reactivate(MANAGER, 13, { version: await versionOf(store, 13) }), 'DEPARTMENT_NOT_ACTIVE');
    assert.equal((await store.getProgram(13)).lifecycleStatus, 'DISCONTINUED');
  });

  test('already in that status, or retired, is refused', async () => {
    const { store, programs } = setup();
    await rejectsWith(programs.reactivate(MANAGER, 11, { version: await versionOf(store) }), 'ALREADY_IN_STATUS');
    await rejectsWith(programs.discontinue(MANAGER, 14, { version: await versionOf(store, 14) }), 'PROGRAM_RETIRED');
  });

  test('a discontinue waits for a referral that already read the Program as ACTIVE', async () => {
    const { store, programs } = setup();
    const referrals = createReferralService({ store });
    let reached; let release;
    const reachedP = new Promise((r) => { reached = r; });
    const gate = new Promise((r) => { release = r; });
    let paused = false;
    store._afterLockingRead(async (kind, id) => {
      if (!paused && kind === 'program' && id === 11) { paused = true; reached(); await gate; }
    });
    const referring = referrals.createDirectReferral(CREATOR, {
      submissionId: randomUUID(), receivingProgramId: 11, participantName: 'Synthetic Person',
      contactMethod: 'NOT_AVAILABLE', referralContext: 'Synthetic need',
    });
    await reachedP; // the referral has read Program 11 as ACTIVE

    let discontinued = false;
    const discontinuing = programs.discontinue(MANAGER, 11, { version: await versionOf(store) })
      .then(() => { discontinued = true; });
    for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r));
    assert.equal(discontinued, false, 'the discontinue waits for the referral');
    assert.equal((await store.getProgram(11)).lifecycleStatus, 'ACTIVE');

    release();
    assert.equal((await referring).status, 'RECEIVED');
    await discontinuing;
    assert.equal((await store.getProgram(11)).lifecycleStatus, 'DISCONTINUED');
  });
});

describe('request validation (PRD 10.3, 10.4, 10.7)', () => {
  for (const extra of [
    { name: 'Synthetic rename' },
    { departmentId: 2 },
    { notificationEmail: 'x@example.test' },
    { lifecycleStatus: 'DISCONTINUED' },
    { ageMin: 18 },
    { programId: 12 },
    { [MARKER]: 1 },
  ]) {
    test(`not editable here: ${Object.keys(extra)[0]} -> UNEXPECTED_FIELD, no echo`, async () => {
      const { store, programs } = setup();
      const err = await rejectsWith(programs.updateDetails(MANAGER, 11, { version: await versionOf(store), ...extra }), 'UNEXPECTED_FIELD');
      assert.doesNotMatch(JSON.stringify({ message: err.message, fields: err.fields }), new RegExp(Object.keys(extra)[0]));
    });
  }

  test('field rules', () => {
    const v = 'v1';
    assert.deepEqual(validateProgramDetails({ version: v }).fields, ['changes']);
    assert.deepEqual(validateProgramDetails({ costNotes: 'x' }).fields, ['version']);
    assert.deepEqual(validateProgramDetails({ version: v, costNotes: 'x'.repeat(1001) }).fields, ['costNotes']);
    assert.deepEqual(validateProgramDetails({ version: v, site: 'line1\nline2' }).fields, ['site']);
    assert.deepEqual(validateProgramDetails({ version: v, description: 'bad\u0007' }).fields, ['description']);
    assert.deepEqual(validateProgramDetails({ version: v, description: 5 }).fields, ['description']);
    assert.deepEqual(validateProgramDetails({ version: v, description: 'multi\nline ok' }).value.changes, { description: 'multi\nline ok' });
    assert.equal(validateProgramDetails([]).ok, false);
  });

  test('lifecycle bodies accept only version', async () => {
    const { store, programs } = setup();
    await rejectsWith(programs.discontinue(MANAGER, 11, { version: await versionOf(store), lifecycleStatus: 'ACTIVE' }), 'UNEXPECTED_FIELD');
    await rejectsWith(programs.discontinue(MANAGER, 11, {}), 'INVALID_REQUEST');
  });
});

describe('HTTP routes', () => {
  function appFor(store, userId = MANAGER) {
    return createApp({
      affiliationStore: store,
      referralStore: store,
      resolveIdentity: () => (userId === null ? null : { userId }),
      nodeEnv: 'test',
    });
  }
  const base = '/api/program-management/programs';

  test('GET returns the editable Program with its version, never routing data', async () => {
    const res = await request(appFor(seed())).get(`${base}/11`);
    assert.equal(res.status, 200);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.deepEqual(Object.keys(res.body.program).sort(), [
      'costNotes', 'departmentId', 'departmentName', 'description', 'eligibilityNotes', 'lifecycleStatus',
      'name', 'programId', 'scheduleNotes', 'site', 'updatedAt', 'version',
    ]);
  });

  test('PATCH, discontinue, and reactivate over HTTP', async () => {
    const app = appFor(seed());
    const { body: { program } } = await request(app).get(`${base}/11`);
    const patched = await request(app).patch(`${base}/11`).send({ version: program.version, costNotes: 'Synthetic' });
    assert.equal(patched.status, 200);
    const off = await request(app).post(`${base}/11/discontinue`).send({ version: patched.body.program.version });
    assert.equal(off.body.status, 'DISCONTINUED');
    const on = await request(app).post(`${base}/11/reactivate`).send({ version: off.body.program.version });
    assert.equal(on.body.status, 'REACTIVATED');
    const stale = await request(app).patch(`${base}/11`).send({ version: program.version, costNotes: 'Late' });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'PROGRAM_CHANGED');
    assert.equal(stale.body.current.version, on.body.program.version);
  });

  test('status codes: 401, 403, 404, 503', async () => {
    const store = seed();
    assert.equal((await request(appFor(store, null)).get(`${base}/11`)).status, 401);
    assert.equal((await request(appFor(store, OTHER_MANAGER)).get(`${base}/11`)).status, 403);
    assert.equal((await request(appFor(store, INACTIVE)).get(`${base}/11`)).status, 403);
    assert.equal((await request(appFor(store)).get(`${base}/999`)).status, 404);
    assert.equal((await request(appFor(store)).get(`${base}/9007199254740993`)).status, 404);
    assert.equal((await request(appFor(store)).get(`${base}/abc`)).status, 404);
    const noStore = createApp({ resolveIdentity: () => ({ userId: MANAGER }), nodeEnv: 'test' });
    assert.equal((await request(noStore).get(`${base}/11`)).status, 503);
  });

  test('query parameters are refused without echo, after sign-in', async () => {
    const app = appFor(seed());
    for (const q of ['?userId=5', `?${MARKER}=1`, `?x=${MARKER}`]) {
      const res = await request(app).get(`${base}/11${q}`);
      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'UNEXPECTED_FIELD');
      assert.doesNotMatch(JSON.stringify(res.body), new RegExp(`${MARKER}|userId`));
    }
    assert.equal((await request(appFor(seed(), null)).get(`${base}/11?userId=5`)).status, 401);
  });

  test('malformed JSON -> 400; a field outside the allowlist -> 400 without echo', async () => {
    const app = appFor(seed());
    const bad = await request(app).patch(`${base}/11`).set('Content-Type', 'application/json').send('{"version":');
    assert.equal(bad.status, 400);
    const extra = await request(app).patch(`${base}/11`).send({ version: 'v1', [MARKER]: 'x' });
    assert.equal(extra.body.code, 'UNEXPECTED_FIELD');
    assert.doesNotMatch(JSON.stringify(extra.body), new RegExp(MARKER));
  });

  test('demo grants at start-up follow the production guard', () => {
    assert.throws(() => createApp({ referralStore: seed(), allowDemoGrants: true, nodeEnv: 'production' }));
  });
});

describe('store contract: conditional Program update', () => {
  test('updateProgram writes nothing on a stale version (0 rows updated)', async () => {
    const store = seed();
    const before = await store.getProgram(11);
    const result = await store.withTransaction(async (tx) => {
      await tx.lockProgramForUpdate(11);
      return tx.updateProgram({ programId: 11, expectedVersion: 'v999', set: { costNotes: 'Synthetic' } });
    });
    assert.equal(result, null);
    assert.deepEqual(await store.getProgram(11), before);
  });

  test('updateProgram requires the Program held for update first', async () => {
    const store = seed();
    await assert.rejects(store.withTransaction((tx) =>
      tx.updateProgram({ programId: 11, expectedVersion: 'v1', set: { costNotes: 'x' } })), /lockProgramForUpdate/);
  });

  test('a second holder waits until the first transaction ends', async () => {
    const store = seed();
    let release;
    const gate = new Promise((r) => { release = r; });
    const first = store.withTransaction(async (tx) => { await tx.lockProgramForUpdate(11); await gate; });
    await new Promise((r) => setImmediate(r));
    let secondGotIt = false;
    const second = store.withTransaction(async (tx) => { await tx.lockProgramForUpdate(11); secondGotIt = true; });
    for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r));
    assert.equal(secondGotIt, false);
    release();
    await first;
    await second;
    assert.equal(secondGotIt, true);
  });
});

describe('managed Program discovery', () => {
  test('lists only granted Programs, including discontinued and retired, without routing or details', async () => {
    const { store, programs } = setup();
    const result = await programs.listManagedPrograms(MANAGER);
    assert.deepEqual(result.programs.map((p) => p.programId).sort((a, b) => a - b), [11, 13, 14]);
    assert.equal(result.programs.find((p) => p.programId === 13).lifecycleStatus, 'DISCONTINUED');
    assert.equal(result.programs.find((p) => p.programId === 14).lifecycleStatus, 'RETIRED');
    for (const row of result.programs) {
      assert.deepEqual(Object.keys(row).sort(), [
        'departmentId', 'departmentName', 'lifecycleStatus', 'name', 'programId', 'site',
      ]);
    }
    assert.equal(programAudit(store).length, 0);
    assert.deepEqual((await programs.listManagedPrograms(OTHER_MANAGER)).programs.map((p) => p.programId), [12]);
  });

  test('affiliation, revoked grants, demo grants, admin rights and broad scopes do not grant discovery', async () => {
    const { programs } = setup();
    for (const id of [NO_GRANTS, REVOKED, DEMO_USER, ADMIN_ONLY, WIDE_SCOPE]) {
      assert.deepEqual(await programs.listManagedPrograms(id), { programs: [] }, `user ${id}`);
    }
    const demo = setup({ allowDemoGrants: true });
    assert.deepEqual((await demo.programs.listManagedPrograms(DEMO_USER)).programs.map((p) => p.programId), [11]);
  });

  test('rejects inactive, missing and invalid identities', async () => {
    const { programs } = setup();
    for (const id of [INACTIVE, 999]) {
      await rejectsWith(programs.listManagedPrograms(id), 'USER_NOT_ACTIVE');
    }
    for (const id of [0, -1, 1.5, '100', undefined]) {
      await rejectsWith(programs.listManagedPrograms(id), 'NOT_AUTHENTICATED');
    }
  });

  test('HTTP discovery is no-store, rejects queries without echo, and uses resolved identity', async () => {
    const store = seed();
    const app = createApp({
      affiliationStore: store,
      referralStore: store,
      resolveIdentity: () => ({ userId: OTHER_MANAGER }),
    });
    const url = '/api/program-management/programs';
    const listed = await request(app).get(url).set('X-User-Id', String(MANAGER));
    assert.equal(listed.status, 200);
    assert.equal(listed.headers['cache-control'], 'no-store');
    assert.deepEqual(listed.body.programs.map((p) => p.programId), [12]);
    const refused = await request(app).get(url).query({ [MARKER]: MARKER });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.code, 'UNEXPECTED_FIELD');
    assert.ok(!JSON.stringify(refused.body).includes(MARKER));
  });
});
