// Task JJ: Department and Program lifecycle regression.
//
// Frozen Handoff PRD 10, 11, 12, 17; Handoff MVP 12, 13, 16; acceptance
// gates 18, 19 and 21:
//
//   "Previously used Departments and Programs must retain stable historical
//    relationships. Records with history should be discontinued or retired
//    rather than destructively deleted." (MVP 13)
//   "Discontinued Programs must not behave as active referral destinations
//    while historical records remain intact." (PRD 12)
//   "Changing current Program information must not rewrite historical
//    referrals." (PRD 10, MVP 12)
//
// One synthetic organization sends referrals of every kind (Direct and Find
// a Program, waiting and finished, to and from the Programs that will
// change). Then the organization changes: the referring Program and a whole
// Department's Programs are discontinued, the Department is discontinued and
// renamed, a Program is retired. Afterwards:
//
//   - nothing was deleted, and there is no delete route to call
//   - every saved referral, its audit history and its GPME evaluation are
//     byte-for-byte what they were before the changes
//   - discontinued and retired Programs are not offered, matched or
//     accepted as new destinations
//   - senders and receiving staff still see every old referral, linked to
//     the same Program and Department IDs
//   - a referral still waiting stays Awaiting Response and is not rerouted
//     (Handoff PRD 17)
//   - reports still count history under the same Program and Department
//   - reactivation brings a Program back without touching history
//
// Existing behavior, NOT QCH policy: after its Program is discontinued,
// that Program's receiving staff can still answer a referral already
// waiting for it, because receiving access follows staff grants, not the
// Program's status. The frozen documents do not say whether that should
// happen; it is an open question for QCH. The test records what the code
// does so a change is visible, not that QCH approved it.
//
// Scope of the retirement evidence: QCH Connect has no retirement workflow
// on main. RETIRED is injected through the store's test hook
// (_setProgramStatus), so these tests verify how the app treats an
// ALREADY-retired Program (not offered, not matched, not accepted, cannot be
// reactivated, history kept). They do not verify an authorized retirement
// workflow: who may retire a Program, when, or with what audit.
//
// Journeys 7 and 11 (journeys.test.js, workflowJourneys.test.js) already
// cover one Program discontinued and reactivated, and a Program moved
// between Departments; this file covers the whole organization changing at
// once, as QCH's real structure will (Handoff PRD 11).
//
// The data store is the in-memory store; the production SharePoint Lists
// are a QCH IT dependency (Handoff PRD 27). All data is SYNTHETIC
// (Handoff PRD 35).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createMemoryReferralStore } from '../../src/referrals/memoryReferralStore.js';

const WORKER = 100;       // sends referrals; affiliated with Program 10
const YOUTH_STAFF = 200;  // Programs 20 and 21: view, respond, outcomes
const ADULT_STAFF = 201;  // Program 11: view, respond
const DIRECTOR = 400;     // MANAGE_PROGRAM for Programs 10, 11, 20, 21, 30
const ORG_ADMIN = 500;    // MANAGE_ORGANIZATION (ORG scope)

const D_FAMILY = 1;
const D_ADULT = 2;
const D_YOUTH = 3;        // will be discontinued and renamed

const P_FAMILY = 10;      // the worker's referring Program; will be discontinued
const P_ADULT_ED = 11;    // stays active
const P_YOUTH_JOBS = 20;  // will be discontinued with a referral still waiting
const P_YOUTH_ARTS = 21;  // will be discontinued; had a Find a Program referral
const P_PILOT = 30;       // will be retired

const EDUCATION = 1;
const EMPLOYMENT = 2;

const FIXED_NOW = new Date('2026-10-20T14:00:00.000Z');
const PM = '/api/program-management';

const NO_LIMITS = { ageLimitState: 'NO_RESTRICTION', ageMin: null, ageMax: null, serviceAreaState: 'NO_RESTRICTION', serviceAreaZips: [] };
const grant = (userId, permission, programId, extra = {}) => ({
  userId, permission, scopeType: 'PROGRAM', programId, departmentId: null, grantSource: 'IN_APP', ...extra,
});
const RECEIVING = ['VIEW_RECEIVED_REFERRAL', 'RESPOND_TO_REFERRAL', 'RECORD_OUTCOME'];

function organization() {
  const program = (programId, departmentId, name, needCategoryIds) => ({
    programId, departmentId, name, site: null, lifecycleStatus: 'ACTIVE', needCategoryIds, ...NO_LIMITS,
  });
  return createMemoryReferralStore({
    departments: [
      { departmentId: D_FAMILY, name: 'Synthetic Family Services', lifecycleStatus: 'ACTIVE' },
      { departmentId: D_ADULT, name: 'Synthetic Adult Services', lifecycleStatus: 'ACTIVE' },
      { departmentId: D_YOUTH, name: 'Synthetic Youth Services', lifecycleStatus: 'ACTIVE' },
    ],
    programs: [
      program(P_FAMILY, D_FAMILY, 'Synthetic Family Center', [EDUCATION]),
      program(P_ADULT_ED, D_ADULT, 'Synthetic Adult Education', [EDUCATION]),
      program(P_YOUTH_JOBS, D_YOUTH, 'Synthetic Youth Jobs', [EMPLOYMENT]),
      program(P_YOUTH_ARTS, D_YOUTH, 'Synthetic Youth Arts', [EDUCATION]),
      program(P_PILOT, D_ADULT, 'Synthetic Pilot Program', [EMPLOYMENT]),
    ],
    needCategories: [
      { needCategoryId: EDUCATION, name: 'Education', lifecycleStatus: 'ACTIVE' },
      { needCategoryId: EMPLOYMENT, name: 'Employment', lifecycleStatus: 'ACTIVE' },
    ],
    users: [
      { userId: WORKER, isActive: true },
      { userId: YOUTH_STAFF, isActive: true },
      { userId: ADULT_STAFF, isActive: true },
      { userId: DIRECTOR, isActive: true },
      { userId: ORG_ADMIN, isActive: true },
    ],
    grants: [
      ...RECEIVING.flatMap((p) => [grant(YOUTH_STAFF, p, P_YOUTH_JOBS), grant(YOUTH_STAFF, p, P_YOUTH_ARTS)]),
      grant(ADULT_STAFF, 'VIEW_RECEIVED_REFERRAL', P_ADULT_ED), grant(ADULT_STAFF, 'RESPOND_TO_REFERRAL', P_ADULT_ED),
      ...[P_FAMILY, P_ADULT_ED, P_YOUTH_JOBS, P_YOUTH_ARTS, P_PILOT].map((id) => grant(DIRECTOR, 'MANAGE_PROGRAM', id)),
      grant(ORG_ADMIN, 'MANAGE_ORGANIZATION', null, { scopeType: 'ORG' }),
    ],
    notAppropriateReasons: [
      { reasonId: 1, code: 'PROGRAM_CRITERIA_NOT_MET', label: 'Program criteria not met', displayOrder: 1 },
    ],
  }, { now: () => new Date(FIXED_NOW) });
}

function startApp() {
  const store = organization();
  let current = null;
  const app = createApp({
    affiliationStore: store, referralStore: store, nodeEnv: 'test', now: () => new Date(FIXED_NOW),
    resolveIdentity: () => (current ? { userId: current } : null),
  });
  const as = (userId) => {
    const call = (method) => (url, body) => {
      current = userId;
      const req = request(app)[method](url);
      return body === undefined ? req : req.send(body);
    };
    return { get: call('get'), post: call('post'), put: call('put'), patch: call('patch'), delete: call('delete') };
  };
  return { store, as };
}

const referralTo = (receivingProgramId, extra = {}) => ({
  submissionId: randomUUID(),
  receivingProgramId,
  participantName: 'Synthetic Person Lifecycle',
  contactMethod: 'NOT_AVAILABLE',
  referralContext: 'Synthetic context for the lifecycle test',
  ...extra,
});

async function chooseAffiliation(user, programId) {
  const current = await user.get('/api/me/affiliation');
  return user.put('/api/me/affiliation', { programId, version: current.body.version });
}

// A deep copy, so later changes to the store cannot change the snapshot.
const snapshot = (value) => JSON.parse(JSON.stringify(value));

// Sends the referrals the organization changes must not disturb.
async function sendHistory({ store, as }) {
  const worker = as(WORKER);
  assert.equal((await chooseAffiliation(worker, P_FAMILY)).status, 200);
  const send = async (programId, extra) => {
    const res = await worker.post('/api/referrals', referralTo(programId, extra));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.referral.referralId;
  };

  // Still waiting when its Program is discontinued.
  const waiting = await send(P_YOUTH_JOBS);
  // Finished before the change: accepted, resulted in service.
  const finished = await send(P_YOUTH_JOBS);
  const youth = as(YOUTH_STAFF);
  assert.equal((await youth.post(`/api/referrals/${finished}/response`, { decision: 'ACCEPTED' })).status, 200);
  assert.equal((await youth.post(`/api/referrals/${finished}/outcome`, { outcome: 'RESULTED_IN_SERVICE' })).status, 200);
  // Sent through Find a Program, so it carries a GPME evaluation.
  const matched = await worker.post('/api/gpme/match', { needCategoryIds: [EDUCATION] });
  assert.ok(matched.body.plausible.some((p) => p.programId === P_YOUTH_ARTS));
  const guided = await send(P_YOUTH_ARTS, { gpme: { needCategoryIds: [EDUCATION] } });
  // To a Program that stays active, and to the one that will be retired.
  const adult = await send(P_ADULT_ED);
  const pilot = await send(P_PILOT);

  return {
    ids: { waiting, finished, guided, adult, pilot },
    before: snapshot({
      referrals: store._referrals,
      referralAudit: store._referralAuditEvents.filter((e) => e.entityType === 'REFERRAL'),
      evaluations: store._gpmeEvaluations,
    }),
  };
}

// The organization changes, all through the app, by the people allowed to
// make them, except the retirement: QCH Connect has no retirement workflow,
// so RETIRED is injected through the store's test hook. Nothing here shows
// who may retire a Program; see the header.
async function changeOrganization({ store, as }) {
  const director = as(DIRECTOR);
  const admin = as(ORG_ADMIN);
  const discontinueProgram = async (programId) => {
    const { version } = (await director.get(`${PM}/programs/${programId}`)).body.program;
    const res = await director.post(`${PM}/programs/${programId}/discontinue`, { version });
    assert.equal(res.body.status, 'DISCONTINUED', `Program ${programId}`);
  };
  const departmentVersion = async (departmentId) =>
    (await admin.get(`${PM}/departments`)).body.departments.find((d) => d.departmentId === departmentId).version;

  // The Department cannot go while it still has active Programs.
  const early = await admin.post(`${PM}/departments/${D_YOUTH}/discontinue`, { version: await departmentVersion(D_YOUTH) });
  assert.deepEqual([early.status, early.body.code], [409, 'DEPARTMENT_HAS_ACTIVE_PROGRAMS']);

  await discontinueProgram(P_YOUTH_JOBS);
  await discontinueProgram(P_YOUTH_ARTS);
  await discontinueProgram(P_FAMILY);
  const off = await admin.post(`${PM}/departments/${D_YOUTH}/discontinue`, { version: await departmentVersion(D_YOUTH) });
  assert.equal(off.body.status, 'DISCONTINUED');
  const renamed = await admin.patch(`${PM}/departments/${D_YOUTH}`, {
    version: off.body.department.version, name: 'Synthetic Youth Services (closed)',
  });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
  await store._setProgramStatus(P_PILOT, 'RETIRED');
}

describe('Task JJ: Departments and Programs change; history stays (Handoff PRD 10 to 12, 17; MVP 12, 13; gates 18, 19, 21)', () => {
  test('nothing is deleted, and there is no delete to call', async () => {
    const ctx = startApp();
    await sendHistory(ctx);
    await changeOrganization(ctx);

    // Every Program and Department is still there, under the same ID.
    for (const programId of [P_FAMILY, P_ADULT_ED, P_YOUTH_JOBS, P_YOUTH_ARTS, P_PILOT]) {
      assert.ok(await ctx.store.getProgram(programId), `Program ${programId} still exists`);
    }
    for (const departmentId of [D_FAMILY, D_ADULT, D_YOUTH]) {
      assert.ok(await ctx.store.getDepartment(departmentId), `Department ${departmentId} still exists`);
    }
    const statuses = await Promise.all([P_FAMILY, P_YOUTH_JOBS, P_YOUTH_ARTS, P_PILOT].map(async (id) => (await ctx.store.getProgram(id)).lifecycleStatus));
    assert.deepEqual(statuses, ['DISCONTINUED', 'DISCONTINUED', 'DISCONTINUED', 'RETIRED']);
    assert.equal((await ctx.store.getDepartment(D_YOUTH)).lifecycleStatus, 'DISCONTINUED');

    // No route deletes a Program, a Department or a referral, even for the
    // people who manage them. Each answers the app's fixed 404.
    const tries = [
      [as(ctx, DIRECTOR), `${PM}/programs/${P_YOUTH_JOBS}`],
      [as(ctx, ORG_ADMIN), `${PM}/departments/${D_YOUTH}`],
      [as(ctx, ORG_ADMIN), `${PM}/programs/${P_YOUTH_JOBS}`],
      [as(ctx, YOUTH_STAFF), '/api/referrals/1'],
      [as(ctx, WORKER), '/api/referrals/1'],
    ];
    for (const [user, url] of tries) {
      const res = await user.delete(url);
      assert.equal(res.status, 404, `DELETE ${url}`);
    }
    assert.ok(await ctx.store.getProgram(P_YOUTH_JOBS));
    assert.equal(ctx.store._referrals.length, 5);
  });

  test('every saved referral, its audit history and its GPME evaluation are exactly what they were', async () => {
    const ctx = startApp();
    const { before } = await sendHistory(ctx);
    await changeOrganization(ctx);
    const after = snapshot({
      referrals: ctx.store._referrals,
      referralAudit: ctx.store._referralAuditEvents.filter((e) => e.entityType === 'REFERRAL'),
      evaluations: ctx.store._gpmeEvaluations,
    });
    assert.deepEqual(after, before, 'an organization change rewrote referral history');

    // The changes themselves are audited, by the person who made them.
    const audited = ctx.store._referralAuditEvents
      .filter((e) => e.entityType === 'PROGRAM' || e.entityType === 'DEPARTMENT')
      .map((e) => [e.entityType, e.entityId, e.action, e.actorUserId]);
    assert.deepEqual(audited, [
      ['PROGRAM', P_YOUTH_JOBS, 'DISCONTINUED', DIRECTOR],
      ['PROGRAM', P_YOUTH_ARTS, 'DISCONTINUED', DIRECTOR],
      ['PROGRAM', P_FAMILY, 'DISCONTINUED', DIRECTOR],
      ['DEPARTMENT', D_YOUTH, 'DISCONTINUED', ORG_ADMIN],
      ['DEPARTMENT', D_YOUTH, 'RENAMED', ORG_ADMIN],
    ]);
  });

  test('discontinued and retired Programs are not offered, matched or accepted as new destinations', async () => {
    const ctx = startApp();
    await sendHistory(ctx);
    const worker = as(ctx, WORKER);

    // Find a Program BEFORE the changes: each search must answer 200 with a
    // business result, and lists the Programs about to be discontinued or
    // retired. Missing result arrays fail here; they never count as empty.
    const search = async (needCategoryIds) => {
      const res = await worker.post('/api/gpme/match', { needCategoryIds });
      assert.equal(res.status, 200, `match ${needCategoryIds}: ${JSON.stringify(res.body)}`);
      assert.ok(Array.isArray(res.body.plausible) && Array.isArray(res.body.possible),
        `match ${needCategoryIds}: result arrays present`);
      return {
        status: res.body.status,
        listed: [...res.body.plausible, ...res.body.possible].map((p) => p.programId).sort((a, b) => a - b),
      };
    };
    assert.deepEqual(await search([EDUCATION]), { status: 'RESULTS', listed: [P_FAMILY, P_ADULT_ED, P_YOUTH_ARTS] });
    assert.deepEqual(await search([EMPLOYMENT]), { status: 'RESULTS', listed: [P_YOUTH_JOBS, P_PILOT] });

    await changeOrganization(ctx);

    // The worker's own Program was discontinued: they must choose again
    // before sending, and cannot choose a discontinued Program.
    const noAffiliation = await worker.post('/api/referrals', referralTo(P_ADULT_ED));
    assert.deepEqual([noAffiliation.status, noAffiliation.body.code], [409, 'AFFILIATION_PROGRAM_NOT_ACTIVE']);
    assert.equal(ctx.store._referrals.length, 5, 'nothing saved');
    assert.equal((await chooseAffiliation(worker, P_FAMILY)).status, 422);
    assert.equal((await chooseAffiliation(worker, P_ADULT_ED)).status, 200);

    // Direct Referral list: only the active Program.
    const offered = (await worker.get('/api/programs')).body.programs.map((p) => p.programId);
    assert.deepEqual(offered, [P_ADULT_ED]);

    // Find a Program AFTER the changes: the same searches still succeed
    // (200, a business result), the active Program is still found, and the
    // discontinued and retired Programs are gone. Employment's only
    // Programs are now discontinued or retired, so that search is a
    // legitimate "no plausible match", not a failure.
    assert.deepEqual(await search([EDUCATION]), { status: 'RESULTS', listed: [P_ADULT_ED] });
    assert.deepEqual(await search([EMPLOYMENT]), { status: 'NO_PLAUSIBLE_MATCH', listed: [] });
    assert.deepEqual(await search([EDUCATION, EMPLOYMENT]), { status: 'RESULTS', listed: [P_ADULT_ED] });

    // Sending to them anyway is refused, by either path, and nothing is saved.
    for (const programId of [P_FAMILY, P_YOUTH_JOBS, P_YOUTH_ARTS, P_PILOT]) {
      const direct = await worker.post('/api/referrals', referralTo(programId));
      assert.deepEqual([direct.status, direct.body.code], [422, 'RECEIVING_PROGRAM_NOT_SELECTABLE'], `Program ${programId}`);
      const guided = await worker.post('/api/referrals', referralTo(programId, { gpme: { needCategoryIds: [EDUCATION] } }));
      assert.deepEqual([guided.status, guided.body.code], [422, 'RECEIVING_PROGRAM_NOT_SELECTABLE'], `guided to Program ${programId}`);
    }
    assert.equal(ctx.store._referrals.length, 5);

    // The active Program still works, with the new referring Program.
    const fresh = await worker.post('/api/referrals', referralTo(P_ADULT_ED));
    assert.equal(fresh.status, 201);
    assert.equal(fresh.body.referral.referringProgramId, P_ADULT_ED);

    // An already-retired Program (set through the store hook) cannot be
    // brought back.
    const director = as(ctx, DIRECTOR);
    const retired = await director.get(`${PM}/programs/${P_PILOT}`);
    assert.equal(retired.status, 200, 'a retired Program can still be looked at');
    const back = await director.post(`${PM}/programs/${P_PILOT}/reactivate`, { version: retired.body.program.version });
    assert.deepEqual([back.status, back.body.code], [409, 'PROGRAM_RETIRED']);
    assert.equal((await ctx.store.getProgram(P_PILOT)).lifecycleStatus, 'RETIRED');
  });

  test('senders and receiving staff still see every old referral, linked to the same Programs and Departments', async () => {
    const ctx = startApp();
    const { ids } = await sendHistory(ctx);
    await changeOrganization(ctx);

    // The sender's list and details: all five, same Programs.
    const worker = as(ctx, WORKER);
    const sent = await worker.get('/api/referrals/sent');
    assert.equal(sent.status, 200);
    const sentById = new Map(sent.body.referrals.map((r) => [r.referralId, r]));
    const expected = {
      [ids.waiting]: P_YOUTH_JOBS, [ids.finished]: P_YOUTH_JOBS, [ids.guided]: P_YOUTH_ARTS,
      [ids.adult]: P_ADULT_ED, [ids.pilot]: P_PILOT,
    };
    assert.deepEqual([...sentById.keys()].sort((a, b) => a - b), Object.keys(expected).map(Number).sort((a, b) => a - b));
    for (const [id, programId] of Object.entries(expected)) {
      const row = sentById.get(Number(id));
      assert.equal(row.receivingProgram.programId, programId);
      assert.equal(row.referringProgram.programId, P_FAMILY, 'the discontinued referring Program is still named');
      assert.ok(row.receivingProgram.name && row.referringProgram.name, 'names still resolve');
      const detail = await worker.get(`/api/referrals/${id}`);
      assert.equal(detail.status, 200, `sender opens ${id}`);
      assert.equal(detail.body.referral.receivingProgram.programId, programId);
    }

    // The saved rows keep the Department they were made under.
    const departmentOf = (id) => ctx.store._referrals.find((r) => r.referralId === id).receivingDepartmentId;
    assert.deepEqual([departmentOf(ids.waiting), departmentOf(ids.guided), departmentOf(ids.adult)], [D_YOUTH, D_YOUTH, D_ADULT]);

    // The receiving staff of the discontinued Programs still have their queue.
    const youth = as(ctx, YOUTH_STAFF);
    for (const [programId, want] of [[P_YOUTH_JOBS, [ids.waiting, ids.finished]], [P_YOUTH_ARTS, [ids.guided]]]) {
      const queue = await youth.get(`/api/referrals/received?programId=${programId}`);
      assert.equal(queue.status, 200);
      assert.deepEqual(queue.body.referrals.map((r) => r.referralId).sort((a, b) => a - b), want.sort((a, b) => a - b));
    }
    const finished = await youth.get(`/api/referrals/${ids.finished}`);
    assert.deepEqual(
      [finished.body.referral.responseStatus, finished.body.referral.decision, finished.body.referral.serviceOutcome],
      ['RESPONDED', 'ACCEPTED', 'RESULTED_IN_SERVICE'],
      'a finished referral keeps its response and outcome',
    );
  });

  test('a referral still waiting is not rerouted or closed (Handoff PRD 17); existing behavior lets its Program still answer it', async () => {
    const ctx = startApp();
    const { ids } = await sendHistory(ctx);
    await changeOrganization(ctx);

    const waiting = ctx.store._referrals.find((r) => r.referralId === ids.waiting);
    assert.deepEqual(
      [waiting.receivingProgramId, waiting.responseStatus, waiting.decision],
      [P_YOUTH_JOBS, 'AWAITING_RESPONSE', null],
      'discontinuing the Program did not reroute, answer or close the referral',
    );

    // Existing behavior, NOT QCH policy (see the header): receiving access
    // follows the staff member's grants, not the Program's status, so the
    // referral can still be answered and finished. The frozen documents do
    // not say whether this should be allowed; it is an open question for QCH.
    const youth = as(ctx, YOUTH_STAFF);
    const answered = await youth.post(`/api/referrals/${ids.waiting}/response`, { decision: 'ACCEPTED' });
    assert.equal(answered.status, 200, JSON.stringify(answered.body));
    const outcome = await youth.post(`/api/referrals/${ids.waiting}/outcome`, { outcome: 'DID_NOT_RESULT_IN_SERVICE' });
    assert.equal(outcome.status, 200, JSON.stringify(outcome.body));
    const after = ctx.store._referrals.find((r) => r.referralId === ids.waiting);
    assert.deepEqual([after.receivingProgramId, after.receivingDepartmentId], [P_YOUTH_JOBS, D_YOUTH]);

    // Staff of another Program still cannot see or touch it.
    const adult = as(ctx, ADULT_STAFF);
    assert.equal((await adult.get(`/api/referrals/${ids.waiting}`)).status, 404);
  });

  test('reports still count history under the same Program and Department', async () => {
    const ctx = startApp();
    await sendHistory(ctx);
    const report = async () => (await as(ctx, WORKER).get('/api/reports/referral-activity?period=MONTHLY')).body;
    const before = await report();
    await changeOrganization(ctx);
    const after = await report();

    const counts = (r) => ({
      summary: r.summary,
      programs: r.programs.map(({ name, ...rest }) => rest),
      departments: r.departments.map(({ name, ...rest }) => rest),
    });
    assert.deepEqual(counts(after), counts(before), 'an organization change moved or dropped historical counts');

    // The discontinued and retired Programs and the discontinued Department
    // are still in the report, with their referrals.
    const program = (id) => after.programs.find((p) => p.programId === id);
    assert.deepEqual([program(P_YOUTH_JOBS).received, program(P_YOUTH_ARTS).received, program(P_PILOT).received], [2, 1, 1]);
    assert.equal(program(P_FAMILY).made, 5, 'the discontinued referring Program still made five');
    const youthDept = after.departments.find((d) => d.departmentId === D_YOUTH);
    assert.equal(youthDept.received, 3);
    // The Department keeps its ID; the report shows its current name.
    assert.equal(youthDept.name, 'Synthetic Youth Services (closed)');
  });

  test('reactivation brings the Department and Program back without touching history', async () => {
    const ctx = startApp();
    const { ids, before } = await sendHistory(ctx);
    await changeOrganization(ctx);
    const director = as(ctx, DIRECTOR);
    const admin = as(ctx, ORG_ADMIN);
    const worker = as(ctx, WORKER);

    // A Program cannot come back while its Department is discontinued.
    const program = (await director.get(`${PM}/programs/${P_YOUTH_JOBS}`)).body.program;
    const tooSoon = await director.post(`${PM}/programs/${P_YOUTH_JOBS}/reactivate`, { version: program.version });
    assert.deepEqual([tooSoon.status, tooSoon.body.code], [409, 'DEPARTMENT_NOT_ACTIVE']);

    const dept = (await admin.get(`${PM}/departments`)).body.departments.find((d) => d.departmentId === D_YOUTH);
    assert.equal((await admin.post(`${PM}/departments/${D_YOUTH}/reactivate`, { version: dept.version })).body.status, 'REACTIVATED');
    const fresh = (await director.get(`${PM}/programs/${P_YOUTH_JOBS}`)).body.program;
    assert.equal((await director.post(`${PM}/programs/${P_YOUTH_JOBS}/reactivate`, { version: fresh.version })).body.status, 'REACTIVATED');

    // Offered again, under the same ID, and new referrals go through.
    assert.equal((await chooseAffiliation(worker, P_ADULT_ED)).status, 200);
    assert.ok((await worker.get('/api/programs')).body.programs.some((p) => p.programId === P_YOUTH_JOBS));
    const next = await worker.post('/api/referrals', referralTo(P_YOUTH_JOBS));
    assert.equal(next.status, 201);

    // The old referrals are still exactly as they were.
    const old = snapshot(ctx.store._referrals.filter((r) => r.referralId !== next.body.referral.referralId));
    assert.deepEqual(old, before.referrals);
    const queue = await as(ctx, YOUTH_STAFF).get(`/api/referrals/received?programId=${P_YOUTH_JOBS}`);
    assert.deepEqual(queue.body.referrals.map((r) => r.referralId).sort((a, b) => a - b),
      [ids.waiting, ids.finished, next.body.referral.referralId].sort((a, b) => a - b));
  });
});

function as(ctx, userId) {
  return ctx.as(userId);
}
