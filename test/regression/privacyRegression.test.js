// Trello Task DD: privacy / data-leakage final regression, server side
// (Frozen Handoff PRD 5.4, 21, 25, 28, 34, 35; Handoff MVP 6, 21, 24, 25;
// acceptance gates 8, 29, 30, 31).
//
// Runs the whole application the way the synthetic dev server builds it
// (store, GPME, notifications on the simulated outbox) and drives every
// workflow with marked SYNTHETIC participant data:
//   - describe the need, match, GPME-assisted and Direct Referral,
//   - respond Not Appropriate with an explanation, correct the decision,
//     record and correct the outcome, a failed audit,
//   - every report, the sent and received lists,
//   - notification sending, including a NO_RECIPIENT failure,
//   - an interpreter that fails while carrying the worker's text.
// Then it checks that no marker reached any console channel, any error
// response, any report, or any notification email.
//
// What other suites already cover, and this file does not repeat:
//   test/securityPass.test.js       401/403, no-store, first lifecycle logs
//   test/regression/securityRegression.test.js  refusals leak nothing
//   test/notifications.test.js, test/notificationWiring.test.js  email content
//   test/gpmeInterpretation.test.js  the describe-step boundary in detail
// The browser side (URLs, storage, console, cookies on the fixed-identity
// fixture) is e2e/privacy.spec.js. The Task O demo mode's session cookie
// is checked here, at the end of this file.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createDemoSignIn } from '../../scripts/demoSignIn.js';
import { withDemoPeople } from '../../scripts/demoPersonas.js';
import { createMemoryReferralStore } from '../../src/referrals/memoryReferralStore.js';
import { createNotificationService } from '../../src/notifications/notificationService.js';
import { createSimulatedOutboxSender } from '../../src/notifications/simulatedOutbox.js';
import { DEV_RECEIVING_PROGRAM_ID, DEV_USER_ID, syntheticSeed } from '../../scripts/syntheticSeed.js';

// Participant data that must be kept out of logs, aggregate reports,
// notifications, URLs, browser storage and unauthorized responses (Frozen
// Handoff PRD 34; Handoff MVP 25). Authorized referral views legitimately show it.
const MARK = Object.freeze({
  name: 'Synthetic Person DDLEAKNAME',
  email: 'ddleak.contact@example.test',
  context: 'Synthetic context DDLEAKCTX',
  notes: 'Synthetic note DDLEAKNOTE',
  explanation: 'Synthetic explanation DDLEAKEXPL',
  correction: 'Synthetic correction DDLEAKFIX',
  describe: 'Synthetic description DDLEAKDESC needs housing help',
});
const MARKERS = ['DDLEAKNAME', 'ddleak.contact', 'DDLEAKCTX', 'DDLEAKNOTE', 'DDLEAKEXPL', 'DDLEAKFIX', 'DDLEAKDESC'];
// The participant ZIP is checked as a whole word, so a random ID that
// happens to contain those digits is not a false alarm.
const ZIP = '99577';
const ZIP_WORD = new RegExp(`\\b${ZIP}\\b`);

const JOBS = 5; // Job Readiness Workshop (sample): has no notification email on purpose

function assertClean(text, where) {
  const value = String(text);
  for (const marker of MARKERS) assert.ok(!value.includes(marker), `${where} contains "${marker}"`);
  assert.doesNotMatch(value, ZIP_WORD, `${where} contains the participant ZIP`);
}

// Every console channel the app or its libraries could write to.
function captureConsole(t) {
  const lines = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    const original = console[level];
    console[level] = (...args) => lines.push(`${level}: ${args.map((a) => (a instanceof Error ? `${a.name} ${a.message} ${a.stack}` : String(a))).join(' ')}`);
    t.after(() => { console[level] = original; });
  }
  return lines;
}

// The app as scripts/dev-synthetic-server.js builds it, with a switchable
// identity and a handle on every notification started.
function build({ gpmeInterpreter } = {}) {
  const store = createMemoryReferralStore(syntheticSeed({ programManagement: true, organizationManagement: true, receiving: true }));
  const sender = createSimulatedOutboxSender({ nodeEnv: 'test' });
  const real = createNotificationService({ store: store.notificationStore, sender });
  const started = [];
  const notifier = {
    ...real,
    notifyReferralCommitted(args) {
      const pending = real.notifyReferralCommitted(args);
      started.push(pending);
      return pending;
    },
  };
  const who = { userId: DEV_USER_ID };
  const app = createApp({
    affiliationStore: store,
    referralStore: store,
    resolveIdentity: () => (who.userId === null ? null : { userId: who.userId }),
    notifier,
    nodeEnv: 'test',
    ...(gpmeInterpreter ? { gpmeInterpreter } : {}),
  });
  return { app, store, sender, notifier: real, started, who };
}

function referralBody(extra = {}) {
  return {
    submissionId: randomUUID(),
    receivingProgramId: DEV_RECEIVING_PROGRAM_ID,
    participantName: MARK.name,
    contactMethod: 'EMAIL',
    contactValue: MARK.email,
    participantZip: ZIP,
    referralContext: MARK.context,
    notes: MARK.notes,
    ...extra,
  };
}

async function setAffiliation(agent, programId = 1) {
  const current = await agent.get('/api/me/affiliation');
  const saved = await agent.put('/api/me/affiliation').send({ programId, version: current.body.version });
  assert.equal(saved.status, 200);
}

describe('Task DD: participant data stays out of logs, reports, notifications and unauthorized responses', () => {
  test('a whole working day writes no participant data to any console channel, report or email', async (t) => {
    const lines = captureConsole(t);
    const { app, store, sender, notifier, started } = build();
    const agent = request.agent(app);
    await setAffiliation(agent);

    // Find a Program: describe the need, then match on the confirmed criteria.
    const interpreted = await agent.post('/api/gpme/interpret').send({ text: `${MARK.describe} ${MARK.name} zip ${ZIP}` });
    assert.equal(interpreted.status, 200);
    // It proposes the ZIP back to the worker on purpose (Task D), but never
    // echoes the description or anything else typed.
    assert.equal(interpreted.body.participantZip, ZIP);
    for (const marker of MARKERS) assert.ok(!interpreted.text.includes(marker), `the interpret response contains "${marker}"`);
    const matched = await agent.post('/api/gpme/match').send({ needCategoryIds: [4] });
    assert.equal(matched.status, 200);
    const offered = [...matched.body.plausible, ...matched.body.possible].map((p) => p.programId);
    assert.ok(offered.includes(DEV_RECEIVING_PROGRAM_ID), 'the Housing sample Program is offered');

    // A GPME-assisted referral, a retry of it, and a Direct Referral to a
    // Program with no notification email (a NO_RECIPIENT failure).
    const gpmeBody = referralBody({ gpme: { needCategoryIds: [4] } });
    const created = await agent.post('/api/referrals').send(gpmeBody);
    assert.equal(created.status, 201);
    const retried = await agent.post('/api/referrals').send(gpmeBody);
    assert.equal(retried.status, 200);
    const direct = await agent.post('/api/referrals').send(referralBody({ receivingProgramId: JOBS }));
    assert.equal(direct.status, 201);
    const id = created.body.referral.referralId;

    // Lists never carry contact details or notes. The receiving queue shows
    // the need to the authorized receivers on purpose (so they can triage);
    // the sent list does not show it.
    for (const [path, hidden] of [
      ['/api/referrals/sent', ['ddleak.contact', 'DDLEAKCTX', 'DDLEAKNOTE']],
      ['/api/referrals/received', ['ddleak.contact', 'DDLEAKNOTE']],
    ]) {
      const list = await agent.get(path);
      assert.equal(list.status, 200);
      for (const marker of hidden) assert.ok(!list.text.includes(marker), `${path} contains "${marker}"`);
    }

    // Receiving: Not Appropriate with an explanation, then corrections.
    const responded = await agent.post(`/api/referrals/${id}/response`)
      .send({ decision: 'NOT_APPROPRIATE', reasonId: 5, explanation: MARK.explanation });
    assert.equal(responded.status, 200);
    const versionOf = async () => (await agent.get(`/api/referrals/${id}`)).body.referral.version;
    let version = await versionOf();
    const corrected = await agent.post(`/api/referrals/${id}/response/correction`).send({ decision: 'ACCEPTED', version });
    assert.equal(corrected.status, 200);
    const recorded = await agent.post(`/api/referrals/${id}/outcome`).send({ outcome: 'RESULTED_IN_SERVICE' });
    assert.equal(recorded.status, 200);
    version = await versionOf();
    store._failNextAudit();
    const failed = await agent.post(`/api/referrals/${id}/outcome/correction`)
      .send({ outcome: 'DID_NOT_RESULT_IN_SERVICE', version });
    assert.equal(failed.status, 500);
    assertClean(failed.text, 'the 500 response');
    const outcomeFixed = await agent.post(`/api/referrals/${id}/outcome/correction`)
      .send({ outcome: 'DID_NOT_RESULT_IN_SERVICE', version });
    assert.equal(outcomeFixed.status, 200);
    // The second referral was only sent by the developer, who does not
    // receive for Program 5: responding is refused without echoing anything.
    const second = direct.body.referral.referralId;
    const refused = await agent.post(`/api/referrals/${second}/response`)
      .send({ decision: 'NOT_APPROPRIATE', reasonId: 5, explanation: MARK.explanation });
    assert.equal(refused.status, 403);
    assertClean(refused.text, 'a refusal');

    // Reports are aggregate: no participant data and no referral IDs.
    for (const period of ['WEEKLY', 'YEARLY']) {
      for (const report of ['total-referrals', 'timing-metrics', 'referral-activity']) {
        const res = await agent.get(`/api/reports/${report}?period=${period}`);
        assert.equal(res.status, 200, `${report} ${period}`);
        assertClean(res.text, `${report} (${period})`);
        assert.doesNotMatch(res.text, /"referralId"|"participant|"contact|"notes"|"explanation"|"referralContext"/, `${report} carries a referral field`);
      }
    }
    assertClean((await agent.get('/api/reports/departments')).text, 'the Departments list');

    // Notifications finish: the GPME-assisted referral is SENT once (its
    // retry reuses the same delivery), the Direct Referral to Program 5
    // FAILS with NO_RECIPIENT. Then a retry run.
    const outcomes = await Promise.all(started);
    assert.deepEqual(outcomes.map((o) => o.outcome).sort(), ['FAILED', 'SENT', 'SENT']);
    assert.equal(sender.list().length, 1, 'one email, not two');
    await notifier.retryPendingDeliveries();
    for (const message of sender.list()) {
      assertClean(`${message.subject}\n${message.body}`, 'a notification email');
    }

    assert.ok(lines.length >= 2, 'the failed audit and the NO_RECIPIENT failure are logged');
    assertClean(lines.join('\n'), 'console output');
  });

  test('an interpreter that fails while holding the worker\'s text logs none of it', async (t) => {
    const lines = captureConsole(t);
    const { app } = build({
      gpmeInterpreter: {
        version: 'broken-for-test',
        interpret({ text }) {
          const err = new Error(`could not read: ${text}`);
          err.detail = text;
          throw err;
        },
      },
    });
    const agent = request.agent(app);
    await setAffiliation(agent);
    const res = await agent.post('/api/gpme/interpret').send({ text: `${MARK.describe} ${MARK.name} zip ${ZIP}` });
    assert.equal(res.status, 503);
    assertClean(res.text, 'the 503 response');
    assert.ok(lines.length >= 1, 'the failure is logged');
    assertClean(lines.join('\n'), 'console output');
  });

  test('refused and invalid requests never echo the values they carried', async (t) => {
    const lines = captureConsole(t);
    const { app, who } = build();
    const agent = request.agent(app);
    await setAffiliation(agent);
    const created = await agent.post('/api/referrals').send(referralBody());
    assert.equal(created.status, 201);
    const id = created.body.referral.referralId;
    const { version } = created.body.referral;
    const long = 'x'.repeat(5000);

    const attempts = [
      ['bad email', () => agent.post('/api/referrals').send(referralBody({ contactValue: `not an email ${MARK.name}` }))],
      ['ZIP holding a name', () => agent.post('/api/referrals').send(referralBody({ participantZip: MARK.name }))],
      ['unexpected field', () => agent.post('/api/referrals').send(referralBody({ dateOfBirth: MARK.name }))],
      ['context too long', () => agent.post('/api/referrals').send(referralBody({ referralContext: `${MARK.context}${long}` }))],
      ['broken JSON', () => agent.post('/api/referrals').set('Content-Type', 'application/json').send(`{"notes":"${MARK.notes}"`)],
      ['unknown reason', () => agent.post(`/api/referrals/${id}/response`).send({ decision: 'NOT_APPROPRIATE', reasonId: 999, explanation: MARK.explanation })],
      ['explanation too long', () => agent.post(`/api/referrals/${id}/response`).send({ decision: 'NOT_APPROPRIATE', reasonId: 5, explanation: `${MARK.explanation}${long}` })],
      ['outcome not a value', () => agent.post(`/api/referrals/${id}/outcome`).send({ outcome: MARK.name })],
      ['outcome correction, bad values', () => agent.post(`/api/referrals/${id}/outcome/correction`).send({ outcome: MARK.name, version: MARK.notes })],
      ['decision correction, bad values', () => agent.post(`/api/referrals/${id}/response/correction`).send({ decision: MARK.name, explanation: MARK.correction, version })],
      ['match ZIP holding a name', () => agent.post('/api/gpme/match').send({ needCategoryIds: [4], participantZip: MARK.name })],
      ['match extra field', () => agent.post('/api/gpme/match').send({ needCategoryIds: [4], notes: MARK.notes })],
      ['describe too long', () => agent.post('/api/gpme/interpret').send({ text: `${MARK.describe}${long}` })],
      ['describe extra field', () => agent.post('/api/gpme/interpret').send({ text: 'housing', participantName: MARK.name })],
      ['query on the received list', () => agent.get(`/api/referrals/received?stage=${encodeURIComponent(MARK.name)}`)],
      ['query on the sent list', () => agent.get(`/api/referrals/sent?note=${encodeURIComponent(MARK.notes)}`)],
      ['query on match', () => agent.post(`/api/gpme/match?zip=${ZIP}`).send({ needCategoryIds: [4] })],
      ['report date holding a name', () => agent.get(`/api/reports/total-referrals?period=WEEKLY&date=${encodeURIComponent(MARK.name)}`)],
      ['referral ID holding a name', () => agent.get(`/api/referrals/${encodeURIComponent(MARK.name)}`)],
      ['unknown API path', () => agent.get(`/api/${encodeURIComponent(MARK.context)}`)],
    ];
    for (const [label, send] of attempts) {
      const res = await send();
      assert.ok(res.status >= 400 && res.status < 500, `${label}: expected a 4xx, got ${res.status}`);
      assertClean(res.text, `${label} (response)`);
    }

    // Someone who is not a QCH Connect user, and nobody at all.
    for (const userId of [999, null]) {
      who.userId = userId;
      const res = await agent.get(`/api/referrals/${id}`);
      assert.ok([401, 403].includes(res.status), `user ${userId}: ${res.status}`);
      assertClean(res.text, `user ${userId} (response)`);
    }

    assertClean(lines.join('\n'), 'console output');
  });
});

// The Task O demo mode (npm run dev:demo) is the one setup that uses a
// cookie: an HttpOnly session cookie holding only a random token. The
// browser test's "no cookies" expectation is about the fixed-identity
// fixture; this checks the demo cookie never carries participant data.
describe('Task DD: the Task O demo session cookie carries no participant data', () => {
  test('every cookie the demo sets, through a whole referral, is only the random session token', async (t) => {
    const lines = captureConsole(t);
    const store = createMemoryReferralStore(withDemoPeople(syntheticSeed({ receiving: true })));
    const demo = createDemoSignIn({ nodeEnv: 'development' });
    const server = express();
    demo.mount(server);
    server.use(createApp({ affiliationStore: store, referralStore: store, resolveIdentity: demo.resolveIdentity }));

    const setCookies = [];
    const seen = (res) => { setCookies.push(...(res.headers['set-cookie'] ?? [])); return res; };
    const referrer = request.agent(server);
    const receiver = request.agent(server);
    seen(await referrer.post('/demo/api/sign-in').send({ person: 'referring-worker' }));
    seen(await receiver.post('/demo/api/sign-in').send({ person: 'housing-receiver' }));

    const created = seen(await referrer.post('/api/referrals').send(referralBody()));
    assert.equal(created.status, 201);
    const id = created.body.referral.referralId;
    seen(await referrer.get('/api/referrals/sent'));
    seen(await receiver.get('/api/referrals/received'));
    seen(await receiver.get(`/api/referrals/${id}`));
    const responded = seen(await receiver.post(`/api/referrals/${id}/response`)
      .send({ decision: 'NOT_APPROPRIATE', reasonId: 5, explanation: MARK.explanation }));
    assert.equal(responded.status, 200);
    seen(await referrer.get(`/api/referrals/${id}`));
    seen(await receiver.get('/sent/'));
    seen(await referrer.post('/demo/api/sign-in').send({ person: 'wellness-receiver' }));
    seen(await receiver.post('/demo/api/sign-out'));

    assert.ok(setCookies.length >= 4, 'sign-in, switching and sign-out set the session cookie');
    for (const cookie of setCookies) {
      assertClean(cookie, 'a Set-Cookie header');
      assert.match(cookie, /^qch_demo_session=([0-9a-f]{32})?; Path=\/; HttpOnly; SameSite=Strict(; Max-Age=0)?$/, cookie);
    }
    assertClean(lines.join('\n'), 'console output');
  });
});
