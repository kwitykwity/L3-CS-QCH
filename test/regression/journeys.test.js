// Card 17: end-to-end regression journeys through the integrated
// application (Final Technical PRD 17.2, 17.3, 17.5; workflows 2.1 to 2.4,
// 3.9, 6.1, 6.2, 7.3, 7.4).
//
// Each journey drives the real Express app over HTTP the way the screens
// do, switching between staff members, from first sign-in to the end of a
// workflow. The per-card tests check each rule on its own; these check
// that the rules still hold together when the workflows run end to end.
//
// Covered here: everything merged on main (Direct Referral, receiving
// queue, response). GPME-assisted referral (#16, #27), outcome and
// corrections (#14), Program maintenance (#21, #22, #24, #25) and P0
// reporting (#18, #26) get journeys here as they merge; see
// docs/regression-coverage.md.
//
// The data store is the in-memory store. Running the same journeys
// against Azure SQL (PRD 17.2) waits on the Azure SQL store.
// All data is SYNTHETIC (PRD 15.5).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createMemoryReferralStore } from '../../src/referrals/memoryReferralStore.js';

// Staff in the synthetic organization.
const WORKER = 100;        // sends referrals; no receiving rights
const COLLEAGUE = 101;     // another sender
const INTAKE = 200;        // view + respond for Program 11 (receiving)
const INTAKE_VIEWER = 201; // view only for Program 11
const OTHER_INTAKE = 300;  // view + respond for Program 12
const ADMIN = 400;         // administers permissions; no referral access
const LEFT = 500;          // account deactivated

const P_FAMILY = 10;       // worker's Program
const P_ADULT_ED = 11;     // receives referrals
const P_HOUSING = 12;      // another receiving Program
const P_CLOSED = 13;       // discontinued

// Text that must never leave the referral records (PRD 5.4, 15.3).
const MARKERS = {
  name: 'Synthetic Person Journey Kappa',
  context: 'Synthetic context marker QX17CTX',
  notes: 'Synthetic note marker QX17NOTE',
  phone: '(555) 017-1717',
  explanation: 'Synthetic explanation marker QX17EXPL',
};

const grant = (userId, permission, programId, extra = {}) => ({
  userId, permission, scopeType: 'PROGRAM', programId, departmentId: null, grantSource: 'IN_APP', ...extra,
});

function organization() {
  return createMemoryReferralStore({
    departments: [
      { departmentId: 1, name: 'Synthetic Family Services', lifecycleStatus: 'ACTIVE' },
      { departmentId: 2, name: 'Synthetic Adult Services', lifecycleStatus: 'ACTIVE' },
    ],
    programs: [
      { programId: P_FAMILY, departmentId: 1, name: 'Synthetic Family Center', site: 'Site A', lifecycleStatus: 'ACTIVE' },
      { programId: P_ADULT_ED, departmentId: 2, name: 'Synthetic Adult Education', site: 'Site B', lifecycleStatus: 'ACTIVE' },
      { programId: P_HOUSING, departmentId: 2, name: 'Synthetic Housing Desk', site: 'Site C', lifecycleStatus: 'ACTIVE' },
      { programId: P_CLOSED, departmentId: 2, name: 'Synthetic Closed Program', site: null, lifecycleStatus: 'DISCONTINUED' },
    ],
    users: [
      { userId: WORKER, isActive: true, displayName: 'Synthetic Worker' },
      { userId: COLLEAGUE, isActive: true, currentProgramId: P_HOUSING },
      { userId: INTAKE, isActive: true, currentProgramId: P_ADULT_ED },
      { userId: INTAKE_VIEWER, isActive: true, currentProgramId: P_ADULT_ED },
      { userId: OTHER_INTAKE, isActive: true, currentProgramId: P_HOUSING },
      { userId: ADMIN, isActive: true },
      { userId: LEFT, isActive: false },
    ],
    grants: [
      grant(INTAKE, 'VIEW_RECEIVED_REFERRAL', P_ADULT_ED), grant(INTAKE, 'RESPOND_TO_REFERRAL', P_ADULT_ED),
      grant(INTAKE_VIEWER, 'VIEW_RECEIVED_REFERRAL', P_ADULT_ED),
      grant(OTHER_INTAKE, 'VIEW_RECEIVED_REFERRAL', P_HOUSING), grant(OTHER_INTAKE, 'RESPOND_TO_REFERRAL', P_HOUSING),
      grant(ADMIN, 'ADMINISTER_PERMISSIONS', null, { scopeType: 'ORG' }),
      grant(ADMIN, 'VIEW_AGGREGATE_REPORTING', null, { scopeType: 'ORG' }),
    ],
    notAppropriateReasons: [
      { reasonId: 1, code: 'PROGRAM_CRITERIA_NOT_MET', label: 'Program criteria not met', displayOrder: 1 },
      { reasonId: 2, code: 'PROGRAM_UNAVAILABLE', label: 'Program currently unavailable', displayOrder: 2 },
      { reasonId: 3, code: 'NOT_APPROPRIATE_FOR_NEED', label: 'Program not appropriate for identified need', displayOrder: 3 },
      { reasonId: 4, code: 'UNABLE_TO_PROCEED', label: 'Unable to proceed with referral', displayOrder: 4 },
      { reasonId: 5, code: 'OTHER', label: 'Other', displayOrder: 5 },
    ],
  });
}

// The integrated app, plus a way to act as one staff member at a time.
// Identity comes only from resolveIdentity (PRD 3.2); requests here are
// awaited one at a time, so `current` always names the acting user.
function startApp() {
  const store = organization();
  let current = null;
  const app = createApp({ affiliationStore: store, referralStore: store, resolveIdentity: () => (current ? { userId: current } : null) });
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
  });
  return { store, as, responses };
}

// Captures everything written to the console while fn runs.
async function captureConsole(fn) {
  const lines = [];
  const saved = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  for (const key of Object.keys(saved)) console[key] = (...args) => lines.push(args.map(String).join(' '));
  try {
    await fn();
  } finally {
    Object.assign(console, saved);
  }
  return lines.join('\n');
}

async function chooseAffiliation(user, programId) {
  const current = await user.get('/api/me/affiliation');
  assert.equal(current.status, 200);
  const saved = await user.put('/api/me/affiliation', { programId, version: current.body.version });
  assert.equal(saved.status, 200);
  return saved.body;
}

function referralTo(receivingProgramId, extra = {}) {
  return {
    submissionId: randomUUID(),
    receivingProgramId,
    participantName: MARKERS.name,
    contactMethod: 'PHONE_TEXT',
    contactValue: MARKERS.phone,
    participantZip: '99917',
    referralContext: MARKERS.context,
    notes: MARKERS.notes,
    ...extra,
  };
}

describe('Journey 1: Direct Referral, accepted by the receiving Program', () => {
  test('first use -> affiliation -> send -> lost confirmation -> receive -> accept -> both sides see it', async () => {
    const { store, as, responses } = startApp();
    const worker = as(WORKER);
    const intake = as(INTAKE);

    // First use: no affiliation yet, so sending fails closed (PRD 3.9).
    const draft = referralTo(P_ADULT_ED);
    const blocked = await worker.post('/api/referrals', draft);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, 'AFFILIATION_REQUIRED');
    assert.equal(store._referrals.length, 0);

    // Programs offered: active only, discontinued left out (PRD 4.4).
    const programs = await worker.get('/api/programs');
    assert.deepEqual(programs.body.programs.map((p) => p.programId).sort(), [P_FAMILY, P_ADULT_ED, P_HOUSING]);

    await chooseAffiliation(worker, P_FAMILY);

    // Send. The same Submission ID is kept for the whole logical referral.
    const sent = await worker.post('/api/referrals', draft);
    assert.equal(sent.status, 201);
    assert.equal(sent.body.status, 'RECEIVED');
    const referralId = sent.body.referral.referralId;
    assert.equal(sent.body.referral.referringProgramId, P_FAMILY, 'Referring Program = stored affiliation');

    // The confirmation is "lost": the page asks the safe check, then resends.
    const check = await worker.get(`/api/referrals/submissions/${draft.submissionId}`);
    assert.equal(check.body.status, 'RECEIVED');
    const resent = await worker.post('/api/referrals', draft);
    assert.equal(resent.status, 200);
    assert.equal(resent.body.status, 'ALREADY_RECEIVED');
    assert.equal(resent.body.referral.referralId, referralId);
    assert.equal(store._referrals.length, 1, 'one referral for one logical submission (PRD 7.3)');

    // The worker sees it as sent and awaiting a response.
    const mine = await worker.get('/api/referrals/sent');
    assert.deepEqual(mine.body.referrals.map((r) => [r.referralId, r.stage]), [[referralId, 'AWAITING_RESPONSE']]);

    // The receiving Program finds it in its queue.
    const queue = await intake.get(`/api/referrals/received?programId=${P_ADULT_ED}&stage=AWAITING_RESPONSE`);
    assert.equal(queue.status, 200);
    assert.deepEqual(queue.body.referrals.map((r) => r.referralId), [referralId]);

    // Opens it: full detail for an authorized receiver, with the action allowed.
    const opened = await intake.get(`/api/referrals/${referralId}`);
    assert.equal(opened.status, 200);
    assert.equal(opened.body.referral.participantName, MARKERS.name);
    assert.equal(opened.body.referral.source, 'DIRECT');
    assert.deepEqual(opened.body.viewerAccess, { asCreator: false, asReceiver: true, canRespond: true });

    // Accepts it.
    const accepted = await intake.post(`/api/referrals/${referralId}/response`, { decision: 'ACCEPTED' });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.status, 'RESPONDED');

    // A second response is refused; nothing changes (PRD 6.2).
    const again = await intake.post(`/api/referrals/${referralId}/response`, { decision: 'NOT_APPROPRIATE', reasonId: 1 });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'ALREADY_RESPONDED');

    // Both sides now see Accepted, outcome still pending (PRD 6.1, 6.2).
    const workerView = await worker.get(`/api/referrals/${referralId}`);
    assert.equal(workerView.body.referral.decision, 'ACCEPTED');
    assert.equal(workerView.body.referral.serviceOutcome, 'NOT_RECORDED');
    assert.equal(workerView.body.referral.stage, 'ACCEPTED_OUTCOME_PENDING');
    assert.equal(workerView.body.viewerAccess.canRespond, false, 'the sender cannot respond');
    const pending = await intake.get(`/api/referrals/received?programId=${P_ADULT_ED}&stage=ACCEPTED_OUTCOME_PENDING`);
    assert.deepEqual(pending.body.referrals.map((r) => r.referralId), [referralId]);
    const stillAwaiting = await intake.get(`/api/referrals/received?programId=${P_ADULT_ED}&stage=AWAITING_RESPONSE`);
    assert.deepEqual(stillAwaiting.body.referrals, []);

    // Audit trail: created then accepted, by the right people (PRD 9.6).
    const trail = store._referralAuditEvents.filter((e) => e.entityId === referralId);
    assert.deepEqual(trail.map((e) => [e.action, e.actorUserId]), [['CREATED', WORKER], ['ACCEPTED', INTAKE]]);

    // Every API answer in the journey was marked no-store (PRD 5.5).
    for (const res of responses) assert.equal(res.headers['cache-control'], 'no-store', res.req?.path);
  });
});

describe('Journey 2: Not Appropriate, then the worker decides the next step', () => {
  test('reason + explanation return to the worker; nothing is rerouted; a new referral is a new lifecycle', async () => {
    const { store, as } = startApp();
    const worker = as(WORKER);
    const intake = as(INTAKE);
    await chooseAffiliation(worker, P_FAMILY);

    const first = await worker.post('/api/referrals', referralTo(P_ADULT_ED));
    const referralId = first.body.referral.referralId;

    // The receiver picks a configured reason (PRD 6.3).
    const reasons = await intake.get('/api/referrals/not-appropriate-reasons');
    assert.deepEqual(reasons.body.reasons.map((r) => r.label), [
      'Program criteria not met', 'Program currently unavailable', 'Program not appropriate for identified need',
      'Unable to proceed with referral', 'Other',
    ]);
    const answered = await intake.post(`/api/referrals/${referralId}/response`, {
      decision: 'NOT_APPROPRIATE', reasonId: 2, explanation: MARKERS.explanation,
    });
    assert.equal(answered.status, 200);

    // It comes back to the worker with the reason and explanation (PRD 2.3).
    const view = await worker.get(`/api/referrals/${referralId}`);
    assert.equal(view.body.referral.decision, 'NOT_APPROPRIATE');
    assert.equal(view.body.referral.stage, 'COMPLETE');
    assert.equal(view.body.referral.notAppropriateReason.label, 'Program currently unavailable');
    assert.equal(view.body.referral.notAppropriateExplanation, MARKERS.explanation);

    // QCH Connect never reroutes on its own (PRD 2.3).
    assert.equal(store._referrals.length, 1);
    assert.equal((await as(OTHER_INTAKE).get('/api/referrals/received')).body.referrals.length, 0);

    // The worker chooses to try another Program: a new referral, new ID.
    const second = await worker.post('/api/referrals', referralTo(P_HOUSING));
    assert.equal(second.status, 201);
    assert.notEqual(second.body.referral.referralId, referralId);
    const housingQueue = await as(OTHER_INTAKE).get('/api/referrals/received');
    assert.deepEqual(housingQueue.body.referrals.map((r) => r.referralId), [second.body.referral.referralId]);

    // The first referral keeps its own history.
    const firstAgain = await worker.get(`/api/referrals/${referralId}`);
    assert.equal(firstAgain.body.referral.receivingProgram.programId, P_ADULT_ED);
    assert.equal(firstAgain.body.referral.decision, 'NOT_APPROPRIATE');
  });
});

describe('Journey 3: who can see and do what, along the way (PRD 3.3 to 3.7, 17.3)', () => {
  test('each role gets exactly its access to one referral, and refusals change nothing', async () => {
    const { store, as } = startApp();
    const worker = as(WORKER);
    await chooseAffiliation(worker, P_FAMILY);
    const { body } = await worker.post('/api/referrals', referralTo(P_ADULT_ED));
    const id = body.referral.referralId;
    const snapshot = () => JSON.stringify(store._referrals);
    const before = snapshot();

    // Hidden is the same as missing: another sender, another Program's
    // receiver, and an administrator all get 404 (PRD 3.3, 3.5).
    for (const userId of [COLLEAGUE, OTHER_INTAKE, ADMIN]) {
      const res = await as(userId).get(`/api/referrals/${id}`);
      assert.equal(res.status, 404, `user ${userId}`);
      assert.deepEqual(res.body, { error: 'Referral not found.', code: 'REFERRAL_NOT_FOUND' });
      const missing = await as(userId).get('/api/referrals/999999');
      assert.deepEqual(missing.body, res.body, 'a real hidden referral looks exactly like a missing one');
    }

    // A view-only receiver can read but not respond (403, nothing changes).
    const viewer = as(INTAKE_VIEWER);
    assert.equal((await viewer.get(`/api/referrals/${id}`)).body.viewerAccess.canRespond, false);
    const denied = await viewer.post(`/api/referrals/${id}/response`, { decision: 'ACCEPTED' });
    assert.equal(denied.status, 403);

    // Another Program's receiver cannot respond, and cannot list this Program.
    assert.equal((await as(OTHER_INTAKE).post(`/api/referrals/${id}/response`, { decision: 'ACCEPTED' })).status, 404);
    assert.equal((await as(OTHER_INTAKE).get(`/api/referrals/received?programId=${P_ADULT_ED}`)).status, 403);

    // The sender can see the referral but cannot respond to it (403).
    assert.equal((await worker.post(`/api/referrals/${id}/response`, { decision: 'ACCEPTED' })).status, 403);

    // A deactivated account and a missing sign-in get nothing.
    assert.equal((await as(LEFT).get(`/api/referrals/${id}`)).status, 403);
    assert.equal((await as(null).get(`/api/referrals/${id}`)).status, 401);

    // Identity can't be smuggled in through the query or body (PRD 3.2, 10.3).
    assert.equal((await as(COLLEAGUE).get(`/api/referrals/sent?userId=${WORKER}`)).status, 400);
    assert.equal((await as(INTAKE).post(`/api/referrals/${id}/response`, { decision: 'ACCEPTED', userId: WORKER })).status, 400);

    assert.equal(snapshot(), before, 'no refused request changed the referral');
  });
});

describe('Journey 4: organization changes during work keep history intact (PRD 3.9, 4.4, 9.1)', () => {
  test('a new affiliation affects only later referrals; a discontinued Program stops new referrals only', async () => {
    const { store, as } = startApp();
    const worker = as(WORKER);
    await chooseAffiliation(worker, P_FAMILY);
    const early = await worker.post('/api/referrals', referralTo(P_ADULT_ED));

    // The worker moves to another Program.
    await chooseAffiliation(worker, P_HOUSING);
    const later = await worker.post('/api/referrals', referralTo(P_ADULT_ED));
    assert.equal(later.body.referral.referringProgramId, P_HOUSING);
    const earlyView = await worker.get(`/api/referrals/${early.body.referral.referralId}`);
    assert.equal(earlyView.body.referral.referringProgram.programId, P_FAMILY, 'history keeps the original Referring Program');

    // A stale affiliation version is refused, never silently applied (PRD 9.4).
    const stale = await worker.put('/api/me/affiliation', { programId: P_FAMILY, version: 'v1' });
    assert.equal(stale.status, 409);

    // A discontinued Program: no new referrals, existing ones still readable.
    const refused = await worker.post('/api/referrals', referralTo(P_CLOSED));
    assert.equal(refused.status, 422);
    assert.equal(refused.body.code, 'RECEIVING_PROGRAM_NOT_SELECTABLE');
    await store._setProgramStatus(P_ADULT_ED, 'DISCONTINUED');
    assert.equal((await worker.post('/api/referrals', referralTo(P_ADULT_ED))).status, 422);
    const stillThere = await as(INTAKE).get(`/api/referrals/${early.body.referral.referralId}`);
    assert.equal(stillThere.status, 200);
    assert.equal(stillThere.body.referral.receivingProgram.programId, P_ADULT_ED);
  });
});

describe('Journey 5: participant information stays where it belongs (PRD 5.4, 5.5, 10.5, 15.3)', () => {
  test('across a whole journey, including errors, nothing sensitive reaches logs, lists, errors or URLs', async () => {
    const { as, responses } = startApp();
    let referralId;
    const logs = await captureConsole(async () => {
      const worker = as(WORKER);
      const intake = as(INTAKE);
      await chooseAffiliation(worker, P_FAMILY);
      // Some failures on the way: invalid input, an unknown field, a bad JSON body.
      await worker.post('/api/referrals', referralTo(P_ADULT_ED, { contactValue: `${MARKERS.phone} not a phone` }));
      await worker.post('/api/referrals', { ...referralTo(P_ADULT_ED), [MARKERS.name]: 1 });
      const sent = await worker.post('/api/referrals', referralTo(P_ADULT_ED));
      referralId = sent.body.referral.referralId;
      await worker.get('/api/referrals/sent');
      await intake.get('/api/referrals/received');
      await intake.post(`/api/referrals/${referralId}/response`, {
        decision: 'NOT_APPROPRIATE', reasonId: 5, explanation: MARKERS.explanation,
      });
      await intake.post(`/api/referrals/${referralId}/response`, { decision: 'ACCEPTED' });
    });

    const values = Object.values(MARKERS);
    for (const value of values) assert.ok(!logs.includes(value), `log contains ${value}`);

    for (const res of responses) {
      const url = res.req.path;
      for (const value of values) assert.ok(!decodeURIComponent(url).includes(value), `URL contains ${value}`);
      const isDetail = /^\/api\/referrals\/\d+$/.test(url) && res.status === 200;
      const isReceivingQueue = url.startsWith('/api/referrals/received') && res.status === 200;
      const text = JSON.stringify(res.body ?? {});
      if (!isDetail) {
        // Contact details, Notes and the Not Appropriate explanation appear
        // only on the authorized single-referral view (PRD 6.5, 10.5).
        for (const value of [MARKERS.notes, MARKERS.phone, MARKERS.explanation]) {
          assert.ok(!text.includes(value), `${res.req.method} ${url} (${res.status}) returned ${value}`);
        }
        // The need is shown in the receiving queue to authorized receivers
        // (card 6), and nowhere else outside the detail view.
        if (!isReceivingQueue) assert.ok(!text.includes(MARKERS.context), `${res.req.method} ${url} returned the need`);
      }
      if (res.status >= 400) {
        for (const value of values) assert.ok(!text.includes(value), `error body echoes ${value}`);
      }
    }
  });
});

describe('Journey 6: double clicks and races end in one result (PRD 7.3, 6.2)', () => {
  test('two sends of one referral at the same moment -> one referral; two responders at once -> one response', async () => {
    const { store, as } = startApp();
    await chooseAffiliation(as(WORKER), P_FAMILY);
    const draft = referralTo(P_ADULT_ED);

    // Not awaited one at a time: both requests are in flight together.
    // (Same user, so the shared identity is safe here.)
    const app = createApp({ affiliationStore: store, referralStore: store, resolveIdentity: () => ({ userId: WORKER }) });
    const [a, b] = await Promise.all([
      request(app).post('/api/referrals').send(draft),
      request(app).post('/api/referrals').send(draft),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 201]);
    assert.equal(a.body.referral.referralId, b.body.referral.referralId);
    assert.equal(store._referrals.length, 1);

    const id = a.body.referral.referralId;
    const intakeApp = createApp({ affiliationStore: store, referralStore: store, resolveIdentity: () => ({ userId: INTAKE }) });
    const [r1, r2] = await Promise.all([
      request(intakeApp).post(`/api/referrals/${id}/response`).send({ decision: 'ACCEPTED' }),
      request(intakeApp).post(`/api/referrals/${id}/response`).send({ decision: 'NOT_APPROPRIATE', reasonId: 1 }),
    ]);
    assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
    assert.equal(store._referralAuditEvents.filter((e) => e.entityId === id && e.action !== 'CREATED').length, 1, 'one response audit event');
  });
});
