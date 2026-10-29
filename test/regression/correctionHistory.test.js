// Trello Task OO: correction-history regression (Frozen Handoff PRD §19,
// §17, §18, §26, §34; Handoff MVP §19).
//
//   PRD §19  Authorized corrections to decisions and service outcomes must
//            preserve historical values. The system must not silently
//            overwrite history. Audit evidence must show what changed, who
//            changed it, and when.
//   PRD §17  When required, an approved reason and explanation may
//            accompany the response.
//
// Reading of "the appropriate reason/explanation" (Trello card): neither
// the PRD nor the MVP requires a reason on every correction, so none is
// asserted here. The reason and explanation belong to a Not Appropriate
// decision (PRD §17); a correction to or from Not Appropriate must record
// the new reason and keep the previous reason and explanation in history.
//
// What was already covered: test/serviceOutcome.test.js checks each
// correction rule on its own (prior value in the CORRECTED event, prior
// explanation kept, first service time never rewritten, stale and
// unauthorized corrections refused). This file checks the WHOLE history of
// one referral over HTTP, across several corrections by different people:
//   1. every step is recorded with what changed (before and after), who
//      and when (a controlled clock);
//   2. the history is a chain: each correction's "before" is exactly the
//      previous value, so no value is ever lost between steps;
//   3. history is append-only: earlier records are byte-for-byte unchanged
//      after later corrections, and refused corrections add nothing;
//   4. every earlier reason and explanation can still be found, and the
//      current referral can be rebuilt from the history alone;
//   5. first-response and first-service times are never rewritten.
//
// Tests only: no product code changed. In-memory store; SYNTHETIC data.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createMemoryReferralStore } from '../../src/referrals/memoryReferralStore.js';

const WORKER = 100;     // sends the referral
const INTAKE = 200;     // responds
const OUTCOMES = 201;   // records the service outcome
const SUP_A = 202;      // corrects decisions and outcomes
const SUP_B = 203;      // corrects decisions and outcomes
const VIEWER = 204;     // may only view
const P_SENDER = 10;
const P_RECEIVER = 11;
const REASON_CRITERIA = 1;
const REASON_UNAVAILABLE = 2;

// Explanations are synthetic; each must stay findable after it is replaced.
const E1 = 'Synthetic explanation one OO19A';
const E2 = 'Synthetic explanation two OO19B';
const E3 = 'Synthetic explanation three OO19C';
const PARTICIPANT = 'Synthetic Person OO History';

const grant = (userId, permission) => ({
  userId, permission, scopeType: 'PROGRAM', programId: P_RECEIVER, departmentId: null, grantSource: 'IN_APP',
});

function startApp() {
  let t = new Date('2026-10-28T13:00:00.000Z').getTime();
  const now = () => new Date(t);
  const tick = () => { t += 60_000; return new Date(t).toISOString(); };

  const store = createMemoryReferralStore({
    departments: [{ departmentId: 1, name: 'Synthetic Department', lifecycleStatus: 'ACTIVE' }],
    programs: [P_SENDER, P_RECEIVER].map((programId) => ({
      programId, departmentId: 1, name: `Synthetic Program ${programId}`, site: null, lifecycleStatus: 'ACTIVE',
    })),
    users: [
      { userId: WORKER, isActive: true, currentProgramId: P_SENDER },
      ...[INTAKE, OUTCOMES, SUP_A, SUP_B, VIEWER].map((userId) => ({ userId, isActive: true, currentProgramId: P_RECEIVER })),
    ],
    grants: [
      grant(INTAKE, 'VIEW_RECEIVED_REFERRAL'), grant(INTAKE, 'RESPOND_TO_REFERRAL'),
      grant(OUTCOMES, 'VIEW_RECEIVED_REFERRAL'), grant(OUTCOMES, 'RECORD_OUTCOME'),
      ...[SUP_A, SUP_B].flatMap((u) => [
        grant(u, 'VIEW_RECEIVED_REFERRAL'), grant(u, 'UPDATE_RECEIVED_REFERRAL'), grant(u, 'CORRECT_OUTCOME'),
      ]),
      grant(VIEWER, 'VIEW_RECEIVED_REFERRAL'),
    ],
    notAppropriateReasons: [
      { reasonId: REASON_CRITERIA, code: 'PROGRAM_CRITERIA_NOT_MET', label: 'Program criteria not met', displayOrder: 1 },
      { reasonId: REASON_UNAVAILABLE, code: 'PROGRAM_UNAVAILABLE', label: 'Program currently unavailable', displayOrder: 2 },
    ],
  }, { now });

  let current = null;
  const app = createApp({
    affiliationStore: store, referralStore: store, nodeEnv: 'test', now,
    resolveIdentity: () => (current ? { userId: current } : null),
  });
  const call = (method) => (userId, url, body) => {
    current = userId;
    const pending = request(app)[method](url);
    return body === undefined ? pending : pending.send(body);
  };
  return { store, tick, get: call('get'), post: call('post'), put: call('put'), patch: call('patch'), del: call('delete') };
}

describe('Task OO: correction history is complete, chained and append-only (PRD §19)', () => {
  test('a referral corrected many times by different people keeps every earlier value, who and when', async () => {
    const t = startApp();
    const sent = await t.post(WORKER, '/api/referrals', {
      submissionId: randomUUID(), receivingProgramId: P_RECEIVER, participantName: PARTICIPANT,
      contactMethod: 'NOT_AVAILABLE', referralContext: 'Synthetic context OO',
    });
    assert.equal(sent.status, 201);
    const id = sent.body.referral.referralId;
    const url = (suffix = '') => `/api/referrals/${id}${suffix}`;
    const version = async () => (await t.get(SUP_A, url())).body.referral.version;
    const history = () => t.store._referralAuditEvents.filter((e) => e.entityType === 'REFERRAL' && e.entityId === id);
    const row = () => t.store._referrals.find((r) => r.referralId === id);

    // Each step: who, what, and the time the controlled clock says it ran.
    const steps = [];
    const snapshots = []; // the full history after each step
    async function step(userId, path, body, expectedStatus = 200) {
      const at = t.tick();
      const res = await t.post(userId, url(path), body);
      assert.equal(res.status, expectedStatus, `${path} by ${userId}: ${JSON.stringify(res.body)}`);
      steps.push({ userId, at });
      snapshots.push(JSON.stringify(history()));
      return res;
    }

    // 1. Not Appropriate, criteria not met, explanation E1.
    await step(INTAKE, '/response', { decision: 'NOT_APPROPRIATE', reasonId: REASON_CRITERIA, explanation: E1 });
    const firstRespondedAt = row().firstRespondedAt;
    // 2. Reason and explanation corrected (E1 -> E2).
    await step(SUP_A, '/response/correction',
      { decision: 'NOT_APPROPRIATE', reasonId: REASON_UNAVAILABLE, explanation: E2, version: await version() });
    // 3. Decision corrected to Accepted (E2 cleared).
    await step(SUP_B, '/response/correction', { decision: 'ACCEPTED', version: await version() });
    // 4. Outcome recorded.
    await step(OUTCOMES, '/outcome', { outcome: 'RESULTED_IN_SERVICE' });
    const firstResultedInServiceAt = row().firstResultedInServiceAt;
    // 5. Outcome corrected, 6. corrected back, 7. cleared to Not Recorded.
    await step(SUP_A, '/outcome/correction', { outcome: 'DID_NOT_RESULT_IN_SERVICE', version: await version() });
    await step(SUP_B, '/outcome/correction', { outcome: 'RESULTED_IN_SERVICE', version: await version() });
    await step(SUP_A, '/outcome/correction', { outcome: 'NOT_RECORDED', version: await version() });
    // 8. Decision corrected back to Not Appropriate, explanation E3.
    await step(SUP_B, '/response/correction',
      { decision: 'NOT_APPROPRIATE', reasonId: REASON_CRITERIA, explanation: E3, version: await version() });

    const events = history();

    // 1. What, who and when, for every step (CREATED first, by the sender).
    assert.deepEqual(events.map((e) => [e.action, e.actorUserId]), [
      ['CREATED', WORKER],
      ['NOT_APPROPRIATE', INTAKE],
      ['CORRECTED', SUP_A],
      ['CORRECTED', SUP_B],
      ['SERVICE_OUTCOME_RECORDED', OUTCOMES],
      ['CORRECTED', SUP_A],
      ['CORRECTED', SUP_B],
      ['CORRECTED', SUP_A],
      ['CORRECTED', SUP_B],
    ]);
    assert.deepEqual(events.slice(1).map((e) => [e.actorUserId, e.occurredAt]), steps.map((s) => [s.userId, s.at]),
      'each record says who did it and exactly when');
    assert.deepEqual(events.slice(1).map((e) => [e.before, e.after]), [
      [{ response_status: 'AWAITING_RESPONSE', decision: null },
        { response_status: 'RESPONDED', decision: 'NOT_APPROPRIATE', not_appropriate_reason_id: REASON_CRITERIA, has_explanation: true }],
      [{ field: 'DECISION', decision: 'NOT_APPROPRIATE', not_appropriate_reason_id: REASON_CRITERIA, has_explanation: true, not_appropriate_explanation: E1 },
        { field: 'DECISION', decision: 'NOT_APPROPRIATE', not_appropriate_reason_id: REASON_UNAVAILABLE, has_explanation: true }],
      [{ field: 'DECISION', decision: 'NOT_APPROPRIATE', not_appropriate_reason_id: REASON_UNAVAILABLE, has_explanation: true, not_appropriate_explanation: E2 },
        { field: 'DECISION', decision: 'ACCEPTED', not_appropriate_reason_id: null, has_explanation: false }],
      [{ service_outcome: 'NOT_RECORDED' }, { service_outcome: 'RESULTED_IN_SERVICE' }],
      [{ field: 'SERVICE_OUTCOME', service_outcome: 'RESULTED_IN_SERVICE' }, { field: 'SERVICE_OUTCOME', service_outcome: 'DID_NOT_RESULT_IN_SERVICE' }],
      [{ field: 'SERVICE_OUTCOME', service_outcome: 'DID_NOT_RESULT_IN_SERVICE' }, { field: 'SERVICE_OUTCOME', service_outcome: 'RESULTED_IN_SERVICE' }],
      [{ field: 'SERVICE_OUTCOME', service_outcome: 'RESULTED_IN_SERVICE' }, { field: 'SERVICE_OUTCOME', service_outcome: 'NOT_RECORDED' }],
      [{ field: 'DECISION', decision: 'ACCEPTED', not_appropriate_reason_id: null, has_explanation: false },
        { field: 'DECISION', decision: 'NOT_APPROPRIATE', not_appropriate_reason_id: REASON_CRITERIA, has_explanation: true }],
    ]);

    // 2. A chain: each "before" is exactly the previous "after", per field.
    const last = { DECISION: null, SERVICE_OUTCOME: { service_outcome: 'NOT_RECORDED' } };
    for (const e of events.slice(1)) {
      const field = e.before.field ?? (e.action === 'SERVICE_OUTCOME_RECORDED' ? 'SERVICE_OUTCOME' : 'DECISION');
      if (field === 'DECISION') {
        if (last.DECISION) {
          assert.deepEqual([e.before.decision, e.before.not_appropriate_reason_id, e.before.has_explanation],
            [last.DECISION.decision, last.DECISION.not_appropriate_reason_id, last.DECISION.has_explanation],
            `${e.action} at ${e.occurredAt}: "before" is the previous decision`);
        }
        last.DECISION = e.after;
      } else {
        assert.equal(e.before.service_outcome, last.SERVICE_OUTCOME.service_outcome,
          `${e.action} at ${e.occurredAt}: "before" is the previous outcome`);
        last.SERVICE_OUTCOME = e.after;
      }
    }

    // 3. Append-only: each step only added one record; earlier ones unchanged.
    for (let i = 1; i < snapshots.length; i += 1) {
      const before = JSON.parse(snapshots[i - 1]);
      const after = JSON.parse(snapshots[i]);
      assert.equal(after.length, before.length + 1, `step ${i + 1} added exactly one record`);
      assert.deepEqual(after.slice(0, before.length), before, `step ${i + 1} left earlier records unchanged`);
    }

    // 4. Every replaced explanation is still findable, once, where it was
    //    replaced; the current one is only on the referral. Reasons too.
    const audit = JSON.stringify(events);
    assert.equal(events[2].before.not_appropriate_explanation, E1);
    assert.equal(events[3].before.not_appropriate_explanation, E2);
    assert.equal(audit.split(E1).length - 1, 1, 'E1 kept once');
    assert.equal(audit.split(E2).length - 1, 1, 'E2 kept once');
    assert.ok(!audit.includes(E3), 'the current explanation is not copied into history');
    assert.equal(row().notAppropriateExplanation, E3);
    assert.deepEqual(events.slice(1).flatMap((e) => [e.before.not_appropriate_reason_id, e.after.not_appropriate_reason_id])
      .filter((r) => r !== undefined && r !== null), [REASON_CRITERIA, REASON_CRITERIA, REASON_UNAVAILABLE, REASON_UNAVAILABLE, REASON_CRITERIA]);
    assert.ok(!audit.includes(PARTICIPANT), 'history holds no participant name (PRD §26, §34)');

    // The current referral can be rebuilt from history alone.
    assert.deepEqual(
      [row().decision, row().notAppropriateReasonId, Boolean(row().notAppropriateExplanation), row().serviceOutcome],
      [last.DECISION.decision, last.DECISION.not_appropriate_reason_id, last.DECISION.has_explanation, last.SERVICE_OUTCOME.service_outcome],
    );
    const view = (await t.get(VIEWER, url())).body.referral;
    assert.deepEqual([view.decision, view.serviceOutcome], ['NOT_APPROPRIATE', 'NOT_RECORDED']);

    // 5. First-response and first-service times are never rewritten.
    assert.equal(row().firstRespondedAt, firstRespondedAt);
    assert.equal(row().firstRespondedAt, steps[0].at);
    assert.equal(row().firstResultedInServiceAt, firstResultedInServiceAt);
    assert.equal(row().firstResultedInServiceAt, steps[3].at);
  });

  test('refused corrections add nothing to history and change nothing, and no route can edit or delete history', async () => {
    const t = startApp();
    const sent = await t.post(WORKER, '/api/referrals', {
      submissionId: randomUUID(), receivingProgramId: P_RECEIVER, participantName: PARTICIPANT,
      contactMethod: 'NOT_AVAILABLE', referralContext: 'Synthetic context OO',
    });
    const id = sent.body.referral.referralId;
    const url = (suffix = '') => `/api/referrals/${id}${suffix}`;
    t.tick();
    assert.equal((await t.post(INTAKE, url('/response'), { decision: 'ACCEPTED' })).status, 200);
    t.tick();
    assert.equal((await t.post(OUTCOMES, url('/outcome'), { outcome: 'RESULTED_IN_SERVICE' })).status, 200);
    const staleVersion = (await t.get(SUP_A, url())).body.referral.version;
    t.tick();
    assert.equal((await t.post(SUP_A, url('/outcome/correction'),
      { outcome: 'DID_NOT_RESULT_IN_SERVICE', version: staleVersion })).status, 200);

    const frozen = () => JSON.stringify([
      t.store._referrals.find((r) => r.referralId === id),
      t.store._referralAuditEvents.filter((e) => e.entityId === id),
    ]);
    const before = frozen();
    const currentVersion = (await t.get(SUP_A, url())).body.referral.version;

    const refused = [
      // A stale screen: the earlier version, overtaken by the correction above.
      [SUP_B, '/outcome/correction', { outcome: 'NOT_RECORDED', version: staleVersion }, 409],
      // No change: the value already saved.
      [SUP_B, '/outcome/correction', { outcome: 'DID_NOT_RESULT_IN_SERVICE', version: currentVersion }, 409],
      // Not allowed to correct.
      [VIEWER, '/outcome/correction', { outcome: 'NOT_RECORDED', version: currentVersion }, 403],
      [OUTCOMES, '/outcome/correction', { outcome: 'NOT_RECORDED', version: currentVersion }, 403],
      [INTAKE, '/response/correction', { decision: 'ACCEPTED', version: currentVersion }, 403],
      [WORKER, '/response/correction', { decision: 'ACCEPTED', version: currentVersion }, 403],
      // Recording again instead of correcting.
      [OUTCOMES, '/outcome', { outcome: 'RESULTED_IN_SERVICE' }, 409],
    ];
    for (const [userId, path, body, status] of refused) {
      const res = await t.post(userId, url(path), body);
      assert.equal(res.status, status, `${path} by ${userId}`);
      assert.equal(frozen(), before, `${path} by ${userId} changed nothing`);
    }

    // No HTTP route edits or deletes a referral or its history.
    for (const method of ['put', 'patch', 'del']) {
      for (const path of ['', '/history', '/audit', '/response', '/outcome']) {
        const res = await t[method](SUP_A, url(path), { decision: 'ACCEPTED', outcome: 'NOT_RECORDED' });
        assert.ok(res.status === 404 || res.status === 405, `${method} ${path}: ${res.status}`);
      }
    }
    assert.equal(frozen(), before, 'history is unchanged');
  });
});
