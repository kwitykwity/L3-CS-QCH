// Direct Referral creation + idempotency (Trello card 3).
// All data below is SYNTHETIC.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createReferralService } from '../src/referrals/referralService.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
import { createAffiliationService } from '../src/affiliation/affiliationService.js';

const NAME = 'Synthetic Person Alpha';
const CONTEXT = 'Synthetic context: needs evening class schedule';
const NOTE = 'Synthetic note: prefers mornings';

function seed() {
  return createMemoryReferralStore({
    departments: [
      { departmentId: 1, name: 'Synthetic Dept A', lifecycleStatus: 'ACTIVE' },
      { departmentId: 2, name: 'Synthetic Dept B', lifecycleStatus: 'ACTIVE' },
      { departmentId: 3, name: 'Synthetic Dept Closed', lifecycleStatus: 'DISCONTINUED' },
    ],
    programs: [
      { programId: 10, departmentId: 1, name: 'Referring Program', site: null, lifecycleStatus: 'ACTIVE' },
      { programId: 11, departmentId: 2, name: 'Receiving Program', site: null, lifecycleStatus: 'ACTIVE' },
      { programId: 12, departmentId: 2, name: 'Old Program', site: null, lifecycleStatus: 'DISCONTINUED' },
      { programId: 13, departmentId: 3, name: 'Program In Closed Dept', site: null, lifecycleStatus: 'ACTIVE' },
    ],
    users: [
      { userId: 100, isActive: true, currentProgramId: 10 },
      { userId: 101, isActive: true, currentProgramId: 11 },
      { userId: 102, isActive: true },                       // no affiliation
      { userId: 103, isActive: false, currentProgramId: 10 },
    ],
  });
}

function validBody(overrides = {}) {
  return {
    submissionId: randomUUID(),
    receivingProgramId: 11,
    participantName: NAME,
    contactMethod: 'PHONE_CALL',
    contactValue: '(555) 010-0147',
    participantZip: '11375',
    referralContext: CONTEXT,
    notes: NOTE,
    ...overrides,
  };
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code);
    return true;
  });
}

describe('creating a Direct Referral', () => {
  test('commits one referral with a permanent ID and the initial lifecycle state', async () => {
    const store = seed();
    const service = createReferralService({ store });

    const result = await service.createDirectReferral(100, validBody(), { correlationId: 'c-1' });

    assert.equal(result.status, 'RECEIVED');
    assert.equal(result.referral.referralId, 1);
    assert.equal(store._referrals.length, 1);
    const row = store._referrals[0];
    assert.equal(row.source, 'DIRECT');
    assert.equal(row.createdByUserId, 100);
    assert.equal(row.responseStatus, 'AWAITING_RESPONSE');
    assert.equal(row.decision, null);
    assert.equal(row.serviceOutcome, 'NOT_RECORDED');
    assert.match(row.createdAt, /Z$/, 'stored in UTC');
  });

  test('records the original referring and receiving Program and Department', async () => {
    const store = seed();
    await createReferralService({ store }).createDirectReferral(100, validBody());

    const row = store._referrals[0];
    assert.deepEqual(
      [row.referringProgramId, row.referringDepartmentId, row.receivingProgramId, row.receivingDepartmentId],
      [10, 1, 11, 2],
    );
  });

  test('a later affiliation change does not rewrite an existing referral', async () => {
    const store = seed();
    await createReferralService({ store }).createDirectReferral(100, validBody());

    await createAffiliationService({ store }).setAffiliation(100, { programId: 11 });

    assert.equal(store._referrals[0].referringProgramId, 10);
    assert.equal(store._referrals[0].referringDepartmentId, 1);
  });

  test('returns no participant data in the confirmation', async () => {
    const result = await createReferralService({ store: seed() }).createDirectReferral(100, validBody());
    const text = JSON.stringify(result);

    for (const value of [NAME, CONTEXT, NOTE, '010-0147', '11375']) {
      assert.ok(!text.includes(value), `confirmation must not contain "${value}"`);
    }
  });

  test('writes one audit event with IDs only, no participant data', async () => {
    const store = seed();
    await createReferralService({ store }).createDirectReferral(100, validBody(), { correlationId: 'c-9' });

    assert.equal(store._referralAuditEvents.length, 1);
    const [event] = store._referralAuditEvents;
    assert.equal(event.entityType, 'REFERRAL');
    assert.equal(event.action, 'CREATED');
    assert.equal(event.actorUserId, 100);
    assert.equal(event.correlationId, 'c-9');
    const text = JSON.stringify(event);
    for (const value of [NAME, CONTEXT, NOTE, '010-0147', '11375']) {
      assert.ok(!text.includes(value), `audit must not contain "${value}"`);
    }
  });

  test('a referral to a Program in the same Program is allowed (no self-referral rule in the PRD)', async () => {
    const store = seed();
    const result = await createReferralService({ store }).createDirectReferral(100, validBody({ receivingProgramId: 10 }));
    assert.equal(result.status, 'RECEIVED');
  });

  test('NOT_AVAILABLE contact needs no contact value; ZIP and notes are optional', async () => {
    const store = seed();
    const body = validBody({ contactMethod: 'NOT_AVAILABLE', contactValue: null, participantZip: '', notes: null });
    await createReferralService({ store }).createDirectReferral(100, body);

    const row = store._referrals[0];
    assert.equal(row.contactValue, null);
    assert.equal(row.participantZip, null);
    assert.equal(row.notes, null);
  });

  test('accepts email and text contact methods', async () => {
    const service = createReferralService({ store: seed() });
    await service.createDirectReferral(100, validBody({ contactMethod: 'EMAIL', contactValue: 'synthetic@example.test' }));
    await service.createDirectReferral(100, validBody({ contactMethod: 'PHONE_TEXT', contactValue: '555-010-0148' }));
  });
});

describe('Submission ID idempotency', () => {
  test('repeating the same request returns the same referral and creates no second one', async () => {
    const store = seed();
    const service = createReferralService({ store });
    const body = validBody();

    const first = await service.createDirectReferral(100, body);
    const second = await service.createDirectReferral(100, { ...body });

    assert.equal(second.status, 'ALREADY_RECEIVED');
    assert.equal(second.referral.referralId, first.referral.referralId);
    assert.equal(store._referrals.length, 1);
    assert.equal(store._referralAuditEvents.length, 1);
  });

  test('Submission ID matching is case-insensitive', async () => {
    const store = seed();
    const service = createReferralService({ store });
    const body = validBody();

    await service.createDirectReferral(100, body);
    const again = await service.createDirectReferral(100, { ...body, submissionId: body.submissionId.toUpperCase() });

    assert.equal(again.status, 'ALREADY_RECEIVED');
    assert.equal(store._referrals.length, 1);
  });

  test('concurrent requests with the same Submission ID create exactly one referral', async () => {
    const store = seed();
    const service = createReferralService({ store });
    const body = validBody();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => service.createDirectReferral(100, { ...body })),
    );

    assert.equal(store._referrals.length, 1);
    assert.equal(results.filter((r) => r.status === 'RECEIVED').length, 1);
    assert.equal(results.filter((r) => r.status === 'ALREADY_RECEIVED').length, 4);
    assert.ok(results.every((r) => r.referral.referralId === store._referrals[0].referralId));
  });

  // Wraps the store so a test can see when the unique-constraint path
  // (DuplicateSubmissionError on insert) is actually hit.
  function countDuplicateInserts(store) {
    const counter = { duplicates: 0 };
    const original = store.withTransaction;
    store.withTransaction = (fn) => original((tx) => fn({
      ...tx,
      insertReferral: async (row) => {
        try { return await tx.insertReferral(row); } catch (err) {
          if (err.name === 'DuplicateSubmissionError') counter.duplicates += 1;
          throw err;
        }
      },
    }));
    return counter;
  }

  test('the database unique constraint is the final guard when both requests pass the early check', async () => {
    const store = seed();
    const counter = countDuplicateInserts(store);
    const service = createReferralService({ store });
    const body = validBody();

    const results = await Promise.all([
      service.createDirectReferral(100, { ...body }),
      service.createDirectReferral(100, { ...body }),
    ]);

    assert.ok(counter.duplicates >= 1, 'the race reached the unique-constraint path');
    assert.equal(store._referrals.length, 1);
    assert.deepEqual(results.map((r) => r.status).sort(), ['ALREADY_RECEIVED', 'RECEIVED']);
  });

  test('if the first of two concurrent requests rolls back, the second still succeeds', async () => {
    const store = seed();
    const service = createReferralService({ store });
    const body = validBody();
    store._failNextAudit();

    const [first, second] = await Promise.allSettled([
      service.createDirectReferral(100, { ...body }),
      service.createDirectReferral(100, { ...body }),
    ]);

    assert.equal(first.status, 'rejected');
    assert.equal(second.status, 'fulfilled');
    assert.equal(second.value.status, 'RECEIVED');
    assert.equal(store._referrals.length, 1);
  });

  test('the same Submission ID with different content is a conflict, not a second referral', async () => {
    const store = seed();
    const service = createReferralService({ store });
    const body = validBody();
    await service.createDirectReferral(100, body);

    await rejectsWith(
      service.createDirectReferral(100, { ...body, participantName: 'Synthetic Person Beta' }),
      'SUBMISSION_ID_CONFLICT',
    );
    assert.equal(store._referrals.length, 1);
  });

  test('another user reusing a Submission ID gets a conflict and learns nothing', async () => {
    const store = seed();
    const service = createReferralService({ store });
    const body = validBody();
    await service.createDirectReferral(100, body);

    await assert.rejects(service.createDirectReferral(101, { ...body }), (err) => {
      assert.equal(err.code, 'SUBMISSION_ID_CONFLICT');
      assert.ok(!JSON.stringify(err).includes(NAME));
      return true;
    });
    assert.equal(store._referrals.length, 1);
  });

  test('if any step fails, nothing is committed and the Submission ID can be retried', async () => {
    const store = seed();
    const service = createReferralService({ store });
    const body = validBody();

    store._failNextAudit();
    await assert.rejects(service.createDirectReferral(100, body));
    assert.equal(store._referrals.length, 0, 'referral rolled back with the audit failure');
    assert.equal(store._referralAuditEvents.length, 0);

    const retry = await service.createDirectReferral(100, { ...body });
    assert.equal(retry.status, 'RECEIVED');
    assert.equal(store._referrals.length, 1);
  });
});

describe('authorization and Program checks', () => {
  test('the Referring Program cannot differ from the user\'s affiliation', async () => {
    const store = seed();
    await rejectsWith(
      createReferralService({ store }).createDirectReferral(100, validBody({ referringProgramId: 11 })),
      'REFERRING_PROGRAM_MISMATCH',
    );
    assert.equal(store._referrals.length, 0);
  });

  test('a matching submitted Referring Program is accepted', async () => {
    const result = await createReferralService({ store: seed() })
      .createDirectReferral(100, validBody({ referringProgramId: 10 }));
    assert.equal(result.status, 'RECEIVED');
  });

  test('fails closed when the user has no affiliation', async () => {
    await rejectsWith(createReferralService({ store: seed() }).createDirectReferral(102, validBody()), 'AFFILIATION_REQUIRED');
  });

  test('an inactive user cannot create a referral', async () => {
    await rejectsWith(createReferralService({ store: seed() }).createDirectReferral(103, validBody()), 'USER_NOT_ACTIVE');
  });

  for (const [label, programId] of [
    ['a discontinued receiving Program', 12],
    ['a receiving Program in a discontinued Department', 13],
    ['a receiving Program that does not exist', 999],
  ]) {
    test(`rejects ${label}`, async () => {
      const store = seed();
      await rejectsWith(
        createReferralService({ store }).createDirectReferral(100, validBody({ receivingProgramId: programId })),
        'RECEIVING_PROGRAM_NOT_SELECTABLE',
      );
      assert.equal(store._referrals.length, 0);
    });
  }
});

describe('validation', () => {
  const invalidCases = [
    ['missing submissionId', { submissionId: undefined }, 'submissionId'],
    ['non-UUID submissionId', { submissionId: 'abc-123' }, 'submissionId'],
    ['missing receivingProgramId', { receivingProgramId: undefined }, 'receivingProgramId'],
    ['string receivingProgramId', { receivingProgramId: '11' }, 'receivingProgramId'],
    ['blank participant name', { participantName: '   ' }, 'participantName'],
    ['name over 200 characters', { participantName: 'x'.repeat(201) }, 'participantName'],
    ['name with a line break', { participantName: 'Synthetic\nPerson' }, 'participantName'],
    ['unknown contact method', { contactMethod: 'FAX' }, 'contactMethod'],
    ['phone method with no number', { contactValue: null }, 'contactValue'],
    ['phone number with letters', { contactValue: 'call me maybe' }, 'contactValue'],
    ['phone number too short', { contactValue: '12-34' }, 'contactValue'],
    ['email method with a bad address', { contactMethod: 'EMAIL', contactValue: 'not-an-email' }, 'contactValue'],
    ['NOT_AVAILABLE with a contact value', { contactMethod: 'NOT_AVAILABLE', contactValue: '555-010-0147' }, 'contactValue'],
    ['4-digit ZIP', { participantZip: '1137' }, 'participantZip'],
    ['ZIP+4', { participantZip: '11375-1234' }, 'participantZip'],
    ['missing referral context', { referralContext: undefined }, 'referralContext'],
    ['context over 4000 characters', { referralContext: 'x'.repeat(4001) }, 'referralContext'],
    ['notes over 4000 characters', { notes: 'x'.repeat(4001) }, 'notes'],
    ['control characters in context', { referralContext: 'bad\u0000value' }, 'referralContext'],
  ];

  for (const [label, overrides, field] of invalidCases) {
    test(`rejects ${label}`, async () => {
      const store = seed();
      await assert.rejects(createReferralService({ store }).createDirectReferral(100, validBody(overrides)), (err) => {
        assert.equal(err.code, 'INVALID_REQUEST');
        assert.ok(err.fields.includes(field), `fields should include ${field}, got ${err.fields}`);
        return true;
      });
      assert.equal(store._referrals.length, 0);
    });
  }

  for (const field of ['userId', 'createdByUserId', 'source', 'createdAt', 'responseStatus', 'decision',
    'serviceOutcome', 'referringDepartmentId', 'receivingDepartmentId', 'referralId', 'dateOfBirth', 'ssn', 'address']) {
    test(`rejects a client-supplied "${field}" field (allowlist)`, async () => {
      const store = seed();
      await assert.rejects(createReferralService({ store }).createDirectReferral(100, validBody({ [field]: 'x' })), (err) => {
        assert.equal(err.code, 'INVALID_REQUEST');
        assert.deepEqual(err.fields, [field]);
        return true;
      });
      assert.equal(store._referrals.length, 0);
    });
  }

  test('validation errors name the fields but never echo their values', async () => {
    await assert.rejects(
      createReferralService({ store: seed() }).createDirectReferral(100, validBody({ contactValue: 'SECRET-555' })),
      (err) => {
        assert.ok(!JSON.stringify({ ...err, message: err.message }).includes('SECRET-555'));
        return true;
      },
    );
  });

  test('trims surrounding whitespace before storing', async () => {
    const store = seed();
    await createReferralService({ store }).createDirectReferral(100, validBody({ participantName: `  ${NAME}  ` }));
    assert.equal(store._referrals[0].participantName, NAME);
  });
});

describe('HTTP: POST /api/referrals', () => {
  const asUser = (userId) => () => ({ userId });
  const appFor = (store, userId) => createApp({ affiliationStore: store, referralStore: store, resolveIdentity: asUser(userId) });

  test('fails closed with 401 when no sign-in is configured', async () => {
    const store = seed();
    const response = await request(createApp({ referralStore: store })).post('/api/referrals').send(validBody());

    assert.equal(response.status, 401);
    assert.equal(response.body.code, 'NOT_AUTHENTICATED');
    assert.equal(store._referrals.length, 0);
  });

  test('answers 503 when signed in but no store is configured', async () => {
    const response = await request(createApp({ resolveIdentity: asUser(100) })).post('/api/referrals').send(validBody());
    assert.equal(response.status, 503);
  });

  test('201 on a new referral, 200 ALREADY_RECEIVED on a retry; never cached', async () => {
    const store = seed();
    const app = appFor(store, 100);
    const body = validBody();

    const first = await request(app).post('/api/referrals').send(body);
    assert.equal(first.status, 201);
    assert.equal(first.body.status, 'RECEIVED');
    assert.equal(first.headers['cache-control'], 'no-store');

    const retry = await request(app).post('/api/referrals').send(body);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.status, 'ALREADY_RECEIVED');
    assert.equal(retry.body.referral.referralId, first.body.referral.referralId);
    assert.equal(store._referrals.length, 1);
  });

  test('the creator is always the signed-in user, never a body field', async () => {
    const store = seed();
    const response = await request(appFor(store, 100)).post('/api/referrals').send(validBody({ userId: 101 }));

    assert.equal(response.status, 400);
    assert.deepEqual(response.body.fields, ['userId']);
    assert.equal(store._referrals.length, 0);
  });

  test('a validation error returns field names only', async () => {
    const response = await request(appFor(seed(), 100))
      .post('/api/referrals')
      .send(validBody({ participantZip: 'SECRET', contactValue: 'SECRET-PHONE' }));

    assert.equal(response.status, 400);
    assert.deepEqual(response.body.fields.sort(), ['contactValue', 'participantZip']);
    assert.ok(!response.text.includes('SECRET'));
  });

  test('a referral body larger than 1kb is accepted (not caught by the affiliation router)', async () => {
    const store = seed();
    const response = await request(appFor(store, 100))
      .post('/api/referrals')
      .send(validBody({ referralContext: 'x'.repeat(3000) }));

    assert.equal(response.status, 201);
  });

  test('malformed JSON returns 400 without echoing the input', async () => {
    const response = await request(appFor(seed(), 100))
      .post('/api/referrals')
      .set('Content-Type', 'application/json')
      .send('{"participantName": "SECRET-NAME"');

    assert.equal(response.status, 400);
    assert.ok(!response.text.includes('SECRET-NAME'));
  });

  test('an unexpected failure returns a generic 500 and logs no participant data', async (t) => {
    const store = seed();
    const logs = [];
    t.mock.method(console, 'error', (...args) => logs.push(args.map(String).join(' ')));
    store._failNextAudit();

    const response = await request(appFor(store, 100)).post('/api/referrals').send(validBody());

    assert.equal(response.status, 500);
    assert.deepEqual(response.body, { error: 'Internal Server Error' });
    const text = response.text + logs.join('\n');
    for (const value of [NAME, CONTEXT, NOTE, '010-0147']) {
      assert.ok(!text.includes(value), `must not contain "${value}"`);
    }
    assert.equal(store._referrals.length, 0);
  });

  test('affiliation routes still work alongside referral routes', async () => {
    const response = await request(appFor(seed(), 100)).get('/api/me/affiliation');
    assert.equal(response.status, 200);
    assert.equal(response.body.program.programId, 10);
  });
});

describe('HTTP: GET /api/referrals/submissions/:submissionId (safe check)', () => {
  const appFor = (store, userId) => createApp({ referralStore: store, resolveIdentity: () => ({ userId }) });

  test('RECEIVED for the creator after a committed referral', async () => {
    const store = seed();
    const body = validBody();
    await request(appFor(store, 100)).post('/api/referrals').send(body);

    const check = await request(appFor(store, 100)).get(`/api/referrals/submissions/${body.submissionId}`);
    assert.equal(check.status, 200);
    assert.equal(check.body.status, 'RECEIVED');
    assert.equal(check.body.referral.referralId, 1);
  });

  test('NOT_RECEIVED for an unknown Submission ID', async () => {
    const check = await request(appFor(seed(), 100)).get(`/api/referrals/submissions/${randomUUID()}`);
    assert.equal(check.body.status, 'NOT_RECEIVED');
  });

  test('NOT_RECEIVED for another user\'s Submission ID (nothing revealed)', async () => {
    const store = seed();
    const body = validBody();
    await request(appFor(store, 100)).post('/api/referrals').send(body);

    const check = await request(appFor(store, 101)).get(`/api/referrals/submissions/${body.submissionId}`);
    assert.deepEqual(check.body, { status: 'NOT_RECEIVED', referral: null });
  });

  test('400 for a malformed Submission ID', async () => {
    const check = await request(appFor(seed(), 100)).get('/api/referrals/submissions/not-a-uuid');
    assert.equal(check.status, 400);
  });
});
