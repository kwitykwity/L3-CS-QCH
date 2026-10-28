// Card 17, next slice: the HTTP journeys docs/regression-coverage.md still
// listed as missing (Final Technical PRD 17.2, 17.3, 17.5).
//
//   Journey 8   GPME-assisted referral (#16, #27): need categories -> match
//               -> choose -> saved as GPME_ASSISTED with its evaluation ->
//               received like any referral; a Program that changed after
//               the search is refused; matching down -> Direct Referral.
//   Journey 9   Outcome and corrections (#14): Not Appropriate -> outcome
//               refused -> decision corrected -> outcome recorded ->
//               outcome corrected; stale screens refused; each capability
//               separate; the sender sees the result; full audit history.
//   Journey 10  Program fields and values, slice 14B (#22, #24): create,
//               set, reuse in a second Program, rename, options, replace a
//               meaning; values follow the field's identity.
//   Journey 11  Organization changes, slice 14C (#25): new Department and
//               Program, referrals to it, move it, Department lifecycle.
//   Journey 13  Program Management -> Find a Program (Task AA): language,
//               availability, contact and site changes made through
//               Program Management appear in Find a Program without
//               changing who is found; missing information stays unknown;
//               authorization and stale-version refusals; rename, option
//               and field discontinue, retire and Program discontinue follow
//               the lifecycle rules; referrals sent earlier, their GPME
//               evaluation, audit trail and every view of them stay
//               byte-for-byte the same.
//
// Like journeys.test.js, each journey drives the real Express app over
// HTTP the way the screens do, switching between staff members. The
// per-card tests check each rule on its own; these check that the rules
// still hold together across a whole workflow. The browser side of these
// areas is covered by e2e/gpme.spec.js, e2e/receivingLifecycle.spec.js and
// the Program Management specs.
//
// The data store is the in-memory store. Running the same journeys against
// Azure SQL (PRD 17.2) waits on the Azure SQL store and QCH IT.
// All data is SYNTHETIC (PRD 15.5).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createMemoryReferralStore } from '../../src/referrals/memoryReferralStore.js';
import { createGpmeService } from '../../src/gpme/gpmeService.js';

// Staff in the synthetic organization.
const WORKER = 100;         // sends referrals; no receiving rights
const INTAKE = 200;         // Program 11: view + respond
const OUTCOMES = 201;       // Program 11: view + record outcome
const SUPERVISOR = 202;     // Program 11: view + correct outcome + correct response
const VIEWER = 203;         // Program 11: view only
const HOUSING_STAFF = 300;  // Program 12: view + respond + every correction
const DIRECTOR = 400;       // MANAGE_PROGRAM for Programs 11 and 12
const DIRECTOR_12 = 401;    // MANAGE_PROGRAM for Program 12 only
const ORG_ADMIN = 500;      // MANAGE_ORGANIZATION (ORG scope)
const LEFT = 600;           // account deactivated

const P_FAMILY = 10;        // the worker's Program
const P_ADULT_ED = 11;      // receives referrals
const P_YOUTH = 12;         // another receiving Program
const P_TRADES = 13;        // age rule not on file
const D_FAMILY = 1;
const D_ADULT = 2;

const FOOD = 1;
const EMPLOYMENT = 2;

// Text that must never leave the referral records (PRD 5.4, 15.3).
const MARKERS = {
  name: 'Synthetic Person Journey Lambda',
  context: 'Synthetic context marker QX18CTX',
  explanation: 'Synthetic explanation marker QX18EXPL',
};

const grant = (userId, permission, programId, extra = {}) => ({
  userId, permission, scopeType: 'PROGRAM', programId, departmentId: null, grantSource: 'IN_APP', ...extra,
});
const NO_LIMITS = { ageLimitState: 'NO_RESTRICTION', ageMin: null, ageMax: null, serviceAreaState: 'NO_RESTRICTION', serviceAreaZips: [] };

function organization(storeOptions = {}) {
  return createMemoryReferralStore({
    departments: [
      { departmentId: D_FAMILY, name: 'Synthetic Family Services', lifecycleStatus: 'ACTIVE' },
      { departmentId: D_ADULT, name: 'Synthetic Adult Services', lifecycleStatus: 'ACTIVE' },
    ],
    programs: [
      { programId: P_FAMILY, departmentId: D_FAMILY, name: 'Synthetic Family Center', site: 'Site A', lifecycleStatus: 'ACTIVE',
        needCategoryIds: [FOOD], ...NO_LIMITS },
      { programId: P_ADULT_ED, departmentId: D_ADULT, name: 'Synthetic Adult Education', site: 'Site B', lifecycleStatus: 'ACTIVE',
        needCategoryIds: [EMPLOYMENT], ageLimitState: 'SET', ageMin: 18, ageMax: 64,
        serviceAreaState: 'SET', serviceAreaZips: ['99918'] },
      { programId: P_YOUTH, departmentId: D_ADULT, name: 'Synthetic Youth Jobs', site: null, lifecycleStatus: 'ACTIVE',
        needCategoryIds: [EMPLOYMENT], ...NO_LIMITS, ageLimitState: 'SET', ageMin: 16, ageMax: 21 },
      { programId: P_TRADES, departmentId: D_ADULT, name: 'Synthetic Trades', site: null, lifecycleStatus: 'ACTIVE',
        needCategoryIds: [EMPLOYMENT], ...NO_LIMITS, ageLimitState: 'NOT_ON_FILE' },
    ],
    needCategories: [
      { needCategoryId: FOOD, name: 'Food', lifecycleStatus: 'ACTIVE' },
      { needCategoryId: EMPLOYMENT, name: 'Employment', lifecycleStatus: 'ACTIVE' },
    ],
    users: [
      { userId: WORKER, isActive: true, displayName: 'Synthetic Worker' },
      ...[INTAKE, OUTCOMES, SUPERVISOR, VIEWER].map((userId) => ({ userId, isActive: true, currentProgramId: P_ADULT_ED })),
      { userId: HOUSING_STAFF, isActive: true, currentProgramId: P_YOUTH },
      { userId: DIRECTOR, isActive: true },
      { userId: DIRECTOR_12, isActive: true },
      { userId: ORG_ADMIN, isActive: true },
      { userId: LEFT, isActive: false },
    ],
    grants: [
      grant(INTAKE, 'VIEW_RECEIVED_REFERRAL', P_ADULT_ED), grant(INTAKE, 'RESPOND_TO_REFERRAL', P_ADULT_ED),
      grant(OUTCOMES, 'VIEW_RECEIVED_REFERRAL', P_ADULT_ED), grant(OUTCOMES, 'RECORD_OUTCOME', P_ADULT_ED),
      grant(SUPERVISOR, 'VIEW_RECEIVED_REFERRAL', P_ADULT_ED), grant(SUPERVISOR, 'CORRECT_OUTCOME', P_ADULT_ED),
      grant(SUPERVISOR, 'UPDATE_RECEIVED_REFERRAL', P_ADULT_ED),
      grant(VIEWER, 'VIEW_RECEIVED_REFERRAL', P_ADULT_ED),
      ...['VIEW_RECEIVED_REFERRAL', 'RESPOND_TO_REFERRAL', 'RECORD_OUTCOME', 'CORRECT_OUTCOME', 'UPDATE_RECEIVED_REFERRAL']
        .map((permission) => grant(HOUSING_STAFF, permission, P_YOUTH)),
      grant(DIRECTOR, 'MANAGE_PROGRAM', P_ADULT_ED), grant(DIRECTOR, 'MANAGE_PROGRAM', P_YOUTH),
      grant(DIRECTOR_12, 'MANAGE_PROGRAM', P_YOUTH),
      grant(ORG_ADMIN, 'MANAGE_ORGANIZATION', null, { scopeType: 'ORG' }),
    ],
    notAppropriateReasons: [
      { reasonId: 1, code: 'PROGRAM_CRITERIA_NOT_MET', label: 'Program criteria not met', displayOrder: 1 },
      { reasonId: 2, code: 'PROGRAM_UNAVAILABLE', label: 'Program currently unavailable', displayOrder: 2 },
      { reasonId: 5, code: 'OTHER', label: 'Other', displayOrder: 5 },
    ],
  }, storeOptions);
}

// The integrated app, plus a way to act as one staff member at a time.
// Identity comes only from resolveIdentity (PRD 3.2); requests are awaited
// one at a time, so `current` always names the acting user.
function startApp(storeOptions = {}) {
  const store = organization(storeOptions);
  let current = null;
  const app = createApp({
    affiliationStore: store, referralStore: store, resolveIdentity: () => (current ? { userId: current } : null), nodeEnv: 'test',
  });
  const responses = [];
  const record = async (pending) => {
    const res = await pending;
    responses.push(res);
    return res;
  };
  const as = (userId) => ({
    get: (url) => { current = userId; return record(request(app).get(url)); },
    post: (url, body) => { current = userId; return record(request(app).post(url).send(body)); },
    put: (url, body) => { current = userId; return record(request(app).put(url).send(body)); },
    patch: (url, body) => { current = userId; return record(request(app).patch(url).send(body)); },
  });
  return { store, as, responses };
}

async function chooseAffiliation(user, programId) {
  const current = await user.get('/api/me/affiliation');
  const saved = await user.put('/api/me/affiliation', { programId, version: current.body.version });
  assert.equal(saved.status, 200);
}

function referralTo(receivingProgramId, extra = {}) {
  return {
    submissionId: randomUUID(),
    receivingProgramId,
    participantName: MARKERS.name,
    contactMethod: 'NOT_AVAILABLE',
    referralContext: MARKERS.context,
    ...extra,
  };
}

const ids = (items) => items.map((p) => p.programId).sort((a, b) => a - b);
const auditOf = (store, entityType, entityId) => store._referralAuditEvents
  .filter((e) => e.entityType === entityType && (entityId === undefined || e.entityId === entityId));
const noStore = (responses, prefix) => {
  for (const res of responses.filter((r) => r.req.path.startsWith(prefix))) {
    assert.equal(res.headers['cache-control'], 'no-store', res.req.path);
  }
};

describe('Journey 8: GPME-assisted referral (#16, #27; PRD 2.2, 5.3, 8.1 to 8.8)', () => {
  // Employment, ages 19 to 20, ZIP 99918:
  //   P11 (18-64, serves 99918)  plausible
  //   P12 (16-21, any area)      plausible
  //   P13 (ages not on file)     possible
  const ANSWERS = { needCategoryIds: [EMPLOYMENT], ageRange: { min: 19, max: 20 }, participantZip: '99918' };

  test('search -> choose -> saved with its evaluation -> received and answered like any referral', async () => {
    const { store, as, responses } = startApp();
    const worker = as(WORKER);
    const intake = as(INTAKE);
    await chooseAffiliation(worker, P_FAMILY);

    // The guided form offers the active need categories (PRD 8.2).
    const categories = await worker.get('/api/gpme/need-categories');
    assert.equal(categories.status, 200);
    assert.deepEqual(categories.body.needCategories.map((c) => c.name), ['Employment', 'Food']);

    // Search: answers go in a POST body, never a URL (PRD 5.5).
    const found = await worker.post('/api/gpme/match', ANSWERS);
    assert.equal(found.status, 200);
    assert.equal(found.body.status, 'RESULTS');
    assert.deepEqual(ids(found.body.plausible), [P_ADULT_ED, P_YOUTH]);
    assert.deepEqual(ids(found.body.possible), [P_TRADES]);
    const shown = found.body.plausible.find((p) => p.programId === P_ADULT_ED);
    assert.deepEqual(shown.explanations, ['Offers: Employment', 'Serves ages 18 to 64', 'Serves listed ZIP codes']);
    assert.equal(store._referrals.length, 0, 'GPME only suggests; nothing is created (PRD 8.1)');

    // The worker chooses Program 11. Same pipeline as Direct Referral.
    const draft = referralTo(P_ADULT_ED, { gpme: ANSWERS });
    const sent = await worker.post('/api/referrals', draft);
    assert.equal(sent.status, 201);
    const referralId = sent.body.referral.referralId;
    assert.equal(sent.body.referral.referringProgramId, P_FAMILY, 'Referring Program still comes from affiliation');

    // A lost confirmation, then a resend: still one referral, one evaluation (PRD 7.3).
    const again = await worker.post('/api/referrals', draft);
    assert.equal(again.status, 200);
    assert.equal(again.body.status, 'ALREADY_RECEIVED');
    assert.equal(store._referrals.length, 1);
    assert.equal(store._gpmeEvaluations.length, 1);

    // The evaluation records what was shown and what was chosen (PRD 8.7).
    const evaluation = await store.getGpmeEvaluation(store._referrals[0].gpmeEvaluationId);
    assert.deepEqual(evaluation.results.map((r) => [r.programId, r.programContext.group, r.wasSelected]), [
      [P_ADULT_ED, 'PLAUSIBLE', true], [P_YOUTH, 'PLAUSIBLE', false], [P_TRADES, 'POSSIBLE', false],
    ]);
    assert.deepEqual(evaluation.results[0].programContext.explanations, shown.explanations);

    // The matching answers themselves are never stored (PRD 5.3, 8.7).
    const evidence = JSON.stringify([store._gpmeEvaluations, store._referralAuditEvents]);
    for (const key of ['ageRange', 'participantZip', 'needCategoryIds']) assert.ok(!evidence.includes(key), `stored: ${key}`);
    assert.ok(!JSON.stringify([evidence, store._referrals]).includes('99918'), 'the ZIP answer is stored nowhere');

    // Received like any referral, marked as guided.
    const queue = await intake.get(`/api/referrals/received?programId=${P_ADULT_ED}&stage=AWAITING_RESPONSE`);
    assert.deepEqual(queue.body.referrals.map((r) => r.referralId), [referralId]);
    const opened = await intake.get(`/api/referrals/${referralId}`);
    assert.equal(opened.body.referral.source, 'GPME_ASSISTED');
    assert.equal(opened.body.referral.participantZip, null, 'the referral ZIP is only what the referral form sent');
    assert.equal((await intake.post(`/api/referrals/${referralId}/response`, { decision: 'ACCEPTED' })).status, 200);
    const workerView = await worker.get(`/api/referrals/${referralId}`);
    assert.equal(workerView.body.referral.stage, 'ACCEPTED_OUTCOME_PENDING');

    // Audit: created by the worker, with the source and rule version only.
    const trail = auditOf(store, 'REFERRAL', referralId);
    assert.deepEqual(trail.map((e) => [e.action, e.actorUserId]), [['CREATED', WORKER], ['ACCEPTED', INTAKE]]);
    assert.equal(trail[0].after.source, 'GPME_ASSISTED');
    assert.equal(trail[0].after.gpme_rule_version, evaluation.ruleVersion);

    noStore(responses, '/api/');
  });

  test('a Program whose matching facts changed after the search is refused; the worker re-searches and sends', async () => {
    const { store, as } = startApp();
    const worker = as(WORKER);
    const director = as(DIRECTOR);
    await chooseAffiliation(worker, P_FAMILY);
    const before = await worker.post('/api/gpme/match', ANSWERS);
    assert.ok(ids(before.body.plausible).includes(P_YOUTH));

    // Meanwhile Program 12's Director changes its age limit (Program Management).
    const facts = await director.get(`/api/program-management/programs/${P_YOUTH}/matching-facts`);
    assert.equal(facts.status, 200);
    const changed = await director.put(`/api/program-management/programs/${P_YOUTH}/matching-facts`, {
      version: facts.body.program.version,
      needCategoryIds: [EMPLOYMENT], ageLimitState: 'SET', ageMin: 30, ageMax: 40,
      serviceAreaState: 'NO_RESTRICTION', serviceAreaZips: [],
    });
    assert.equal(changed.status, 200);

    // The worker sends from the old results: refused, nothing saved (PRD 8.8).
    const draft = referralTo(P_YOUTH, { gpme: ANSWERS });
    const refused = await worker.post('/api/referrals', draft);
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, 'GPME_RESULT_CHANGED');
    assert.equal(store._referrals.length, 0);
    assert.equal(store._gpmeEvaluations.length, 0);

    // Re-search: Program 12 is gone; the worker picks the "possible" one,
    // keeping the same logical submission.
    const now = await worker.post('/api/gpme/match', ANSWERS);
    assert.ok(![...now.body.plausible, ...now.body.possible].some((p) => p.programId === P_YOUTH));
    const sent = await worker.post('/api/referrals', { ...draft, receivingProgramId: P_TRADES });
    assert.equal(sent.status, 201);
    const evaluation = await store.getGpmeEvaluation(store._referrals[0].gpmeEvaluationId);
    assert.deepEqual(evaluation.results.filter((r) => r.wasSelected).map((r) => [r.programId, r.programContext.group]),
      [[P_TRADES, 'POSSIBLE']]);

    // The matching change is audited to the Director (PRD 9.6).
    const programEvents = auditOf(store, 'PROGRAM', P_YOUTH);
    assert.deepEqual(programEvents.map((e) => [e.action, e.actorUserId]), [['UPDATED', DIRECTOR]]);
    assert.deepEqual(programEvents[0].after.matching_facts.ageMin, 30);
  });

  test('matching down: never "no match", nothing saved, and Direct Referral still works (PRD 8.5, 8.8)', async () => {
    const { store, as } = startApp();
    const worker = as(WORKER);
    await chooseAffiliation(worker, P_FAMILY);
    store._failMatching();

    const search = await worker.post('/api/gpme/match', ANSWERS);
    assert.equal(search.status, 503);
    assert.equal(search.body.status, 'UNABLE_TO_MATCH');
    assert.equal(search.body.plausible, undefined, 'a technical failure is not an empty result');

    const draft = referralTo(P_ADULT_ED, { gpme: ANSWERS });
    const guided = await worker.post('/api/referrals', draft);
    assert.equal(guided.status, 503);
    assert.equal(guided.body.code, 'GPME_UNAVAILABLE');
    assert.equal(store._referrals.length, 0);

    // The same Program as a Direct Referral, same logical submission.
    const { gpme, ...direct } = draft;
    const sent = await worker.post('/api/referrals', direct);
    assert.equal(sent.status, 201);
    assert.equal(store._referrals[0].source, 'DIRECT');
    assert.equal(store._gpmeEvaluations.length, 0);
  });
});

describe('Journey 9: service outcome and corrections (#14; PRD 2.4, 3.6, 6.1 to 6.5, 9.4, 9.6)', () => {
  test('Not Appropriate -> corrected to Accepted -> outcome recorded -> outcome corrected, across staff', async () => {
    const { store, as, responses } = startApp();
    const worker = as(WORKER);
    const intake = as(INTAKE);
    const outcomes = as(OUTCOMES);
    const supervisor = as(SUPERVISOR);
    await chooseAffiliation(worker, P_FAMILY);
    const sent = await worker.post('/api/referrals', referralTo(P_ADULT_ED));
    const id = sent.body.referral.referralId;
    const url = (path = '') => `/api/referrals/${id}${path}`;
    const row = () => store._referrals.find((r) => r.referralId === id);
    const versionFor = async (user) => (await user.get(url())).body.referral.version;

    // Intake answers Not Appropriate with a reason and an explanation.
    const answered = await intake.post(url('/response'), {
      decision: 'NOT_APPROPRIATE', reasonId: 1, explanation: MARKERS.explanation,
    });
    assert.equal(answered.status, 200);

    // A Not Appropriate referral cannot receive an outcome (PRD 6.5).
    const tooEarly = await outcomes.post(url('/outcome'), { outcome: 'RESULTED_IN_SERVICE' });
    assert.equal(tooEarly.status, 409);
    assert.equal(tooEarly.body.code, 'OUTCOME_NOT_ALLOWED');

    // Hints follow capability: only the supervisor may correct the decision.
    assert.equal((await supervisor.get(url())).body.viewerAccess.canCorrectResponse, true);
    assert.equal((await outcomes.get(url())).body.viewerAccess.canCorrectResponse, false);
    assert.equal((await worker.get(url())).body.viewerAccess.canCorrectResponse, false);

    // Each action is its own capability. Refusals change nothing (PRD 3.6).
    const seenNotAppropriate = await versionFor(supervisor);
    const snapshot = JSON.stringify(row());
    const auditCount = store._referralAuditEvents.length;
    const toAccepted = { decision: 'ACCEPTED', version: seenNotAppropriate };
    for (const [userId, status] of [[INTAKE, 403], [OUTCOMES, 403], [VIEWER, 403], [WORKER, 403], [HOUSING_STAFF, 404], [LEFT, 403]]) {
      const res = await as(userId).post(url('/response/correction'), toAccepted);
      assert.equal(res.status, status, `user ${userId}`);
    }
    assert.equal((await as(null).post(url('/response/correction'), toAccepted)).status, 401);
    assert.equal(JSON.stringify(row()), snapshot, 'no refused correction changed the referral');
    assert.equal(store._referralAuditEvents.length, auditCount);

    // The supervisor corrects the decision to Accepted.
    const corrected = await supervisor.post(url('/response/correction'), toAccepted);
    assert.equal(corrected.status, 200);
    assert.equal(corrected.body.referral.decision, 'ACCEPTED');
    assert.equal(corrected.body.referral.stage, 'ACCEPTED_OUTCOME_PENDING');
    assert.equal(corrected.body.referral.hasExplanation, false);

    // The same correction from the old screen is refused with what is saved now (PRD 9.4).
    const stale = await supervisor.post(url('/response/correction'), { decision: 'NOT_APPROPRIATE', reasonId: 2, version: seenNotAppropriate });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'REFERRAL_CHANGED');
    assert.equal(stale.body.current.decision, 'ACCEPTED');

    // Only RECORD_OUTCOME records: the supervisor cannot, the outcome staff can.
    assert.equal((await supervisor.post(url('/outcome'), { outcome: 'RESULTED_IN_SERVICE' })).status, 403);
    const recorded = await outcomes.post(url('/outcome'), { outcome: 'RESULTED_IN_SERVICE' });
    assert.equal(recorded.status, 200);
    assert.equal(recorded.body.referral.stage, 'COMPLETE');
    const firstServed = row().firstResultedInServiceAt;
    assert.match(firstServed, /Z$/);
    const twice = await outcomes.post(url('/outcome'), { outcome: 'DID_NOT_RESULT_IN_SERVICE' });
    assert.equal(twice.status, 409);
    assert.equal(twice.body.code, 'OUTCOME_ALREADY_RECORDED');

    // The sender sees the result, read-only (PRD 1.2, 6.1).
    const senderView = await worker.get(url());
    assert.equal(senderView.body.referral.serviceOutcome, 'RESULTED_IN_SERVICE');
    assert.equal(senderView.body.viewerAccess.canCorrectOutcome, false);
    const sentList = await worker.get('/api/referrals/sent');
    assert.deepEqual(sentList.body.referrals.map((r) => [r.referralId, r.stage]), [[id, 'COMPLETE']]);

    // Not Appropriate is blocked while an outcome is recorded (PRD 6.5, 13.4).
    const blocked = await supervisor.post(url('/response/correction'), {
      decision: 'NOT_APPROPRIATE', reasonId: 1, version: recorded.body.referral.version,
    });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, 'OUTCOME_RECORDED');

    // The supervisor corrects the outcome; a second screen still showing the
    // old version is refused; the first service time is never rewritten (PRD 12.4).
    const seenRecorded = recorded.body.referral.version;
    const fixed = await supervisor.post(url('/outcome/correction'), { outcome: 'DID_NOT_RESULT_IN_SERVICE', version: seenRecorded });
    assert.equal(fixed.status, 200);
    assert.equal(fixed.body.referral.serviceOutcome, 'DID_NOT_RESULT_IN_SERVICE');
    const late = await supervisor.post(url('/outcome/correction'), { outcome: 'NOT_RECORDED', version: seenRecorded });
    assert.equal(late.status, 409);
    assert.equal(late.body.code, 'REFERRAL_CHANGED');
    assert.equal(late.body.current.serviceOutcome, 'DID_NOT_RESULT_IN_SERVICE');
    assert.equal(row().firstResultedInServiceAt, firstServed);
    assert.equal((await worker.get(url())).body.referral.serviceOutcome, 'DID_NOT_RESULT_IN_SERVICE');

    // The whole history, by the right people, with every prior value kept (PRD 6.2, 9.6).
    const trail = auditOf(store, 'REFERRAL', id);
    assert.deepEqual(trail.map((e) => [e.action, e.actorUserId]), [
      ['CREATED', WORKER],
      ['NOT_APPROPRIATE', INTAKE],
      ['CORRECTED', SUPERVISOR],
      ['SERVICE_OUTCOME_RECORDED', OUTCOMES],
      ['CORRECTED', SUPERVISOR],
    ]);
    assert.deepEqual([trail[2].before.decision, trail[2].after.decision], ['NOT_APPROPRIATE', 'ACCEPTED']);
    assert.equal(trail[2].before.not_appropriate_explanation, MARKERS.explanation,
      'the prior explanation is kept in the correction that cleared it');
    assert.deepEqual([trail[4].before.service_outcome, trail[4].after.service_outcome],
      ['RESULTED_IN_SERVICE', 'DID_NOT_RESULT_IN_SERVICE']);

    // The explanation appears only on the authorized detail view; action
    // confirmations and errors carry no participant details (PRD 6.5, 10.5).
    for (const res of responses) {
      const isDetail = /^\/api\/referrals\/\d+$/.test(res.req.path) && res.status === 200;
      const text = JSON.stringify(res.body ?? {});
      if (!isDetail) assert.ok(!text.includes(MARKERS.explanation), `${res.req.method} ${res.req.path} returned the explanation`);
      if (res.req.method === 'POST' || res.status >= 400) {
        for (const value of Object.values(MARKERS)) assert.ok(!text.includes(value), `${res.req.method} ${res.req.path} returned ${value}`);
      }
    }
    noStore(responses, '/api/referrals');
  });
});

describe('Journey 10: Program fields and values, slice 14B (#22, #24; PRD 3.6, 4.2, 4.3, 9.4, 9.6)', () => {
  const PM = '/api/program-management';

  test('create -> set -> reuse in a second Program -> rename -> options -> replace a meaning; values follow identity', async () => {
    const { store, as, responses } = startApp();
    const director = as(DIRECTOR);
    const director12 = as(DIRECTOR_12);
    const fieldsOf = async (user, programId) => (await user.get(`${PM}/programs/${programId}/fields`)).body.fields;

    // Who may manage fields: Directors only (PRD 3.6).
    for (const userId of [WORKER, INTAKE, ORG_ADMIN]) {
      assert.equal((await as(userId).get(`${PM}/programs/${P_ADULT_ED}/fields`)).status, 403, `user ${userId}`);
    }
    assert.deepEqual(await fieldsOf(director, P_ADULT_ED), []);

    // Create a required choice field for Program 11 and set its value.
    const created = await director.post(`${PM}/programs/${P_ADULT_ED}/fields`, {
      label: 'Synthetic session format', dataType: 'SINGLE_SELECT',
      options: ['Synthetic in person', 'Synthetic remote'], isRequired: true, displayOrder: 1,
    });
    assert.equal(created.status, 201);
    const field = created.body.field;
    const [inPerson, remote] = field.options.map((o) => o.optionId);
    const set11 = await director.put(`${PM}/programs/${P_ADULT_ED}/field-values/${field.fieldId}`,
      { version: field.applicability.version, value: inPerson });
    assert.equal(set11.status, 200);
    const cleared = await director.put(`${PM}/programs/${P_ADULT_ED}/field-values/${field.fieldId}`,
      { version: set11.body.applicability.version, value: null });
    assert.deepEqual([cleared.status, cleared.body.code], [422, 'VALUE_REQUIRED']);

    // Reuse the same field (same meaning) in Program 12, as optional.
    const available = await director.get(`${PM}/programs/${P_YOUTH}/available-fields`);
    assert.deepEqual(available.body.fields.map((f) => f.fieldId), [field.fieldId]);
    const applied = await director.post(`${PM}/programs/${P_YOUTH}/field-applicability/${field.fieldId}`, { isRequired: false, displayOrder: 2 });
    assert.equal(applied.status, 201);
    assert.equal(applied.body.status, 'APPLIED');

    // Program 12's own Director sets Program 12's value, but cannot touch
    // Program 11's value or the shared definition.
    const set12 = await director12.put(`${PM}/programs/${P_YOUTH}/field-values/${field.fieldId}`,
      { version: applied.body.field.applicability.version, value: remote });
    assert.equal(set12.status, 200);
    assert.equal((await director12.put(`${PM}/programs/${P_ADULT_ED}/field-values/${field.fieldId}`,
      { version: set11.body.applicability.version, value: remote })).status, 403);
    assert.equal((await director12.patch(`${PM}/fields/${field.fieldId}`, { version: field.version, label: 'Synthetic other' })).status, 403);

    // Rename (wording only): same field, values kept in both Programs (PRD 4.3).
    const renamed = await director.patch(`${PM}/fields/${field.fieldId}`, { version: field.version, label: 'Synthetic meeting format' });
    assert.equal(renamed.body.status, 'RENAMED');
    assert.equal(renamed.body.field.fieldId, field.fieldId);
    const after11 = (await fieldsOf(director, P_ADULT_ED))[0];
    const after12 = (await fieldsOf(director, P_YOUTH))[0];
    assert.deepEqual([after11.label, after11.value, after12.label, after12.value],
      ['Synthetic meeting format', inPerson, 'Synthetic meeting format', remote]);

    // A rename from a screen that missed it is refused with the current field (PRD 9.4).
    const stale = await director.patch(`${PM}/fields/${field.fieldId}`, { version: field.version, label: 'Synthetic late wording' });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'FIELD_CHANGED');
    assert.equal(stale.body.current.label, 'Synthetic meeting format');

    // Options: discontinue "remote". Program 12 keeps its selection as it
    // is; Program 11 cannot newly choose it.
    const remoteOption = renamed.body.field.options.find((o) => o.optionId === remote);
    const off = await director.post(`${PM}/fields/${field.fieldId}/options/${remote}/discontinue`, { version: remoteOption.version });
    assert.equal(off.status, 200);
    assert.equal((await fieldsOf(director, P_YOUTH))[0].value, remote);
    const pick = await director.put(`${PM}/programs/${P_ADULT_ED}/field-values/${field.fieldId}`,
      { version: after11.applicability.version, value: remote });
    assert.deepEqual([pick.status, pick.body.code], [422, 'OPTION_NOT_SELECTABLE']);

    // A change of meaning is a replacement: the old field is discontinued
    // and linked to a new field used by the same Programs (PRD 4.3).
    const replaced = await director.post(`${PM}/fields/${field.fieldId}/replace`, {
      version: renamed.body.field.version, label: 'Synthetic sessions per week', dataType: 'NUMBER',
    });
    assert.equal(replaced.status, 201);
    assert.equal(replaced.body.status, 'REPLACED');
    const replacement = replaced.body.replacement;
    assert.notEqual(replacement.fieldId, field.fieldId);
    assert.equal(replaced.body.field.lifecycleStatus, 'DISCONTINUED');
    assert.equal(replaced.body.field.replacedByFieldId, replacement.fieldId);

    // The old value stays as history but takes no new value; the old field
    // cannot come back.
    const list11 = await fieldsOf(director, P_ADULT_ED);
    const old11 = list11.find((f) => f.fieldId === field.fieldId);
    const new11 = list11.find((f) => f.fieldId === replacement.fieldId);
    assert.deepEqual([old11.lifecycleStatus, old11.value, old11.permissions.canManageValue], ['DISCONTINUED', inPerson, false]);
    assert.deepEqual([new11.applicability.isRequired, new11.value], [true, null]);
    const oldWrite = await director.put(`${PM}/programs/${P_ADULT_ED}/field-values/${field.fieldId}`,
      { version: old11.applicability.version, value: inPerson });
    assert.deepEqual([oldWrite.status, oldWrite.body.code], [409, 'FIELD_NOT_ACTIVE']);
    const back = await director.post(`${PM}/fields/${field.fieldId}/reactivate`, { version: replaced.body.field.version });
    assert.equal(back.status, 409);

    // The replacement takes values in both Programs.
    assert.equal((await director.put(`${PM}/programs/${P_ADULT_ED}/field-values/${replacement.fieldId}`,
      { version: new11.applicability.version, value: 2 })).status, 200);
    const new12 = (await fieldsOf(director, P_YOUTH)).find((f) => f.fieldId === replacement.fieldId);
    assert.equal(new12.applicability.isRequired, false, 'each Program keeps its own required setting');
    assert.equal((await director12.put(`${PM}/programs/${P_YOUTH}/field-values/${replacement.fieldId}`,
      { version: new12.applicability.version, value: 1 })).status, 200);

    // What Find a Program reads as current Program information: active
    // fields only, with their current values (Task C, internal interface).
    const information = await createGpmeService({ store, logFailure: () => {} }).listCurrentProgramInformation(WORKER);
    const fieldsFor = (programId) => information.find((p) => p.programId === programId).fields.map((f) => [f.fieldId, f.value]);
    assert.deepEqual(fieldsFor(P_ADULT_ED), [[replacement.fieldId, 2]]);
    assert.deepEqual(fieldsFor(P_YOUTH), [[replacement.fieldId, 1]]);

    // Audit: every change attributed; the field keeps one identity through
    // a rename and links to its replacement (PRD 9.6).
    assert.deepEqual(auditOf(store, 'FIELD', field.fieldId).map((e) => e.action), ['CREATED', 'RENAMED', 'REPLACED']);
    assert.equal(auditOf(store, 'FIELD', replacement.fieldId)[0].after.replaces_field_id, field.fieldId);
    const actors = new Map(store._referralAuditEvents.map((e) => [e.actorUserId, true]));
    assert.deepEqual([...actors.keys()].sort(), [DIRECTOR, DIRECTOR_12]);
    assert.deepEqual(auditOf(store, 'PROGRAM_FIELD', P_YOUTH).filter((e) => e.actorUserId === DIRECTOR_12).length, 2,
      'Program 12 values set by its own Director');

    noStore(responses, PM);
  });
});

describe('Journey 11: organization changes, slice 14C (#25; PRD 3.6, 4.4, 9.1, 9.4, 9.6)', () => {
  const PM = '/api/program-management';

  test('new Department and Program -> referrals to it -> move it -> Department lifecycle; history kept', async () => {
    const { store, as, responses } = startApp();
    const admin = as(ORG_ADMIN);
    const worker = as(WORKER);
    await chooseAffiliation(worker, P_FAMILY);
    const offered = async () => (await worker.get('/api/programs')).body.programs.map((p) => p.programId);

    // Only an ORG-scope MANAGE_ORGANIZATION grant counts; refusals write nothing (PRD 3.6).
    for (const userId of [WORKER, DIRECTOR, INTAKE]) {
      assert.equal((await as(userId).post(`${PM}/departments`, { name: 'Synthetic Refused Dept' })).status, 403, `user ${userId}`);
      assert.equal((await as(userId).post(`${PM}/programs`, { departmentId: D_ADULT, name: 'Synthetic Refused' })).status, 403);
    }
    assert.equal(store._referralAuditEvents.length, 0);

    // A new Department, then a new Program in it.
    const dept = await admin.post(`${PM}/departments`, { name: 'Synthetic Community Services' });
    assert.equal(dept.status, 201);
    const deptId = dept.body.department.departmentId;
    const taken = await admin.post(`${PM}/departments`, { name: 'synthetic community services' });
    assert.deepEqual([taken.status, taken.body.code], [409, 'DEPARTMENT_NAME_TAKEN']);
    const created = await admin.post(`${PM}/programs`, { departmentId: deptId, name: 'Synthetic Tenant Help', site: 'Site D' });
    assert.equal(created.status, 201);
    const program = created.body.program;
    assert.deepEqual([program.departmentId, program.lifecycleStatus], [deptId, 'ACTIVE']);
    assert.ok((await offered()).includes(program.programId), 'a new Program is offered for new referrals');

    // Creating a Program does not make the administrator its manager.
    assert.equal((await admin.get(`${PM}/programs/${program.programId}`)).status, 403);

    // QCH assigns receiving staff (grants are administered outside this
    // app slice); then referrals flow to the new Program.
    const NEW_INTAKE = INTAKE;
    store._grants.push(grant(NEW_INTAKE, 'VIEW_RECEIVED_REFERRAL', program.programId), grant(NEW_INTAKE, 'RESPOND_TO_REFERRAL', program.programId));
    const early = await worker.post('/api/referrals', referralTo(program.programId));
    assert.equal(early.status, 201);
    const earlyId = early.body.referral.referralId;
    assert.equal(store._referrals.find((r) => r.referralId === earlyId).receivingDepartmentId, deptId);

    // The Department cannot be discontinued while it has an active Program (PRD 4.4).
    const deptVersion = dept.body.department.version;
    const blocked = await admin.post(`${PM}/departments/${deptId}/discontinue`, { version: deptVersion });
    assert.deepEqual([blocked.status, blocked.body.code], [409, 'DEPARTMENT_HAS_ACTIVE_PROGRAMS']);

    // Move the Program to Adult Services. A move from an old screen is refused.
    const moved = await admin.post(`${PM}/programs/${program.programId}/move`, { version: program.version, departmentId: D_ADULT });
    assert.equal(moved.body.status, 'MOVED');
    const staleMove = await admin.post(`${PM}/programs/${program.programId}/move`, { version: program.version, departmentId: deptId });
    assert.deepEqual([staleMove.status, staleMove.body.code], [409, 'PROGRAM_CHANGED']);

    // History: the earlier referral keeps the Department it was made under;
    // a new one uses the current Department (PRD 9.1; reports by Department
    // at creation are checked in reportingJourney.test.js).
    const later = await worker.post('/api/referrals', referralTo(program.programId));
    const departmentOf = (referralId) => store._referrals.find((r) => r.referralId === referralId).receivingDepartmentId;
    assert.deepEqual([departmentOf(earlyId), departmentOf(later.body.referral.referralId)], [deptId, D_ADULT]);
    const queue = await as(NEW_INTAKE).get(`/api/referrals/received?programId=${program.programId}`);
    assert.deepEqual(queue.body.referrals.map((r) => r.referralId).sort((a, b) => a - b), [earlyId, later.body.referral.referralId]);

    // Now the empty Department can be discontinued; the moved Program keeps running.
    const off = await admin.post(`${PM}/departments/${deptId}/discontinue`, { version: deptVersion });
    assert.equal(off.body.status, 'DISCONTINUED');
    assert.ok((await offered()).includes(program.programId));
    const intoClosed = await admin.post(`${PM}/programs`, { departmentId: deptId, name: 'Synthetic Too Late' });
    assert.deepEqual([intoClosed.status, intoClosed.body.code], [409, 'DEPARTMENT_NOT_ACTIVE']);
    const moveBack = await admin.post(`${PM}/programs/${program.programId}/move`, { version: moved.body.program.version, departmentId: deptId });
    assert.deepEqual([moveBack.status, moveBack.body.code], [409, 'DEPARTMENT_NOT_ACTIVE']);

    // A rename from an old screen is refused with the current Department.
    const staleRename = await admin.patch(`${PM}/departments/${deptId}`, { version: deptVersion, name: 'Synthetic Renamed' });
    assert.deepEqual([staleRename.status, staleRename.body.code], [409, 'DEPARTMENT_CHANGED']);
    assert.equal(staleRename.body.current.lifecycleStatus, 'DISCONTINUED');

    // Reactivate; the list shows the counts the screens use.
    const on = await admin.post(`${PM}/departments/${deptId}/reactivate`, { version: off.body.department.version });
    assert.equal(on.body.status, 'REACTIVATED');
    const list = await admin.get(`${PM}/departments`);
    const row = list.body.departments.find((d) => d.departmentId === deptId);
    assert.deepEqual([row.lifecycleStatus, row.activeProgramCount, row.programCount], ['ACTIVE', 0, 0]);
    assert.equal(list.body.departments.find((d) => d.departmentId === D_ADULT).activeProgramCount, 4);

    // Audit: every change by the administrator, with before and after (PRD 9.6).
    assert.deepEqual(auditOf(store, 'DEPARTMENT', deptId).map((e) => [e.action, e.actorUserId]), [
      ['CREATED', ORG_ADMIN], ['DISCONTINUED', ORG_ADMIN], ['REACTIVATED', ORG_ADMIN],
    ]);
    const programEvents = auditOf(store, 'PROGRAM', program.programId);
    assert.deepEqual(programEvents.map((e) => e.action), ['CREATED', 'UPDATED']);
    assert.deepEqual([programEvents[1].before, programEvents[1].after], [{ department_id: deptId }, { department_id: D_ADULT }]);

    // Routing details are never returned by organization screens (PRD 10.5).
    for (const res of responses.filter((r) => r.req.path.startsWith(PM))) {
      assert.ok(!JSON.stringify(res.body ?? {}).includes('notification'), res.req.path);
    }
    noStore(responses, PM);
  });
});

describe('Journey 13: Program Management changes reach Find a Program; referral history does not move (Task AA; PRD 4.1 to 4.4, 6.5, 8.7, 9.1, 9.4, 9.6)', () => {
  const PM = '/api/program-management';
  // Employment, ages 19 to 20, ZIP 99918: P11 and P12 plausible, P13 possible.
  const ANSWERS = { needCategoryIds: [EMPLOYMENT], ageRange: { min: 19, max: 20 }, participantZip: '99918' };
  const DAY = 24 * 60 * 60 * 1000;

  const shown = (body, programId) => [...body.plausible, ...body.possible].find((p) => p.programId === programId);
  const infoOf = (body, programId) => shown(body, programId)?.programInformation;
  const valueOf = (info, label) => info.find((f) => f.label === label)?.value;
  // What matching decided, without the descriptive information.
  const decision = (body) => ({
    plausible: body.plausible.map(({ programInformation, ...rest }) => rest),
    possible: body.possible.map(({ programInformation, ...rest }) => rest),
  });

  test('current information, language, availability and contact reach Find a Program; sent referrals stay exactly as they were', async () => {
    let clock = Date.parse('2026-10-01T12:00:00Z');
    const { store, as, responses } = startApp({ now: () => new Date(clock) });
    const worker = as(WORKER);
    const intake = as(INTAKE);
    const director = as(DIRECTOR);
    const director12 = as(DIRECTOR_12);
    await chooseAffiliation(worker, P_FAMILY);
    const find = async () => {
      const res = await worker.post('/api/gpme/match', ANSWERS);
      assert.equal(res.status, 200);
      return res.body;
    };
    const fieldsOf = async (programId) => (await director.get(`${PM}/programs/${programId}/fields`)).body.fields;
    const setValue = async (user, programId, fieldId, value) => {
      const field = (await fieldsOf(programId)).find((f) => f.fieldId === fieldId);
      return user.put(`${PM}/programs/${programId}/field-values/${fieldId}`, { version: field.applicability.version, value });
    };

    // Before any change: nothing on file is an empty list, never "available".
    const baseline = await find();
    assert.deepEqual(infoOf(baseline, P_ADULT_ED), []);

    // Referrals sent before the changes: one guided to P11, one direct to P12.
    const guidedSent = await worker.post('/api/referrals', referralTo(P_ADULT_ED, { gpme: ANSWERS }));
    const directSent = await worker.post('/api/referrals', referralTo(P_YOUTH));
    assert.deepEqual([guidedSent.status, directSent.status], [201, 201]);
    const sentIds = [guidedSent.body.referral.referralId, directSent.body.referral.referralId];
    const history = async () => ({
      rows: JSON.stringify(store._referrals),
      evaluations: JSON.stringify(store._gpmeEvaluations),
      referralAudit: JSON.stringify(store._referralAuditEvents.filter((e) => e.entityType === 'REFERRAL')),
      senderViews: await Promise.all(sentIds.map(async (id) => (await worker.get(`/api/referrals/${id}`)).body)),
      receiverView: (await intake.get(`/api/referrals/${sentIds[0]}`)).body,
      sentList: (await worker.get('/api/referrals/sent')).body,
    });
    const before = await history();

    // The Director maintains P11's current information (Program Management).
    const create = async (body) => {
      const res = await director.post(`${PM}/programs/${P_ADULT_ED}/fields`, { isRequired: false, ...body });
      assert.equal(res.status, 201, body.label);
      return res.body.field;
    };
    const languages = await create({ label: 'Languages offered', dataType: 'MULTI_SELECT', displayOrder: 1,
      options: ['Synthetic English', 'Synthetic Spanish', 'Synthetic Mandarin'] });
    const availability = await create({ label: 'Current availability', dataType: 'SINGLE_SELECT', displayOrder: 2,
      options: ['Synthetic open', 'Synthetic limited', 'Synthetic wait list'] });
    const contact = await create({ label: 'Primary Program contact', dataType: 'TEXT', displayOrder: 3 });
    const waitList = await create({ label: 'Wait-list information', dataType: 'TEXT', displayOrder: 4 });
    const [english, spanish] = languages.options.map((o) => o.optionId);
    const waitListed = availability.options[2];
    assert.equal((await setValue(director, P_ADULT_ED, languages.fieldId, [english, spanish])).status, 200);
    assert.equal((await setValue(director, P_ADULT_ED, availability.fieldId, waitListed.optionId)).status, 200);
    assert.equal((await setValue(director, P_ADULT_ED, contact.fieldId, 'Synthetic intake desk, ext. 000')).status, 200);
    const program = (await director.get(`${PM}/programs/${P_ADULT_ED}`)).body.program;
    assert.equal((await director.patch(`${PM}/programs/${P_ADULT_ED}`, { version: program.version, site: 'Synthetic Site B2' })).status, 200);

    // Find a Program shows it. A wait-listed Program is still found, with
    // the same matching decision; missing information stays unknown.
    const afterEdits = await find();
    const info = infoOf(afterEdits, P_ADULT_ED);
    assert.deepEqual(info.map((f) => f.label), ['Languages offered', 'Current availability', 'Primary Program contact', 'Wait-list information']);
    assert.equal(valueOf(info, 'Languages offered'), 'Synthetic English, Synthetic Spanish');
    assert.equal(valueOf(info, 'Current availability'), 'Synthetic wait list');
    assert.equal(valueOf(info, 'Primary Program contact'), 'Synthetic intake desk, ext. 000');
    assert.equal(valueOf(info, 'Wait-list information'), null, 'nothing on file stays unknown');
    assert.equal(shown(afterEdits, P_ADULT_ED).site, 'Synthetic Site B2');
    assert.deepEqual(infoOf(afterEdits, P_YOUTH), [], 'another Program is not affected');
    const withoutSite = (d) => JSON.stringify(d).replaceAll('Synthetic Site B2', 'Site B');
    assert.equal(withoutSite(decision(afterEdits)), withoutSite(decision(baseline)), 'information never changes who is found');

    // Authorization: only P11's Program managers may change P11's information.
    const snapshot = JSON.stringify(infoOf(afterEdits, P_ADULT_ED));
    const contactField = (await fieldsOf(P_ADULT_ED)).find((f) => f.fieldId === contact.fieldId);
    const attempt = { version: contactField.applicability.version, value: 'Synthetic unauthorized text' };
    for (const [userId, status] of [[DIRECTOR_12, 403], [WORKER, 403], [INTAKE, 403], [LEFT, 403]]) {
      const res = await as(userId).put(`${PM}/programs/${P_ADULT_ED}/field-values/${contact.fieldId}`, attempt);
      assert.equal(res.status, status, `user ${userId}`);
    }
    assert.equal((await as(null).put(`${PM}/programs/${P_ADULT_ED}/field-values/${contact.fieldId}`, attempt)).status, 401);
    assert.equal(JSON.stringify(infoOf(await find(), P_ADULT_ED)), snapshot, 'refused changes are not shown');

    // Stale update: a second screen still showing the old version is refused;
    // Find a Program keeps showing what is saved.
    assert.equal((await director.put(`${PM}/programs/${P_ADULT_ED}/field-values/${contact.fieldId}`,
      { version: contactField.applicability.version, value: 'Synthetic front desk' })).status, 200);
    const stale = await director.put(`${PM}/programs/${P_ADULT_ED}/field-values/${contact.fieldId}`,
      { version: contactField.applicability.version, value: 'Synthetic old screen text' });
    assert.equal(stale.status, 409);
    assert.equal(valueOf(infoOf(await find(), P_ADULT_ED), 'Primary Program contact'), 'Synthetic front desk');

    // Lifecycle (PRD 4.3):
    // - a rename keeps identity and value;
    const renamed = await director.patch(`${PM}/fields/${availability.fieldId}`,
      { version: availability.version, label: 'Availability this cycle' });
    assert.equal(renamed.status, 200);
    // - a discontinued option stays where it was selected;
    assert.equal((await director.post(`${PM}/fields/${availability.fieldId}/options/${waitListed.optionId}/discontinue`,
      { version: waitListed.version })).status, 200);
    let current = infoOf(await find(), P_ADULT_ED);
    assert.equal(valueOf(current, 'Availability this cycle'), 'Synthetic wait list');
    assert.equal(valueOf(current, 'Current availability'), undefined);
    // - a discontinued field leaves Find a Program but keeps its value as history;
    const discontinued = await director.post(`${PM}/fields/${contact.fieldId}/discontinue`, { version: contact.version });
    assert.equal(discontinued.status, 200);
    current = infoOf(await find(), P_ADULT_ED);
    assert.equal(valueOf(current, 'Primary Program contact'), undefined);
    const kept = (await fieldsOf(P_ADULT_ED)).find((f) => f.fieldId === contact.fieldId);
    assert.deepEqual([kept.lifecycleStatus, kept.value], ['DISCONTINUED', 'Synthetic front desk']);
    // - retiring is refused until the review period has passed, then the
    //   field stays out of Find a Program and its value stays as history.
    const tooSoon = await as(ORG_ADMIN).post(`${PM}/fields/${contact.fieldId}/retire`, { version: discontinued.body.field.version });
    assert.equal(tooSoon.body.code, 'RETIRE_NOT_YET');
    clock += 91 * DAY;
    const retired = await as(ORG_ADMIN).post(`${PM}/fields/${contact.fieldId}/retire`, { version: discontinued.body.field.version });
    assert.equal(retired.status, 200);
    assert.equal(valueOf(infoOf(await find(), P_ADULT_ED), 'Primary Program contact'), undefined);
    const retiredRow = (await fieldsOf(P_ADULT_ED)).find((f) => f.fieldId === contact.fieldId);
    assert.deepEqual([retiredRow.lifecycleStatus, retiredRow.value], ['RETIRED', 'Synthetic front desk']);

    // A discontinued Program leaves Find a Program; its referrals remain.
    const p12 = (await director12.get(`${PM}/programs/${P_YOUTH}`)).body.program;
    assert.equal((await director12.post(`${PM}/programs/${P_YOUTH}/discontinue`, { version: p12.version })).status, 200);
    assert.equal(shown(await find(), P_YOUTH), undefined);

    // Every change is audited to the person who made it (PRD 9.6).
    const actors = new Set(store._referralAuditEvents
      .filter((e) => e.entityType !== 'REFERRAL' && e.entityType !== 'USER').map((e) => e.actorUserId));
    assert.deepEqual([...actors].sort((a, b) => a - b), [DIRECTOR, DIRECTOR_12, ORG_ADMIN].sort((a, b) => a - b));

    // History: referrals sent before the changes are byte-for-byte the same,
    // as are their GPME evaluation (what was shown then), their audit trail,
    // and what the sender and receiver see.
    const after = await history();
    assert.equal(after.rows, before.rows, 'referral records unchanged');
    assert.equal(after.evaluations, before.evaluations, 'the saved recommendation context is unchanged');
    assert.equal(after.referralAudit, before.referralAudit, 'no referral audit entries were added');
    assert.deepEqual(after.senderViews, before.senderViews);
    assert.deepEqual(after.receiverView, before.receiverView);
    assert.deepEqual(after.sentList, before.sentList);

    // New referrals use the current information; old ones keep theirs.
    const later = await worker.post('/api/referrals', referralTo(P_ADULT_ED, { gpme: ANSWERS }));
    assert.equal(later.status, 201, 'availability information does not block a referral');
    assert.equal((await worker.post('/api/referrals', referralTo(P_YOUTH))).body.code, 'RECEIVING_PROGRAM_NOT_SELECTABLE');
    noStore(responses, '/api/');
  });
});
