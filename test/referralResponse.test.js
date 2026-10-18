// Referral response lifecycle (Trello card 7):
// Awaiting Response -> Accepted / Not Appropriate. All data is SYNTHETIC.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
import { createReferralService } from '../src/referrals/referralService.js';
import { createReferralQueryService } from '../src/referrals/referralQueryService.js';
import { createResponseService, validateResponse } from '../src/referrals/responseService.js';

const CREATOR = 100;        // affiliated with Program 10; no grants
const RESPONDER = 200;      // view + respond for Program 11
const VIEWER_ONLY = 201;    // view only for Program 11
const RESPOND_ONLY = 202;   // respond only for Program 11
const OTHER_PROGRAM = 203;  // view + respond for Program 12
const REVOKED = 204;        // respond for 11, revoked
const DEMO = 205;           // DEMO view + respond for 11
const ADMIN = 206;          // admin / management grants only
const INACTIVE = 207;       // respond for 11, inactive account
const SECOND = 208;         // another view + respond user for Program 11

const SECRET_EXPLANATION = 'Synthetic sensitive explanation XYZZY';

const g = (userId, permission, extra = {}) => ({
  userId, permission, scopeType: 'PROGRAM', programId: 11, departmentId: null, grantSource: 'IN_APP', ...extra,
});

function seed({ now } = {}) {
  return createMemoryReferralStore({
    departments: [{ departmentId: 1, name: 'Synthetic Dept', lifecycleStatus: 'ACTIVE' }],
    programs: [
      { programId: 10, departmentId: 1, name: 'Program Ten', site: null, lifecycleStatus: 'ACTIVE' },
      { programId: 11, departmentId: 1, name: 'Program Eleven', site: null, lifecycleStatus: 'ACTIVE' },
      { programId: 12, departmentId: 1, name: 'Program Twelve', site: null, lifecycleStatus: 'ACTIVE' },
    ],
    users: [CREATOR, RESPONDER, VIEWER_ONLY, RESPOND_ONLY, OTHER_PROGRAM, REVOKED, DEMO, ADMIN, SECOND]
      .map((userId) => ({ userId, isActive: true, currentProgramId: userId === CREATOR ? 10 : null }))
      .concat([{ userId: INACTIVE, isActive: false }]),
    grants: [
      g(RESPONDER, 'VIEW_RECEIVED_REFERRAL'), g(RESPONDER, 'RESPOND_TO_REFERRAL'),
      g(VIEWER_ONLY, 'VIEW_RECEIVED_REFERRAL'),
      g(RESPOND_ONLY, 'RESPOND_TO_REFERRAL'),
      g(OTHER_PROGRAM, 'VIEW_RECEIVED_REFERRAL', { programId: 12 }), g(OTHER_PROGRAM, 'RESPOND_TO_REFERRAL', { programId: 12 }),
      g(REVOKED, 'RESPOND_TO_REFERRAL', { revokedAt: '2026-10-01T00:00:00.000Z' }),
      g(DEMO, 'VIEW_RECEIVED_REFERRAL', { grantSource: 'DEMO' }), g(DEMO, 'RESPOND_TO_REFERRAL', { grantSource: 'DEMO' }),
      g(ADMIN, 'ADMINISTER_PERMISSIONS', { scopeType: 'ORG', programId: null }),
      g(ADMIN, 'MANAGE_ORGANIZATION', { scopeType: 'ORG', programId: null }),
      g(ADMIN, 'MANAGE_PROGRAM'), g(ADMIN, 'UPDATE_RECEIVED_REFERRAL'),
      g(INACTIVE, 'RESPOND_TO_REFERRAL'),
      g(SECOND, 'VIEW_RECEIVED_REFERRAL'), g(SECOND, 'RESPOND_TO_REFERRAL'),
    ],
    // The PRD's initial configurable list, plus two test-only entries.
    notAppropriateReasons: [
      { reasonId: 1, code: 'PROGRAM_CRITERIA_NOT_MET', label: 'Program criteria not met', displayOrder: 1 },
      { reasonId: 2, code: 'PROGRAM_UNAVAILABLE', label: 'Program currently unavailable', displayOrder: 2 },
      { reasonId: 3, code: 'NOT_APPROPRIATE_FOR_NEED', label: 'Program not appropriate for identified need', displayOrder: 3 },
      { reasonId: 4, code: 'UNABLE_TO_PROCEED', label: 'Unable to proceed with referral', displayOrder: 4 },
      { reasonId: 5, code: 'OTHER', label: 'Other', displayOrder: 5 },
      { reasonId: 6, code: 'RETIRED_SAMPLE', label: 'Retired sample reason', displayOrder: 6, lifecycleStatus: 'DISCONTINUED' },
      { reasonId: 7, code: 'NEEDS_DETAIL_SAMPLE', label: 'Sample reason that needs detail', displayOrder: 7, requiresExplanation: true },
    ],
  }, now ? { now } : undefined);
}

async function withReferral(options) {
  const store = seed(options);
  const created = await createReferralService({ store }).createDirectReferral(CREATOR, {
    submissionId: randomUUID(),
    receivingProgramId: 11,
    participantName: 'Synthetic Person',
    contactMethod: 'NOT_AVAILABLE',
    referralContext: 'Synthetic need',
  });
  return {
    store,
    id: created.referral.referralId,
    responses: createResponseService({ store }),
    queries: createReferralQueryService({ store }),
  };
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code);
    return true;
  });
}

const accept = { decision: 'ACCEPTED' };
const notAppropriate = (extra = {}) => ({ decision: 'NOT_APPROPRIATE', reasonId: 2, ...extra });

describe('Awaiting Response -> Accepted', () => {
  test('records RESPONDED + ACCEPTED, keeps outcome NOT_RECORDED, and audits it', async () => {
    const { store, id, responses } = await withReferral();
    const result = await responses.respond(RESPONDER, id, accept, { correlationId: 'c-1' });

    assert.equal(result.status, 'RESPONDED');
    assert.equal(result.referral.decision, 'ACCEPTED');
    assert.equal(result.referral.serviceOutcome, 'NOT_RECORDED', 'Accepted does not mean Resulted in Service (PRD 6.1)');
    assert.equal(result.referral.stage, 'ACCEPTED_OUTCOME_PENDING');
    assert.match(result.referral.firstRespondedAt, /Z$/);

    const row = store._referrals[0];
    assert.deepEqual([row.responseStatus, row.decision, row.respondedByUserId], ['RESPONDED', 'ACCEPTED', RESPONDER]);

    const event = store._referralAuditEvents.at(-1);
    assert.deepEqual(
      [event.entityType, event.entityId, event.action, event.actorUserId, event.correlationId],
      ['REFERRAL', id, 'ACCEPTED', RESPONDER, 'c-1'],
    );
    assert.deepEqual(event.before, { response_status: 'AWAITING_RESPONSE', decision: null });
  });
});

describe('Awaiting Response -> Not Appropriate', () => {
  test('requires a standard reason and returns it with the confirmed state', async () => {
    const { store, id, responses } = await withReferral();
    const result = await responses.respond(RESPONDER, id, notAppropriate({ explanation: `  ${SECRET_EXPLANATION}  ` }));

    assert.equal(result.referral.decision, 'NOT_APPROPRIATE');
    assert.equal(result.referral.stage, 'COMPLETE');
    assert.deepEqual(result.referral.notAppropriateReason, { reasonId: 2, label: 'Program currently unavailable' });
    assert.equal(result.referral.hasExplanation, true);
    assert.ok(!JSON.stringify(result).includes('XYZZY'), 'the confirmation does not echo the explanation (PRD 10.5)');
    assert.equal(store._referrals[0].notAppropriateExplanation, SECRET_EXPLANATION, 'stored trimmed');
    assert.equal(store._referrals[0].notAppropriateReasonId, 2);
  });

  test('the explanation is optional', async () => {
    const { store, id, responses } = await withReferral();
    await responses.respond(RESPONDER, id, notAppropriate());
    assert.equal(store._referrals[0].notAppropriateExplanation, null);
  });

  test('a whitespace-only explanation is stored as none', async () => {
    const { store, id, responses } = await withReferral();
    await responses.respond(RESPONDER, id, notAppropriate({ explanation: '   ' }));
    assert.equal(store._referrals[0].notAppropriateExplanation, null);
  });

  test('the explanation text is never copied into audit history (PRD 5.4, 6.5)', async () => {
    const { store, id, responses } = await withReferral();
    await responses.respond(RESPONDER, id, notAppropriate({ explanation: SECRET_EXPLANATION }));
    const event = store._referralAuditEvents.at(-1);
    assert.equal(event.action, 'NOT_APPROPRIATE');
    assert.deepEqual(event.after, { response_status: 'RESPONDED', decision: 'NOT_APPROPRIATE', not_appropriate_reason_id: 2, has_explanation: true });
    assert.ok(!JSON.stringify(store._referralAuditEvents).includes('XYZZY'));
  });

  test('missing reason -> 400 naming reasonId; nothing changes', async () => {
    const { store, id, responses } = await withReferral();
    await assert.rejects(responses.respond(RESPONDER, id, { decision: 'NOT_APPROPRIATE' }), (err) => {
      assert.equal(err.code, 'INVALID_REQUEST');
      assert.deepEqual(err.fields, ['reasonId']);
      return true;
    });
    assert.equal(store._referrals[0].responseStatus, 'AWAITING_RESPONSE');
  });

  test('unknown or discontinued reasons cannot be selected', async () => {
    const { store, id, responses } = await withReferral();
    await rejectsWith(responses.respond(RESPONDER, id, notAppropriate({ reasonId: 999 })), 'REASON_NOT_SELECTABLE');
    await rejectsWith(responses.respond(RESPONDER, id, notAppropriate({ reasonId: 6 })), 'REASON_NOT_SELECTABLE');
    assert.equal(store._referrals[0].responseStatus, 'AWAITING_RESPONSE');
  });

  test('a configured reason marked "requires explanation" enforces it', async () => {
    const { id, responses } = await withReferral();
    await assert.rejects(responses.respond(RESPONDER, id, notAppropriate({ reasonId: 7 })), (err) => {
      assert.deepEqual(err.fields, ['explanation']);
      return true;
    });
    const ok = await responses.respond(RESPONDER, id, notAppropriate({ reasonId: 7, explanation: 'Synthetic detail' }));
    assert.equal(ok.referral.decision, 'NOT_APPROPRIATE');
  });
});

describe('request validation (allowlist)', () => {
  for (const [label, body, fields] of [
    ['unknown decision', { decision: 'DECLINED' }, ['decision']],
    ['lowercase decision', { decision: 'accepted' }, ['decision']],
    ['service outcome sent as a decision', { decision: 'RESULTED_IN_SERVICE' }, ['decision']],
    ['missing decision', {}, ['decision']],
    ['reason with Accepted', { decision: 'ACCEPTED', reasonId: 1 }, ['reasonId']],
    ['explanation with Accepted', { decision: 'ACCEPTED', explanation: 'x' }, ['explanation']],
    ['string reasonId', { decision: 'NOT_APPROPRIATE', reasonId: '2' }, ['reasonId']],
    ['explanation over 1000 characters', notAppropriate({ explanation: 'x'.repeat(1001) }), ['explanation']],
    ['control characters in explanation', notAppropriate({ explanation: 'bad\u0000text' }), ['explanation']],
    ['numeric explanation', notAppropriate({ explanation: 42 }), ['explanation']],
    ['zero explanation', notAppropriate({ explanation: 0 }), ['explanation']],
    ['boolean explanation', notAppropriate({ explanation: false }), ['explanation']],
    ['object explanation', notAppropriate({ explanation: { text: 'x' } }), ['explanation']],
    ['array explanation', notAppropriate({ explanation: ['x'] }), ['explanation']],
    ['padded explanation over 1000 as sent', notAppropriate({ explanation: ` ${'x'.repeat(1000)}` }), ['explanation']],
  ]) {
    test(`rejects ${label}`, () => {
      const result = validateResponse(body);
      assert.equal(result.ok, false);
      assert.deepEqual(result.fields, fields);
    });
  }

  for (const [label, explanation] of [['omitted', undefined], ['null', null], ['empty', ''], ['whitespace-only', ' \n\t ']]) {
    test(`an ${label} explanation means "no explanation"`, () => {
      const body = notAppropriate();
      if (explanation !== undefined) body.explanation = explanation;
      const result = validateResponse(body);
      assert.equal(result.ok, true);
      assert.equal(result.value.explanation, null);
    });
  }

  for (const [label, body] of [
    ['client-set responseStatus', { decision: 'ACCEPTED', responseStatus: 'RESPONDED' }],
    ['client-set timestamp', { decision: 'ACCEPTED', firstRespondedAt: '2020-01-01T00:00:00Z' }],
    ['client-set responder', { decision: 'ACCEPTED', respondedByUserId: 1 }],
    ['client-set user', { decision: 'ACCEPTED', userId: 1 }],
    ['sensitive text as a property name', { decision: 'ACCEPTED', 'Synthetic Person Omega 555-0199': 1 }],
  ]) {
    test(`rejects ${label} without naming it`, () => {
      const result = validateResponse(body);
      assert.deepEqual(result, { ok: false, unexpectedField: true });
    });
  }

  test('HTTP: an unknown property is refused with a fixed error that never echoes its name', async () => {
    const { store, id } = await withReferral();
    const app = createApp({ referralStore: store, affiliationStore: store, resolveIdentity: () => ({ userId: RESPONDER }) });
    const res = await request(app).post(`/api/referrals/${id}/response`).send({ decision: 'ACCEPTED', 'Synthetic Person Omega 555-0199': 1 });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: 'The request contains a field that is not allowed.', code: 'UNEXPECTED_FIELD' });
    assert.ok(!res.text.includes('Omega'));
    assert.equal(store._referrals[0].responseStatus, 'AWAITING_RESPONSE');
  });

  test('HTTP: a wrongly typed explanation is a 400 naming only the field', async () => {
    const { store, id } = await withReferral();
    const app = createApp({ referralStore: store, affiliationStore: store, resolveIdentity: () => ({ userId: RESPONDER }) });
    const res = await request(app).post(`/api/referrals/${id}/response`).send(notAppropriate({ explanation: { nested: 'XYZZY' } }));
    assert.equal(res.status, 400);
    assert.deepEqual(res.body.fields, ['explanation']);
    assert.ok(!res.text.includes('XYZZY'));
    assert.equal(store._referrals[0].responseStatus, 'AWAITING_RESPONSE');
  });

  test('validation errors never echo the explanation', async () => {
    const { id, responses } = await withReferral();
    const err = await responses.respond(RESPONDER, id, notAppropriate({ explanation: `${SECRET_EXPLANATION}${'x'.repeat(1000)}` })).catch((e) => e);
    assert.ok(!JSON.stringify({ ...err, message: err.message }).includes('XYZZY'));
  });
});

describe('server-side transition rules', () => {
  test('a second response is refused; the first stands', async () => {
    const { store, id, responses } = await withReferral();
    await responses.respond(RESPONDER, id, accept);
    await rejectsWith(responses.respond(SECOND, id, notAppropriate()), 'ALREADY_RESPONDED');
    await rejectsWith(responses.respond(RESPONDER, id, accept), 'ALREADY_RESPONDED');
    assert.equal(store._referrals[0].decision, 'ACCEPTED');
    assert.equal(store._referralAuditEvents.filter((e) => e.action !== 'CREATED').length, 1);
  });

  test('two receivers responding at the same moment: exactly one wins', async () => {
    const { store, id, responses } = await withReferral();
    const results = await Promise.allSettled([
      responses.respond(RESPONDER, id, accept),
      responses.respond(SECOND, id, notAppropriate()),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const loser = results.find((r) => r.status === 'rejected');
    assert.equal(loser.reason.code, 'ALREADY_RESPONDED');
    const winner = results.find((r) => r.status === 'fulfilled').value.referral.decision;
    assert.equal(store._referrals[0].decision, winner, 'stored state matches the confirmed winner');
    assert.equal(store._referralAuditEvents.filter((e) => e.action !== 'CREATED').length, 1);
  });

  test('if saving fails, nothing changes and the response can be retried', async () => {
    const { store, id, responses } = await withReferral();
    store._failNextAudit();
    await assert.rejects(responses.respond(RESPONDER, id, accept));
    assert.equal(store._referrals[0].responseStatus, 'AWAITING_RESPONSE', 'rolled back with the audit failure');
    assert.equal((await responses.respond(RESPONDER, id, accept)).referral.decision, 'ACCEPTED');
  });

  test('if the first of two concurrent responses rolls back, the second succeeds', async () => {
    const { store, id, responses } = await withReferral();
    store._failNextAudit();
    const [first, second] = await Promise.allSettled([
      responses.respond(RESPONDER, id, accept),
      responses.respond(SECOND, id, notAppropriate()),
    ]);
    assert.equal(first.status, 'rejected');
    assert.equal(second.status, 'fulfilled');
    assert.equal(store._referrals[0].decision, 'NOT_APPROPRIATE');
  });

  test('time passing alone never changes status (PRD 2.3, 6.2)', async () => {
    let clock = new Date('2026-10-16T12:00:00.000Z');
    const { id, queries } = await withReferral({ now: () => clock });
    clock = new Date('2027-10-16T12:00:00.000Z'); // a year later, no response
    const { referral } = await queries.getReferral(CREATOR, id);
    assert.deepEqual([referral.responseStatus, referral.decision, referral.stage], ['AWAITING_RESPONSE', null, 'AWAITING_RESPONSE']);
  });
});

describe('who may respond (RESPOND_TO_REFERRAL for the receiving Program)', () => {
  test('a user with respond permission for the Program may respond', async () => {
    const { id, responses } = await withReferral();
    assert.equal((await responses.respond(RESPONDER, id, accept)).status, 'RESPONDED');
  });

  test('respond permission alone is enough (it is its own capability)', async () => {
    const { id, responses } = await withReferral();
    assert.equal((await responses.respond(RESPOND_ONLY, id, accept)).status, 'RESPONDED');
  });

  test('view-only receivers and the creator can see it but get 403 on respond', async () => {
    const { store, id, responses } = await withReferral();
    await rejectsWith(responses.respond(VIEWER_ONLY, id, accept), 'NOT_AUTHORIZED');
    await rejectsWith(responses.respond(CREATOR, id, accept), 'NOT_AUTHORIZED');
    assert.equal(store._referrals[0].responseStatus, 'AWAITING_RESPONSE');
  });

  for (const [label, userId] of [
    ['another Program\'s responder', OTHER_PROGRAM],
    ['a revoked grant', REVOKED],
    ['DEMO grants while demo is off', DEMO],
    ['admin / management / UPDATE_RECEIVED_REFERRAL without respond', ADMIN],
  ]) {
    test(`${label} gets the same 404 as a missing referral`, async () => {
      const { store, id, responses } = await withReferral();
      const denied = await responses.respond(userId, id, accept).catch((e) => e);
      const missing = await responses.respond(userId, 999999, accept).catch((e) => e);
      assert.equal(denied.code, 'REFERRAL_NOT_FOUND');
      assert.deepEqual([denied.status, denied.message], [missing.status, missing.message]);
      assert.equal(store._referrals[0].responseStatus, 'AWAITING_RESPONSE');
    });
  }

  test('DEMO grants work only when the non-production caller allows them', async () => {
    const { store, id } = await withReferral();
    const demoAllowed = createResponseService({ store, allowDemoGrants: true });
    assert.equal((await demoAllowed.respond(DEMO, id, accept)).status, 'RESPONDED');
  });

  test('an inactive account is refused', async () => {
    const { id, responses } = await withReferral();
    await rejectsWith(responses.respond(INACTIVE, id, accept), 'USER_NOT_ACTIVE');
  });
});

describe('the response returns to the initiating worker (PRD 2.3)', () => {
  test('creator sees decision, reason and explanation on the referral', async () => {
    const { id, responses, queries } = await withReferral();
    await responses.respond(RESPONDER, id, notAppropriate({ explanation: SECRET_EXPLANATION }));
    const { referral } = await queries.getReferral(CREATOR, id);
    assert.equal(referral.decision, 'NOT_APPROPRIATE');
    assert.deepEqual(referral.notAppropriateReason, { reasonId: 2, label: 'Program currently unavailable' });
    assert.equal(referral.notAppropriateExplanation, SECRET_EXPLANATION);
  });

  test('lists show the reason label but never the explanation', async () => {
    const { id, responses, queries } = await withReferral();
    await responses.respond(RESPONDER, id, notAppropriate({ explanation: SECRET_EXPLANATION }));
    const sent = await queries.listSent(CREATOR);
    const received = await queries.listReceived(RESPONDER);
    for (const list of [sent.referrals, received.referrals]) {
      assert.equal(list[0].notAppropriateReason.label, 'Program currently unavailable');
      assert.ok(!JSON.stringify(list).includes('XYZZY'));
    }
  });

  test('viewerAccess.canRespond is true only for a responder while awaiting', async () => {
    const { id, responses, queries } = await withReferral();
    assert.equal((await queries.getReferral(RESPONDER, id)).viewerAccess.canRespond, true);
    assert.equal((await queries.getReferral(VIEWER_ONLY, id)).viewerAccess.canRespond, false);
    assert.equal((await queries.getReferral(CREATOR, id)).viewerAccess.canRespond, false);
    await responses.respond(RESPONDER, id, accept);
    assert.equal((await queries.getReferral(RESPONDER, id)).viewerAccess.canRespond, false);
  });
});

describe('configurable reason list', () => {
  test('returns active reasons in display order, without internal codes', async () => {
    const { responses } = await withReferral();
    const { reasons } = await responses.listReasons(RESPONDER);
    assert.deepEqual(reasons.map((r) => r.label), [
      'Program criteria not met', 'Program currently unavailable', 'Program not appropriate for identified need',
      'Unable to proceed with referral', 'Other', 'Sample reason that needs detail',
    ]);
    assert.deepEqual(Object.keys(reasons[0]).sort(), ['label', 'reasonId', 'requiresExplanation']);
  });

  test('inactive accounts cannot read it', async () => {
    const { responses } = await withReferral();
    await rejectsWith(responses.listReasons(INACTIVE), 'USER_NOT_ACTIVE');
  });
});

describe('HTTP', () => {
  const appFor = (store, userId) => createApp({ referralStore: store, affiliationStore: store, resolveIdentity: () => ({ userId }) });

  test('POST /api/referrals/:id/response fails closed without sign-in', async () => {
    const { store, id } = await withReferral();
    const res = await request(createApp({ referralStore: store })).post(`/api/referrals/${id}/response`).send(accept);
    assert.equal(res.status, 401);
    assert.equal(store._referrals[0].responseStatus, 'AWAITING_RESPONSE');
  });

  test('responding returns the confirmed state and is never cached', async () => {
    const { store, id } = await withReferral();
    const res = await request(appFor(store, RESPONDER)).post(`/api/referrals/${id}/response`).send(notAppropriate());
    assert.equal(res.status, 200);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.body.referral.decision, 'NOT_APPROPRIATE');
  });

  test('second response -> 409 ALREADY_RESPONDED', async () => {
    const { store, id } = await withReferral();
    await request(appFor(store, RESPONDER)).post(`/api/referrals/${id}/response`).send(accept);
    const res = await request(appFor(store, SECOND)).post(`/api/referrals/${id}/response`).send(accept);
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'ALREADY_RESPONDED');
  });

  test('view-only -> 403; other Program -> 404', async () => {
    const { store, id } = await withReferral();
    assert.equal((await request(appFor(store, VIEWER_ONLY)).post(`/api/referrals/${id}/response`).send(accept)).status, 403);
    assert.equal((await request(appFor(store, OTHER_PROGRAM)).post(`/api/referrals/${id}/response`).send(accept)).status, 404);
  });

  test('query parameters, bad IDs and malformed JSON are rejected without echoing input', async () => {
    const { store, id } = await withReferral();
    const app = appFor(store, RESPONDER);
    assert.equal((await request(app).post(`/api/referrals/${id}/response?asUser=1`).send(accept)).status, 400);
    assert.equal((await request(app).post('/api/referrals/abc/response').send(accept)).status, 404);
    const bad = await request(app).post(`/api/referrals/${id}/response`).set('Content-Type', 'application/json').send('{"explanation": "XYZZY');
    assert.equal(bad.status, 400);
    assert.ok(!bad.text.includes('XYZZY'));
  });

  test('an unexpected failure returns a generic 500 and logs no explanation', async (t) => {
    const { store, id } = await withReferral();
    const logs = [];
    t.mock.method(console, 'error', (...args) => logs.push(args.map(String).join(' ')));
    store._failNextAudit();
    const res = await request(appFor(store, RESPONDER)).post(`/api/referrals/${id}/response`).send(notAppropriate({ explanation: SECRET_EXPLANATION }));
    assert.equal(res.status, 500);
    assert.ok(!(res.text + logs.join('\n')).includes('XYZZY'));
    assert.equal(store._referrals[0].responseStatus, 'AWAITING_RESPONSE');
  });

  test('GET /api/referrals/not-appropriate-reasons is not mistaken for a referral ID', async () => {
    const { store } = await withReferral();
    const res = await request(appFor(store, RESPONDER)).get('/api/referrals/not-appropriate-reasons');
    assert.equal(res.status, 200);
    assert.equal(res.body.reasons.length, 6);
  });
});

// ---------------------------------------------------------------------------
// PR #11 review: consistent grants and reasons during a response (PRD 3.3,
// 9.3), response-only permission (PRD 3.3, 10.5), integration with #10.

describe('grants and reasons stay consistent during a response', () => {
  function pauseAfterRead(store, kind, id) {
    let reached;
    let release;
    const reachedP = new Promise((r) => { reached = r; });
    const gate = new Promise((r) => { release = r; });
    let done = false;
    store._afterLockingRead(async (k, i) => {
      if (!done && k === kind && i === id) { done = true; reached(); await gate; }
    });
    return { reached: reachedP, release };
  }
  async function stillPending(promise) {
    let settled = false;
    promise.then(() => { settled = true; }, () => { settled = true; });
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
    return !settled;
  }

  test('a revocation that starts during a response waits; the response commits on the grant it checked', async () => {
    const { store, id, responses } = await withReferral();
    const pause = pauseAfterRead(store, 'grants', RESPONDER);
    const responding = responses.respond(RESPONDER, id, accept);
    await pause.reached;

    const revoking = store._revokeGrants(RESPONDER, 'RESPOND_TO_REFERRAL');
    assert.ok(await stillPending(revoking), 'revocation waits for the response transaction');
    pause.release();
    assert.equal((await responding).status, 'RESPONDED');
    await revoking;

    // From now on the revocation applies.
    const next = await withReferral();
    await next.store._revokeGrants(RESPONDER, 'RESPOND_TO_REFERRAL');
    await assert.rejects(next.responses.respond(RESPONDER, next.id, accept), (err) => err.code === 'NOT_AUTHORIZED');
  });

  test('a revocation committed before the grants are read refuses the response; nothing changes', async () => {
    const { store, id, responses } = await withReferral();
    const pause = pauseAfterRead(store, 'user', RESPONDER); // before the grant read
    const responding = responses.respond(RESPONDER, id, accept);
    await pause.reached;
    await store._revokeGrants(RESPONDER, 'RESPOND_TO_REFERRAL'); // not blocked: grants not read yet
    pause.release();
    await assert.rejects(responding, (err) => err.code === 'NOT_AUTHORIZED');
    assert.equal(store._referrals[0].responseStatus, 'AWAITING_RESPONSE');
    assert.equal(store._referralAuditEvents.filter((e) => e.action !== 'CREATED').length, 0);
  });

  test('discontinuing a reason during a response waits; later responses cannot use it', async () => {
    const { store, id, responses } = await withReferral();
    const pause = pauseAfterRead(store, 'reason', 2);
    const responding = responses.respond(RESPONDER, id, notAppropriate());
    await pause.reached;

    const discontinuing = store._setReasonStatus(2, 'DISCONTINUED');
    assert.ok(await stillPending(discontinuing));
    pause.release();
    assert.equal((await responding).referral.notAppropriateReason.reasonId, 2);
    await discontinuing;

    const next = await withReferral();
    await next.store._setReasonStatus(2, 'DISCONTINUED');
    await assert.rejects(next.responses.respond(RESPONDER, next.id, notAppropriate()), (err) => err.code === 'REASON_NOT_SELECTABLE');
  });

  test('a reason discontinued before it is read is refused; nothing changes', async () => {
    const { store, id, responses } = await withReferral();
    const pause = pauseAfterRead(store, 'grants', RESPONDER); // before the reason read
    const responding = responses.respond(RESPONDER, id, notAppropriate());
    await pause.reached;
    await store._setReasonStatus(2, 'DISCONTINUED');
    pause.release();
    await assert.rejects(responding, (err) => err.code === 'REASON_NOT_SELECTABLE');
    assert.equal(store._referrals[0].responseStatus, 'AWAITING_RESPONSE');
  });

  test('a rolled-back response releases its locks', async () => {
    const { store, id, responses } = await withReferral();
    const pause = pauseAfterRead(store, 'grants', RESPONDER);
    store._failNextAudit();
    const responding = responses.respond(RESPONDER, id, accept);
    await pause.reached;
    const revoking = store._revokeGrants(RESPONDER, 'RESPOND_TO_REFERRAL');
    pause.release();
    await assert.rejects(responding);
    await revoking;
    assert.equal(store._referrals[0].responseStatus, 'AWAITING_RESPONSE');
    assert.equal((await store.getActiveGrants(RESPONDER)).some((gr) => gr.permission === 'RESPOND_TO_REFERRAL'), false);
  });
});

describe('response-only permission (PRD 3.3, 10.5)', () => {
  const appFor = (store, userId) => createApp({ referralStore: store, affiliationStore: store, resolveIdentity: () => ({ userId }) });

  test('the response returns only confirmation data, and responding grants no view access', async () => {
    const { store, id } = await withReferral();
    const res = await request(appFor(store, RESPOND_ONLY)).post(`/api/referrals/${id}/response`)
      .send(notAppropriate({ explanation: SECRET_EXPLANATION }));
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body).sort(), ['referral', 'status']);
    assert.deepEqual(Object.keys(res.body.referral).sort(), [
      'decision', 'firstRespondedAt', 'hasExplanation', 'notAppropriateReason', 'referralId', 'responseStatus', 'serviceOutcome', 'stage',
    ]);
    for (const secret of ['Synthetic Person', 'Synthetic need', 'XYZZY']) assert.ok(!res.text.includes(secret), secret);

    // Still no view: the referral itself, the queue and the detail stay closed.
    assert.equal((await request(appFor(store, RESPOND_ONLY)).get(`/api/referrals/${id}`)).status, 404);
    assert.deepEqual((await request(appFor(store, RESPOND_ONLY)).get('/api/referrals/received')).body.referrals, []);
  });
});

describe('integration with PR #10 (safe IDs, demo guard)', () => {
  const appFor = (store, userId, extra = {}) => createApp({ referralStore: store, affiliationStore: store, resolveIdentity: () => ({ userId }), ...extra });

  test('response route refuses IDs beyond the safe integer range before touching the store', async () => {
    const { store } = await withReferral();
    let called = false;
    const spy = { ...store, withTransaction: async () => { called = true; return null; } };
    const res = await request(appFor(spy, RESPONDER)).post('/api/referrals/9007199254740993/response').send(accept);
    assert.equal(res.status, 404);
    assert.equal(called, false);
  });

  test('DEMO respond grants count only in development/test, and the app refuses them elsewhere', async () => {
    const { store, id } = await withReferral();
    assert.equal((await request(appFor(store, DEMO)).post(`/api/referrals/${id}/response`).send(accept)).status, 404, 'off by default');
    assert.throws(() => appFor(store, DEMO, { allowDemoGrants: true, nodeEnv: 'production' }), /DEMO grants/);
    assert.throws(() => appFor(store, DEMO, { allowDemoGrants: true }), /DEMO grants/);
    const res = await request(appFor(store, DEMO, { allowDemoGrants: true, nodeEnv: 'test' })).post(`/api/referrals/${id}/response`).send(accept);
    assert.equal(res.status, 200);
  });
});
