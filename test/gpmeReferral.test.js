// GPME-assisted referral submission (Trello card 11): the guided path
// converges on the same canonical referral pipeline as Direct Referral
// (Final Technical PRD 2.1, 2.2, 5.3, 8.1, 8.5, 8.7, 8.8, 9.1, 10.3).
// All data is SYNTHETIC: made-up Programs and ZIP codes from outside New
// York, the same shapes as test/gpme.test.js (PRD 15.5).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
import { createReferralService } from '../src/referrals/referralService.js';
import { createGpmeService } from '../src/gpme/gpmeService.js';
import { MAX_BODY_BYTES, LIMITS } from '../src/referrals/validateReferral.js';
import { MAX_NEED_CATEGORIES } from '../src/gpme/validateMatchRequest.js';

const FOOD = 1;
const EMPLOYMENT = 2;
const RETIRED_NEED = 9;

const NEED_CATEGORIES = [
  { needCategoryId: FOOD, name: 'Food', lifecycleStatus: 'ACTIVE' },
  { needCategoryId: EMPLOYMENT, name: 'Employment', lifecycleStatus: 'ACTIVE' },
  { needCategoryId: RETIRED_NEED, name: 'Old category', lifecycleStatus: 'DISCONTINUED' },
];

const DEPARTMENTS = [
  { departmentId: 1, name: 'Synthetic Department A', lifecycleStatus: 'ACTIVE' },
  { departmentId: 2, name: 'Synthetic Department B', lifecycleStatus: 'ACTIVE' },
];

const NONE = { serviceAreaState: 'NO_RESTRICTION', serviceAreaZips: [] };
const NO_AGE = { ageLimitState: 'NO_RESTRICTION', ageMin: null, ageMax: null };

const PROGRAMS = [
  { programId: 1, departmentId: 1, name: 'Synthetic Food Program', site: 'Site A', lifecycleStatus: 'ACTIVE',
    needCategoryIds: [FOOD], ...NO_AGE, ...NONE },
  { programId: 2, departmentId: 2, name: 'Synthetic Job Training', site: null, lifecycleStatus: 'ACTIVE',
    needCategoryIds: [EMPLOYMENT], ageLimitState: 'SET', ageMin: 18, ageMax: 24,
    serviceAreaState: 'SET', serviceAreaZips: ['99901', '99902'] },
  { programId: 3, departmentId: 2, name: 'Synthetic Youth Jobs', site: null, lifecycleStatus: 'ACTIVE',
    needCategoryIds: [EMPLOYMENT], ageLimitState: 'SET', ageMin: 16, ageMax: 21, ...NONE },
  { programId: 4, departmentId: 2, name: 'Synthetic Trades', site: null, lifecycleStatus: 'ACTIVE',
    needCategoryIds: [EMPLOYMENT], ageLimitState: 'NOT_ON_FILE', ageMin: null, ageMax: null, ...NONE },
  { programId: 7, departmentId: 1, name: 'Synthetic Closed Pantry', site: null, lifecycleStatus: 'DISCONTINUED',
    needCategoryIds: [FOOD], ...NO_AGE, ...NONE },
];

const USER = 100;
const USERS = [{ userId: USER, isActive: true, currentProgramId: 1 }];

// The worker's matching answers (T2 in the GPME Decision Proposal):
// Employment, ages 19 to 20, ZIP 99901 -> P2, P3 plausible; P4 possible.
const ANSWERS = { needCategoryIds: [EMPLOYMENT], ageRange: { min: 19, max: 20 }, participantZip: '99901' };

function newStore() {
  return createMemoryReferralStore({
    departments: DEPARTMENTS, programs: PROGRAMS, users: USERS, needCategories: NEED_CATEGORIES,
  });
}

function appFor(store) {
  return createApp({ affiliationStore: store, referralStore: store, resolveIdentity: () => ({ userId: USER }) });
}

function referralBody(receivingProgramId, extra = {}) {
  return {
    submissionId: randomUUID(),
    receivingProgramId,
    participantName: 'Synthetic Person Gamma',
    contactMethod: 'NOT_AVAILABLE',
    referralContext: 'Synthetic context',
    ...extra,
  };
}

const guided = (receivingProgramId, answers = ANSWERS, extra = {}) =>
  referralBody(receivingProgramId, { gpme: answers, ...extra });

function nothingSaved(store) {
  assert.equal(store._referrals.length, 0, 'no referral');
  assert.equal(store._gpmeEvaluations.length, 0, 'no evaluation');
  assert.equal(store._referralAuditEvents.length, 0, 'no audit event');
}

describe('GPME-assisted submission converges on the referral pipeline', () => {
  test('a recommended Program is saved as GPME_ASSISTED with its evaluation', async () => {
    const store = newStore();
    const res = await request(appFor(store)).post('/api/referrals').send(guided(2));
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'RECEIVED');
    // Same minimum-necessary confirmation as Direct Referral (PRD 10.5).
    assert.deepEqual(Object.keys(res.body.referral).sort(),
      ['createdAt', 'receivingProgramId', 'referralId', 'referringProgramId', 'responseStatus', 'submissionId']);

    const [row] = store._referrals;
    assert.equal(row.source, 'GPME_ASSISTED');
    assert.equal(row.responseStatus, 'AWAITING_RESPONSE');
    assert.equal(row.decision, null);
    assert.equal(row.serviceOutcome, 'NOT_RECORDED');
    assert.equal(row.referringProgramId, 1, 'Referring Program still comes from affiliation');
    assert.equal(row.receivingDepartmentId, 2);

    const evaluation = await store.getGpmeEvaluation(row.gpmeEvaluationId);
    assert.equal(evaluation.ruleVersion, 'gpme-v1');
    assert.deepEqual(evaluation.results.map((r) => [r.programId, r.displayOrder, r.programContext.group, r.wasSelected]), [
      [2, 1, 'PLAUSIBLE', true],
      [3, 2, 'PLAUSIBLE', false],
      [4, 3, 'POSSIBLE', false],
    ]);
  });

  test('the saved explanations are exactly what GPME showed the worker', async () => {
    const store = newStore();
    const shown = await createGpmeService({ store, logFailure: () => {} }).match(USER, ANSWERS);
    await request(appFor(store)).post('/api/referrals').send(guided(2));
    const evaluation = await store.getGpmeEvaluation(store._referrals[0].gpmeEvaluationId);

    const listed = [...shown.plausible, ...shown.possible];
    assert.deepEqual(evaluation.results.map((r) => r.programContext.explanations), listed.map((p) => p.explanations));
    assert.deepEqual(evaluation.results.map((r) => r.explanation), listed.map((p) => p.explanations.join('; ')));
    assert.deepEqual(evaluation.results[0].programContext, {
      group: 'PLAUSIBLE', programName: 'Synthetic Job Training', site: null,
      departmentId: 2, departmentName: 'Synthetic Department B',
      explanations: ['Offers: Employment', 'Serves ages 18 to 24', 'Serves listed ZIP codes'],
    });
  });

  test('a "possible" Program can be chosen too', async () => {
    const store = newStore();
    const res = await request(appFor(store)).post('/api/referrals').send(guided(4));
    assert.equal(res.status, 201);
    const evaluation = await store.getGpmeEvaluation(store._referrals[0].gpmeEvaluationId);
    assert.deepEqual(evaluation.results.filter((r) => r.wasSelected).map((r) => [r.programId, r.programContext.group]),
      [[4, 'POSSIBLE']]);
  });

  test('matching answers are never stored or audited (PRD 5.3, 8.7)', async () => {
    const store = newStore();
    const answers = { needCategoryIds: [EMPLOYMENT], ageRange: { min: 19, max: 20 }, participantZip: '99902' };
    await request(appFor(store)).post('/api/referrals').send(guided(2, answers));

    const saved = JSON.stringify(store._gpmeEvaluations) + JSON.stringify(store._referralAuditEvents);
    for (const value of ['99902', 'ageRange', 'participantZip', 'needCategoryIds', '"min"', '"max"']) {
      assert.ok(!saved.includes(value), value);
    }
    const [row] = store._referrals;
    assert.equal(row.participantZip, null, 'the referral ZIP is only what the referral form sent');
    assert.ok(!('gpme' in row));
  });

  test('the audit event records the source, evaluation and rule version only', async () => {
    const store = newStore();
    await request(appFor(store)).post('/api/referrals').send(guided(3));
    const [event] = store._referralAuditEvents;
    assert.deepEqual(event.after, {
      source: 'GPME_ASSISTED',
      gpme_evaluation_id: store._referrals[0].gpmeEvaluationId,
      gpme_rule_version: 'gpme-v1',
      referring_program_id: 1,
      receiving_program_id: 3,
      referring_department_id: 1,
      receiving_department_id: 2,
    });
  });

  test('Direct Referral is unchanged: source DIRECT, no evaluation', async () => {
    const store = newStore();
    const res = await request(appFor(store)).post('/api/referrals').send(referralBody(2));
    assert.equal(res.status, 201);
    assert.equal(store._referrals[0].source, 'DIRECT');
    assert.equal(store._referrals[0].gpmeEvaluationId, null);
    assert.equal(store._gpmeEvaluations.length, 0);
    assert.equal(store._referralAuditEvents[0].after.source, 'DIRECT');
    assert.ok(!('gpme_evaluation_id' in store._referralAuditEvents[0].after));
  });

  test('the same answers give the same saved evaluation every time (PRD 8.4)', async () => {
    const store = newStore();
    const app = appFor(store);
    await request(app).post('/api/referrals').send(guided(2));
    await request(app).post('/api/referrals').send(guided(2));
    const [a, b] = store._gpmeEvaluations;
    assert.notEqual(a.evaluationId, b.evaluationId, 'one evaluation per referral');
    assert.deepEqual(a.results, b.results);
  });
});

describe('the server never trusts a recommendation it cannot reproduce', () => {
  test('a Program GPME did not list -> 409 GPME_RESULT_CHANGED, nothing saved', async () => {
    const store = newStore();
    // P1 offers Food only; the answers ask for Employment.
    const res = await request(appFor(store)).post('/api/referrals').send(guided(1));
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'GPME_RESULT_CHANGED');
    assert.equal(res.body.error, 'The matching results changed after your search. Nothing was sent. Review the current results.');
    nothingSaved(store);
  });

  test('Program information changed after the search -> 409, nothing saved', async () => {
    const store = newStore();
    const app = appFor(store);
    const before = await request(app).post('/api/gpme/match').send(ANSWERS);
    assert.ok(before.body.plausible.some((p) => p.programId === 3));

    await store.updateProgramMatchingFacts({ programId: 3, ageLimitState: 'SET', ageMin: 30, ageMax: 40 });
    const res = await request(app).post('/api/referrals').send(guided(3));
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'GPME_RESULT_CHANGED');
    nothingSaved(store);
  });

  test('a Program moved from plausible to possible is still accepted, and saved as possible', async () => {
    const store = newStore();
    await store.updateProgramMatchingFacts({ programId: 3, ageLimitState: 'NOT_ON_FILE', ageMin: null, ageMax: null });
    const res = await request(appFor(store)).post('/api/referrals').send(guided(3));
    assert.equal(res.status, 201);
    const evaluation = await store.getGpmeEvaluation(store._referrals[0].gpmeEvaluationId);
    assert.equal(evaluation.results.find((r) => r.wasSelected).programContext.group, 'POSSIBLE');
  });

  test('matching unavailable at submission -> 503 GPME_UNAVAILABLE, never "result changed"', async () => {
    const store = newStore();
    store._failMatching();
    const logged = [];
    const service = createReferralService({ store, logGpmeFailure: (err) => logged.push(err) });
    await assert.rejects(service.createDirectReferral(USER, guided(2)), (err) => {
      assert.equal(err.status, 503);
      assert.equal(err.code, 'GPME_UNAVAILABLE');
      assert.equal(err.message, 'Matching could not be confirmed, so the referral was not saved.');
      return true;
    });
    assert.equal(logged.length, 1);
    nothingSaved(store);
  });

  test('over HTTP the 503 is a fixed body and the log line holds no request data', async () => {
    const store = newStore();
    store._failMatching();
    const lines = [];
    const original = console.error;
    console.error = (...args) => lines.push(args.join(' '));
    let res;
    try {
      res = await request(appFor(store)).post('/api/referrals')
        .send(guided(2, { ...ANSWERS, participantZip: '99902' }, { participantName: 'Synthetic Marker Zeta' }));
    } finally {
      console.error = original;
    }
    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { error: 'Matching could not be confirmed, so the referral was not saved.', code: 'GPME_UNAVAILABLE' });
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.deepEqual(lines, ['[referrals] GPME re-check unavailable (Error)']);
    nothingSaved(store);
  });

  test('a discontinued receiving Program is refused before matching runs', async () => {
    const store = newStore();
    const res = await request(appFor(store)).post('/api/referrals')
      .send(guided(7, { needCategoryIds: [FOOD] }));
    assert.equal(res.status, 422);
    assert.equal(res.body.code, 'RECEIVING_PROGRAM_NOT_SELECTABLE');
    nothingSaved(store);
  });

  test('a failure after matching rolls back the evaluation with the referral', async () => {
    const store = newStore();
    store._failNextAudit();
    const res = await request(appFor(store)).post('/api/referrals').send(guided(2));
    assert.equal(res.status, 500);
    nothingSaved(store);
  });
});

describe('GPME part of the request is validated like the match request', () => {
  test('unknown, inactive or missing need categories -> 400 naming only "gpme"', async () => {
    const app = appFor(newStore());
    for (const answers of [
      { needCategoryIds: [RETIRED_NEED] },
      { needCategoryIds: [12345] },
      { needCategoryIds: [] },
      { ageRange: { min: 19, max: 20 } },
      { needCategoryIds: [EMPLOYMENT], ageRange: { min: 30, max: 20 } },
      { needCategoryIds: [EMPLOYMENT], participantZip: '9990' },
      'Employment',
      [EMPLOYMENT],
    ]) {
      const res = await request(app).post('/api/referrals').send(guided(2, answers));
      assert.equal(res.status, 400, JSON.stringify(answers));
      assert.equal(res.body.code, 'INVALID_REQUEST');
      assert.deepEqual(res.body.fields, ['gpme']);
    }
  });

  test('hidden factors cannot ride along inside gpme; names are never echoed (PRD 8.2, 10.4)', async () => {
    const store = newStore();
    const app = appFor(store);
    for (const answers of [
      { ...ANSWERS, notes: 'Synthetic note' },
      { ...ANSWERS, referralContext: 'Synthetic context' },
      { ...ANSWERS, workerId: USER },
      { ...ANSWERS, ageRange: { min: 19, max: 20, exact: 19 } },
      { ...ANSWERS, 'Synthetic Secret Name': 1 },
    ]) {
      const res = await request(app).post('/api/referrals').send(guided(2, answers));
      assert.equal(res.status, 400);
      assert.deepEqual(res.body, { error: 'The request contains a field that is not allowed.', code: 'UNEXPECTED_FIELD' });
    }
    nothingSaved(store);
  });

  test('the browser cannot set source or an evaluation itself (PRD 10.3)', async () => {
    const store = newStore();
    const app = appFor(store);
    for (const extra of [{ source: 'GPME_ASSISTED' }, { gpmeEvaluationId: 1 }, { source: 'DIRECT' }]) {
      const res = await request(app).post('/api/referrals').send(referralBody(2, extra));
      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'UNEXPECTED_FIELD');
    }
    nothingSaved(store);
  });

  test('gpme: null is the same as Direct Referral', async () => {
    const store = newStore();
    const res = await request(appFor(store)).post('/api/referrals').send(referralBody(2, { gpme: null }));
    assert.equal(res.status, 201);
    assert.equal(store._referrals[0].source, 'DIRECT');
  });

  test('the largest valid referral plus the largest gpme part fits the body limit', async () => {
    const store = newStore();
    const huge = (n) => '\u{1F600}'.repeat(n / 2); // 2 code units each
    const body = guided(2, { needCategoryIds: Array.from({ length: MAX_NEED_CATEGORIES }, (_, i) => Number.MAX_SAFE_INTEGER - i),
      ageRange: { min: 0, max: 120 }, participantZip: '99901' }, {
      participantName: huge(LIMITS.participantName),
      referralContext: huge(LIMITS.referralContext),
      notes: huge(LIMITS.notes),
      contactMethod: 'EMAIL',
      contactValue: `${'a'.repeat(LIMITS.contactValue - 12)}@example.com`,
    });
    // Worst-case encoding: every non-ASCII character as a \uXXXX escape, pretty-printed.
    const json = JSON.stringify(body, null, 2).replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    assert.ok(Buffer.byteLength(json) <= MAX_BODY_BYTES, `${Buffer.byteLength(json)} <= ${MAX_BODY_BYTES}`);
    const res = await request(appFor(store)).post('/api/referrals').set('Content-Type', 'application/json').send(json);
    // Reaches validation (the unknown categories are refused), not the size limit.
    assert.equal(res.status, 400);
    assert.deepEqual(res.body.fields, ['gpme']);
  });
});

describe('retries keep one referral per logical submission (PRD 7.3)', () => {
  test('the same GPME-assisted request again -> ALREADY_RECEIVED, one evaluation', async () => {
    const store = newStore();
    const app = appFor(store);
    const body = guided(2);
    const first = await request(app).post('/api/referrals').send(body);
    const second = await request(app).post('/api/referrals').send(body);
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(second.body.status, 'ALREADY_RECEIVED');
    assert.equal(second.body.referral.referralId, first.body.referral.referralId);
    assert.equal(store._gpmeEvaluations.length, 1);
  });

  test('a retry after Program information changed still answers ALREADY_RECEIVED', async () => {
    const store = newStore();
    const app = appFor(store);
    const body = guided(3);
    await request(app).post('/api/referrals').send(body);
    await store.updateProgramMatchingFacts({ programId: 3, ageLimitState: 'SET', ageMin: 30, ageMax: 40 });
    const again = await request(app).post('/api/referrals').send(body);
    assert.equal(again.status, 200);
    assert.equal(again.body.status, 'ALREADY_RECEIVED');
  });

  test('switching path under the same Submission ID is a conflict, both ways', async () => {
    const store = newStore();
    const app = appFor(store);
    const asGuided = guided(2);
    await request(app).post('/api/referrals').send(asGuided);
    const { gpme, ...asDirect } = asGuided;
    const conflict = await request(app).post('/api/referrals').send(asDirect);
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.code, 'SUBMISSION_ID_CONFLICT');

    const direct = referralBody(2);
    await request(app).post('/api/referrals').send(direct);
    const conflict2 = await request(app).post('/api/referrals').send({ ...direct, gpme: ANSWERS });
    assert.equal(conflict2.status, 409);
    assert.equal(conflict2.body.code, 'SUBMISSION_ID_CONFLICT');
    assert.equal(store._referrals.length, 2);
  });

  test('after GPME_RESULT_CHANGED the same Submission ID can be sent again', async () => {
    const store = newStore();
    const app = appFor(store);
    const body = guided(1);
    assert.equal((await request(app).post('/api/referrals').send(body)).status, 409);
    // The worker re-searches with Food and keeps the same logical submission.
    const res = await request(app).post('/api/referrals').send({ ...body, gpme: { needCategoryIds: [FOOD] } });
    assert.equal(res.status, 201);
  });

  test('after GPME_UNAVAILABLE the worker can send the same Program as a Direct Referral', async () => {
    const store = newStore();
    const app = appFor(store);
    store._failMatching();
    const body = guided(2);
    assert.equal((await request(app).post('/api/referrals').send(body)).status, 503);
    const { gpme, ...direct } = body;
    const res = await request(app).post('/api/referrals').send(direct);
    assert.equal(res.status, 201);
    assert.equal(store._referrals[0].source, 'DIRECT');
  });
});
