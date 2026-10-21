// Service outcome + authorized corrections (Trello card 8).
// Final Technical PRD 2.4, 3.3, 3.6, 5.4, 6.1, 6.2, 6.5, 9.3, 9.4, 9.6,
// 10.5, 12.4, 13.4. All data is SYNTHETIC.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
import { createReferralService } from '../src/referrals/referralService.js';
import { createReferralQueryService } from '../src/referrals/referralQueryService.js';
import { createResponseService } from '../src/referrals/responseService.js';
import {
  createOutcomeService, validateCorrectOutcome, validateCorrectResponse, validateRecordOutcome,
} from '../src/referrals/outcomeService.js';

const CREATOR = 100;          // affiliated with Program 10; no grants
const RESPONDER = 200;        // view + respond, Program 11
const RECORDER = 201;         // view + RECORD_OUTCOME
const CORRECTOR = 202;        // view + CORRECT_OUTCOME
const UPDATER = 203;          // view + UPDATE_RECEIVED_REFERRAL
const ALL = 204;              // view + all three
const RECORD_ONLY = 205;      // RECORD_OUTCOME without view
const VIEWER_ONLY = 206;      // view only
const OTHER_PROGRAM = 207;    // everything, but for Program 12
const REVOKED = 208;          // RECORD_OUTCOME revoked
const DEMO = 209;             // DEMO grants
const ADMIN = 210;            // admin / management grants only
const INACTIVE = 211;         // all three, inactive account
const SECOND = 212;           // another view + all three

const SECRET = 'Synthetic sensitive explanation XYZZY';

const g = (userId, permission, extra = {}) => ({
  userId, permission, scopeType: 'PROGRAM', programId: 11, departmentId: null, grantSource: 'IN_APP', ...extra,
});
const ACTIONS = ['RECORD_OUTCOME', 'CORRECT_OUTCOME', 'UPDATE_RECEIVED_REFERRAL'];

function seed({ now } = {}) {
  return createMemoryReferralStore({
    departments: [{ departmentId: 1, name: 'Synthetic Dept', lifecycleStatus: 'ACTIVE' }],
    programs: [10, 11, 12].map((programId) => ({ programId, departmentId: 1, name: `Program ${programId}`, site: null, lifecycleStatus: 'ACTIVE' })),
    users: [CREATOR, RESPONDER, RECORDER, CORRECTOR, UPDATER, ALL, RECORD_ONLY, VIEWER_ONLY, OTHER_PROGRAM, REVOKED, DEMO, ADMIN, SECOND]
      .map((userId) => ({ userId, isActive: true, currentProgramId: userId === CREATOR ? 10 : null, displayName: `Synthetic ${userId}` }))
      .concat([{ userId: INACTIVE, isActive: false }]),
    grants: [
      g(RESPONDER, 'VIEW_RECEIVED_REFERRAL'), g(RESPONDER, 'RESPOND_TO_REFERRAL'),
      g(RECORDER, 'VIEW_RECEIVED_REFERRAL'), g(RECORDER, 'RECORD_OUTCOME'),
      g(CORRECTOR, 'VIEW_RECEIVED_REFERRAL'), g(CORRECTOR, 'CORRECT_OUTCOME'),
      g(UPDATER, 'VIEW_RECEIVED_REFERRAL'), g(UPDATER, 'UPDATE_RECEIVED_REFERRAL'),
      g(ALL, 'VIEW_RECEIVED_REFERRAL'), ...ACTIONS.map((p) => g(ALL, p)),
      g(SECOND, 'VIEW_RECEIVED_REFERRAL'), ...ACTIONS.map((p) => g(SECOND, p)),
      g(RECORD_ONLY, 'RECORD_OUTCOME'),
      g(VIEWER_ONLY, 'VIEW_RECEIVED_REFERRAL'),
      g(OTHER_PROGRAM, 'VIEW_RECEIVED_REFERRAL', { programId: 12 }), ...ACTIONS.map((p) => g(OTHER_PROGRAM, p, { programId: 12 })),
      g(REVOKED, 'VIEW_RECEIVED_REFERRAL'), g(REVOKED, 'RECORD_OUTCOME', { revokedAt: '2026-10-01T00:00:00.000Z' }),
      g(DEMO, 'VIEW_RECEIVED_REFERRAL', { grantSource: 'DEMO' }), ...ACTIONS.map((p) => g(DEMO, p, { grantSource: 'DEMO' })),
      g(ADMIN, 'ADMINISTER_PERMISSIONS', { scopeType: 'ORG', programId: null }),
      g(ADMIN, 'MANAGE_ORGANIZATION', { scopeType: 'ORG', programId: null }),
      g(ADMIN, 'MANAGE_PROGRAM'), g(ADMIN, 'VIEW_UNDERLYING_REFERRAL'),
      ...ACTIONS.map((p) => g(INACTIVE, p)),
    ],
    notAppropriateReasons: [
      { reasonId: 1, code: 'PROGRAM_CRITERIA_NOT_MET', label: 'Program criteria not met', displayOrder: 1 },
      { reasonId: 2, code: 'PROGRAM_UNAVAILABLE', label: 'Program currently unavailable', displayOrder: 2 },
      { reasonId: 5, code: 'OTHER', label: 'Other', displayOrder: 5 },
      { reasonId: 6, code: 'RETIRED_SAMPLE', label: 'Retired sample reason', displayOrder: 6, lifecycleStatus: 'DISCONTINUED' },
      { reasonId: 7, code: 'NEEDS_DETAIL_SAMPLE', label: 'Sample reason that needs detail', displayOrder: 7, requiresExplanation: true },
    ],
  }, now ? { now } : undefined);
}

// A referral to Program 11, optionally responded to.
async function referral({ respond = null, now } = {}) {
  const store = seed({ now });
  const created = await createReferralService({ store }).createDirectReferral(CREATOR, {
    submissionId: randomUUID(),
    receivingProgramId: 11,
    participantName: 'Synthetic Person',
    contactMethod: 'NOT_AVAILABLE',
    referralContext: 'Synthetic need',
  });
  const id = created.referral.referralId;
  if (respond) await createResponseService({ store }).respond(RESPONDER, id, respond);
  return {
    store,
    id,
    outcomes: createOutcomeService({ store }),
    queries: createReferralQueryService({ store }),
    row: () => store._referrals.find((r) => r.referralId === id),
    events: () => store._referralAuditEvents.filter((e) => e.entityId === id && e.action !== 'CREATED'),
  };
}
const ACCEPT = { decision: 'ACCEPTED' };
const NOT_APPROPRIATE = { decision: 'NOT_APPROPRIATE', reasonId: 2, explanation: SECRET };
const versionOf = async (ctx) => (await ctx.queries.getReferral(ALL, ctx.id)).referral.version;

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code);
    return true;
  });
}

// ---------------------------------------------------------------------------

describe('recording the service outcome (RECORD_OUTCOME)', () => {
  test('Accepted -> Resulted in Service: recorded, timestamped, audited; first service time set', async () => {
    const ctx = await referral({ respond: ACCEPT });
    const before = { ...ctx.row() };
    const result = await ctx.outcomes.recordOutcome(RECORDER, ctx.id, { outcome: 'RESULTED_IN_SERVICE' }, { correlationId: 'c-8' });

    assert.equal(result.status, 'OUTCOME_RECORDED');
    assert.equal(result.referral.serviceOutcome, 'RESULTED_IN_SERVICE');
    assert.equal(result.referral.stage, 'COMPLETE');
    const row = ctx.row();
    assert.equal(row.outcomeRecordedByUserId, RECORDER);
    assert.match(row.outcomeRecordedAt, /Z$/);
    assert.equal(row.firstResultedInServiceAt, row.outcomeRecordedAt);
    assert.equal(row.firstRespondedAt, before.firstRespondedAt, 'first response time untouched');
    assert.notEqual(result.referral.version, `v${before.rowVersion}`, 'version changes');

    const [event] = ctx.events().filter((e) => e.action === 'SERVICE_OUTCOME_RECORDED');
    assert.deepEqual(
      [event.actorUserId, event.correlationId, event.before, event.after],
      [RECORDER, 'c-8', { service_outcome: 'NOT_RECORDED' }, { service_outcome: 'RESULTED_IN_SERVICE' }],
    );
    assert.match(event.occurredAt, /Z$/, 'store sets the audit time');
  });

  test('Accepted -> Did Not Result in Service: no first-service time', async () => {
    const ctx = await referral({ respond: ACCEPT });
    await ctx.outcomes.recordOutcome(RECORDER, ctx.id, { outcome: 'DID_NOT_RESULT_IN_SERVICE' });
    assert.equal(ctx.row().serviceOutcome, 'DID_NOT_RESULT_IN_SERVICE');
    assert.equal(ctx.row().firstResultedInServiceAt ?? null, null);
  });

  test('Accepted alone does not mean service occurred (PRD 6.1)', async () => {
    const ctx = await referral({ respond: ACCEPT });
    assert.equal(ctx.row().serviceOutcome, 'NOT_RECORDED');
    assert.equal((await ctx.queries.getReferral(CREATOR, ctx.id)).referral.stage, 'ACCEPTED_OUTCOME_PENDING');
  });

  for (const [label, respond] of [['Awaiting Response', null], ['Not Appropriate', NOT_APPROPRIATE]]) {
    test(`${label} cannot receive an outcome; nothing changes`, async () => {
      const ctx = await referral({ respond });
      const auditBefore = ctx.events().length;
      await rejectsWith(ctx.outcomes.recordOutcome(RECORDER, ctx.id, { outcome: 'RESULTED_IN_SERVICE' }), 'OUTCOME_NOT_ALLOWED');
      assert.equal(ctx.row().serviceOutcome, 'NOT_RECORDED');
      assert.equal(ctx.events().length, auditBefore);
    });
  }

  test('an outcome already recorded can only be changed by a correction', async () => {
    const ctx = await referral({ respond: ACCEPT });
    await ctx.outcomes.recordOutcome(RECORDER, ctx.id, { outcome: 'RESULTED_IN_SERVICE' });
    await rejectsWith(ctx.outcomes.recordOutcome(RECORDER, ctx.id, { outcome: 'DID_NOT_RESULT_IN_SERVICE' }), 'OUTCOME_ALREADY_RECORDED');
    assert.equal(ctx.row().serviceOutcome, 'RESULTED_IN_SERVICE');
  });

  test('two recorders at the same moment: exactly one wins', async () => {
    const ctx = await referral({ respond: ACCEPT });
    const results = await Promise.allSettled([
      ctx.outcomes.recordOutcome(RECORDER, ctx.id, { outcome: 'RESULTED_IN_SERVICE' }),
      ctx.outcomes.recordOutcome(SECOND, ctx.id, { outcome: 'DID_NOT_RESULT_IN_SERVICE' }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'OUTCOME_ALREADY_RECORDED');
    assert.equal(ctx.events().filter((e) => e.action === 'SERVICE_OUTCOME_RECORDED').length, 1);
  });

  test('if saving fails, nothing changes and it can be retried', async () => {
    const ctx = await referral({ respond: ACCEPT });
    ctx.store._failNextAudit();
    await assert.rejects(ctx.outcomes.recordOutcome(RECORDER, ctx.id, { outcome: 'RESULTED_IN_SERVICE' }));
    assert.equal(ctx.row().serviceOutcome, 'NOT_RECORDED');
    assert.equal(ctx.row().firstResultedInServiceAt ?? null, null);
    assert.equal((await ctx.outcomes.recordOutcome(RECORDER, ctx.id, { outcome: 'RESULTED_IN_SERVICE' })).status, 'OUTCOME_RECORDED');
  });

  // Controlled order (PR #14 review): the first operation is paused right
  // after its grants read (it has already read the referral row), the
  // second runs to completion, then the first is released.
  function pauseAfterGrantsRead(store, userId) {
    let reached; let release;
    const reachedP = new Promise((r) => { reached = r; });
    const gate = new Promise((r) => { release = r; });
    let done = false;
    store._afterLockingRead(async (kind, id) => {
      if (!done && kind === 'grants' && id === userId) { done = true; reached(); await gate; }
    });
    return { reached: reachedP, release };
  }

  test('record wins: a decision correction that read the row first gets REFERRAL_CHANGED; Accepted + Resulted stands', async () => {
    const ctx = await referral({ respond: ACCEPT });
    const version = await versionOf(ctx);
    const pause = pauseAfterGrantsRead(ctx.store, UPDATER);
    const correcting = ctx.outcomes.correctResponse(UPDATER, ctx.id, { ...NOT_APPROPRIATE, version });
    await pause.reached;

    assert.equal((await ctx.outcomes.recordOutcome(RECORDER, ctx.id, { outcome: 'RESULTED_IN_SERVICE' })).status, 'OUTCOME_RECORDED');
    pause.release();
    await rejectsWith(correcting, 'REFERRAL_CHANGED');

    const row = ctx.row();
    assert.deepEqual([row.decision, row.serviceOutcome], ['ACCEPTED', 'RESULTED_IN_SERVICE']);
    assert.deepEqual(ctx.events().map((e) => e.action), ['ACCEPTED', 'SERVICE_OUTCOME_RECORDED']);
  });

  test('correction wins: a recording that read the row first gets OUTCOME_NOT_ALLOWED; Not Appropriate + Not Recorded stands', async () => {
    const ctx = await referral({ respond: ACCEPT });
    const version = await versionOf(ctx);
    const pause = pauseAfterGrantsRead(ctx.store, RECORDER);
    const recording = ctx.outcomes.recordOutcome(RECORDER, ctx.id, { outcome: 'RESULTED_IN_SERVICE' });
    await pause.reached;

    assert.equal((await ctx.outcomes.correctResponse(UPDATER, ctx.id, { ...NOT_APPROPRIATE, version })).status, 'CORRECTED');
    pause.release();
    await rejectsWith(recording, 'OUTCOME_NOT_ALLOWED');

    const row = ctx.row();
    assert.deepEqual([row.decision, row.serviceOutcome, row.outcomeRecordedAt ?? null], ['NOT_APPROPRIATE', 'NOT_RECORDED', null]);
    assert.deepEqual(ctx.events().map((e) => e.action), ['ACCEPTED', 'CORRECTED']);
  });
});

describe('explanation history in corrections (PRD 6.4, 6.5, 9.6)', () => {
  const NEW_TEXT = 'Synthetic replacement explanation PLUGH';
  const corrected = (ctx) => ctx.events().filter((e) => e.action === 'CORRECTED').at(-1);

  test('changing the explanation keeps the prior text in the CORRECTED event; the new text is only in the row', async () => {
    const ctx = await referral({ respond: NOT_APPROPRIATE });
    await ctx.outcomes.correctResponse(UPDATER, ctx.id, { decision: 'NOT_APPROPRIATE', reasonId: 2, explanation: NEW_TEXT, version: await versionOf(ctx) });
    const event = corrected(ctx);
    assert.equal(event.before.not_appropriate_explanation, SECRET);
    assert.deepEqual(event.after, { field: 'DECISION', decision: 'NOT_APPROPRIATE', not_appropriate_reason_id: 2, has_explanation: true });
    assert.equal(ctx.row().notAppropriateExplanation, NEW_TEXT);
    assert.ok(!JSON.stringify(ctx.store._referralAuditEvents).includes('PLUGH'), 'the new text is not copied into audit');
  });

  test('correcting to Accepted clears the explanation; the prior text is kept in the CORRECTED event', async () => {
    const ctx = await referral({ respond: NOT_APPROPRIATE });
    await ctx.outcomes.correctResponse(UPDATER, ctx.id, { decision: 'ACCEPTED', version: await versionOf(ctx) });
    assert.equal(ctx.row().notAppropriateExplanation, null);
    assert.equal(corrected(ctx).before.not_appropriate_explanation, SECRET);
    assert.equal(corrected(ctx).after.has_explanation, false);
  });

  test('removing the explanation (same reason) keeps the prior text', async () => {
    const ctx = await referral({ respond: NOT_APPROPRIATE });
    await ctx.outcomes.correctResponse(UPDATER, ctx.id, { decision: 'NOT_APPROPRIATE', reasonId: 2, version: await versionOf(ctx) });
    assert.equal(corrected(ctx).before.not_appropriate_explanation, SECRET);
  });

  test('a correction that leaves the explanation unchanged copies no text', async () => {
    const ctx = await referral({ respond: NOT_APPROPRIATE });
    await ctx.outcomes.correctResponse(UPDATER, ctx.id, { decision: 'NOT_APPROPRIATE', reasonId: 1, explanation: SECRET, version: await versionOf(ctx) });
    assert.equal('not_appropriate_explanation' in corrected(ctx).before, false);
    assert.ok(!JSON.stringify(ctx.store._referralAuditEvents).includes('XYZZY'));
  });

  test('adding an explanation where there was none copies no text', async () => {
    const ctx = await referral({ respond: ACCEPT });
    await ctx.outcomes.correctResponse(UPDATER, ctx.id, { ...NOT_APPROPRIATE, version: await versionOf(ctx) });
    assert.equal('not_appropriate_explanation' in corrected(ctx).before, false);
    assert.ok(!JSON.stringify(ctx.store._referralAuditEvents).includes('XYZZY'));
  });

  test('the prior text never reaches a response or a log, even when the save fails', async (t) => {
    const ctx = await referral({ respond: NOT_APPROPRIATE });
    const logs = [];
    t.mock.method(console, 'error', (...args) => logs.push(args.map(String).join(' ')));
    t.mock.method(console, 'log', (...args) => logs.push(args.map(String).join(' ')));
    const app = createApp({ referralStore: ctx.store, affiliationStore: ctx.store, resolveIdentity: () => ({ userId: ALL }) });
    const ok = await request(app).post(`/api/referrals/${ctx.id}/response/correction`).send({ decision: 'ACCEPTED', version: await versionOf(ctx) });
    assert.equal(ok.status, 200);
    const detail = await request(app).get(`/api/referrals/${ctx.id}`);
    ctx.store._failNextAudit();
    const failed = await request(app).post(`/api/referrals/${ctx.id}/response/correction`)
      .send({ ...NOT_APPROPRIATE, explanation: NEW_TEXT, version: detail.body.referral.version });
    assert.equal(failed.status, 500);
    for (const text of [ok.text, detail.text, failed.text, logs.join('\n')]) {
      assert.ok(!text.includes('XYZZY') && !text.includes('PLUGH'));
    }
  });
});

describe('correcting the service outcome (CORRECT_OUTCOME)', () => {
  async function recorded(outcome = 'RESULTED_IN_SERVICE') {
    const ctx = await referral({ respond: ACCEPT });
    await ctx.outcomes.recordOutcome(RECORDER, ctx.id, { outcome });
    return ctx;
  }

  test('Resulted -> Did Not Result: corrected, prior value kept in audit, first service time never rewritten', async () => {
    const ctx = await recorded();
    const firstService = ctx.row().firstResultedInServiceAt;
    const result = await ctx.outcomes.correctOutcome(CORRECTOR, ctx.id, { outcome: 'DID_NOT_RESULT_IN_SERVICE', version: await versionOf(ctx) });

    assert.equal(result.status, 'CORRECTED');
    assert.equal(ctx.row().serviceOutcome, 'DID_NOT_RESULT_IN_SERVICE');
    assert.equal(ctx.row().outcomeRecordedByUserId, CORRECTOR);
    assert.equal(ctx.row().firstResultedInServiceAt, firstService, 'PRD 12.4');
    const event = ctx.events().at(-1);
    assert.equal(event.action, 'CORRECTED');
    assert.deepEqual(event.before, { field: 'SERVICE_OUTCOME', service_outcome: 'RESULTED_IN_SERVICE' });
    assert.deepEqual(event.after, { field: 'SERVICE_OUTCOME', service_outcome: 'DID_NOT_RESULT_IN_SERVICE' });
  });

  test('Did Not Result -> Resulted sets the first service time once; later corrections keep it', async () => {
    let t = Date.UTC(2026, 9, 1);
    const ctx = await referral({ respond: ACCEPT, now: () => new Date((t += 60_000)) });
    await ctx.outcomes.recordOutcome(RECORDER, ctx.id, { outcome: 'DID_NOT_RESULT_IN_SERVICE' });
    await ctx.outcomes.correctOutcome(CORRECTOR, ctx.id, { outcome: 'RESULTED_IN_SERVICE', version: await versionOf(ctx) });
    const first = ctx.row().firstResultedInServiceAt;
    assert.ok(first);
    await ctx.outcomes.correctOutcome(CORRECTOR, ctx.id, { outcome: 'DID_NOT_RESULT_IN_SERVICE', version: await versionOf(ctx) });
    await ctx.outcomes.correctOutcome(CORRECTOR, ctx.id, { outcome: 'RESULTED_IN_SERVICE', version: await versionOf(ctx) });
    assert.equal(ctx.row().firstResultedInServiceAt, first);
    assert.notEqual(ctx.row().outcomeRecordedAt, first, 'the recorded-at time does move');
  });

  test('back to Not Recorded clears who/when recorded; it can then be recorded again', async () => {
    const ctx = await recorded('DID_NOT_RESULT_IN_SERVICE');
    await ctx.outcomes.correctOutcome(CORRECTOR, ctx.id, { outcome: 'NOT_RECORDED', version: await versionOf(ctx) });
    const row = ctx.row();
    assert.deepEqual([row.serviceOutcome, row.outcomeRecordedAt, row.outcomeRecordedByUserId], ['NOT_RECORDED', null, null]);
    assert.equal((await ctx.queries.getReferral(ALL, ctx.id)).referral.stage, 'ACCEPTED_OUTCOME_PENDING');
    assert.equal((await ctx.outcomes.recordOutcome(RECORDER, ctx.id, { outcome: 'RESULTED_IN_SERVICE' })).status, 'OUTCOME_RECORDED');
  });

  test('a stale version is refused with the current state; nothing is written (PRD 9.4)', async () => {
    const ctx = await recorded();
    const seen = await versionOf(ctx);
    await ctx.outcomes.correctOutcome(SECOND, ctx.id, { outcome: 'DID_NOT_RESULT_IN_SERVICE', version: seen });
    const auditBefore = ctx.events().length;
    await assert.rejects(ctx.outcomes.correctOutcome(CORRECTOR, ctx.id, { outcome: 'NOT_RECORDED', version: seen }), (err) => {
      assert.equal(err.code, 'REFERRAL_CHANGED');
      assert.equal(err.status, 409);
      assert.equal(err.current.serviceOutcome, 'DID_NOT_RESULT_IN_SERVICE');
      assert.equal(err.current.version, ctx.row().version ?? `v${ctx.row().rowVersion}`);
      return true;
    });
    assert.equal(ctx.row().serviceOutcome, 'DID_NOT_RESULT_IN_SERVICE');
    assert.equal(ctx.events().length, auditBefore);
  });

  test('two corrections with the same version: exactly one wins', async () => {
    const ctx = await recorded();
    const version = await versionOf(ctx);
    const results = await Promise.allSettled([
      ctx.outcomes.correctOutcome(CORRECTOR, ctx.id, { outcome: 'DID_NOT_RESULT_IN_SERVICE', version }),
      ctx.outcomes.correctOutcome(SECOND, ctx.id, { outcome: 'NOT_RECORDED', version }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'REFERRAL_CHANGED');
  });

  test('nothing recorded yet -> OUTCOME_NOT_RECORDED; same value -> NO_CHANGE', async () => {
    const ctx = await referral({ respond: ACCEPT });
    await rejectsWith(ctx.outcomes.correctOutcome(CORRECTOR, ctx.id, { outcome: 'RESULTED_IN_SERVICE', version: await versionOf(ctx) }), 'OUTCOME_NOT_RECORDED');
    const rec = await recorded();
    await rejectsWith(rec.outcomes.correctOutcome(CORRECTOR, rec.id, { outcome: 'RESULTED_IN_SERVICE', version: await versionOf(rec) }), 'NO_CHANGE');
  });

  test('a Not Appropriate referral has no outcome to correct', async () => {
    const ctx = await referral({ respond: NOT_APPROPRIATE });
    await rejectsWith(ctx.outcomes.correctOutcome(CORRECTOR, ctx.id, { outcome: 'RESULTED_IN_SERVICE', version: await versionOf(ctx) }), 'OUTCOME_NOT_ALLOWED');
  });
});

describe('correcting the response / decision (UPDATE_RECEIVED_REFERRAL)', () => {
  test('Accepted -> Not Appropriate: reason required, response stays RESPONDED, first response time kept, explanation not audited', async () => {
    const ctx = await referral({ respond: ACCEPT });
    const firstResponded = ctx.row().firstRespondedAt;
    const result = await ctx.outcomes.correctResponse(UPDATER, ctx.id, { ...NOT_APPROPRIATE, version: await versionOf(ctx) });

    assert.equal(result.referral.decision, 'NOT_APPROPRIATE');
    assert.deepEqual(result.referral.notAppropriateReason, { reasonId: 2, label: 'Program currently unavailable' });
    assert.equal(result.referral.hasExplanation, true);
    assert.ok(!JSON.stringify(result).includes('XYZZY'), 'confirmation never echoes the explanation');
    const row = ctx.row();
    assert.deepEqual([row.responseStatus, row.firstRespondedAt, row.notAppropriateExplanation], ['RESPONDED', firstResponded, SECRET]);

    const event = ctx.events().at(-1);
    assert.equal(event.action, 'CORRECTED');
    assert.deepEqual(event.before, { field: 'DECISION', decision: 'ACCEPTED', not_appropriate_reason_id: null, has_explanation: false });
    assert.deepEqual(event.after, { field: 'DECISION', decision: 'NOT_APPROPRIATE', not_appropriate_reason_id: 2, has_explanation: true });
    assert.ok(!JSON.stringify(ctx.store._referralAuditEvents).includes('XYZZY'));
  });

  test('Not Appropriate cannot receive an outcome until it is corrected to Accepted (PRD 6.5)', async () => {
    const ctx = await referral({ respond: NOT_APPROPRIATE });
    await rejectsWith(ctx.outcomes.recordOutcome(RECORDER, ctx.id, { outcome: 'RESULTED_IN_SERVICE' }), 'OUTCOME_NOT_ALLOWED');

    await ctx.outcomes.correctResponse(UPDATER, ctx.id, { decision: 'ACCEPTED', version: await versionOf(ctx) });
    const row = ctx.row();
    assert.deepEqual([row.decision, row.notAppropriateReasonId, row.notAppropriateExplanation], ['ACCEPTED', null, null], 'reason and explanation cleared');

    assert.equal((await ctx.outcomes.recordOutcome(RECORDER, ctx.id, { outcome: 'RESULTED_IN_SERVICE' })).status, 'OUTCOME_RECORDED');
  });

  test('Accepted with a recorded outcome cannot become Not Appropriate until the outcome is corrected to Not Recorded', async () => {
    const ctx = await referral({ respond: ACCEPT });
    await ctx.outcomes.recordOutcome(RECORDER, ctx.id, { outcome: 'RESULTED_IN_SERVICE' });
    await rejectsWith(ctx.outcomes.correctResponse(UPDATER, ctx.id, { ...NOT_APPROPRIATE, version: await versionOf(ctx) }), 'OUTCOME_RECORDED');
    assert.equal(ctx.row().decision, 'ACCEPTED');
    assert.equal(ctx.row().serviceOutcome, 'RESULTED_IN_SERVICE', 'never cleared silently');

    await ctx.outcomes.correctOutcome(CORRECTOR, ctx.id, { outcome: 'NOT_RECORDED', version: await versionOf(ctx) });
    const result = await ctx.outcomes.correctResponse(UPDATER, ctx.id, { ...NOT_APPROPRIATE, version: await versionOf(ctx) });
    assert.equal(result.referral.decision, 'NOT_APPROPRIATE');
  });

  test('a different Not Appropriate reason or explanation is a correction; an identical one is NO_CHANGE', async () => {
    const ctx = await referral({ respond: NOT_APPROPRIATE });
    await ctx.outcomes.correctResponse(UPDATER, ctx.id, { decision: 'NOT_APPROPRIATE', reasonId: 1, explanation: SECRET, version: await versionOf(ctx) });
    assert.equal(ctx.row().notAppropriateReasonId, 1);
    await ctx.outcomes.correctResponse(UPDATER, ctx.id, { decision: 'NOT_APPROPRIATE', reasonId: 1, version: await versionOf(ctx) });
    assert.equal(ctx.row().notAppropriateExplanation, null, 'explanation removed');
    await rejectsWith(ctx.outcomes.correctResponse(UPDATER, ctx.id, { decision: 'NOT_APPROPRIATE', reasonId: 1, explanation: '  ', version: await versionOf(ctx) }), 'NO_CHANGE');
  });

  test('reason rules match the first response: active reason, required explanation', async () => {
    const ctx = await referral({ respond: ACCEPT });
    const version = await versionOf(ctx);
    await rejectsWith(ctx.outcomes.correctResponse(UPDATER, ctx.id, { decision: 'NOT_APPROPRIATE', reasonId: 6, version }), 'REASON_NOT_SELECTABLE');
    await rejectsWith(ctx.outcomes.correctResponse(UPDATER, ctx.id, { decision: 'NOT_APPROPRIATE', reasonId: 99, version }), 'REASON_NOT_SELECTABLE');
    await assert.rejects(ctx.outcomes.correctResponse(UPDATER, ctx.id, { decision: 'NOT_APPROPRIATE', reasonId: 7, version }),
      (err) => err.code === 'INVALID_REQUEST' && err.fields.includes('explanation'));
    assert.equal(ctx.row().decision, 'ACCEPTED');
  });

  test('a referral still Awaiting Response has nothing to correct; there is no correction back to Awaiting', async () => {
    const ctx = await referral();
    await rejectsWith(ctx.outcomes.correctResponse(UPDATER, ctx.id, { ...ACCEPT, version: await versionOf(ctx) }), 'NOT_RESPONDED');
    assert.deepEqual(validateCorrectResponse({ decision: 'AWAITING_RESPONSE', version: 'v1' }), { ok: false, fields: ['decision'] });
  });

  test('a stale version is refused with the current state', async () => {
    const ctx = await referral({ respond: ACCEPT });
    const seen = await versionOf(ctx);
    await ctx.outcomes.recordOutcome(RECORDER, ctx.id, { outcome: 'DID_NOT_RESULT_IN_SERVICE' });
    await assert.rejects(ctx.outcomes.correctResponse(UPDATER, ctx.id, { ...NOT_APPROPRIATE, version: seen }), (err) => {
      assert.equal(err.code, 'REFERRAL_CHANGED');
      assert.equal(err.current.serviceOutcome, 'DID_NOT_RESULT_IN_SERVICE');
      return true;
    });
  });
});

describe('who may do what (capability + resource + scope, PRD 3.3, 3.6)', () => {
  const record = (ctx, userId) => ctx.outcomes.recordOutcome(userId, ctx.id, { outcome: 'RESULTED_IN_SERVICE' });

  test('only RECORD_OUTCOME records; respond, correct and update capabilities do not', async () => {
    for (const userId of [RESPONDER, CORRECTOR, UPDATER, VIEWER_ONLY, CREATOR]) {
      const ctx = await referral({ respond: ACCEPT });
      await rejectsWith(record(ctx, userId), 'NOT_AUTHORIZED');
      assert.equal(ctx.row().serviceOutcome, 'NOT_RECORDED');
    }
  });

  test('only CORRECT_OUTCOME corrects an outcome; RECORD_OUTCOME and UPDATE_RECEIVED_REFERRAL do not', async () => {
    for (const userId of [RECORDER, UPDATER, RESPONDER]) {
      const ctx = await referral({ respond: ACCEPT });
      await record(ctx, RECORDER);
      await rejectsWith(ctx.outcomes.correctOutcome(userId, ctx.id, { outcome: 'NOT_RECORDED', version: await versionOf(ctx) }), 'NOT_AUTHORIZED');
    }
  });

  test('only UPDATE_RECEIVED_REFERRAL corrects the decision; respond and outcome capabilities do not', async () => {
    for (const userId of [RESPONDER, RECORDER, CORRECTOR]) {
      const ctx = await referral({ respond: ACCEPT });
      await rejectsWith(ctx.outcomes.correctResponse(userId, ctx.id, { ...NOT_APPROPRIATE, version: await versionOf(ctx) }), 'NOT_AUTHORIZED');
      assert.equal(ctx.row().decision, 'ACCEPTED');
    }
  });

  for (const [label, userId] of [
    ['another Program\'s staff', OTHER_PROGRAM],
    ['a revoked grant', REVOKED],
    ['DEMO grants while demo is off', DEMO],
    ['admin / management grants', ADMIN],
  ]) {
    test(`${label} get the same 404 as a missing referral, for every action`, async () => {
      const ctx = await referral({ respond: ACCEPT });
      const version = await versionOf(ctx);
      await rejectsWith(record(ctx, userId), userId === REVOKED ? 'NOT_AUTHORIZED' : 'REFERRAL_NOT_FOUND');
      await rejectsWith(ctx.outcomes.correctResponse(userId, ctx.id, { ...NOT_APPROPRIATE, version }), userId === REVOKED ? 'NOT_AUTHORIZED' : 'REFERRAL_NOT_FOUND');
      assert.equal(ctx.row().serviceOutcome, 'NOT_RECORDED');
    });
  }

  test('an inactive account is refused', async () => {
    const ctx = await referral({ respond: ACCEPT });
    await assert.rejects(record(ctx, INACTIVE), (err) => err.status === 403);
  });

  test('DEMO grants work only when the non-production caller allows them', async () => {
    const ctx = await referral({ respond: ACCEPT });
    const demo = createOutcomeService({ store: ctx.store, allowDemoGrants: true });
    assert.equal((await demo.recordOutcome(DEMO, ctx.id, { outcome: 'RESULTED_IN_SERVICE' })).status, 'OUTCOME_RECORDED');
  });

  test('an action capability without view: the action works, returns only confirmation data, and grants no view', async () => {
    const ctx = await referral({ respond: ACCEPT });
    const result = await record(ctx, RECORD_ONLY);
    assert.deepEqual(Object.keys(result.referral).sort(),
      ['decision', 'hasExplanation', 'notAppropriateReason', 'outcomeRecordedAt', 'referralId', 'responseStatus', 'serviceOutcome', 'stage', 'version']);
    assert.ok(!JSON.stringify(result).includes('Synthetic Person'));
    await rejectsWith(ctx.queries.getReferral(RECORD_ONLY, ctx.id), 'REFERRAL_NOT_FOUND');
  });

  test('a revocation during a recording waits for it (grants are a locking read)', async () => {
    const ctx = await referral({ respond: ACCEPT });
    let reached; let release;
    const reachedP = new Promise((r) => { reached = r; });
    const gate = new Promise((r) => { release = r; });
    let done = false;
    ctx.store._afterLockingRead(async (kind, id) => {
      if (!done && kind === 'grants' && id === RECORDER) { done = true; reached(); await gate; }
    });
    const recording = record(ctx, RECORDER);
    await reachedP;
    let revoked = false;
    const revoking = ctx.store._revokeGrants(RECORDER, 'RECORD_OUTCOME').then(() => { revoked = true; });
    for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r));
    assert.equal(revoked, false, 'revocation waits');
    release();
    assert.equal((await recording).status, 'OUTCOME_RECORDED');
    await revoking;
  });
});

describe('input validation (allowlist, PRD 10.3, 10.4)', () => {
  for (const [label, body] of [
    ['missing outcome', {}],
    ['NOT_RECORDED is not a recording', { outcome: 'NOT_RECORDED' }],
    ['lowercase outcome', { outcome: 'resulted_in_service' }],
    ['numeric outcome', { outcome: 1 }],
    ['a decision instead of an outcome', { outcome: 'ACCEPTED' }],
  ]) {
    test(`record: rejects ${label}`, () => {
      assert.deepEqual(validateRecordOutcome(body), { ok: false, fields: ['outcome'] });
    });
  }

  for (const body of [
    { outcome: 'RESULTED_IN_SERVICE', outcomeRecordedAt: '2020-01-01T00:00:00Z' },
    { outcome: 'RESULTED_IN_SERVICE', userId: 1 },
    { outcome: 'RESULTED_IN_SERVICE', 'Synthetic Person Omega 555-0199': 1 },
  ]) {
    test(`record: refuses an unexpected field without naming it (${Object.keys(body)[1].slice(0, 12)})`, () => {
      assert.deepEqual(validateRecordOutcome(body), { ok: false, unexpectedField: true });
    });
  }

  test('corrections require a version', () => {
    assert.deepEqual(validateCorrectOutcome({ outcome: 'NOT_RECORDED' }), { ok: false, fields: ['version'] });
    assert.deepEqual(validateCorrectOutcome({ outcome: 'NOT_RECORDED', version: 5 }), { ok: false, fields: ['version'] });
    assert.deepEqual(validateCorrectOutcome({ outcome: 'NOT_RECORDED', version: 'x'.repeat(65) }), { ok: false, fields: ['version'] });
    assert.deepEqual(validateCorrectResponse({ decision: 'ACCEPTED' }), { ok: false, fields: ['version'] });
  });

  test('decision corrections reuse the first-response rules (types, reason with Accepted, unknown fields)', () => {
    assert.deepEqual(validateCorrectResponse({ decision: 'NOT_APPROPRIATE', reasonId: 2, explanation: 42, version: 'v1' }), { ok: false, fields: ['explanation'] });
    assert.deepEqual(validateCorrectResponse({ decision: 'ACCEPTED', reasonId: 2, version: 'v1' }), { ok: false, fields: ['reasonId'] });
    assert.deepEqual(validateCorrectResponse({ decision: 'ACCEPTED', firstRespondedAt: 'x', version: 'v1' }), { ok: false, unexpectedField: true });
    assert.deepEqual(validateCorrectOutcome({ outcome: 'NOT_RECORDED', version: 'v1', firstResultedInServiceAt: null }), { ok: false, unexpectedField: true });
  });
});

describe('detail view: version and next-action hints (PRD 3.7, 9.4)', () => {
  test('flags follow both state and capability', async () => {
    const ctx = await referral({ respond: ACCEPT });
    const view = async (userId) => (await ctx.queries.getReferral(userId, ctx.id)).viewerAccess;
    assert.equal((await view(RECORDER)).canRecordOutcome, true);
    assert.equal((await view(CORRECTOR)).canCorrectOutcome, false, 'nothing recorded yet');
    assert.equal((await view(UPDATER)).canCorrectResponse, true);
    assert.deepEqual(
      [(await view(CREATOR)).canRecordOutcome, (await view(CREATOR)).canCorrectResponse, (await view(VIEWER_ONLY)).canRecordOutcome],
      [false, false, false],
    );
    await ctx.outcomes.recordOutcome(RECORDER, ctx.id, { outcome: 'RESULTED_IN_SERVICE' });
    assert.equal((await view(RECORDER)).canRecordOutcome, false);
    assert.equal((await view(CORRECTOR)).canCorrectOutcome, true);
    const detail = (await ctx.queries.getReferral(CREATOR, ctx.id)).referral;
    assert.equal(detail.serviceOutcome, 'RESULTED_IN_SERVICE', 'the creator sees the recorded outcome (PRD 1.2)');
    assert.match(detail.version, /^v\d+$/);
    assert.match(detail.outcomeRecordedAt, /Z$/);
  });
});

describe('HTTP', () => {
  const appFor = (store, userId, extra = {}) => createApp({ referralStore: store, affiliationStore: store, resolveIdentity: () => ({ userId }), ...extra });

  test('full lifecycle: Not Appropriate -> refused outcome -> corrected -> recorded -> corrected; history keeps every prior value', async () => {
    const ctx = await referral({ respond: NOT_APPROPRIATE });
    const app = appFor(ctx.store, ALL);
    const get = async () => (await request(app).get(`/api/referrals/${ctx.id}`)).body.referral;

    const refused = await request(app).post(`/api/referrals/${ctx.id}/outcome`).send({ outcome: 'RESULTED_IN_SERVICE' });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, 'OUTCOME_NOT_ALLOWED');

    const fixed = await request(app).post(`/api/referrals/${ctx.id}/response/correction`).send({ decision: 'ACCEPTED', version: (await get()).version });
    assert.equal(fixed.status, 200);
    assert.equal(fixed.headers['cache-control'], 'no-store');
    assert.equal(fixed.body.referral.decision, 'ACCEPTED');

    const recorded = await request(app).post(`/api/referrals/${ctx.id}/outcome`).send({ outcome: 'RESULTED_IN_SERVICE' });
    assert.equal(recorded.status, 200);
    assert.equal(recorded.body.referral.stage, 'COMPLETE');

    const corrected = await request(app).post(`/api/referrals/${ctx.id}/outcome/correction`)
      .send({ outcome: 'DID_NOT_RESULT_IN_SERVICE', version: recorded.body.referral.version });
    assert.equal(corrected.status, 200);
    assert.equal((await get()).serviceOutcome, 'DID_NOT_RESULT_IN_SERVICE');

    assert.deepEqual(ctx.events().map((e) => e.action), ['NOT_APPROPRIATE', 'CORRECTED', 'SERVICE_OUTCOME_RECORDED', 'CORRECTED']);
    for (const text of [recorded.text, corrected.text, fixed.text]) {
      assert.ok(!text.includes('Synthetic Person') && !text.includes('XYZZY'));
    }
  });

  test('a stale correction gets 409 with the current state for a viewer, and no state for a non-viewer', async () => {
    const ctx = await referral({ respond: ACCEPT });
    const viewer = appFor(ctx.store, ALL);
    const seen = (await request(viewer).get(`/api/referrals/${ctx.id}`)).body.referral.version;
    await request(viewer).post(`/api/referrals/${ctx.id}/outcome`).send({ outcome: 'RESULTED_IN_SERVICE' }).expect(200);

    const stale = await request(viewer).post(`/api/referrals/${ctx.id}/outcome/correction`).send({ outcome: 'NOT_RECORDED', version: seen });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'REFERRAL_CHANGED');
    assert.equal(stale.body.current.serviceOutcome, 'RESULTED_IN_SERVICE');

    ctx.store._grants.push(g(RECORD_ONLY, 'CORRECT_OUTCOME'));
    const blind = await request(appFor(ctx.store, RECORD_ONLY)).post(`/api/referrals/${ctx.id}/outcome/correction`).send({ outcome: 'NOT_RECORDED', version: seen });
    assert.equal(blind.status, 409);
    assert.equal(blind.body.current, undefined, 'no state for someone who cannot view it');
  });

  test('sign-in required; query parameters, unsafe IDs, unknown fields and bad JSON refused without echo', async () => {
    const ctx = await referral({ respond: ACCEPT });
    for (const path of ['outcome', 'outcome/correction', 'response/correction']) {
      assert.equal((await request(createApp({ referralStore: ctx.store })).post(`/api/referrals/${ctx.id}/${path}`).send({})).status, 401, path);
      const app = appFor(ctx.store, ALL);
      assert.equal((await request(app).post(`/api/referrals/${ctx.id}/${path}?asUser=1`).send({})).status, 400, path);
      assert.equal((await request(app).post(`/api/referrals/9007199254740993/${path}`).send({})).status, 404, path);
      const unknown = await request(app).post(`/api/referrals/${ctx.id}/${path}`).send({ 'Synthetic Omega 555-0199': 1 });
      assert.equal(unknown.status, 400);
      assert.equal(unknown.body.code, 'UNEXPECTED_FIELD');
      assert.ok(!unknown.text.includes('Omega'));
      const bad = await request(app).post(`/api/referrals/${ctx.id}/${path}`).set('Content-Type', 'application/json').send('{"outcome": "XYZZY');
      assert.equal(bad.status, 400);
      assert.ok(!bad.text.includes('XYZZY'));
    }
    assert.equal(ctx.row().serviceOutcome, 'NOT_RECORDED');
  });

  test('an unexpected failure returns a generic 500 and logs no participant data or explanation', async (t) => {
    const ctx = await referral({ respond: ACCEPT });
    const logs = [];
    t.mock.method(console, 'error', (...args) => logs.push(args.map(String).join(' ')));
    ctx.store._failNextAudit();
    const res = await request(appFor(ctx.store, ALL)).post(`/api/referrals/${ctx.id}/response/correction`)
      .send({ ...NOT_APPROPRIATE, version: ctx.row().version ?? `v${ctx.row().rowVersion}` });
    assert.equal(res.status, 500);
    assert.ok(!(res.text + logs.join('\n')).match(/XYZZY|Synthetic Person/));
    assert.equal(ctx.row().decision, 'ACCEPTED');
  });

  test('DEMO grants follow the start-up guard on the new routes too', async () => {
    const ctx = await referral({ respond: ACCEPT });
    assert.equal((await request(appFor(ctx.store, DEMO)).post(`/api/referrals/${ctx.id}/outcome`).send({ outcome: 'RESULTED_IN_SERVICE' })).status, 404);
    assert.throws(() => appFor(ctx.store, DEMO, { allowDemoGrants: true, nodeEnv: 'production' }), /DEMO grants/);
    const res = await request(appFor(ctx.store, DEMO, { allowDemoGrants: true, nodeEnv: 'test' })).post(`/api/referrals/${ctx.id}/outcome`).send({ outcome: 'RESULTED_IN_SERVICE' });
    assert.equal(res.status, 200);
  });
});
