// Organization changes, slice 14C (Trello card 14): create Programs, move a
// Program to another Department, Department lifecycle.
// Final Technical PRD 3.6, 4.4, 6.4, 9.3, 9.4, 9.6, 10.3, 10.4, 13.4.
// All data is SYNTHETIC.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
import { createOrganizationService } from '../src/programs/organizationService.js';
import { createProgramService } from '../src/programs/programService.js';
import { validateCreateProgram, validateCreateDepartment } from '../src/programs/validateProgramChange.js';

const ORG_ADMIN = 200;    // MANAGE_ORGANIZATION at ORG scope
const SECOND_ORG = 201;   // another ORG-scope MANAGE_ORGANIZATION holder
const NARROW = 202;       // MANAGE_ORGANIZATION at PROGRAM scope (doesn't count)
const PM = 203;           // MANAGE_PROGRAM for 11, 13 (Program Director)
const PERMS_ADMIN = 204;  // ADMINISTER_PERMISSIONS at ORG scope (doesn't count)
const NOBODY = 205;
const INACTIVE = 206;     // ORG MANAGE_ORGANIZATION, inactive
const DEMO_ADMIN = 207;   // ORG MANAGE_ORGANIZATION from a DEMO grant
const MARKER = 'SyntheticMarkerUpsilon';

const g = (userId, permission, extra = {}) => ({
  userId, permission, scopeType: 'ORG', programId: null, departmentId: null, grantSource: 'IN_APP', ...extra,
});

// Department 1: Program 11 ACTIVE, Program 12 DISCONTINUED.
// Department 2: Program 13 DISCONTINUED only.
// Department 3: DISCONTINUED. Department 4: RETIRED.
function seed() {
  const store = createMemoryReferralStore({
    departments: [
      { departmentId: 1, name: 'Synthetic Youth Services', lifecycleStatus: 'ACTIVE' },
      { departmentId: 2, name: 'Synthetic Adult Services', lifecycleStatus: 'ACTIVE' },
      { departmentId: 3, name: 'Synthetic Closed Dept', lifecycleStatus: 'DISCONTINUED' },
      { departmentId: 4, name: 'Synthetic Retired Dept', lifecycleStatus: 'RETIRED' },
    ],
    programs: [
      { programId: 11, departmentId: 1, name: 'Synthetic After School', site: 'Synthetic Site A', lifecycleStatus: 'ACTIVE' },
      { programId: 12, departmentId: 1, name: 'Synthetic Summer Camp', site: null, lifecycleStatus: 'DISCONTINUED' },
      { programId: 13, departmentId: 2, name: 'Synthetic ESOL', site: null, lifecycleStatus: 'DISCONTINUED' },
      { programId: 14, departmentId: 3, name: 'Synthetic Old Program', site: null, lifecycleStatus: 'RETIRED' },
    ],
    users: [ORG_ADMIN, SECOND_ORG, NARROW, PM, PERMS_ADMIN, NOBODY, DEMO_ADMIN]
      .map((userId) => ({ userId, isActive: true }))
      .concat([{ userId: INACTIVE, isActive: false }]),
    grants: [
      g(ORG_ADMIN, 'MANAGE_ORGANIZATION'),
      g(SECOND_ORG, 'MANAGE_ORGANIZATION'),
      g(NARROW, 'MANAGE_ORGANIZATION', { scopeType: 'PROGRAM', programId: 11 }),
      g(PM, 'MANAGE_PROGRAM', { scopeType: 'PROGRAM', programId: 11 }),
      g(PM, 'MANAGE_PROGRAM', { scopeType: 'PROGRAM', programId: 13 }),
      g(PERMS_ADMIN, 'ADMINISTER_PERMISSIONS'),
      g(INACTIVE, 'MANAGE_ORGANIZATION'),
      g(DEMO_ADMIN, 'MANAGE_ORGANIZATION', { grantSource: 'DEMO' }),
    ],
  });
  return { store, org: createOrganizationService({ store }), programs: createProgramService({ store }) };
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

const dept = async (store, id) => store.getDepartment(id);
const prog = async (store, id) => store.getProgram(id);
const audit = (store, type) => store._referralAuditEvents.filter((e) => !type || e.entityType === type);
const ticks = async (n = 10) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setImmediate(r)); };

// Pauses the first transaction that writes an audit event matching `match`,
// at that point (after all its checks, before commit).
function pauseAtAudit(store, match) {
  let reached; let release;
  const reachedP = new Promise((r) => { reached = r; });
  const gate = new Promise((r) => { release = r; });
  let paused = false;
  const original = store.withTransaction;
  store.withTransaction = (fn) => original((tx) => fn({
    ...tx,
    async appendAuditEvent(event) {
      if (!paused && match(event)) { paused = true; reached(); await gate; }
      return tx.appendAuditEvent(event);
    },
  }));
  return { reached: reachedP, release };
}

// ---------------------------------------------------------------------------

describe('Departments', () => {
  test('list with Program counts', async () => {
    const { org } = seed();
    const { departments } = await org.listDepartments(ORG_ADMIN);
    assert.deepEqual(departments.map((d) => [d.departmentId, d.lifecycleStatus, d.activeProgramCount, d.programCount]),
      [[1, 'ACTIVE', 1, 2], [2, 'ACTIVE', 0, 1], [3, 'DISCONTINUED', 0, 1], [4, 'RETIRED', 0, 0]]);
    assert.match(departments[0].version, /^v\d+$/);
  });

  test('create: trimmed, ACTIVE, audited', async () => {
    const { store, org } = seed();
    const result = await org.createDepartment(ORG_ADMIN, { name: '  Synthetic Senior Services ' }, { correlationId: 'c-14c' });
    assert.equal(result.status, 'CREATED');
    const id = result.department.departmentId;
    assert.equal(id, 5);
    assert.deepEqual([(await dept(store, id)).name, (await dept(store, id)).lifecycleStatus], ['Synthetic Senior Services', 'ACTIVE']);
    const event = audit(store, 'DEPARTMENT').at(-1);
    assert.deepEqual([event.entityId, event.action, event.actorUserId, event.correlationId, event.before, event.after],
      [id, 'CREATED', ORG_ADMIN, 'c-14c', null, { name: 'Synthetic Senior Services', lifecycle_status: 'ACTIVE' }]);
  });

  test('names are unique, ignoring case', async () => {
    const { store, org } = seed();
    await rejectsWith(org.createDepartment(ORG_ADMIN, { name: 'synthetic youth SERVICES' }), 'DEPARTMENT_NAME_TAKEN');
    const v = (await dept(store, 2)).version;
    await rejectsWith(org.renameDepartment(ORG_ADMIN, 2, { version: v, name: 'Synthetic Youth Services' }), 'DEPARTMENT_NAME_TAKEN');
    assert.equal(audit(store).length, 0);
  });

  test('rename: audited; case-only change allowed; same name is NO_CHANGE', async () => {
    const { store, org } = seed();
    const v = (await dept(store, 1)).version;
    const r = await org.renameDepartment(ORG_ADMIN, 1, { version: v, name: 'Synthetic Youth & Family' });
    assert.equal(r.status, 'RENAMED');
    assert.equal((await dept(store, 1)).name, 'Synthetic Youth & Family');
    assert.equal((await prog(store, 11)).departmentId, 1, 'Programs keep their Department ID');
    const event = audit(store, 'DEPARTMENT').at(-1);
    assert.deepEqual([event.action, event.before, event.after],
      ['RENAMED', { name: 'Synthetic Youth Services' }, { name: 'Synthetic Youth & Family' }]);
    await rejectsWith(org.renameDepartment(ORG_ADMIN, 1, { version: r.department.version, name: 'Synthetic Youth & Family' }), 'NO_CHANGE');
    const lower = await org.renameDepartment(ORG_ADMIN, 1, { version: r.department.version, name: 'synthetic youth & family' });
    assert.equal(lower.department.name, 'synthetic youth & family');
  });

  test('discontinue is refused while the Department has an ACTIVE Program (PRD 4.4)', async () => {
    const { store, org } = seed();
    const v = (await dept(store, 1)).version;
    await rejectsWith(org.discontinueDepartment(ORG_ADMIN, 1, { version: v }), 'DEPARTMENT_HAS_ACTIVE_PROGRAMS');
    assert.equal((await dept(store, 1)).lifecycleStatus, 'ACTIVE');
    assert.equal(audit(store).length, 0);
  });

  test('after the Program Director discontinues the active Program, the Department can be discontinued', async () => {
    const { store, org, programs } = seed();
    await programs.discontinue(PM, 11, { version: (await prog(store, 11)).version });
    const r = await org.discontinueDepartment(ORG_ADMIN, 1, { version: (await dept(store, 1)).version });
    assert.equal(r.status, 'DISCONTINUED');
    const event = audit(store, 'DEPARTMENT').at(-1);
    assert.deepEqual([event.action, event.before, event.after],
      ['DISCONTINUED', { lifecycle_status: 'ACTIVE' }, { lifecycle_status: 'DISCONTINUED' }]);
    // Discontinued Departments drop out of new operational choices.
    assert.ok((await store.listActivePrograms()).every((row) => row.department.departmentId !== 1));
    // ...and their Programs can't be reactivated until the Department is.
    await rejectsWith(programs.reactivate(PM, 11, { version: (await prog(store, 11)).version }), 'DEPARTMENT_NOT_ACTIVE');
    const back = await org.reactivateDepartment(ORG_ADMIN, 1, { version: r.department.version });
    assert.equal(back.status, 'REACTIVATED');
    assert.equal(audit(store, 'DEPARTMENT').at(-1).action, 'REACTIVATED');
    assert.equal((await programs.reactivate(PM, 11, { version: (await prog(store, 11)).version })).status, 'REACTIVATED');
  });

  test('lifecycle rules: already in status, retired, not found, stale', async () => {
    const { store, org } = seed();
    await rejectsWith(org.reactivateDepartment(ORG_ADMIN, 1, { version: (await dept(store, 1)).version }), 'ALREADY_IN_STATUS');
    await rejectsWith(org.discontinueDepartment(ORG_ADMIN, 3, { version: (await dept(store, 3)).version }), 'ALREADY_IN_STATUS');
    await rejectsWith(org.reactivateDepartment(ORG_ADMIN, 4, { version: (await dept(store, 4)).version }), 'DEPARTMENT_RETIRED');
    await rejectsWith(org.renameDepartment(ORG_ADMIN, 4, { version: (await dept(store, 4)).version, name: 'Synthetic X' }), 'DEPARTMENT_RETIRED');
    await rejectsWith(org.discontinueDepartment(ORG_ADMIN, 99, { version: 'v1' }), 'DEPARTMENT_NOT_FOUND');
    const seen = (await dept(store, 2)).version;
    await org.renameDepartment(ORG_ADMIN, 2, { version: seen, name: 'Synthetic Adult Ed' });
    const err = await rejectsWith(org.discontinueDepartment(SECOND_ORG, 2, { version: seen }), 'DEPARTMENT_CHANGED');
    assert.equal(err.current.name, 'Synthetic Adult Ed');
    assert.equal(err.current.version, (await dept(store, 2)).version);
    assert.equal((await dept(store, 2)).lifecycleStatus, 'ACTIVE');
  });
});

describe('creating Programs', () => {
  test('create: ACTIVE in an ACTIVE Department, audited, shows up for new referrals', async () => {
    const { store, org } = seed();
    const result = await org.createProgram(ORG_ADMIN, {
      departmentId: 2, name: ' Synthetic Job Readiness ', site: 'Synthetic Site B', description: 'Synthetic description',
    }, { correlationId: 'c-new' });
    assert.equal(result.status, 'CREATED');
    const p = result.program;
    assert.deepEqual([p.programId, p.name, p.departmentId, p.departmentName, p.lifecycleStatus, p.site, p.costNotes],
      [15, 'Synthetic Job Readiness', 2, 'Synthetic Adult Services', 'ACTIVE', 'Synthetic Site B', null]);
    assert.equal(p.notificationEmail, undefined, 'routing is never returned');
    assert.ok((await store.listActivePrograms()).some((row) => row.program.programId === 15));
    const event = audit(store, 'PROGRAM').at(-1);
    assert.deepEqual([event.entityId, event.action, event.correlationId], [15, 'CREATED', 'c-new']);
    assert.deepEqual(event.after, {
      department_id: 2, name: 'Synthetic Job Readiness', lifecycle_status: 'ACTIVE', site: 'Synthetic Site B',
      description: 'Synthetic description', eligibility_notes: null, schedule_notes: null, cost_notes: null,
    });
  });

  test('the new Program has no manager yet: MANAGE_ORGANIZATION does not grant MANAGE_PROGRAM', async () => {
    const { org, programs } = seed();
    await org.createProgram(ORG_ADMIN, { departmentId: 1, name: 'Synthetic New' });
    await rejectsWith(programs.getProgram(ORG_ADMIN, 15), 'NOT_AUTHORIZED');
  });

  test('Department must exist and be ACTIVE', async () => {
    const { org } = seed();
    await rejectsWith(org.createProgram(ORG_ADMIN, { departmentId: 3, name: 'Synthetic X' }), 'DEPARTMENT_NOT_ACTIVE');
    await rejectsWith(org.createProgram(ORG_ADMIN, { departmentId: 4, name: 'Synthetic X' }), 'DEPARTMENT_NOT_ACTIVE');
    await rejectsWith(org.createProgram(ORG_ADMIN, { departmentId: 99, name: 'Synthetic X' }), 'DEPARTMENT_NOT_FOUND');
  });

  test('name + site is unique (ignoring case; a missing site counts as one site)', async () => {
    const { store, org } = seed();
    await rejectsWith(org.createProgram(ORG_ADMIN, { departmentId: 2, name: 'synthetic after school', site: 'SYNTHETIC SITE A' }), 'PROGRAM_NAME_TAKEN');
    await rejectsWith(org.createProgram(ORG_ADMIN, { departmentId: 2, name: 'Synthetic Summer Camp' }), 'PROGRAM_NAME_TAKEN');
    await rejectsWith(org.createProgram(ORG_ADMIN, { departmentId: 2, name: 'Synthetic Summer Camp', site: '  ' }), 'PROGRAM_NAME_TAKEN');
    const otherSite = await org.createProgram(ORG_ADMIN, { departmentId: 2, name: 'Synthetic After School', site: 'Synthetic Site C' });
    assert.equal(otherSite.status, 'CREATED');
    const noSite = await org.createProgram(ORG_ADMIN, { departmentId: 2, name: 'Synthetic After School' });
    assert.equal(noSite.status, 'CREATED');
    assert.equal(audit(store, 'PROGRAM').length, 2);
  });
});

describe('moving a Program to another Department', () => {
  test('move, audited; the old Department can then be discontinued', async () => {
    const { store, org } = seed();
    const r = await org.moveProgram(ORG_ADMIN, 11, { version: (await prog(store, 11)).version, departmentId: 2 });
    assert.deepEqual([r.status, r.program.departmentId, r.program.departmentName], ['MOVED', 2, 'Synthetic Adult Services']);
    const event = audit(store, 'PROGRAM').at(-1);
    assert.deepEqual([event.entityId, event.action, event.before, event.after],
      [11, 'UPDATED', { department_id: 1 }, { department_id: 2 }]);
    const d = await org.discontinueDepartment(ORG_ADMIN, 1, { version: (await dept(store, 1)).version });
    assert.equal(d.status, 'DISCONTINUED');
    assert.equal((await prog(store, 11)).lifecycleStatus, 'ACTIVE', 'the moved Program keeps running');
  });

  test('move rules', async () => {
    const { store, org } = seed();
    const v = (await prog(store, 11)).version;
    await rejectsWith(org.moveProgram(ORG_ADMIN, 11, { version: v, departmentId: 1 }), 'NO_CHANGE');
    await rejectsWith(org.moveProgram(ORG_ADMIN, 11, { version: v, departmentId: 3 }), 'DEPARTMENT_NOT_ACTIVE');
    await rejectsWith(org.moveProgram(ORG_ADMIN, 11, { version: v, departmentId: 99 }), 'DEPARTMENT_NOT_FOUND');
    await rejectsWith(org.moveProgram(ORG_ADMIN, 14, { version: (await prog(store, 14)).version, departmentId: 2 }), 'PROGRAM_RETIRED');
    await rejectsWith(org.moveProgram(ORG_ADMIN, 99, { version: 'v1', departmentId: 2 }), 'PROGRAM_NOT_FOUND');
    const err = await rejectsWith(org.moveProgram(ORG_ADMIN, 11, { version: 'v999', departmentId: 2 }), 'PROGRAM_CHANGED');
    assert.equal(err.current.version, v);
    assert.equal((await prog(store, 11)).departmentId, 1);
    assert.equal(audit(store).length, 0);
  });

  test('the 14A Program edit still cannot change the Department', async () => {
    const { store, programs } = seed();
    await rejectsWith(programs.updateDetails(PM, 11, { version: (await prog(store, 11)).version, departmentId: 2 }), 'UNEXPECTED_FIELD');
  });
});

describe('who may make organization changes (PRD 3.6)', () => {
  test('only an ORG-scope MANAGE_ORGANIZATION grant counts', async () => {
    const { store, org } = seed();
    for (const userId of [NARROW, PM, PERMS_ADMIN, NOBODY, DEMO_ADMIN]) {
      await rejectsWith(org.listDepartments(userId), 'NOT_AUTHORIZED');
      await rejectsWith(org.createDepartment(userId, { name: `Synthetic ${userId}` }), 'NOT_AUTHORIZED');
      await rejectsWith(org.createProgram(userId, { departmentId: 1, name: `Synthetic ${userId}` }), 'NOT_AUTHORIZED');
      await rejectsWith(org.discontinueDepartment(userId, 2, { version: (await dept(store, 2)).version }), 'NOT_AUTHORIZED');
      await rejectsWith(org.moveProgram(userId, 11, { version: (await prog(store, 11)).version, departmentId: 2 }), 'NOT_AUTHORIZED');
    }
    await rejectsWith(org.createDepartment(INACTIVE, { name: 'Synthetic X' }), 'USER_NOT_ACTIVE');
    assert.equal(audit(store).length, 0);
  });

  test('a DEMO grant counts only when explicitly allowed (development/test)', async () => {
    const { store } = seed();
    const demoOrg = createOrganizationService({ store, allowDemoGrants: true });
    assert.equal((await demoOrg.createDepartment(DEMO_ADMIN, { name: 'Synthetic Demo Dept' })).status, 'CREATED');
  });

  test('a revocation that starts during a change waits for it; the next change is refused', async () => {
    const { store, org } = seed();
    const pause = pauseAtAudit(store, (e) => e.entityType === 'DEPARTMENT');
    const creating = org.createDepartment(ORG_ADMIN, { name: 'Synthetic During' });
    await pause.reached;
    let revoked = false;
    const revoking = store._revokeGrants(ORG_ADMIN, 'MANAGE_ORGANIZATION').then(() => { revoked = true; });
    await ticks();
    assert.equal(revoked, false);
    pause.release();
    assert.equal((await creating).status, 'CREATED');
    await revoking;
    await rejectsWith(org.createDepartment(ORG_ADMIN, { name: 'Synthetic After' }), 'NOT_AUTHORIZED');
  });
});

describe('two changes at once (PRD 9.3, 9.4)', () => {
  test('Department discontinue vs. Program reactivation: the reactivation waits, then is refused', async () => {
    const { store, org, programs } = seed();
    const pause = pauseAtAudit(store, (e) => e.entityType === 'DEPARTMENT' && e.action === 'DISCONTINUED');
    const discontinuing = org.discontinueDepartment(ORG_ADMIN, 2, { version: (await dept(store, 2)).version });
    await pause.reached; // Department 2 checked: no ACTIVE Programs
    let done = false;
    const reactivating = programs.reactivate(PM, 13, { version: (await prog(store, 13)).version })
      .finally(() => { done = true; });
    await ticks();
    assert.equal(done, false, 'reactivation waits for the Department');
    pause.release();
    assert.equal((await discontinuing).status, 'DISCONTINUED');
    await rejectsWith(reactivating, 'DEPARTMENT_NOT_ACTIVE');
    assert.equal((await prog(store, 13)).lifecycleStatus, 'DISCONTINUED');
  });

  test('Program reactivation first: the Department discontinue waits, then is refused', async () => {
    const { store, org, programs } = seed();
    const pause = pauseAtAudit(store, (e) => e.entityType === 'PROGRAM' && e.action === 'REACTIVATED');
    const reactivating = programs.reactivate(PM, 13, { version: (await prog(store, 13)).version });
    await pause.reached;
    let done = false;
    const discontinuing = org.discontinueDepartment(ORG_ADMIN, 2, { version: (await dept(store, 2)).version })
      .finally(() => { done = true; });
    await ticks();
    assert.equal(done, false);
    pause.release();
    assert.equal((await reactivating).status, 'REACTIVATED');
    await rejectsWith(discontinuing, 'DEPARTMENT_HAS_ACTIVE_PROGRAMS');
    assert.equal((await dept(store, 2)).lifecycleStatus, 'ACTIVE');
  });

  test('Department discontinue vs. moving a Program into it: the move waits, then is refused', async () => {
    const { store, org } = seed();
    const pause = pauseAtAudit(store, (e) => e.entityType === 'DEPARTMENT');
    const discontinuing = org.discontinueDepartment(ORG_ADMIN, 2, { version: (await dept(store, 2)).version });
    await pause.reached;
    let done = false;
    const moving = org.moveProgram(SECOND_ORG, 11, { version: (await prog(store, 11)).version, departmentId: 2 })
      .finally(() => { done = true; });
    await ticks();
    assert.equal(done, false);
    pause.release();
    await discontinuing;
    await rejectsWith(moving, 'DEPARTMENT_NOT_ACTIVE');
    assert.equal((await prog(store, 11)).departmentId, 1);
  });

  test('Department discontinue vs. creating a Program in it: the create waits, then is refused', async () => {
    const { store, org } = seed();
    const pause = pauseAtAudit(store, (e) => e.entityType === 'DEPARTMENT');
    const discontinuing = org.discontinueDepartment(ORG_ADMIN, 2, { version: (await dept(store, 2)).version });
    await pause.reached;
    let done = false;
    const creating = org.createProgram(SECOND_ORG, { departmentId: 2, name: 'Synthetic Sneaky' }).finally(() => { done = true; });
    await ticks();
    assert.equal(done, false);
    pause.release();
    await discontinuing;
    await rejectsWith(creating, 'DEPARTMENT_NOT_ACTIVE');
    assert.equal(store._allPrograms().length, 4);
  });

  test('two creates with the same Department name: exactly one wins', async () => {
    const { store, org } = seed();
    const results = await Promise.allSettled([
      org.createDepartment(ORG_ADMIN, { name: 'Synthetic Twin' }),
      org.createDepartment(SECOND_ORG, { name: 'synthetic twin' }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'DEPARTMENT_NAME_TAKEN');
    assert.equal(store._allDepartments().length, 5);
  });

  test('two creates with the same Program name and site: exactly one wins', async () => {
    const { store, org } = seed();
    const results = await Promise.allSettled([
      org.createProgram(ORG_ADMIN, { departmentId: 1, name: 'Synthetic Twin', site: 'Synthetic S' }),
      org.createProgram(SECOND_ORG, { departmentId: 2, name: 'Synthetic Twin', site: 'synthetic s' }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'PROGRAM_NAME_TAKEN');
    assert.equal(store._allPrograms().length, 5);
  });

  test('a rename racing a create for the same name: exactly one wins', async () => {
    const { store, org } = seed();
    const results = await Promise.allSettled([
      org.renameDepartment(ORG_ADMIN, 2, { version: (await dept(store, 2)).version, name: 'Synthetic Shared Name' }),
      org.createDepartment(SECOND_ORG, { name: 'Synthetic Shared Name' }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(store._allDepartments().filter((d) => d.name === 'Synthetic Shared Name').length, 1);
  });

  test('two discontinues with the same version: exactly one wins', async () => {
    const { store, org } = seed();
    const version = (await dept(store, 2)).version;
    const results = await Promise.allSettled([
      org.discontinueDepartment(ORG_ADMIN, 2, { version }),
      org.discontinueDepartment(SECOND_ORG, 2, { version }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'DEPARTMENT_CHANGED');
    assert.equal(audit(store, 'DEPARTMENT').length, 1);
  });
});

describe('audit failure rolls everything back (PRD 9.6)', () => {
  test('create Program, create/rename/discontinue Department, move', async () => {
    const { store, org } = seed();
    const snapshot = () => JSON.stringify([store._allDepartments(), store._allPrograms()]);
    const before = snapshot();
    const tries = [
      () => org.createProgram(ORG_ADMIN, { departmentId: 1, name: 'Synthetic Rollback' }),
      () => org.createDepartment(ORG_ADMIN, { name: 'Synthetic Rollback' }),
      async () => org.renameDepartment(ORG_ADMIN, 2, { version: (await dept(store, 2)).version, name: 'Synthetic Rollback' }),
      async () => org.discontinueDepartment(ORG_ADMIN, 2, { version: (await dept(store, 2)).version }),
      async () => org.moveProgram(ORG_ADMIN, 11, { version: (await prog(store, 11)).version, departmentId: 2 }),
    ];
    for (const attempt of tries) {
      store._failNextAudit();
      await assert.rejects(attempt());
    }
    assert.equal(snapshot(), before);
    assert.equal(audit(store).length, 0);
    // The rolled-back names are free to use.
    assert.equal((await org.createDepartment(ORG_ADMIN, { name: 'Synthetic Rollback' })).status, 'CREATED');
  });
});

describe('validation (PRD 10.3, 10.4)', () => {
  test('create Program and Department bodies', () => {
    assert.deepEqual(validateCreateProgram({ name: 'x' }).fields, ['departmentId']);
    assert.deepEqual(validateCreateProgram({ departmentId: 1, name: '  ' }).fields, ['name']);
    assert.deepEqual(validateCreateProgram({ departmentId: 1, name: 'x'.repeat(201) }).fields, ['name']);
    assert.deepEqual(validateCreateProgram({ departmentId: 1, name: 'a\nb' }).fields, ['name']);
    assert.deepEqual(validateCreateProgram({ departmentId: '1', name: 'x' }).fields, ['departmentId']);
    assert.deepEqual(validateCreateProgram({ departmentId: 1, name: 'x', site: 'a\tb' }).fields, ['site']);
    for (const key of ['notificationEmail', 'lifecycleStatus', 'programId', MARKER]) {
      assert.equal(validateCreateProgram({ departmentId: 1, name: 'x', [key]: 'y' }).unexpectedField, true, key);
    }
    assert.deepEqual(validateCreateDepartment({ name: '' }).fields, ['name']);
    assert.equal(validateCreateDepartment({ name: 'x', lifecycleStatus: 'RETIRED' }).unexpectedField, true);
  });

  test('errors never echo the request', async () => {
    const { org } = seed();
    const err = await rejectsWith(org.createDepartment(ORG_ADMIN, { name: 'x', [MARKER]: 1 }), 'UNEXPECTED_FIELD');
    assert.doesNotMatch(JSON.stringify({ m: err.message, f: err.fields }), new RegExp(MARKER));
  });
});

describe('HTTP routes', () => {
  const appFor = (store, userId = ORG_ADMIN) => createApp({
    affiliationStore: store, referralStore: store, resolveIdentity: () => (userId === null ? null : { userId }), nodeEnv: 'test',
  });
  const base = '/api/program-management';

  test('full flow over HTTP, never cached', async () => {
    const { store } = seed();
    const app = appFor(store);
    const list = await request(app).get(`${base}/departments`);
    assert.equal(list.status, 200);
    assert.equal(list.headers['cache-control'], 'no-store');
    const created = await request(app).post(`${base}/departments`).send({ name: 'Synthetic HTTP Dept' });
    assert.equal(created.status, 201);
    const id = created.body.department.departmentId;
    const renamed = await request(app).patch(`${base}/departments/${id}`).send({ version: created.body.department.version, name: 'Synthetic HTTP Dept 2' });
    assert.equal(renamed.body.status, 'RENAMED');
    const program = await request(app).post(`${base}/programs`).send({ departmentId: id, name: 'Synthetic HTTP Program' });
    assert.equal(program.status, 201);
    const blocked = await request(app).post(`${base}/departments/${id}/discontinue`).send({ version: renamed.body.department.version });
    assert.deepEqual([blocked.status, blocked.body.code], [409, 'DEPARTMENT_HAS_ACTIVE_PROGRAMS']);
    const moved = await request(app).post(`${base}/programs/${program.body.program.programId}/move`)
      .send({ version: program.body.program.version, departmentId: 2 });
    assert.equal(moved.body.status, 'MOVED');
    const off = await request(app).post(`${base}/departments/${id}/discontinue`).send({ version: renamed.body.department.version });
    assert.equal(off.body.status, 'DISCONTINUED');
    const on = await request(app).post(`${base}/departments/${id}/reactivate`).send({ version: off.body.department.version });
    assert.equal(on.body.status, 'REACTIVATED');
  });

  test('errors: 401, 403, 404, 409 with current, query refused without echo', async () => {
    const { store } = seed();
    assert.equal((await request(appFor(store, null)).get(`${base}/departments`)).status, 401);
    assert.equal((await request(appFor(store, PM)).get(`${base}/departments`)).status, 403);
    assert.equal((await request(appFor(store, PM)).post(`${base}/programs`).send({ departmentId: 1, name: 'x' })).status, 403);
    assert.equal((await request(appFor(store)).patch(`${base}/departments/abc`).send({ version: 'v1', name: 'x' })).status, 404);
    assert.equal((await request(appFor(store)).patch(`${base}/departments/99`).send({ version: 'v1', name: 'x' })).status, 404);
    const stale = await request(appFor(store)).post(`${base}/departments/2/discontinue`).send({ version: 'v999' });
    assert.deepEqual([stale.status, stale.body.code], [409, 'DEPARTMENT_CHANGED']);
    assert.ok(stale.body.current);
    const taken = await request(appFor(store)).post(`${base}/departments`).send({ name: 'Synthetic Adult Services' });
    assert.deepEqual([taken.status, taken.body.code], [409, 'DEPARTMENT_NAME_TAKEN']);
    const q = await request(appFor(store)).get(`${base}/departments?${MARKER}=1`);
    assert.equal(q.status, 400);
    assert.doesNotMatch(JSON.stringify(q.body), new RegExp(MARKER));
    const extra = await request(appFor(store)).post(`${base}/programs`).send({ departmentId: 1, name: 'x', [MARKER]: 1 });
    assert.deepEqual([extra.status, extra.body.code], [400, 'UNEXPECTED_FIELD']);
    assert.doesNotMatch(JSON.stringify(extra.body), new RegExp(MARKER));
  });
});

describe('store contract: organization changes', () => {
  test('inserts and updates require the right holds', async () => {
    const { store } = seed();
    await assert.rejects(store.withTransaction((tx) => tx.insertDepartment({ name: 'Synthetic X' })), /lockDepartmentName/);
    await assert.rejects(store.withTransaction(async (tx) => {
      await tx.lockProgramName('Synthetic X', null);
      await tx.insertProgram({ departmentId: 1, name: 'Synthetic X', site: null });
    }), /lockDepartmentForUpdate/);
    await assert.rejects(store.withTransaction(async (tx) => {
      await tx.lockDepartmentForUpdate(1);
      await tx.insertProgram({ departmentId: 1, name: 'Synthetic X', site: null });
    }), /lockProgramName/);
    await assert.rejects(store.withTransaction((tx) => tx.updateDepartment({ departmentId: 1, expectedVersion: 'v1', set: {} })), /lockDepartmentForUpdate/);
    await assert.rejects(store.withTransaction(async (tx) => {
      await tx.lockDepartmentForUpdate(1);
      await tx.updateDepartment({ departmentId: 1, expectedVersion: 'v1', set: { name: 'Synthetic New' } });
    }), /lockDepartmentName/);
  });

  test('a stale Department update writes nothing', async () => {
    const { store } = seed();
    const before = JSON.stringify(store._allDepartments());
    const result = await store.withTransaction(async (tx) => {
      await tx.lockDepartmentForUpdate(2);
      return tx.updateDepartment({ departmentId: 2, expectedVersion: 'v999', set: { lifecycleStatus: 'DISCONTINUED' } });
    });
    assert.equal(result, null);
    assert.equal(JSON.stringify(store._allDepartments()), before);
  });

  test('a transaction sees its own Department and Program changes before commit', async () => {
    const { store } = seed();
    await store.withTransaction(async (tx) => {
      await tx.lockDepartmentForUpdate(2);
      await tx.lockDepartmentName('Synthetic Renamed');
      await tx.updateDepartment({ departmentId: 2, expectedVersion: (await tx.getDepartment(2)).version, set: { name: 'Synthetic Renamed' } });
      assert.equal((await tx.listDepartments()).find((d) => d.departmentId === 2).name, 'Synthetic Renamed');
      assert.equal(await tx.lockDepartmentName('synthetic renamed'), 2);
      const p = await tx.lockProgramForUpdate(11);
      await tx.updateProgram({ programId: 11, expectedVersion: p.version, set: { departmentId: 2 } });
      assert.deepEqual((await tx.listDepartmentPrograms(2)).map((x) => x.programId), [11, 13]);
      assert.deepEqual((await tx.listDepartmentPrograms(1)).map((x) => x.programId), [12]);
    });
    assert.equal((await dept(store, 2)).name, 'Synthetic Renamed');
    assert.equal((await prog(store, 11)).departmentId, 2);
  });

  test('a Department change waits at commit for a transaction that read the Department', async () => {
    const { store } = seed();
    let release;
    const gate = new Promise((r) => { release = r; });
    let readerSaw;
    const reading = store.withTransaction(async (tx) => {
      readerSaw = (await tx.getDepartment(2)).lifecycleStatus; // locking read, held to the end
      await gate;
      return readerSaw;
    });
    await ticks();
    let committed = false;
    const changing = store.withTransaction(async (tx) => {
      const d = await tx.lockDepartmentForUpdate(2);
      await tx.updateDepartment({ departmentId: 2, expectedVersion: d.version, set: { lifecycleStatus: 'DISCONTINUED' } });
    }).then(() => { committed = true; });
    await ticks();
    assert.equal(committed, false, 'commit waits for the reader');
    assert.equal((await dept(store, 2)).lifecycleStatus, 'ACTIVE');
    release();
    assert.equal(await reading, 'ACTIVE');
    await changing;
    assert.equal((await dept(store, 2)).lifecycleStatus, 'DISCONTINUED');
  });

  test('changes are visible inside the transaction and gone after a rollback', async () => {
    const { store } = seed();
    const before = JSON.stringify([store._allDepartments(), store._allPrograms()]);
    await assert.rejects(store.withTransaction(async (tx) => {
      await tx.lockDepartmentName('Synthetic Temp');
      const d = await tx.insertDepartment({ name: 'Synthetic Temp' });
      assert.ok((await tx.listDepartments()).some((x) => x.departmentId === d.departmentId));
      assert.equal(await tx.lockDepartmentName('synthetic temp'), d.departmentId);
      throw new Error('synthetic rollback');
    }), /synthetic rollback/);
    assert.equal(JSON.stringify([store._allDepartments(), store._allPrograms()]), before);
  });
});
