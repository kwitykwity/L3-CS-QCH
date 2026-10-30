// Task II: multi-location Programs.
//
// Frozen Handoff PRD 10, 12, 13; Handoff MVP 10, 12, 14; acceptance gate 20:
//
//   "QCH must be able to decide whether those locations are represented as
//    separate Program listings, or a shared Program listing containing
//    multiple locations. The system must not force one universal model."
//    (Handoff PRD 13)
//
// Model 1, separate listings: the same Program name at different sites is
// a separate Program each time, with its own details, matching facts,
// referrals, queue and report counts.
//
// Model 2, one shared listing: one Program keeps its locations in a
// Program Management field QCH creates itself (here a multi-select field
// called "Locations"), with no code change (Handoff PRD 12). It stays one
// Program for referrals. Find a Program returns the locations with each
// result, through /api/gpme/match, as current Program information (Task X,
// merged in #64), and an edit shows up there at once.
//
// What is NOT a matching input: the informational Locations field.
// Adding or changing it never changes which Programs GPME suggests
// (Handoff MVP 10: Program information shown with results must not
// silently change the GPME result). This says nothing about location in
// general: separate listings are matched on their own matching facts, such
// as age and service area, like any Program.
//
// Both models run in the same organization at once, set up by the people
// allowed to do it, over HTTP the way the screens do.
//
// Still outstanding, not covered here: the location-management screens in
// the Current Handoff Wireframes (screen 5 "Location(s)", screen 15
// Locations tab, screen 17 "Multi-Location Program" with Primary/Satellite
// type and status per location). Today QCH records locations through a
// Program field instead; whether the wireframe screens are expected is not
// verified by this file.
//
// The data store is the in-memory store (Handoff PRD 27). All data is
// SYNTHETIC (Handoff PRD 35).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createMemoryReferralStore } from '../../src/referrals/memoryReferralStore.js';

const WORKER = 100;         // sends referrals from Program 10
const QUEENS_STAFF = 200;   // receives for the Queens listing
const JH_STAFF = 201;       // receives for the Jackson Heights listing
const SHARED_STAFF = 202;   // receives for the shared listing
const DIRECTOR = 400;       // manages Programs (grants added as Programs are created)
const ORG_ADMIN = 500;      // MANAGE_ORGANIZATION (ORG scope)

const D_FAMILY = 1;
const D_YOUTH = 2;
const P_REFERRING = 10;
const P_SHARED = 11;        // one listing, several locations (model 2)

const EMPLOYMENT = 1;
const FAMILY = 2;

const FIXED_NOW = new Date('2026-10-20T14:00:00.000Z');
const PM = '/api/program-management';

const LOCATIONS = ['Synthetic Main Site, Queens', 'Synthetic Satellite, Jackson Heights', 'Synthetic Satellite, Elmhurst'];

const NO_LIMITS = { ageLimitState: 'NO_RESTRICTION', ageMin: null, ageMax: null, serviceAreaState: 'NO_RESTRICTION', serviceAreaZips: [] };
const grant = (userId, permission, programId, extra = {}) => ({
  userId, permission, scopeType: 'PROGRAM', programId, departmentId: null, grantSource: 'IN_APP', ...extra,
});

function organization() {
  return createMemoryReferralStore({
    departments: [
      { departmentId: D_FAMILY, name: 'Synthetic Family Services', lifecycleStatus: 'ACTIVE' },
      { departmentId: D_YOUTH, name: 'Synthetic Youth Services', lifecycleStatus: 'ACTIVE' },
    ],
    programs: [
      { programId: P_REFERRING, departmentId: D_FAMILY, name: 'Synthetic Intake Desk', site: 'Synthetic Main Site, Queens',
        lifecycleStatus: 'ACTIVE', needCategoryIds: [], ...NO_LIMITS },
      { programId: P_SHARED, departmentId: D_FAMILY, name: 'Synthetic Family Support', site: 'Synthetic Main Site, Queens',
        lifecycleStatus: 'ACTIVE', needCategoryIds: [FAMILY], ...NO_LIMITS },
    ],
    needCategories: [
      { needCategoryId: EMPLOYMENT, name: 'Employment', lifecycleStatus: 'ACTIVE' },
      { needCategoryId: FAMILY, name: 'Family support', lifecycleStatus: 'ACTIVE' },
    ],
    users: [WORKER, QUEENS_STAFF, JH_STAFF, SHARED_STAFF, DIRECTOR, ORG_ADMIN].map((userId) => ({ userId, isActive: true })),
    grants: [
      grant(DIRECTOR, 'MANAGE_PROGRAM', P_SHARED),
      grant(SHARED_STAFF, 'VIEW_RECEIVED_REFERRAL', P_SHARED),
      grant(ORG_ADMIN, 'MANAGE_ORGANIZATION', null, { scopeType: 'ORG' }),
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
    return { get: call('get'), post: call('post'), put: call('put'), patch: call('patch') };
  };
  return { store, as };
}

const referralTo = (receivingProgramId) => ({
  submissionId: randomUUID(),
  receivingProgramId,
  participantName: 'Synthetic Person Locations',
  contactMethod: 'NOT_AVAILABLE',
  referralContext: 'Synthetic context for the multi-location test',
});

// Model 1: the administrator creates the same Program at two sites, then
// QCH assigns each listing its own Director grant and receiving staff, and
// the Director sets each listing's matching facts.
async function createSeparateListings({ store, as }) {
  const admin = as(ORG_ADMIN);
  const director = as(DIRECTOR);
  const create = async (site) => {
    const res = await admin.post(`${PM}/programs`, { departmentId: D_YOUTH, name: 'Synthetic Youth Jobs', site });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.program.programId;
  };
  const queens = await create('Synthetic Main Site, Queens');
  const jacksonHeights = await create('Synthetic Satellite, Jackson Heights');
  store._grants.push(
    grant(DIRECTOR, 'MANAGE_PROGRAM', queens), grant(DIRECTOR, 'MANAGE_PROGRAM', jacksonHeights),
    grant(QUEENS_STAFF, 'VIEW_RECEIVED_REFERRAL', queens), grant(JH_STAFF, 'VIEW_RECEIVED_REFERRAL', jacksonHeights),
  );
  // Each location has its own facts: Queens serves ages 16 to 24, Jackson
  // Heights serves 18 to 24.
  for (const [programId, ageMin] of [[queens, 16], [jacksonHeights, 18]]) {
    const url = `${PM}/programs/${programId}/matching-facts`;
    const { version } = (await director.get(url)).body.program;
    const saved = await director.put(url, {
      version, needCategoryIds: [EMPLOYMENT], ageLimitState: 'SET', ageMin, ageMax: 24,
      serviceAreaState: 'NO_RESTRICTION', serviceAreaZips: [],
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
  }
  return { queens, jacksonHeights };
}

// Model 2: the Program's Director creates a "Locations" multi-select field
// in Program Management and selects all three locations. No code change.
async function addSharedLocations({ as }) {
  const director = as(DIRECTOR);
  const created = await director.post(`${PM}/programs/${P_SHARED}/fields`, {
    label: 'Locations', dataType: 'MULTI_SELECT', options: LOCATIONS, isRequired: false, displayOrder: 1,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const field = created.body.field;
  const set = await director.put(`${PM}/programs/${P_SHARED}/field-values/${field.fieldId}`, {
    version: field.applicability.version, value: field.options.map((o) => o.optionId),
  });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  return { field: set.body.field ?? field, applicability: set.body.applicability };
}

async function chooseAffiliation(user, programId) {
  const current = await user.get('/api/me/affiliation');
  const saved = await user.put('/api/me/affiliation', { programId, version: current.body.version });
  assert.equal(saved.status, 200);
}

const ids = (items) => items.map((p) => p.programId).sort((a, b) => a - b);

// The shared listing's result from Find a Program, through the real
// /api/gpme/match route. It must answer 200 with the Program listed.
async function sharedResult(worker) {
  const res = await worker.post('/api/gpme/match', { needCategoryIds: [FAMILY] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, 'RESULTS');
  const item = [...res.body.plausible, ...res.body.possible].find((p) => p.programId === P_SHARED);
  assert.ok(item, 'the shared listing is in the results');
  assert.ok(Array.isArray(item.programInformation), 'Program information is returned with the result');
  return item;
}

// The Locations value shown with a result (multi-select values are joined
// with ", " by Task X's display rule).
function locationsShown(item) {
  const entry = item.programInformation.find((f) => f.label === 'Locations');
  assert.ok(entry, 'the Locations field is in the returned Program information');
  return entry.value;
}

describe('Task II: a Program at more than one location, either way QCH chooses (Handoff PRD 13; MVP 14; gate 20)', () => {
  test('separate listings: one Program name at two sites is two distinct, choosable Programs', async () => {
    const ctx = startApp();
    const { queens, jacksonHeights } = await createSeparateListings(ctx);
    const worker = ctx.as(WORKER);

    // The same name at the same site is refused; the site is what tells
    // the listings apart.
    const duplicate = await ctx.as(ORG_ADMIN).post(`${PM}/programs`, {
      departmentId: D_YOUTH, name: 'synthetic youth jobs', site: 'Synthetic Main Site, Queens',
    });
    assert.deepEqual([duplicate.status, duplicate.body.code], [409, 'PROGRAM_NAME_TAKEN']);

    // Direct Referral offers both, each with its own site.
    const offered = (await worker.get('/api/programs')).body.programs.filter((p) => p.name === 'Synthetic Youth Jobs');
    assert.deepEqual(offered.map((p) => [p.programId, p.site]).sort((a, b) => a[0] - b[0]), [
      [queens, 'Synthetic Main Site, Queens'], [jacksonHeights, 'Synthetic Satellite, Jackson Heights'],
    ]);

    // Find a Program judges each listing on its own facts: a 17-year-old
    // fits Queens (16 to 24) but not Jackson Heights (18 to 24).
    const young = await worker.post('/api/gpme/match', { needCategoryIds: [EMPLOYMENT], ageRange: { min: 17, max: 17 } });
    assert.deepEqual(ids(young.body.plausible), [queens]);
    const older = await worker.post('/api/gpme/match', { needCategoryIds: [EMPLOYMENT], ageRange: { min: 20, max: 20 } });
    assert.deepEqual(ids(older.body.plausible), [queens, jacksonHeights]);
    for (const item of older.body.plausible) {
      assert.equal(item.site, offered.find((p) => p.programId === item.programId).site, 'each result shows its own site');
    }

    // Each listing's details are its own.
    const director = ctx.as(DIRECTOR);
    const facts = async (programId) => (await director.get(`${PM}/programs/${programId}/matching-facts`)).body.facts;
    assert.deepEqual([(await facts(queens)).ageMin, (await facts(jacksonHeights)).ageMin], [16, 18]);
  });

  test('separate listings: referrals, queues and reports stay with the location chosen', async () => {
    const ctx = startApp();
    const { queens, jacksonHeights } = await createSeparateListings(ctx);
    const worker = ctx.as(WORKER);
    await chooseAffiliation(worker, P_REFERRING);

    const toQueens = await worker.post('/api/referrals', referralTo(queens));
    const toJh = await worker.post('/api/referrals', referralTo(jacksonHeights));
    const toJh2 = await worker.post('/api/referrals', referralTo(jacksonHeights));
    for (const res of [toQueens, toJh, toJh2]) assert.equal(res.status, 201, JSON.stringify(res.body));

    // Each location's staff see only their own referrals.
    const queue = async (userId, programId) =>
      (await ctx.as(userId).get(`/api/referrals/received?programId=${programId}`)).body.referrals.map((r) => r.referralId);
    assert.deepEqual(await queue(QUEENS_STAFF, queens), [toQueens.body.referral.referralId]);
    assert.deepEqual((await queue(JH_STAFF, jacksonHeights)).sort((a, b) => a - b),
      [toJh.body.referral.referralId, toJh2.body.referral.referralId].sort((a, b) => a - b));
    assert.equal((await ctx.as(QUEENS_STAFF).get(`/api/referrals/${toJh.body.referral.referralId}`)).status, 404,
      'one location cannot open the other location\'s referral');

    // Reports count each location separately.
    const report = (await worker.get('/api/reports/referral-activity?period=MONTHLY')).body;
    const received = (programId) => report.programs.find((p) => p.programId === programId)?.received;
    assert.deepEqual([received(queens), received(jacksonHeights)], [1, 2]);
  });

  test('one shared listing: QCH records several locations itself, with no code change', async () => {
    const ctx = startApp();
    await addSharedLocations(ctx);

    // Program Management reads them back.
    const fields = (await ctx.as(DIRECTOR).get(`${PM}/programs/${P_SHARED}/fields`)).body.fields;
    const locations = fields.find((f) => f.label === 'Locations');
    assert.ok(locations, 'the Locations field is on the Program');
    const chosen = locations.value.map((id) => locations.options.find((o) => o.optionId === id).label);
    assert.deepEqual(chosen, LOCATIONS);

    // Find a Program returns every location, in order, with the result.
    const result = await sharedResult(ctx.as(WORKER));
    assert.equal(result.site, 'Synthetic Main Site, Queens', 'the primary site is still the Program\'s site');
    assert.deepEqual(locationsShown(result), LOCATIONS.join(', '));
  });

  test('one shared listing: it stays one Program, and the informational Locations field never changes what GPME suggests', async () => {
    const ctx = startApp();
    const worker = ctx.as(WORKER);
    await chooseAffiliation(worker, P_REFERRING);
    // What GPME suggests: which Programs, in which group, in what order, and
    // why. The Program information returned beside each result (Task X) is
    // descriptive and is compared separately, below.
    const suggestions = (body) => ({
      status: body.status,
      ...Object.fromEntries(['plausible', 'possible'].map((group) => [group,
        (body[group] ?? []).map((p) => ({ programId: p.programId, site: p.site, explanations: p.explanations }))])),
    });
    const search = async () => suggestions((await worker.post('/api/gpme/match', { needCategoryIds: [FAMILY] })).body);

    const before = await search();
    await addSharedLocations(ctx);
    const after = await search();
    assert.deepEqual(after, before, 'adding the Locations field changed what GPME suggests');
    assert.deepEqual(ids(after.plausible), [P_SHARED]);
    // Only the information shown with the result changed.
    assert.equal(locationsShown(await sharedResult(worker)), LOCATIONS.join(', '));

    // Listed once in Direct Referral, and every referral goes to that one Program.
    const offered = (await worker.get('/api/programs')).body.programs.filter((p) => p.programId === P_SHARED);
    assert.equal(offered.length, 1);
    const direct = await worker.post('/api/referrals', referralTo(P_SHARED));
    const guided = await worker.post('/api/referrals', { ...referralTo(P_SHARED), gpme: { needCategoryIds: [FAMILY] } });
    for (const res of [direct, guided]) assert.equal(res.status, 201, JSON.stringify(res.body));
    const queue = (await ctx.as(SHARED_STAFF).get(`/api/referrals/received?programId=${P_SHARED}`)).body.referrals;
    assert.equal(queue.length, 2);
  });

  test('both models at once, and changing locations later never rewrites old referrals', async () => {
    const ctx = startApp();
    const { queens, jacksonHeights } = await createSeparateListings(ctx);
    const { field, applicability } = await addSharedLocations(ctx);
    const worker = ctx.as(WORKER);
    await chooseAffiliation(worker, P_REFERRING);

    // The same organization uses both models side by side.
    const offered = ids((await worker.get('/api/programs')).body.programs);
    assert.deepEqual(offered, [P_REFERRING, P_SHARED, queens, jacksonHeights].sort((a, b) => a - b));
    for (const programId of [P_SHARED, queens, jacksonHeights]) {
      assert.equal((await worker.post('/api/referrals', referralTo(programId))).status, 201);
    }
    const before = JSON.parse(JSON.stringify(ctx.store._referrals));
    assert.equal(locationsShown(await sharedResult(worker)), LOCATIONS.join(', '), 'all three locations before the change');

    // QCH closes the Elmhurst satellite on the shared listing...
    const director = ctx.as(DIRECTOR);
    const fieldNow = (await director.get(`${PM}/programs/${P_SHARED}/fields`)).body.fields.find((f) => f.fieldId === field.fieldId);
    const elmhurst = fieldNow.options.find((o) => o.label === LOCATIONS[2]);
    const narrowed = await director.put(`${PM}/programs/${P_SHARED}/field-values/${field.fieldId}`, {
      version: fieldNow.applicability?.version ?? applicability.version,
      value: fieldNow.value.filter((id) => id !== elmhurst.optionId),
    });
    assert.equal(narrowed.status, 200, JSON.stringify(narrowed.body));
    // ...and moves the Jackson Heights listing to a new address.
    const jh = (await director.get(`${PM}/programs/${jacksonHeights}`)).body.program;
    const moved = await director.patch(`${PM}/programs/${jacksonHeights}`, { version: jh.version, site: 'Synthetic Satellite, Corona' });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));

    // Find a Program shows the change at once, through /api/gpme/match...
    assert.equal(locationsShown(await sharedResult(worker)), LOCATIONS.slice(0, 2).join(', '));
    // ...and old referrals are exactly as they were (Handoff PRD 10, 12).
    assert.deepEqual(JSON.parse(JSON.stringify(ctx.store._referrals)), before);
    // New choices show the current information.
    const site = (await worker.get('/api/programs')).body.programs.find((p) => p.programId === jacksonHeights).site;
    assert.equal(site, 'Synthetic Satellite, Corona');
  });
});
