// Security + production-safety pass (Trello card 16), first pass against
// the integrated application on main. Final Technical PRD 3.2, 3.3, 3.6,
// 5.4, 5.5, 10.3, 10.4, 15.3, 15.4, 16.1, 17.3, 17.4, 18.5.
//
// These tests cut across every API route, so a new route must be added to
// ROUTES below (a test fails if it is missing). All data is SYNTHETIC.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { MOUNT_POINTS, errorHandler, safeErrorCode, safeErrorName, safeLocation } from '../src/errorHandler.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
import { createReferralService } from '../src/referrals/referralService.js';
import { createResponseService } from '../src/referrals/responseService.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Synthetic markers: if any of these appear in a log line or in an error
// response, sensitive data leaked.
const M = Object.freeze({
  name: 'Synthetic Person Omega',
  contact: 'omega.synthetic@example.test',
  zip: '11375',
  context: 'Synthetic context QUUXCONTEXT',
  notes: 'Synthetic note QUUXNOTES',
  explanation: 'Synthetic explanation QUUXEXPLAIN',
});
const MARKERS = [M.name, M.contact, 'QUUXCONTEXT', 'QUUXNOTES', 'QUUXEXPLAIN'];
const noMarker = (text, where) => {
  for (const m of MARKERS) assert.ok(!String(text).includes(m), `${where} contains "${m}"`);
};

const CREATOR = 100;      // affiliated with Program 10
const RECEIVER = 200;     // view + respond for Program 11
const OTHER = 300;        // every receiving capability, but for Program 12
const ADMIN = 400;        // admin / management grants only
const INACTIVE = 500;     // grants for 11, inactive account
const UNKNOWN = 999;      // an identity with no user record

const g = (userId, permission, extra = {}) => ({
  userId, permission, scopeType: 'PROGRAM', programId: 11, departmentId: null, grantSource: 'IN_APP', ...extra,
});

function seed() {
  return createMemoryReferralStore({
    departments: [{ departmentId: 1, name: 'Synthetic Dept', lifecycleStatus: 'ACTIVE' }],
    programs: [10, 11, 12].map((programId) => ({ programId, departmentId: 1, name: `Program ${programId}`, site: null, lifecycleStatus: 'ACTIVE' })),
    users: [
      { userId: CREATOR, isActive: true, currentProgramId: 10, displayName: 'Synthetic Creator' },
      { userId: RECEIVER, isActive: true, currentProgramId: 11 },
      { userId: OTHER, isActive: true, currentProgramId: 12 },
      { userId: ADMIN, isActive: true },
      { userId: INACTIVE, isActive: false, currentProgramId: 11 },
    ],
    grants: [
      g(RECEIVER, 'VIEW_RECEIVED_REFERRAL'), g(RECEIVER, 'RESPOND_TO_REFERRAL'),
      ...['VIEW_RECEIVED_REFERRAL', 'RESPOND_TO_REFERRAL', 'UPDATE_RECEIVED_REFERRAL', 'RECORD_OUTCOME', 'CORRECT_OUTCOME']
        .map((p) => g(OTHER, p, { programId: 12 })),
      g(ADMIN, 'ADMINISTER_PERMISSIONS', { scopeType: 'ORG', programId: null }),
      g(ADMIN, 'MANAGE_ORGANIZATION', { scopeType: 'ORG', programId: null }),
      g(ADMIN, 'MANAGE_PROGRAM'), g(ADMIN, 'VIEW_UNDERLYING_REFERRAL'), g(ADMIN, 'VIEW_AGGREGATE_REPORTING', { scopeType: 'ORG', programId: null }),
      g(INACTIVE, 'VIEW_RECEIVED_REFERRAL'), g(INACTIVE, 'RESPOND_TO_REFERRAL'),
    ],
    notAppropriateReasons: [{ reasonId: 2, code: 'PROGRAM_UNAVAILABLE', label: 'Program currently unavailable', displayOrder: 2 }],
  });
}

const referralBody = (overrides = {}) => ({
  submissionId: randomUUID(),
  receivingProgramId: 11,
  participantName: M.name,
  contactMethod: 'EMAIL',
  contactValue: M.contact,
  participantZip: M.zip,
  referralContext: M.context,
  notes: M.notes,
  ...overrides,
});

async function populated() {
  const store = seed();
  const created = await createReferralService({ store }).createDirectReferral(CREATOR, referralBody());
  return { store, id: created.referral.referralId, submissionId: created.referral.submissionId };
}

const appAs = (store, userId, extra = {}) =>
  createApp({ affiliationStore: store, referralStore: store, resolveIdentity: () => (userId === null ? null : { userId }), ...extra });

// Every API route in main. `body` is a valid request body for routes that
// take one; `id` routes use a real referral or submission.
const ROUTES = [
  { method: 'get', path: '/api/programs' },
  { method: 'get', path: '/api/me/affiliation' },
  { method: 'put', path: '/api/me/affiliation', body: () => ({ programId: 10, version: 'v1' }) },
  { method: 'post', path: '/api/referrals', body: () => referralBody() },
  { method: 'get', path: '/api/referrals/submissions/:submissionId' },
  { method: 'get', path: '/api/referrals/received' },
  { method: 'get', path: '/api/referrals/sent' },
  { method: 'get', path: '/api/referrals/not-appropriate-reasons' },
  { method: 'post', path: '/api/referrals/:referralId/response', body: () => ({ decision: 'ACCEPTED' }) },
  { method: 'get', path: '/api/referrals/:referralId' },

  // Service outcome and corrections (card 8, #14)
  { method: 'post', path: '/api/referrals/:referralId/outcome', body: () => ({ outcome: 'RESULTED_IN_SERVICE' }) },
  { method: 'post', path: '/api/referrals/:referralId/outcome/correction', body: () => ({ outcome: 'DID_NOT_RESULT_IN_SERVICE', version: 'v1' }) },
  { method: 'post', path: '/api/referrals/:referralId/response/correction', body: () => ({ decision: 'ACCEPTED', version: 'v1' }) },

  // Reporting (card 9, #18): aggregate only
  { method: 'get', path: '/api/reports/total-referrals' },

  // Guided Program Matching (card 10, #16)
  { method: 'get', path: '/api/gpme/need-categories' },
  { method: 'post', path: '/api/gpme/match', body: () => ({ needCategoryIds: [1] }) },

  // Program maintenance (card 14, PRs #21, #22, #24, #25)
  ...programRoutes(),
];

function programRoutes() {
  const P = '/api/program-management';
  const v = () => ({ version: 'v1' });
  const routes = [
    { method: 'get', path: `${P}/programs` },
    { method: 'get', path: `${P}/programs/:programId/matching-facts` },
    { method: 'put', path: `${P}/programs/:programId/matching-facts` },
    { method: 'get', path: `${P}/programs/:programId/available-fields` },
    { method: 'get', path: `${P}/organization-programs` },
    { method: 'get', path: `${P}/programs/:programId` },
    { method: 'patch', path: `${P}/programs/:programId`, body: () => ({ version: 'v1', site: 'Synthetic Site' }) },
    { method: 'post', path: `${P}/programs/:programId/discontinue`, body: v },
    { method: 'post', path: `${P}/programs/:programId/reactivate`, body: v },
    { method: 'get', path: `${P}/programs/:programId/fields` },
    { method: 'post', path: `${P}/programs/:programId/fields`, body: () => ({ label: 'Synthetic field', dataType: 'TEXT' }) },
    { method: 'post', path: `${P}/programs/:programId/field-applicability/:fieldId`, body: () => ({ isRequired: false }) },
    { method: 'patch', path: `${P}/programs/:programId/field-applicability/:fieldId`, body: () => ({ version: 'v1', isRequired: true }) },
    { method: 'put', path: `${P}/programs/:programId/field-values/:fieldId`, body: () => ({ version: 'v1', value: 'Synthetic value' }) },
    { method: 'patch', path: `${P}/fields/:fieldId`, body: () => ({ version: 'v1', label: 'Synthetic label' }) },
    { method: 'post', path: `${P}/fields/:fieldId/replace`, body: () => ({ version: 'v1', label: 'Synthetic label', dataType: 'TEXT' }) },
    ...['discontinue', 'reactivate', 'retire'].map((a) => ({ method: 'post', path: `${P}/fields/:fieldId/${a}`, body: v })),
    { method: 'post', path: `${P}/fields/:fieldId/options`, body: () => ({ label: 'Synthetic option' }) },
    { method: 'patch', path: `${P}/fields/:fieldId/options/:optionId`, body: () => ({ version: 'v1', label: 'Synthetic option' }) },
    ...['discontinue', 'reactivate'].map((a) => ({ method: 'post', path: `${P}/fields/:fieldId/options/:optionId/${a}`, body: v })),
    { method: 'get', path: `${P}/departments` },
    { method: 'post', path: `${P}/departments`, body: () => ({ name: 'Synthetic Department' }) },
    { method: 'patch', path: `${P}/departments/:departmentId`, body: () => ({ version: 'v1', name: 'Synthetic Department' }) },
    ...['discontinue', 'reactivate'].map((a) => ({ method: 'post', path: `${P}/departments/:departmentId/${a}`, body: v })),
    { method: 'post', path: `${P}/programs`, body: () => ({ departmentId: 1, name: 'Synthetic Program' }) },
    { method: 'post', path: `${P}/programs/:programId/move`, body: () => ({ version: 'v1', departmentId: 1 }) },
  ];
  return routes;
}

// Real IDs where the suite has them; Program-maintenance IDs point at
// seeded rows (Program 11, Department 1) or at IDs that simply do not
// exist (field 1, option 1), which is enough for these checks.
const fillIds = (p, ctx = {}) => p
  .replace(':referralId', String(ctx.id ?? 1))
  .replace(':submissionId', ctx.submissionId ?? randomUUID())
  .replace(':programId', '11')
  .replace(':fieldId', '1')
  .replace(':optionId', '1')
  .replace(':departmentId', '1');
const fill = (route, ctx) => fillIds(route.path, ctx);
const send = (agent, route, ctx, { body, query } = {}) => {
  let req = agent[route.method](fill(route, ctx));
  if (query) req = req.query(query);
  const payload = body ?? route.body?.();
  return payload === undefined ? req : req.send(payload);
};

// Captures every console channel for the duration of a test.
function captureConsole(t) {
  const lines = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    t.mock.method(console, level, (...args) => lines.push(args.map(String).join(' ')));
  }
  return lines;
}

// ---------------------------------------------------------------------------

describe('route inventory', () => {
  test('every route registered in src/ is covered by this security suite', () => {
    const files = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name.endsWith('.js')) files.push(full);
      }
    };
    walk(path.join(ROOT, 'src'));
    const mounts = {
      'referrals/routes.js': '/api/referrals',
      'programs/routes.js': '/api/program-management',
      'reporting/routes.js': '/api/reports',
      'gpme/routes.js': '/api/gpme',
      'affiliation/routes.js': '/api',
    };
    const found = [];
    for (const file of files) {
      const rel = path.relative(path.join(ROOT, 'src'), file).replaceAll(path.sep, '/');
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/(?:router|app)\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) {
        if (rel === 'app.js' && m[2] === '/health') continue; // public, availability only
        const base = mounts[rel];
        assert.ok(base !== undefined, `${rel} registers routes but has no mount point in this test`);
        found.push(`${m[1]} ${base}${m[2] === '/' ? '' : m[2]}`);
      }
      // Routes registered in a loop over fixed names, e.g.
      //   for (const [path, method] of [['discontinue', ...], ...]) {
      //     router.post(`/fields/:fieldId/${path}`, ...)
      // are expanded here. Any other template path fails the test, so no
      // route can hide from this inventory.
      let expanded = 0;
      for (const m of src.matchAll(/for \(const \[path, \w+\] of (\[[^\n]*\])\) \{\s*router\.(get|post|put|patch|delete)\(`([^`]+)`/g)) {
        expanded += 1;
        const base = mounts[rel];
        assert.ok(base !== undefined, `${rel} registers routes but has no mount point in this test`);
        for (const [, name] of m[1].matchAll(/\['([^']+)'/g)) found.push(`${m[2]} ${base}${m[3].replace('${path}', name)}`);
      }
      const templated = [...src.matchAll(/(?:router|app)\.(get|post|put|patch|delete)\(\s*`/g)].length;
      assert.equal(templated, expanded, `${rel}: a route path built in a way this test cannot expand`);
    }
    const covered = ROUTES.map((r) => `${r.method} ${r.path}`);
    assert.deepEqual(found.sort(), covered.sort(), 'add new routes to ROUTES in test/securityPass.test.js');
  });
});

describe('authentication and application access on every route (PRD 3.1-3.3)', () => {
  for (const route of ROUTES) {
    test(`${route.method.toUpperCase()} ${route.path}: no sign-in -> 401, unknown or inactive user -> 403, never cached`, async () => {
      const ctx = await populated();
      for (const [who, expected] of [[null, 401], [UNKNOWN, 403], [INACTIVE, 403]]) {
        const res = await send(request(appAs(ctx.store, who)), route, ctx);
        assert.equal(res.status, expected, `${who}`);
        assert.equal(res.headers['cache-control'], 'no-store');
        assert.match(res.headers['content-type'], /application\/json/);
        noMarker(res.text, 'response');
      }
      assert.equal(ctx.store._referrals.length, 1, 'nothing created');
      assert.equal(ctx.store._referrals[0].responseStatus, 'AWAITING_RESPONSE', 'nothing changed');
    });
  }

  test('identity never comes from headers, query or body (PRD 3.2)', async () => {
    const ctx = await populated();
    for (const headers of [{ 'X-User-Id': String(RECEIVER) }, { 'X-Role': 'ADMIN' }, { Authorization: 'Bearer forged' }]) {
      const res = await request(appAs(ctx.store, null)).get('/api/referrals/received').set(headers);
      assert.equal(res.status, 401);
    }
    const asCreator = await request(appAs(ctx.store, CREATOR)).get('/api/referrals/received').set('X-User-Id', String(RECEIVER));
    assert.deepEqual(asCreator.body.referrals, [], 'a header naming another user changes nothing');
  });
});

describe('manipulated inputs (PRD 3.3, 10.3, 17.3)', () => {
  const BAD_IDS = ['0', '-1', '1.5', '1e3', '0x10', '%201', '9007199254740993', 'abc', '%00', '1;DROP', '1%20OR%201=1'];

  for (const route of ROUTES.filter((r) => r.path.includes(':referralId'))) {
    test(`${route.method.toUpperCase()} ${route.path}: malformed or unsafe IDs -> 404 before the store is read`, async () => {
      const ctx = await populated();
      let reads = 0;
      const spy = { ...ctx.store, getReferralById: async (...a) => { reads += 1; return ctx.store.getReferralById(...a); } };
      for (const bad of BAD_IDS) {
        const res = await send(request(appAs(spy, RECEIVER)), { ...route, path: route.path.replace(':referralId', bad) }, ctx);
        assert.equal(res.status, 404, bad);
        assert.equal(res.body.code, 'REFERRAL_NOT_FOUND', bad);
      }
      assert.equal(reads, 0);
    });
  }

  test('a malformed Submission ID is refused; another user\'s Submission ID reveals nothing', async () => {
    const ctx = await populated();
    for (const bad of ['not-a-uuid', '1', `${ctx.submissionId}x`]) {
      assert.equal((await request(appAs(ctx.store, CREATOR)).get(`/api/referrals/submissions/${bad}`)).status, 400);
    }
    const other = await request(appAs(ctx.store, RECEIVER)).get(`/api/referrals/submissions/${ctx.submissionId}`);
    assert.deepEqual(other.body, { status: 'NOT_RECEIVED', referral: null });
  });

  for (const route of ROUTES) {
    test(`${route.method.toUpperCase()} ${route.path}: unknown query parameters are refused without echoing their names`, async () => {
      const ctx = await populated();
      const res = await send(request(appAs(ctx.store, RECEIVER)), route, ctx, { query: { userId: '1', [M.name]: '1' } });
      assert.equal(res.status, 400);
      noMarker(res.text, 'response');
    });
  }

  for (const route of ROUTES.filter((r) => r.body)) {
    test(`${route.method.toUpperCase()} ${route.path}: server-controlled fields in the body are refused; nothing changes`, async () => {
      for (const extra of [{ userId: RECEIVER }, { createdByUserId: RECEIVER }, { role: 'ADMIN' }, { isAdmin: true }, { [M.name]: 1 }]) {
        const ctx = await populated();
        const res = await send(request(appAs(ctx.store, RECEIVER)), route, ctx, { body: { ...route.body(), ...extra } });
        assert.equal(res.status, 400, JSON.stringify(Object.keys(extra)));
        noMarker(res.text, 'response');
        assert.equal(ctx.store._referrals.length, 1);
        assert.equal(ctx.store._referrals[0].responseStatus, 'AWAITING_RESPONSE');
        assert.equal((await ctx.store.getUser(RECEIVER)).currentProgramId, 11);
        assert.equal((await ctx.store.getProgram(11)).site, null, 'no Program change');
        assert.equal((await ctx.store.getDepartment(1)).name, 'Synthetic Dept', 'no Department change');
      }
    });
  }
});

describe('authorization boundaries (capability + resource + scope, PRD 3.3-3.9)', () => {
  test('outcome and correction rights for another Program grant nothing on this one; admin grants give nothing', async () => {
    const ctx = await populated();
    await request(appAs(ctx.store, RECEIVER)).post(`/api/referrals/${ctx.id}/response`).send({ decision: 'ACCEPTED' });
    const before = JSON.stringify(ctx.store._referrals);
    // OTHER holds RECORD_OUTCOME, CORRECT_OUTCOME and UPDATE_RECEIVED_REFERRAL, but for Program 12.
    for (const who of [OTHER, ADMIN]) {
      const app = appAs(ctx.store, who);
      for (const [url, body] of [
        [`/api/referrals/${ctx.id}/outcome`, { outcome: 'RESULTED_IN_SERVICE' }],
        [`/api/referrals/${ctx.id}/outcome/correction`, { outcome: 'DID_NOT_RESULT_IN_SERVICE', version: 'v1' }],
        [`/api/referrals/${ctx.id}/response/correction`, { decision: 'NOT_APPROPRIATE', reasonId: 2, version: 'v1' }],
      ]) {
        const res = await request(app).post(url).send(body);
        assert.equal(res.status, 404, `${who} ${url}`);
        assert.equal(res.body.code, 'REFERRAL_NOT_FOUND', 'hidden looks the same as missing');
      }
    }
    // The creator can see the referral but holds no outcome or correction capability.
    assert.equal((await request(appAs(ctx.store, CREATOR)).post(`/api/referrals/${ctx.id}/outcome`).send({ outcome: 'RESULTED_IN_SERVICE' })).status, 403);
    assert.equal(JSON.stringify(ctx.store._referrals), before, 'nothing changed');
  });

  test('reporting is aggregate only: no referral content or identifiers for any active user (PRD 3.5, 12)', async () => {
    const ctx = await populated();
    for (const who of [ADMIN, CREATOR, RECEIVER, OTHER]) {
      const res = await request(appAs(ctx.store, who)).get('/api/reports/total-referrals?period=MONTHLY');
      assert.equal(res.status, 200, `${who}`);
      assert.equal(res.headers['cache-control'], 'no-store');
      noMarker(res.text, 'report');
      assert.doesNotMatch(res.text, /referralId|submissionId|participant|contact/i);
    }
  });

  test('GPME never echoes, stores or logs the matching answers (PRD 5.3, 8.2)', async (t) => {
    const lines = captureConsole(t);
    const ctx = await populated();
    const before = JSON.stringify(ctx.store._referrals);
    const app = appAs(ctx.store, CREATOR);
    const responses = [
      await request(app).post('/api/gpme/match').send({ needCategoryIds: [1], ageRange: { min: 19, max: 20 }, participantZip: '99917' }),
      await request(app).post('/api/gpme/match').send({ needCategoryIds: [1], participantZip: M.name }),
      await request(app).post('/api/gpme/match').send({ needCategoryIds: [1], notes: M.notes }),
      await request(app).post('/api/gpme/match').set('Content-Type', 'application/json').send(`{"participantZip":"${M.name}"`),
    ];
    for (const res of responses) {
      assert.equal(res.headers['cache-control'], 'no-store');
      noMarker(res.text, 'GPME response');
      assert.ok(!res.text.includes('99917'), 'ZIP echoed');
    }
    noMarker(lines.join('\n'), 'log');
    assert.ok(!lines.join('\n').includes('99917'), 'ZIP logged');
    assert.equal(JSON.stringify(ctx.store._referrals), before, 'matching creates nothing');
  });

  test('full receiving rights for another Program grant nothing on this one', async () => {
    const ctx = await populated();
    const app = appAs(ctx.store, OTHER);
    assert.equal((await request(app).get(`/api/referrals/${ctx.id}`)).status, 404);
    assert.equal((await request(app).post(`/api/referrals/${ctx.id}/response`).send({ decision: 'ACCEPTED' })).status, 404);
    assert.equal((await request(app).get('/api/referrals/received?programId=11')).status, 403);
    assert.deepEqual((await request(app).get('/api/referrals/received')).body.referrals, []);
  });

  test('administrator, Program-management and reporting grants give no referral access', async () => {
    const ctx = await populated();
    const app = appAs(ctx.store, ADMIN);
    assert.equal((await request(app).get(`/api/referrals/${ctx.id}`)).status, 404);
    assert.equal((await request(app).post(`/api/referrals/${ctx.id}/response`).send({ decision: 'ACCEPTED' })).status, 404);
    assert.deepEqual((await request(app).get('/api/referrals/received')).body.referrals, []);
  });

  test('the creator can view but not respond; an authorized receiver can do both', async () => {
    const ctx = await populated();
    assert.equal((await request(appAs(ctx.store, CREATOR)).get(`/api/referrals/${ctx.id}`)).status, 200);
    assert.equal((await request(appAs(ctx.store, CREATOR)).post(`/api/referrals/${ctx.id}/response`).send({ decision: 'ACCEPTED' })).status, 403);
    assert.equal((await request(appAs(ctx.store, RECEIVER)).post(`/api/referrals/${ctx.id}/response`).send({ decision: 'ACCEPTED' })).status, 200);
  });

  test('an unauthorized ID looks exactly like a missing one', async () => {
    const ctx = await populated();
    const hidden = await request(appAs(ctx.store, OTHER)).get(`/api/referrals/${ctx.id}`);
    const missing = await request(appAs(ctx.store, OTHER)).get('/api/referrals/987654');
    assert.equal(hidden.status, missing.status);
    assert.deepEqual(hidden.body, missing.body);
  });
});

describe('sensitive data stays out of logs, errors and caches (PRD 5.4, 5.5, 15.3, 15.4)', () => {
  test('a full referral lifecycle, including failures, writes no participant data to any console channel', async (t) => {
    const lines = captureConsole(t);
    const store = seed();
    const creator = appAs(store, CREATOR);
    const receiver = appAs(store, RECEIVER);

    await request(creator).put('/api/me/affiliation').send({ programId: 10, version: (await request(creator).get('/api/me/affiliation')).body.version });
    const sent = await request(creator).post('/api/referrals').send(referralBody());
    assert.equal(sent.status, 201);
    const id = sent.body.referral.referralId;
    await request(creator).post('/api/referrals').send(referralBody({ participantZip: 'BAD', contactValue: `bad ${M.contact}` }));
    await request(creator).post('/api/referrals').set('Content-Type', 'application/json').send(`{"participantName":"${M.name}"`);
    await request(creator).post('/api/referrals').send(referralBody({ referralContext: `${M.context}${'x'.repeat(70000)}` }));
    await request(receiver).get('/api/referrals/received');
    await request(receiver).get(`/api/referrals/${id}`);
    store._failNextAudit();
    const failed = await request(receiver).post(`/api/referrals/${id}/response`)
      .send({ decision: 'NOT_APPROPRIATE', reasonId: 2, explanation: M.explanation });
    assert.equal(failed.status, 500);
    await request(receiver).post(`/api/referrals/${id}/response`).send({ decision: 'NOT_APPROPRIATE', reasonId: 2, explanation: M.explanation });
    await request(creator).get(`/api/referrals/${id}`);

    assert.ok(lines.length > 0, 'the 500 is logged');
    noMarker(lines.join('\n'), 'console output');
  });

  test('error responses never echo submitted values', async () => {
    const ctx = await populated();
    const app = appAs(ctx.store, CREATOR);
    const responses = [
      await request(app).post('/api/referrals').send(referralBody({ participantZip: M.name, contactValue: M.contact, contactMethod: 'PHONE_CALL' })),
      await request(app).post('/api/referrals').set('Content-Type', 'application/json').send(`{"notes":"${M.notes}"`),
      await request(app).post('/api/referrals').send(referralBody({ referralContext: `${M.context}${'x'.repeat(70000)}` })),
      await request(app).put('/api/me/affiliation').send({ programId: M.name, version: M.contact }),
    ];
    for (const res of responses) {
      assert.equal(res.status, 400);
      noMarker(res.text, 'error response');
    }
  });

  test('every API response, success or error, is marked no-store', async () => {
    const ctx = await populated();
    for (const route of ROUTES) {
      for (const who of [RECEIVER, CREATOR, null]) {
        const res = await send(request(appAs(ctx.store, who)), route, ctx);
        assert.equal(res.headers['cache-control'], 'no-store', `${route.method} ${route.path} as ${who}: ${res.status}`);
      }
    }
  });

  test('the sent list and the receiving queue never include contact details or notes', async () => {
    const ctx = await populated();
    const sent = await request(appAs(ctx.store, CREATOR)).get('/api/referrals/sent');
    const queue = await request(appAs(ctx.store, RECEIVER)).get('/api/referrals/received');
    for (const res of [sent, queue]) {
      assert.ok(!res.text.includes(M.contact) && !res.text.includes('QUUXNOTES'));
    }
    assert.ok(!sent.text.includes('QUUXCONTEXT'), 'the creator\'s list omits the need');
  });
});

describe('unknown routes and methods get a fixed 404 (PRD 10.4, 15.4)', () => {
  const PROBES = [
    ['get', `/api/nope/${encodeURIComponent(M.name)}`],
    ['get', `/api/referrals/1/${encodeURIComponent(M.contact)}`],
    ['delete', '/api/referrals/1'],
    ['patch', '/api/me/affiliation'],
    ['get', `/no-such-page/${encodeURIComponent(M.name)}`],
  ];

  for (const who of [RECEIVER, null]) {
    test(`${who ? 'signed in' : 'signed out'}: the path is never echoed, the body is fixed JSON, never cached`, async () => {
      const ctx = await populated();
      for (const [method, url] of PROBES) {
        const res = await request(appAs(ctx.store, who))[method](url);
        if (res.status === 401) continue; // /api/referrals/* asks for sign-in first
        assert.equal(res.status, 404, `${method} ${url}`);
        assert.deepEqual(res.body, { error: 'Not Found' });
        assert.equal(res.headers['cache-control'], 'no-store');
        noMarker(res.text, 'response');
        assert.ok(!res.text.includes('Cannot'), 'not the built-in Express page');
      }
    });
  }

  test('hidden files and paths outside public/ are not served', async () => {
    for (const url of ['/.env', '/.env.example', '/%2e%2e/package.json', '/../src/server.js', '/package.json']) {
      const res = await request(createApp({})).get(url);
      assert.equal(res.status, 404, url);
    }
  });
});

describe('error logs carry the route pattern, never the request path (PRD 15.3)', () => {
  test('client text in the URL never reaches the log', async (t) => {
    const lines = captureConsole(t);
    const store = seed();
    // Plain text in the path (no percent-encoding), on requests that really
    // fail with a 500 and get logged.
    const PATH_MARKER = 'SyntheticPersonOmegaInUrl';
    const crashing = createApp({ referralStore: store, affiliationStore: store, resolveIdentity: () => { throw new Error(M.contact); } });
    await request(crashing).get(`/api/referrals/${PATH_MARKER}`);
    await request(crashing).get(`/api/referrals/submissions/${PATH_MARKER}`);
    await request(crashing).get(`/api/referrals/sent?x=${PATH_MARKER}`);
    await request(crashing).get('/api/programs');

    const failing = { ...store, getReferralBySubmissionId: async () => { throw new Error(`db said ${M.name}`); } };
    const app = createApp({ affiliationStore: failing, referralStore: failing, resolveIdentity: () => ({ userId: CREATOR }) });
    const res = await request(app).get(`/api/referrals/submissions/${randomUUID()}`);
    assert.equal(res.status, 500);

    const log = lines.join('\n');
    assert.equal(lines.length, 5, log);
    assert.ok(!log.includes(PATH_MARKER), log);
    noMarker(log, 'log');
    assert.match(log, /\[error\] GET \/api\/referrals\/submissions\/:submissionId -> 500/);
    assert.match(log, /\[error\] GET \/api\/referrals \(no matching route\) -> 500/);
  });

  test('safeLocation returns the matched pattern or the mount point only', () => {
    const at = (originalUrl, routePath) => safeLocation({ originalUrl, route: routePath ? { path: routePath } : undefined });
    assert.equal(at(`/api/referrals/${M.name}`, '/:referralId'), '/api/referrals/:referralId');
    assert.equal(at('/api/referrals?x=1', '/'), '/api/referrals');
    assert.equal(at('/api/me/affiliation', '/me/affiliation'), '/api/me/affiliation');
    assert.equal(at('/health', '/health'), '/health');
    assert.equal(at(`/api/referrals/${M.name}/deep`), '/api/referrals (no matching route)');
    assert.equal(at(`/api-${M.name}`), '(no matching route)');
    assert.equal(at(`/${M.name}`), '(no matching route)');
    assert.equal(safeLocation({}), '(no matching route)');
  });

  test('MOUNT_POINTS matches the app.use() mounts in app.js', () => {
    const app = readFileSync(path.join(ROOT, 'src/app.js'), 'utf8');
    const mounted = [...app.matchAll(/app\.use\(\s*'(\/[^']+)'/g)].map((m) => m[1]);
    assert.deepEqual([...mounted].sort(), [...MOUNT_POINTS].sort());
  });
});

// Christina's #23 review: err.name and err.code were logged verbatim, so
// an error carrying participant text or a line break reached the log.
describe('error name and code in logs are allowlisted (PRD 15.3, 15.4)', () => {
  const SECRET = 'SyntheticSecretToken';
  const HOSTILE = [
    { name: M.name, code: SECRET },
    { name: `TypeError\n[error] GET /forged -> 200 (${M.name})`, code: `ECONNRESET\r\n${SECRET}` },
    { name: 'Error\u2028forged', code: 'ETIMEDOUT\u2029forged' },
    { name: 'error', code: 'econnreset' }, // near misses are not on the list
    { name: { toString: () => M.name }, code: { toString: () => SECRET } },
    { name: ['Error'], code: 404 },
  ];

  // Calls the real handler with a fake request and response.
  function handle(err, { method = 'GET', originalUrl = '/api/referrals/1', route = { path: '/:referralId' }, headersSent = false } = {}) {
    const lines = [];
    const saved = console.error;
    console.error = (...args) => lines.push(args.map(String).join(' '));
    const res = {
      headersSent, statusCode: null, headers: {}, body: undefined, destroyed: false,
      set(k, v) { this.headers[k] = v; return this; },
      status(code) { this.statusCode = code; return this; },
      json(b) { this.body = b; return this; },
      destroy() { this.destroyed = true; },
    };
    try {
      errorHandler(err, { method, originalUrl, route }, res, () => {});
    } finally {
      console.error = saved;
    }
    return { lines, res };
  }

  const clean = (text) => {
    noMarker(text, 'log');
    assert.ok(!text.includes(SECRET), `log contains ${SECRET}`);
    assert.ok(!text.includes('forged'), 'log contains forged text');
    assert.doesNotMatch(text, /[\r\n\u2028\u2029]/, 'log line contains a line break');
  };

  for (const [i, fields] of HOSTILE.entries()) {
    test(`hostile name/code #${i + 1} -> one fixed log line, generic response`, () => {
      const err = Object.assign(new Error(`message ${M.name}`), fields);
      const { lines, res } = handle(err);
      assert.equal(lines.length, 1);
      clean(lines[0]);
      assert.equal(lines[0], '[error] GET /api/referrals/:referralId -> 500 (OtherError code=OTHER)');
      assert.deepEqual(res.body, { error: 'Internal Server Error' });
      assert.equal(res.headers['Cache-Control'], 'no-store');
      clean(JSON.stringify(res.body));
    });
  }

  test('the same holds for a 4xx error and after the response has started', () => {
    const err = Object.assign(new Error('x'), { status: 413, name: M.name, code: `${SECRET}\n` });
    const first = handle(err);
    clean(first.lines[0]);
    assert.deepEqual(first.res.body, { error: 'Payload Too Large' });
    const started = handle(err, { headersSent: true });
    clean(started.lines[0]);
    assert.equal(started.res.destroyed, true);
  });

  test('known names and codes are still logged, so real failures stay diagnosable', () => {
    assert.equal(handle(Object.assign(new TypeError('x'), { code: 'ECONNRESET' })).lines[0],
      '[error] GET /api/referrals/:referralId -> 500 (TypeError code=ECONNRESET)');
    assert.equal(handle(new RangeError('x')).lines[0], '[error] GET /api/referrals/:referralId -> 500 (RangeError)');
    assert.equal(safeErrorName({ name: 'ProgramError' }), 'ProgramError');
    assert.equal(safeErrorCode({ code: 'ELOGIN' }), 'ELOGIN');
    assert.equal(safeErrorCode({}), null);
    assert.equal(safeErrorName(null), 'OtherError');
    assert.equal(safeErrorName(undefined), 'OtherError');
  });

  test('an unexpected HTTP method name is not logged either', () => {
    const { lines } = handle(new Error('x'), { method: `GET ${M.name}\n` });
    clean(lines[0]);
    assert.match(lines[0], /^\[error\] OTHER /);
  });

  test('through the real app: a store error carrying participant text is logged safely, answered generically', async (t) => {
    const lines = captureConsole(t);
    const ctx = await populated();
    const store = {
      ...ctx.store,
      getReferralById: async () => {
        throw Object.assign(new Error(M.context), { name: `${M.name}\nforged`, code: `${SECRET}\r\n` });
      },
    };
    const res = await request(appAs(store, RECEIVER)).get(`/api/referrals/${ctx.id}`);
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { error: 'Internal Server Error' });
    assert.equal(lines.length, 1);
    clean(lines[0]);
    assert.equal(lines[0], '[error] GET /api/referrals/:referralId -> 500 (OtherError code=OTHER)');
  });
});

describe('production safety: demo controls fail closed, no fallback (PRD 16.1, 17.4, 18.5)', () => {
  test('DEMO grants cannot be turned on outside development or test', () => {
    for (const nodeEnv of ['production', 'Production', 'staging', '', undefined]) {
      assert.throws(() => appAs(seed(), RECEIVER, { allowDemoGrants: true, nodeEnv }), /DEMO grants/, String(nodeEnv));
    }
  });

  test('a truthy non-boolean allowDemoGrants never enables DEMO grants', async () => {
    const store = seed();
    store._grants.push(g(ADMIN, 'VIEW_RECEIVED_REFERRAL', { grantSource: 'DEMO' }));
    const created = await createReferralService({ store }).createDirectReferral(CREATOR, referralBody());
    for (const allowDemoGrants of ['true', 1, {}]) {
      const app = appAs(store, ADMIN, { allowDemoGrants, nodeEnv: 'production' });
      assert.equal((await request(app).get(`/api/referrals/${created.referral.referralId}`)).status, 404, String(allowDemoGrants));
    }
  });

  test('production source never imports synthetic data, the dev server, or in-memory stores', () => {
    const server = readFileSync(path.join(ROOT, 'src/server.js'), 'utf8');
    assert.doesNotMatch(server, /memory|synthetic|scripts\//i);
    assert.doesNotMatch(server, /resolveIdentity/);
    assert.match(server, /allowDemoGrants:\s*false/);
    const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n)) : [path.join(dir, n)]));
    for (const file of walk(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js'))) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /from\s+['"][./]*scripts\//, `${file} imports from scripts/`);
    }
  });

  test('the synthetic dev server refuses every environment except development', () => {
    for (const nodeEnv of ['production', 'test', 'staging', 'Development', '']) {
      const env = { PATH: process.env.PATH, PORT: '3998', DOTENV_CONFIG_PATH: '/nonexistent' };
      if (nodeEnv !== '') env.NODE_ENV = nodeEnv;
      const result = spawnSync(process.execPath, ['scripts/dev-synthetic-server.js'], { cwd: ROOT, env, timeout: 5000, encoding: 'utf8' });
      assert.equal(result.status, 1, `NODE_ENV=${nodeEnv}`);
    }
  });

  test('the production server starts with no sign-in fallback: /health works, every API answers 401', async () => {
    const port = String(34600 + Math.floor(Math.random() * 300));
    const child = spawn(process.execPath, ['src/server.js'], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, NODE_ENV: 'production', PORT: port, DOTENV_CONFIG_PATH: '/nonexistent' },
    });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('server did not start')), 10000);
        child.stdout.on('data', (d) => { if (String(d).includes('listening on')) { clearTimeout(timer); resolve(); } });
        child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`exited ${code}`)); });
      });
      const base = `http://127.0.0.1:${port}`;
      assert.equal((await fetch(`${base}/health`)).status, 200);
      for (const route of ROUTES) {
        const url = `${base}${fillIds(route.path)}`;
        const res = await fetch(url, {
          method: route.method.toUpperCase(),
          headers: { 'Content-Type': 'application/json', 'X-User-Id': '1' },
          body: route.body ? JSON.stringify(route.body()) : undefined,
        });
        assert.equal(res.status, 401, `${route.method} ${route.path}`);
      }
    } finally {
      child.kill();
    }
  });

  test('startup refuses a missing or unrecognized NODE_ENV', () => {
    for (const nodeEnv of [undefined, 'Production', 'staging', 'prod']) {
      const env = { PATH: process.env.PATH, PORT: '3997', DOTENV_CONFIG_PATH: '/nonexistent' };
      if (nodeEnv) env.NODE_ENV = nodeEnv;
      const result = spawnSync(process.execPath, ['src/server.js'], { cwd: ROOT, env, timeout: 5000, encoding: 'utf8' });
      assert.equal(result.status, 1, String(nodeEnv));
    }
  });
});
