// Trello Task KK: Direct Referral independence (Frozen Handoff PRD §3.4,
// §4.2, §6.5, §36; Handoff MVP Direct Referral).
//
//   PRD §4.2  Direct Referral must not require GPME. A GPME outage or
//             matching failure must not prevent an employee from using
//             Direct Referral.
//   PRD §3.4  After Program selection, both paths use the same
//             authoritative referral lifecycle.
//
// What was already covered: Journey 12 (workflowJourneys.test.js) runs the
// same lifecycle on both paths with GPME working and sends one Direct
// Referral while matching is down; e2e/gpme.spec.js sends one from the
// browser with /api/gpme blocked. Neither runs the WHOLE lifecycle with
// GPME down. This file does, with every GPME part down at once (the
// describe-the-need interpreter, need categories, matching, and the
// language list), and proves:
//   1. the outage is real (each GPME call reports a technical failure);
//   2. Direct Referral goes from send to notification, Awaiting Response,
//      response, service outcome, outcome correction, the sender's view
//      and aggregate reporting;
//   3. no GPME dependency is touched while it does (call counters);
//   4. the result is identical to the same journey with GPME working.
// A guided send during the outage fails honestly and saves nothing.
//
// Tests only: no product code changed. In-memory store; SYNTHETIC data.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createMemoryReferralStore } from '../../src/referrals/memoryReferralStore.js';

const WORKER = 100;      // sends referrals from P_SENDER
const INTAKE = 200;      // P_RECEIVER: view + respond
const OUTCOMES = 201;    // P_RECEIVER: view + record outcome
const SUPERVISOR = 202;  // P_RECEIVER: view + correct outcome
const P_SENDER = 10;
const P_RECEIVER = 11;
const EMPLOYMENT = 2;
const MARKER = 'Synthetic Person KK Independence';

const grant = (userId, permission) => ({
  userId, permission, scopeType: 'PROGRAM', programId: P_RECEIVER, departmentId: null, grantSource: 'IN_APP',
});
const NO_LIMITS = { ageLimitState: 'NO_RESTRICTION', ageMin: null, ageMax: null, serviceAreaState: 'NO_RESTRICTION', serviceAreaZips: [] };

// The integrated app. With gpmeDown, every GPME dependency fails. Either
// way, every GPME dependency is counted, so the Direct path can be shown
// never to touch one.
function startApp({ gpmeDown }) {
  const store = createMemoryReferralStore({
    departments: [{ departmentId: 1, name: 'Synthetic Department', lifecycleStatus: 'ACTIVE' }],
    programs: [
      { programId: P_SENDER, departmentId: 1, name: 'Synthetic Sending Program', site: null, lifecycleStatus: 'ACTIVE',
        needCategoryIds: [], ...NO_LIMITS },
      { programId: P_RECEIVER, departmentId: 1, name: 'Synthetic Receiving Program', site: null, lifecycleStatus: 'ACTIVE',
        needCategoryIds: [EMPLOYMENT], ...NO_LIMITS },
    ],
    needCategories: [{ needCategoryId: EMPLOYMENT, name: 'Employment', lifecycleStatus: 'ACTIVE' }],
    serviceLanguages: [{ languageId: 1, name: 'English', lifecycleStatus: 'ACTIVE' }],
    users: [WORKER, INTAKE, OUTCOMES, SUPERVISOR].map((userId) => ({
      userId, isActive: true, currentProgramId: userId === WORKER ? null : P_RECEIVER,
    })),
    grants: [
      grant(INTAKE, 'VIEW_RECEIVED_REFERRAL'), grant(INTAKE, 'RESPOND_TO_REFERRAL'),
      grant(OUTCOMES, 'VIEW_RECEIVED_REFERRAL'), grant(OUTCOMES, 'RECORD_OUTCOME'),
      grant(SUPERVISOR, 'VIEW_RECEIVED_REFERRAL'), grant(SUPERVISOR, 'CORRECT_OUTCOME'),
    ],
    notAppropriateReasons: [{ reasonId: 1, code: 'OTHER', label: 'Other', displayOrder: 1 }],
  });

  // Count every call into what GPME depends on.
  const gpmeCalls = { listNeedCategories: 0, listMatchablePrograms: 0, listServiceLanguages: 0, interpret: 0 };
  // Counted on the store AND inside every transaction (the referral code
  // reads through a transaction), so a hidden call whose failure is
  // swallowed is still seen.
  const GPME_READS = ['listNeedCategories', 'listMatchablePrograms', 'listServiceLanguages'];
  const counted = (target) => {
    for (const name of GPME_READS) {
      if (typeof target[name] !== 'function') continue;
      const real = target[name].bind(target);
      target[name] = (...args) => { gpmeCalls[name] += 1; return real(...args); };
    }
    return target;
  };
  counted(store);
  const realWithTransaction = store.withTransaction.bind(store);
  store.withTransaction = (work, ...rest) => realWithTransaction((tx) => work(counted(tx)), ...rest);
  const interpreter = {
    version: 'synthetic-kk-1',
    async interpret() {
      gpmeCalls.interpret += 1;
      if (gpmeDown) throw new Error('simulated interpreter outage');
      return { needCategoryIds: [EMPLOYMENT], ageRange: null, participantZip: null, notes: [], reasons: new Map() };
    },
  };
  if (gpmeDown) {
    store._failMatching(true);
    store._failLanguages(true);
  }

  // Notifier spy. It records each INVOCATION of the notifier, not an email:
  // no sender is attached here, so nothing is delivered. (One delivery per
  // referral, however often the notifier is invoked, is tested in
  // test/notificationWiring.test.js and test/regression/notificationFailure.test.js.)
  // At the moment of each invocation it also records whether the referral
  // and its CREATED audit record were already saved (PRD §21).
  const notified = [];
  const notifier = {
    async notifyReferralCommitted({ referralId }) {
      notified.push({
        referralId,
        savedBefore: store._referrals.some((r) => r.referralId === referralId)
          && store._referralAuditEvents.some((e) => e.entityType === 'REFERRAL' && e.entityId === referralId && e.action === 'CREATED'),
      });
    },
  };
  const invocationsFor = (referralId) => notified.filter((n) => n.referralId === referralId);

  let current = null;
  const app = createApp({
    affiliationStore: store, referralStore: store, nodeEnv: 'test', notifier,
    resolveIdentity: () => (current ? { userId: current } : null), gpmeInterpreter: interpreter,
  });
  const as = (userId) => ({
    get: (url) => { current = userId; return request(app).get(url); },
    post: (url, body) => { current = userId; return request(app).post(url).send(body); },
    put: (url, body) => { current = userId; return request(app).put(url).send(body); },
  });
  const resetCounts = () => { for (const key of Object.keys(gpmeCalls)) gpmeCalls[key] = 0; };
  return { store, as, gpmeCalls, resetCounts, notified, invocationsFor };
}

const waitFor = async (check, what) => {
  for (let i = 0; i < 100; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`timed out waiting for ${what}`);
};

const draft = (extra = {}) => ({
  submissionId: randomUUID(), receivingProgramId: P_RECEIVER, participantName: MARKER,
  contactMethod: 'NOT_AVAILABLE', referralContext: 'Synthetic context for Task KK', ...extra,
});

// Direct Referral from start to finish, the way the screens do it.
// Returns everything the two runs (GPME up / GPME down) must share.
async function directJourney(t) {
  const worker = t.as(WORKER);
  const me = await worker.get('/api/me/affiliation');
  assert.equal((await worker.put('/api/me/affiliation', { programId: P_SENDER, version: me.body.version })).status, 200);

  // The Program list the Direct Referral screen offers.
  const programs = await worker.get('/api/programs');
  assert.equal(programs.status, 200);
  assert.ok(programs.body.programs.some((p) => p.programId === P_RECEIVER), 'the receiving Program can be picked');

  // Send; a retry of the same submission saves nothing new (PRD §20).
  const body = draft();
  const sent = await worker.post('/api/referrals', body);
  assert.equal(sent.status, 201);
  const id = sent.body.referral.referralId;
  const retry = await worker.post('/api/referrals', body);
  assert.deepEqual([retry.status, retry.body.status, retry.body.referral.referralId], [200, 'ALREADY_RECEIVED', id]);
  assert.equal(t.store._referrals.length, 1, 'one referral, not two');
  const url = (suffix = '') => `/api/referrals/${id}${suffix}`;

  // The notifier is invoked for the send and again for its retry (by
  // design: the notification service, not this path, keeps it to one
  // delivery). Wait for BOTH invocations, and check that at each one the
  // referral and its CREATED audit record were already saved (PRD §21).
  await waitFor(() => t.invocationsFor(id).length === 2, 'both notifier invocations');
  assert.deepEqual(t.invocationsFor(id).map((n) => n.savedBefore), [true, true],
    'the referral was saved before each notifier invocation');

  // Awaiting Response in the receiving queue (PRD §16, §17).
  const queue = await t.as(INTAKE).get('/api/referrals/received');
  assert.equal(queue.status, 200);
  const queued = queue.body.referrals.find((r) => r.referralId === id);
  assert.equal(queued.stage, 'AWAITING_RESPONSE');

  // Response -> outcome -> outcome correction (PRD §17, §18, §19).
  assert.equal((await t.as(INTAKE).post(url('/response'), { decision: 'ACCEPTED' })).status, 200);
  const pending = await t.as(OUTCOMES).get(url());
  assert.equal(pending.body.referral.stage, 'ACCEPTED_OUTCOME_PENDING');
  const recorded = await t.as(OUTCOMES).post(url('/outcome'), { outcome: 'RESULTED_IN_SERVICE' });
  assert.equal(recorded.status, 200);
  const corrected = await t.as(SUPERVISOR).post(url('/outcome/correction'), {
    outcome: 'DID_NOT_RESULT_IN_SERVICE', version: recorded.body.referral.version,
  });
  assert.equal(corrected.status, 200);

  // The sender sees the result; reporting counts it (PRD §25).
  const senderView = await worker.get(url());
  assert.equal(senderView.status, 200);
  const activity = await worker.get('/api/reports/referral-activity?period=MONTHLY');
  assert.equal(activity.status, 200);

  const row = t.store._referrals.find((r) => r.referralId === id);
  return {
    source: row.source,
    gpmeEvaluationId: row.gpmeEvaluationId ?? null,
    evaluations: t.store._gpmeEvaluations.length,
    notifierInvocations: t.invocationsFor(id).length,
    decision: row.decision,
    serviceOutcome: row.serviceOutcome,
    senderStage: senderView.body.referral.stage,
    senderOutcome: senderView.body.referral.serviceOutcome,
    trail: t.store._referralAuditEvents
      .filter((e) => e.entityType === 'REFERRAL' && e.entityId === id)
      .map((e) => [e.action, e.actorUserId]),
    report: activity.body.summary,
  };
}

describe('Task KK: Direct Referral does not depend on GPME (PRD §3.4, §4.2)', () => {
  test('with every GPME part down, Direct Referral runs the whole lifecycle, the same as with GPME working', async () => {
    // 1. The outage is real: each GPME call reports a technical failure.
    const down = startApp({ gpmeDown: true });
    const worker = down.as(WORKER);
    const interpreted = await worker.post('/api/gpme/interpret', { text: 'Synthetic: looking for work' });
    assert.equal(interpreted.body.status, 'UNABLE_TO_INTERPRET');
    const categories = await worker.get('/api/gpme/need-categories');
    assert.deepEqual([categories.status, categories.body], [500, { error: 'Internal Server Error' }], 'need categories down');
    const matched = await worker.post('/api/gpme/match', { needCategoryIds: [EMPLOYMENT] });
    assert.deepEqual([matched.status, matched.body.status], [503, 'UNABLE_TO_MATCH']);
    assert.equal(down.store._referrals.length, 0);

    // 2 and 3. The whole Direct lifecycle, touching nothing GPME needs.
    down.resetCounts();
    const withoutGpme = await directJourney(down);
    assert.deepEqual(down.gpmeCalls, { listNeedCategories: 0, listMatchablePrograms: 0, listServiceLanguages: 0, interpret: 0 },
      'Direct Referral never touched a GPME dependency');

    // 4. Identical to the same journey with GPME working.
    const up = startApp({ gpmeDown: false });
    const withGpme = await directJourney(up);
    assert.deepEqual(up.gpmeCalls, { listNeedCategories: 0, listMatchablePrograms: 0, listServiceLanguages: 0, interpret: 0 },
      'even when GPME is available, Direct Referral does not call it');
    assert.deepEqual(withoutGpme, withGpme);

    // And the shared lifecycle is the one expected.
    assert.equal(withoutGpme.source, 'DIRECT');
    assert.equal(withoutGpme.gpmeEvaluationId, null);
    assert.equal(withoutGpme.evaluations, 0);
    // Notifier INVOCATIONS (send + retry), not emails: no sender is
    // attached here. The real notification service sends at most one
    // email per referral (test/notificationWiring.test.js).
    assert.equal(withoutGpme.notifierInvocations, 2);
    assert.deepEqual([withoutGpme.decision, withoutGpme.serviceOutcome], ['ACCEPTED', 'DID_NOT_RESULT_IN_SERVICE']);
    assert.deepEqual([withoutGpme.senderStage, withoutGpme.senderOutcome], ['COMPLETE', 'DID_NOT_RESULT_IN_SERVICE']);
    assert.deepEqual(withoutGpme.trail, [
      ['CREATED', WORKER], ['ACCEPTED', INTAKE], ['SERVICE_OUTCOME_RECORDED', OUTCOMES], ['CORRECTED', SUPERVISOR],
    ]);
    assert.equal(withoutGpme.report.totalReferrals, 1);
  });

  test('during the outage a guided send fails honestly and saves nothing, and the same referral sent Direct succeeds', async () => {
    const t = startApp({ gpmeDown: true });
    const worker = t.as(WORKER);
    const me = await worker.get('/api/me/affiliation');
    await worker.put('/api/me/affiliation', { programId: P_SENDER, version: me.body.version });

    const guided = draft({ gpme: { needCategoryIds: [EMPLOYMENT] } });
    const refused = await worker.post('/api/referrals', guided);
    assert.deepEqual([refused.status, refused.body.code], [503, 'GPME_UNAVAILABLE']);
    assert.equal(t.store._referrals.length, 0, 'a failed guided send saves nothing');
    assert.equal(t.notified.length, 0, 'and notifies no one');

    // The employee switches to Direct Referral with the same details.
    const { gpme, ...direct } = guided;
    const sent = await worker.post('/api/referrals', { ...direct, submissionId: randomUUID() });
    assert.equal(sent.status, 201);
    assert.equal(t.store._referrals.length, 1);
    assert.equal(t.store._referrals[0].source, 'DIRECT');
    await waitFor(() => t.notified.length === 1, 'one notifier invocation');
    assert.deepEqual(t.notified, [{ referralId: sent.body.referral.referralId, savedBefore: true }],
      'invoked once, for the Direct referral, after it was saved');
  });
});
