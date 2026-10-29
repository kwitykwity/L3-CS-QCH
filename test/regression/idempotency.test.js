// Task MM: double-submit and idempotency, across the whole app.
//
// Frozen Handoff PRD 20 and 21; Handoff MVP 20; acceptance gate 25:
//
//   "Referral submission must be idempotent. Retrying the same logical
//    submission must not create duplicate referrals. A failed
//    upload/request must not cause the employee to unknowingly create
//    duplicates through retry." (Handoff PRD 20)
//
// The per-card tests prove the rules one layer at a time (referral.test.js
// for the service, referralUi.test.js for the screen logic,
// notificationWiring.test.js for email). This file proves they hold
// together over HTTP, for both referral paths, when the same submission
// arrives many times at once: one referral, one audit entry, one GPME
// evaluation, one email, one row in the sender's list, one count in the
// reports. It also covers a failed attempt followed by a retry.
//
// The browser half (double clicks, lost answers, interrupted sends) is
// e2e/doubleSubmit.spec.js.
//
// The data store is the in-memory store (Handoff PRD 27). All data is
// SYNTHETIC (Handoff PRD 35).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createMemoryReferralStore } from '../../src/referrals/memoryReferralStore.js';
import { createNotificationService } from '../../src/notifications/notificationService.js';
import { createSimulatedOutboxSender } from '../../src/notifications/simulatedOutbox.js';

const WORKER = 100;
const INTAKE = 200;
const P_REFERRING = 10;
const P_RECEIVING = 11;
const EMPLOYMENT = 1;
const BURST = 10;

const FIXED_NOW = new Date('2026-10-20T14:00:00.000Z');
const NO_LIMITS = { ageLimitState: 'NO_RESTRICTION', ageMin: null, ageMax: null, serviceAreaState: 'NO_RESTRICTION', serviceAreaZips: [] };

function startApp() {
  const store = createMemoryReferralStore({
    departments: [{ departmentId: 1, name: 'Synthetic Services', lifecycleStatus: 'ACTIVE' }],
    programs: [
      { programId: P_REFERRING, departmentId: 1, name: 'Synthetic Intake Desk', site: null, lifecycleStatus: 'ACTIVE', needCategoryIds: [], ...NO_LIMITS },
      { programId: P_RECEIVING, departmentId: 1, name: 'Synthetic Job Center', site: null, lifecycleStatus: 'ACTIVE', needCategoryIds: [EMPLOYMENT], ...NO_LIMITS },
    ],
    needCategories: [{ needCategoryId: EMPLOYMENT, name: 'Employment', lifecycleStatus: 'ACTIVE' }],
    users: [{ userId: WORKER, isActive: true }, { userId: INTAKE, isActive: true }],
    grants: [{ userId: INTAKE, permission: 'VIEW_RECEIVED_REFERRAL', scopeType: 'PROGRAM', programId: P_RECEIVING, departmentId: null, grantSource: 'IN_APP' }],
    programNotificationEmails: { [P_RECEIVING]: 'synthetic-jobs@example.test' },
  }, { now: () => new Date(FIXED_NOW) });

  const outbox = createSimulatedOutboxSender({ nodeEnv: 'test' });
  const notifications = createNotificationService({
    store: store.notificationStore, sender: outbox, now: () => new Date(FIXED_NOW), logger: { info() {}, warn() {}, error() {} },
  });
  const started = [];
  const notifier = {
    notifyReferralCommitted(args) {
      const run = notifications.notifyReferralCommitted(args);
      started.push(run);
      return run;
    },
    retryPendingDeliveries: (options) => notifications.retryPendingDeliveries(options),
  };
  const appFor = (userId) => createApp({
    affiliationStore: store, referralStore: store, nodeEnv: 'test', now: () => new Date(FIXED_NOW),
    resolveIdentity: () => ({ userId }), notifier,
  });
  return { store, outbox, settled: () => Promise.all(started), worker: appFor(WORKER), intake: appFor(INTAKE) };
}

async function chooseAffiliation(app) {
  const current = await request(app).get('/api/me/affiliation');
  const saved = await request(app).put('/api/me/affiliation').send({ programId: P_REFERRING, version: current.body.version });
  assert.equal(saved.status, 200);
}

const draft = (extra = {}) => ({
  submissionId: randomUUID(),
  receivingProgramId: P_RECEIVING,
  participantName: 'Synthetic Person Idempotency',
  contactMethod: 'NOT_AVAILABLE',
  referralContext: 'Synthetic context for the double-submit test',
  ...extra,
});

const referralAudit = (store) => store._referralAuditEvents.filter((e) => e.entityType === 'REFERRAL');

describe('Task MM: the same submission many times is one referral (Handoff PRD 20, 21; MVP 20; gate 25)', () => {
  for (const path of ['Direct Referral', 'Find a Program']) {
    test(`${path}: ${BURST} identical sends at once make one referral, one audit entry, one email`, async () => {
      const ctx = startApp();
      await chooseAffiliation(ctx.worker);
      const body = path === 'Find a Program' ? draft({ gpme: { needCategoryIds: [EMPLOYMENT] } }) : draft();

      const answers = await Promise.all(
        Array.from({ length: BURST }, () => request(ctx.worker).post('/api/referrals').send({ ...body })),
      );
      await ctx.settled();

      // Exactly one is new; every other answer points at the same referral.
      const statuses = answers.map((res) => res.status).sort();
      assert.deepEqual(statuses, [200, 200, 200, 200, 200, 200, 200, 200, 200, 201]);
      assert.ok(answers.filter((r) => r.status === 200).every((r) => r.body.status === 'ALREADY_RECEIVED'));
      const ids = new Set(answers.map((res) => res.body.referral.referralId));
      assert.equal(ids.size, 1, 'every answer names the same referral');

      // One of everything that a referral leaves behind.
      assert.equal(ctx.store._referrals.length, 1);
      assert.deepEqual(referralAudit(ctx.store).map((e) => e.action), ['CREATED']);
      assert.equal(ctx.store._gpmeEvaluations.length, path === 'Find a Program' ? 1 : 0);
      assert.equal(ctx.outbox.list().length, 1, 'one email to the receiving Program');

      // What people see: one row for the sender, one in the queue, one in the reports.
      const sent = await request(ctx.worker).get('/api/referrals/sent');
      assert.equal(sent.body.referrals.length, 1);
      const queue = await request(ctx.intake).get(`/api/referrals/received?programId=${P_RECEIVING}`);
      assert.equal(queue.body.referrals.length, 1);
      const report = await request(ctx.worker).get('/api/reports/total-referrals?period=MONTHLY');
      assert.equal(report.status, 200);
      assert.deepEqual([report.body.metric, report.body.value], ['TOTAL_REFERRALS', 1]);

      // A later resend (the worker's retry after a lost answer) is still the same one.
      const later = await request(ctx.worker).post('/api/referrals').send({ ...body });
      assert.deepEqual([later.status, later.body.status, later.body.referral.referralId], [200, 'ALREADY_RECEIVED', [...ids][0]]);
      await ctx.settled();
      assert.equal(ctx.store._referrals.length, 1);
      assert.equal(ctx.outbox.list().length, 1);
    });
  }

  test('the safe check answers RECEIVED for a saved submission and NOT_RECEIVED for one that never arrived', async () => {
    const ctx = startApp();
    await chooseAffiliation(ctx.worker);
    const body = draft();
    assert.equal((await request(ctx.worker).post('/api/referrals').send(body)).status, 201);

    const found = await request(ctx.worker).get(`/api/referrals/submissions/${body.submissionId}`);
    assert.deepEqual([found.status, found.body.status], [200, 'RECEIVED']);
    const missing = await request(ctx.worker).get(`/api/referrals/submissions/${randomUUID()}`);
    assert.deepEqual([missing.status, missing.body.status], [200, 'NOT_RECEIVED']);
    // Checking never creates anything.
    assert.equal(ctx.store._referrals.length, 1);
  });

  test('the same Submission ID with changed details is refused, not saved as a second referral', async () => {
    const ctx = startApp();
    await chooseAffiliation(ctx.worker);
    const body = draft();
    assert.equal((await request(ctx.worker).post('/api/referrals').send(body)).status, 201);
    const before = JSON.stringify(ctx.store._referrals);

    const edited = await request(ctx.worker).post('/api/referrals').send({ ...body, referralContext: 'Synthetic edited context' });
    assert.deepEqual([edited.status, edited.body.code], [409, 'SUBMISSION_ID_CONFLICT']);
    assert.ok(!edited.text.includes('Synthetic Person Idempotency'), 'the refusal reveals nothing about the saved referral');
    assert.equal(JSON.stringify(ctx.store._referrals), before, 'nothing changed');
  });

  test('a failed attempt saves nothing; the retry with the same Submission ID saves exactly one', async (t) => {
    t.mock.method(console, 'error', () => {});
    const ctx = startApp();
    await chooseAffiliation(ctx.worker);
    const body = draft();

    ctx.store._failNextAudit();
    const failed = await request(ctx.worker).post('/api/referrals').send(body);
    assert.ok(failed.status >= 500, `a server failure, got ${failed.status}`);
    assert.ok(!failed.text.includes('Synthetic Person Idempotency'), 'the error reveals no participant data');
    assert.equal(ctx.store._referrals.length, 0, 'nothing was half-saved');
    const check = await request(ctx.worker).get(`/api/referrals/submissions/${body.submissionId}`);
    assert.equal(check.body.status, 'NOT_RECEIVED', 'the safe check tells the worker it is safe to resend');

    const retry = await request(ctx.worker).post('/api/referrals').send({ ...body });
    assert.equal(retry.status, 201);
    const again = await request(ctx.worker).post('/api/referrals').send({ ...body });
    assert.equal(again.body.status, 'ALREADY_RECEIVED');
    await ctx.settled();
    assert.equal(ctx.store._referrals.length, 1);
    assert.equal(ctx.outbox.list().length, 1);
  });

  test('two different referrals for the same person are both saved: repeat protection never blocks new work', async () => {
    const ctx = startApp();
    await chooseAffiliation(ctx.worker);
    const first = await request(ctx.worker).post('/api/referrals').send(draft());
    const second = await request(ctx.worker).post('/api/referrals').send(draft());
    assert.deepEqual([first.status, second.status], [201, 201]);
    assert.notEqual(first.body.referral.referralId, second.body.referral.referralId);
    assert.equal(ctx.store._referrals.length, 2);
  });
});
