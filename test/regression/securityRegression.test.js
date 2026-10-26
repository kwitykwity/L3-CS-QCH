// Trello Task F: integrated security and authorization regression
// (Final Technical PRD 3.2 to 3.9, 5.4, 5.5, 9.6, 10.3, 10.4, 15.3, 15.4,
// 16.1, 17.3, 17.4).
//
// test/securityPass.test.js (card 16) is the starting point: for EVERY
// route it checks sign-in (401), unknown or inactive users (403), no-store,
// unexpected query and body fields, and that no route is missing from its
// inventory. It does not prove that an ACTIVE, signed-in person without the
// right capability, resource or scope is refused on every later feature.
// This suite does, across referrals, receiving, outcomes and corrections,
// GPME, Program Management and Reporting:
//
// - Every route that changes data has a row in MUTATIONS: who is allowed,
//   who is not. The allowed person must succeed with the exact same
//   request (so a refusal is about permission, not a bad request); every
//   other person must get 403 or 404 and NOTHING in the store may change.
// - Resource reads (READS) are refused the same way, without leaking.
// - DEMO grants count for nothing unless demo grants are turned on.
// - Malformed IDs in every Program Management path are refused cleanly.
// - No response carries a Program's notification email or participant
//   contact details outside the referral itself, and no log line carries
//   participant data, during the whole run.
// - A completeness test fails if a route is added without a row here.
//
// It runs on the in-memory store through the application/store contract
// (no Azure SQL or SharePoint). What must be re-run against the production
// store is listed in docs/security-regression.md. All data is SYNTHETIC.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createMemoryReferralStore } from '../../src/referrals/memoryReferralStore.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ----- synthetic people -----------------------------------------------------
const P = Object.freeze({
  REFERRER: 100,        // affiliated with Program 10; no grants
  RECEIVER: 200,        // every receiving capability for Program 11
  VIEWER: 201,          // may only view Program 11's received referrals
  OTHER_RECEIVER: 202,  // every receiving capability, for Program 12
  DEMO_RECEIVER: 203,   // every receiving capability for 11, DEMO grants
  MANAGER: 300,         // MANAGE_PROGRAM for Programs 11 and 13
  OTHER_MANAGER: 301,   // MANAGE_PROGRAM for Program 12 only
  WIDE_MANAGER: 302,    // MANAGE_PROGRAM at DEPARTMENT and ORG scope only
  DEMO_MANAGER: 303,    // MANAGE_PROGRAM for 11 and 13, DEMO grants
  ORG_ADMIN: 400,       // MANAGE_ORGANIZATION (ORG)
  DEMO_ORG_ADMIN: 401,  // MANAGE_ORGANIZATION (ORG), DEMO grant
  PERMISSION_ADMIN: 402, // ADMINISTER_PERMISSIONS, VIEW_UNDERLYING_REFERRAL, VIEW_AGGREGATE_REPORTING
  NOBODY: 500,          // active, affiliated with Program 11, no grants
});
const NAME = Object.fromEntries(Object.entries(P).map(([k, v]) => [v, k]));
const RECEIVING = ['VIEW_RECEIVED_REFERRAL', 'RESPOND_TO_REFERRAL', 'RECORD_OUTCOME', 'CORRECT_OUTCOME', 'UPDATE_RECEIVED_REFERRAL'];

// Synthetic markers that must never appear where they don't belong.
const M = Object.freeze({
  name: 'Synthetic Person Taskf',
  contact: 'taskf.participant@example.test',
  context: 'Synthetic need TASKFCONTEXT',
  notes: 'Synthetic note TASKFNOTES',
  explanation: 'Synthetic explanation TASKFEXPLAIN',
  routing: 'taskf.routing@example.test', // a Program's notification email
});
const LOG_MARKERS = [M.name, M.contact, 'TASKFCONTEXT', 'TASKFNOTES', 'TASKFEXPLAIN', M.routing];

const grant = (userId, permission, extra = {}) => ({
  userId, permission, scopeType: 'PROGRAM', programId: 11, departmentId: null, grantSource: 'IN_APP', ...extra,
});
const OLD = '2026-01-02T00:00:00.000Z'; // long enough ago to retire (90 days)

function seed() {
  return createMemoryReferralStore({
    departments: [
      { departmentId: 1, name: 'Synthetic Dept One', lifecycleStatus: 'ACTIVE' },
      { departmentId: 2, name: 'Synthetic Dept Empty', lifecycleStatus: 'ACTIVE' },
      { departmentId: 3, name: 'Synthetic Dept Closed', lifecycleStatus: 'DISCONTINUED' },
    ],
    needCategories: [{ needCategoryId: 1, name: 'Synthetic need category', lifecycleStatus: 'ACTIVE' }],
    programs: [
      { programId: 10, departmentId: 1, name: 'Synthetic Referring', site: null, lifecycleStatus: 'ACTIVE' },
      // A notification email on the Program row, the way the SQL design
      // stores it: no API response may ever return it (PRD 11.3).
      { programId: 11, departmentId: 1, name: 'Synthetic Receiving', site: null, lifecycleStatus: 'ACTIVE', notificationEmail: M.routing },
      { programId: 12, departmentId: 1, name: 'Synthetic Other', site: null, lifecycleStatus: 'ACTIVE', notificationEmail: M.routing },
      { programId: 13, departmentId: 1, name: 'Synthetic Paused', site: null, lifecycleStatus: 'DISCONTINUED' },
    ],
    users: [
      { userId: P.REFERRER, isActive: true, currentProgramId: 10 },
      ...[P.RECEIVER, P.VIEWER, P.DEMO_RECEIVER, P.MANAGER, P.DEMO_MANAGER, P.NOBODY]
        .map((userId) => ({ userId, isActive: true, currentProgramId: 11 })),
      ...[P.OTHER_RECEIVER, P.OTHER_MANAGER].map((userId) => ({ userId, isActive: true, currentProgramId: 12 })),
      ...[P.WIDE_MANAGER, P.ORG_ADMIN, P.DEMO_ORG_ADMIN, P.PERMISSION_ADMIN].map((userId) => ({ userId, isActive: true })),
    ],
    grants: [
      ...RECEIVING.map((p) => grant(P.RECEIVER, p)),
      grant(P.VIEWER, 'VIEW_RECEIVED_REFERRAL'),
      ...RECEIVING.map((p) => grant(P.OTHER_RECEIVER, p, { programId: 12 })),
      ...RECEIVING.map((p) => grant(P.DEMO_RECEIVER, p, { grantSource: 'DEMO' })),
      grant(P.MANAGER, 'MANAGE_PROGRAM'), grant(P.MANAGER, 'MANAGE_PROGRAM', { programId: 13 }),
      grant(P.OTHER_MANAGER, 'MANAGE_PROGRAM', { programId: 12 }),
      grant(P.WIDE_MANAGER, 'MANAGE_PROGRAM', { scopeType: 'DEPARTMENT', programId: null, departmentId: 1 }),
      grant(P.WIDE_MANAGER, 'MANAGE_PROGRAM', { scopeType: 'ORG', programId: null }),
      grant(P.DEMO_MANAGER, 'MANAGE_PROGRAM', { grantSource: 'DEMO' }),
      grant(P.DEMO_MANAGER, 'MANAGE_PROGRAM', { programId: 13, grantSource: 'DEMO' }),
      grant(P.ORG_ADMIN, 'MANAGE_ORGANIZATION', { scopeType: 'ORG', programId: null }),
      grant(P.DEMO_ORG_ADMIN, 'MANAGE_ORGANIZATION', { scopeType: 'ORG', programId: null, grantSource: 'DEMO' }),
      grant(P.PERMISSION_ADMIN, 'ADMINISTER_PERMISSIONS', { scopeType: 'ORG', programId: null }),
      grant(P.PERMISSION_ADMIN, 'VIEW_UNDERLYING_REFERRAL'),
      grant(P.PERMISSION_ADMIN, 'VIEW_AGGREGATE_REPORTING', { scopeType: 'ORG', programId: null }),
    ],
    notAppropriateReasons: [{ reasonId: 1, code: 'OTHER', label: 'Other', displayOrder: 1 }],
    fields: [
      { fieldId: 1, label: 'Synthetic hours', dataType: 'TEXT' },                  // Program 11 only
      { fieldId: 2, label: 'Synthetic format', dataType: 'SINGLE_SELECT' },        // Program 11 only
      { fieldId: 3, label: 'Synthetic old', dataType: 'TEXT', lifecycleStatus: 'DISCONTINUED', discontinuedAt: OLD },
      { fieldId: 4, label: 'Synthetic elsewhere', dataType: 'TEXT' },              // Program 12 only
    ].map((f) => ({ fieldKey: `taskf_${f.fieldId}`, appliesTo: 'PROGRAM_INFO', ...f })),
    fieldOptions: [
      { optionId: 1, fieldId: 2, label: 'Synthetic in person' },
      { optionId: 3, fieldId: 2, label: 'Synthetic by phone' },
      { optionId: 2, fieldId: 2, label: 'Synthetic retired option', lifecycleStatus: 'DISCONTINUED' },
    ],
    fieldApplicability: [
      { programId: 11, fieldId: 1, displayOrder: 1 },
      { programId: 11, fieldId: 2, displayOrder: 2 },
      { programId: 11, fieldId: 3, displayOrder: 3 },
      { programId: 12, fieldId: 4, displayOrder: 1 },
    ],
    fieldValues: [{ programId: 11, fieldId: 1, valueText: 'Synthetic Mon-Fri' }],
  });
}

// ----- helpers ------------------------------------------------------------
const appAs = (store, userId, extra = {}) =>
  createApp({ affiliationStore: store, referralStore: store, resolveIdentity: () => ({ userId }), ...extra });

const programVersion = async (store, id) => (await store.getProgram(id)).version;
const departmentVersion = async (store, id) => (await store.getDepartment(id)).version;
const fieldVersion = (store, id) => store._fieldRows().find((f) => f.fieldId === id).version;
const optionVersion = (store, id) => store._optionRows().find((o) => o.optionId === id).version;
const useVersion = (store, programId, fieldId) =>
  store._applicabilityRows().find((a) => a.programId === programId && a.fieldId === fieldId).version;
const referralVersion = async (store, id) => (await store.getReferralById(id)).version;

// A new referral from REFERRER to Program 11, moved to `stage` by RECEIVER.
async function referral(store, stage = 'NEW') {
  const sent = await request(appAs(store, P.REFERRER)).post('/api/referrals').send({
    submissionId: randomUUID(), receivingProgramId: 11, participantName: M.name, contactMethod: 'EMAIL',
    contactValue: M.contact, referralContext: M.context, notes: M.notes,
  });
  assert.equal(sent.status, 201);
  const id = sent.body.referral.referralId;
  const as = request(appAs(store, P.RECEIVER));
  if (stage === 'NEW') return id;
  if (stage === 'NOT_APPROPRIATE') {
    assert.equal((await as.post(`/api/referrals/${id}/response`)
      .send({ decision: 'NOT_APPROPRIATE', reasonId: 1, explanation: M.explanation })).status, 200);
    return id;
  }
  assert.equal((await request(appAs(store, P.RECEIVER)).post(`/api/referrals/${id}/response`).send({ decision: 'ACCEPTED' })).status, 200);
  if (stage === 'ACCEPTED') return id;
  assert.equal((await request(appAs(store, P.RECEIVER)).post(`/api/referrals/${id}/outcome`).send({ outcome: 'RESULTED_IN_SERVICE' })).status, 200);
  return id;
}

// Everything the store holds that a request could change.
async function snapshot(store) {
  const ids = (n) => Array.from({ length: n }, (_, i) => i + 1);
  return JSON.stringify({
    referrals: store._referrals,
    audit: store._referralAuditEvents,
    evaluations: store._gpmeEvaluations,
    fields: store._fieldRows(),
    options: store._optionRows(),
    applicability: store._applicabilityRows(),
    values: store._valueRows(),
    programs: await Promise.all(ids(30).map((id) => store.getProgram(id))),
    departments: await Promise.all(ids(10).map((id) => store.getDepartment(id))),
    users: await Promise.all(Object.values(P).map((id) => store.getUser(id))),
    grants: store._grants,
  });
}

function captureConsole(t) {
  const lines = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    t.mock.method(console, level, (...args) => lines.push(args.map(String).join(' ')));
  }
  return lines;
}

// ----- the permission table for every route that changes data -------------
const REFERRAL_OUTSIDERS = [P.REFERRER, P.VIEWER, P.OTHER_RECEIVER, P.DEMO_RECEIVER, P.MANAGER, P.ORG_ADMIN, P.PERMISSION_ADMIN, P.NOBODY];
const PROGRAM_OUTSIDERS = [P.OTHER_MANAGER, P.WIDE_MANAGER, P.DEMO_MANAGER, P.ORG_ADMIN, P.RECEIVER, P.PERMISSION_ADMIN, P.NOBODY];
const ORG_OUTSIDERS = [P.MANAGER, P.WIDE_MANAGER, P.DEMO_ORG_ADMIN, P.PERMISSION_ADMIN, P.RECEIVER, P.NOBODY];
const PM = '/api/program-management';

// method, path, the allowed person, the people who must be refused, and a
// setup that returns { url, body } for a fresh store.
const MUTATIONS = [
  // Receiving lifecycle (cards 7, 8; Task A)
  { method: 'post', path: '/api/referrals/:referralId/response', allowed: P.RECEIVER, denied: REFERRAL_OUTSIDERS,
    setup: async (s) => ({ url: `/api/referrals/${await referral(s)}/response`, body: { decision: 'ACCEPTED' } }) },
  { method: 'post', path: '/api/referrals/:referralId/outcome', allowed: P.RECEIVER, denied: REFERRAL_OUTSIDERS,
    setup: async (s) => ({ url: `/api/referrals/${await referral(s, 'ACCEPTED')}/outcome`, body: { outcome: 'RESULTED_IN_SERVICE' } }) },
  { method: 'post', path: '/api/referrals/:referralId/outcome/correction', allowed: P.RECEIVER, denied: REFERRAL_OUTSIDERS,
    setup: async (s) => {
      const id = await referral(s, 'OUTCOME');
      return { url: `/api/referrals/${id}/outcome/correction`, body: { outcome: 'DID_NOT_RESULT_IN_SERVICE', version: await referralVersion(s, id) } };
    } },
  { method: 'post', path: '/api/referrals/:referralId/response/correction', allowed: P.RECEIVER, denied: REFERRAL_OUTSIDERS,
    setup: async (s) => {
      const id = await referral(s, 'NOT_APPROPRIATE');
      return { url: `/api/referrals/${id}/response/correction`, body: { decision: 'ACCEPTED', version: await referralVersion(s, id) } };
    } },

  // Program maintenance, Program level (14A, 14B): MANAGE_PROGRAM for that Program
  { method: 'patch', path: `${PM}/programs/:programId`, allowed: P.MANAGER, denied: PROGRAM_OUTSIDERS,
    setup: async (s) => ({ url: `${PM}/programs/11`, body: { version: await programVersion(s, 11), site: 'Synthetic Site X' } }) },
  { method: 'post', path: `${PM}/programs/:programId/discontinue`, allowed: P.MANAGER, denied: PROGRAM_OUTSIDERS,
    setup: async (s) => ({ url: `${PM}/programs/11/discontinue`, body: { version: await programVersion(s, 11) } }) },
  { method: 'post', path: `${PM}/programs/:programId/reactivate`, allowed: P.MANAGER, denied: PROGRAM_OUTSIDERS,
    setup: async (s) => ({ url: `${PM}/programs/13/reactivate`, body: { version: await programVersion(s, 13) } }) },
  { method: 'put', path: `${PM}/programs/:programId/matching-facts`, allowed: P.MANAGER, denied: PROGRAM_OUTSIDERS,
    setup: async (s) => ({ url: `${PM}/programs/11/matching-facts`, body: {
      version: await programVersion(s, 11), needCategoryIds: [1], ageLimitState: 'SET', ageMin: 18, ageMax: null,
      serviceAreaState: 'NO_RESTRICTION', serviceAreaZips: [],
    } }) },
  { method: 'post', path: `${PM}/programs/:programId/fields`, allowed: P.MANAGER, denied: PROGRAM_OUTSIDERS,
    setup: async () => ({ url: `${PM}/programs/11/fields`, body: { label: 'Synthetic new field', dataType: 'TEXT' } }) },
  { method: 'post', path: `${PM}/programs/:programId/field-applicability/:fieldId`, allowed: P.MANAGER, denied: PROGRAM_OUTSIDERS,
    setup: async () => ({ url: `${PM}/programs/11/field-applicability/4`, body: { isRequired: false } }) },
  { method: 'patch', path: `${PM}/programs/:programId/field-applicability/:fieldId`, allowed: P.MANAGER, denied: PROGRAM_OUTSIDERS,
    setup: async (s) => ({ url: `${PM}/programs/11/field-applicability/1`, body: { version: useVersion(s, 11, 1), isRequired: true } }) },
  { method: 'put', path: `${PM}/programs/:programId/field-values/:fieldId`, allowed: P.MANAGER, denied: PROGRAM_OUTSIDERS,
    setup: async (s) => ({ url: `${PM}/programs/11/field-values/1`, body: { version: useVersion(s, 11, 1), value: 'Synthetic weekends' } }) },

  // Program maintenance, field definitions (14B): MANAGE_PROGRAM for every Program using the field
  { method: 'patch', path: `${PM}/fields/:fieldId`, allowed: P.MANAGER, denied: PROGRAM_OUTSIDERS,
    setup: async (s) => ({ url: `${PM}/fields/1`, body: { version: fieldVersion(s, 1), label: 'Synthetic opening hours' } }) },
  { method: 'post', path: `${PM}/fields/:fieldId/replace`, allowed: P.MANAGER, denied: PROGRAM_OUTSIDERS,
    setup: async (s) => ({ url: `${PM}/fields/1/replace`, body: { version: fieldVersion(s, 1), label: 'Synthetic hours v2', dataType: 'TEXT' } }) },
  { method: 'post', path: `${PM}/fields/:fieldId/discontinue`, allowed: P.MANAGER, denied: PROGRAM_OUTSIDERS,
    setup: async (s) => ({ url: `${PM}/fields/1/discontinue`, body: { version: fieldVersion(s, 1) } }) },
  { method: 'post', path: `${PM}/fields/:fieldId/reactivate`, allowed: P.MANAGER, denied: PROGRAM_OUTSIDERS,
    setup: async (s) => ({ url: `${PM}/fields/3/reactivate`, body: { version: fieldVersion(s, 3) } }) },
  { method: 'post', path: `${PM}/fields/:fieldId/options`, allowed: P.MANAGER, denied: PROGRAM_OUTSIDERS,
    setup: async () => ({ url: `${PM}/fields/2/options`, body: { label: 'Synthetic remote' } }) },
  { method: 'patch', path: `${PM}/fields/:fieldId/options/:optionId`, allowed: P.MANAGER, denied: PROGRAM_OUTSIDERS,
    setup: async (s) => ({ url: `${PM}/fields/2/options/1`, body: { version: optionVersion(s, 1), label: 'Synthetic on site' } }) },
  { method: 'post', path: `${PM}/fields/:fieldId/options/:optionId/discontinue`, allowed: P.MANAGER, denied: PROGRAM_OUTSIDERS,
    setup: async (s) => ({ url: `${PM}/fields/2/options/1/discontinue`, body: { version: optionVersion(s, 1) } }) },
  { method: 'post', path: `${PM}/fields/:fieldId/options/:optionId/reactivate`, allowed: P.MANAGER, denied: PROGRAM_OUTSIDERS,
    setup: async (s) => ({ url: `${PM}/fields/2/options/2/reactivate`, body: { version: optionVersion(s, 2) } }) },

  // Organization (14B retire, 14C): MANAGE_ORGANIZATION at ORG scope
  { method: 'post', path: `${PM}/fields/:fieldId/retire`, allowed: P.ORG_ADMIN, denied: ORG_OUTSIDERS,
    setup: async (s) => ({ url: `${PM}/fields/3/retire`, body: { version: fieldVersion(s, 3) } }) },
  { method: 'post', path: `${PM}/departments`, allowed: P.ORG_ADMIN, denied: ORG_OUTSIDERS,
    setup: async () => ({ url: `${PM}/departments`, body: { name: 'Synthetic New Department' } }) },
  { method: 'patch', path: `${PM}/departments/:departmentId`, allowed: P.ORG_ADMIN, denied: ORG_OUTSIDERS,
    setup: async (s) => ({ url: `${PM}/departments/1`, body: { version: await departmentVersion(s, 1), name: 'Synthetic Dept Renamed' } }) },
  { method: 'post', path: `${PM}/departments/:departmentId/discontinue`, allowed: P.ORG_ADMIN, denied: ORG_OUTSIDERS,
    setup: async (s) => ({ url: `${PM}/departments/2/discontinue`, body: { version: await departmentVersion(s, 2) } }) },
  { method: 'post', path: `${PM}/departments/:departmentId/reactivate`, allowed: P.ORG_ADMIN, denied: ORG_OUTSIDERS,
    setup: async (s) => ({ url: `${PM}/departments/3/reactivate`, body: { version: await departmentVersion(s, 3) } }) },
  { method: 'post', path: `${PM}/programs`, allowed: P.ORG_ADMIN, denied: ORG_OUTSIDERS,
    setup: async () => ({ url: `${PM}/programs`, body: { departmentId: 1, name: 'Synthetic New Program' } }) },
  { method: 'post', path: `${PM}/programs/:programId/move`, allowed: P.ORG_ADMIN, denied: ORG_OUTSIDERS,
    setup: async (s) => ({ url: `${PM}/programs/12/move`, body: { version: await programVersion(s, 12), departmentId: 2 } }) },
];

// Routes that change data only for the signed-in person themselves, so
// there is nobody else to refuse. Covered for sign-in, inactive users and
// identity fields by test/securityPass.test.js; listed so the inventory is
// complete.
const SELF_SERVICE = [
  { method: 'post', path: '/api/referrals', why: 'creates a referral from the caller\'s own affiliation; CREATE_REFERRAL needs app access only (PRD 3.6)' },
  { method: 'put', path: '/api/me/affiliation', why: 'sets the caller\'s own affiliation; the user comes only from sign-in (PRD 3.2, 3.9)' },
  { method: 'post', path: '/api/gpme/match', why: 'read-only matching; stores nothing (PRD 8.2)' },
  { method: 'post', path: '/api/gpme/interpret', why: 'proposes criteria from the worker\'s description; stores, logs and returns no text (Task D, PRD 5.3, 5.4)' },
];

// Resource reads: allowed people get 200; everyone else 403 or 404.
const READS = [
  { path: '/api/referrals/:referralId', url: (id) => `/api/referrals/${id}`,
    allowed: [P.REFERRER, P.RECEIVER, P.VIEWER],
    denied: [P.OTHER_RECEIVER, P.DEMO_RECEIVER, P.MANAGER, P.ORG_ADMIN, P.PERMISSION_ADMIN, P.NOBODY] },
  { path: '/api/referrals/received?programId=11', url: () => '/api/referrals/received?programId=11',
    allowed: [P.RECEIVER, P.VIEWER],
    denied: [P.REFERRER, P.OTHER_RECEIVER, P.DEMO_RECEIVER, P.MANAGER, P.ORG_ADMIN, P.PERMISSION_ADMIN, P.NOBODY] },
  ...['', '/matching-facts', '/available-fields', '/fields'].map((tail) => ({
    path: `${PM}/programs/:programId${tail}`, url: () => `${PM}/programs/11${tail}`,
    allowed: [P.MANAGER], denied: PROGRAM_OUTSIDERS,
  })),
  ...['/organization-programs', '/departments'].map((tail) => ({
    path: `${PM}${tail}`, url: () => `${PM}${tail}`,
    allowed: [P.ORG_ADMIN], denied: ORG_OUTSIDERS,
  })),
];

// ---------------------------------------------------------------------------

describe('Task F route inventory', () => {
  test('every route in src/ has a row here (mutation, self-service, or read)', () => {
    const mounts = {
      'referrals/routes.js': '/api/referrals', 'programs/routes.js': PM, 'reporting/routes.js': '/api/reports',
      'gpme/routes.js': '/api/gpme', 'affiliation/routes.js': '/api',
    };
    const files = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name.endsWith('.js')) files.push(full);
      }
    };
    walk(path.join(ROOT, 'src'));
    const found = [];
    for (const file of files) {
      const rel = path.relative(path.join(ROOT, 'src'), file).replaceAll(path.sep, '/');
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/(?:router|app)\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) {
        if (rel === 'app.js' && m[2] === '/health') continue;
        assert.ok(mounts[rel], `${rel} registers routes but has no mount point here`);
        found.push(`${m[1]} ${mounts[rel]}${m[2] === '/' ? '' : m[2]}`);
      }
      for (const m of src.matchAll(/for \(const \[path, \w+\] of (\[[^\n]*\])\) \{\s*router\.(get|post|put|patch|delete)\(`([^`]+)`/g)) {
        for (const [, name] of m[1].matchAll(/\['([^']+)'/g)) found.push(`${m[2]} ${mounts[rel]}${m[3].replace('${path}', name)}`);
      }
    }
    const writes = found.filter((r) => !r.startsWith('get '));
    const listed = [...MUTATIONS, ...SELF_SERVICE].map((r) => `${r.method} ${r.path}`);
    assert.deepEqual(writes.sort(), listed.sort(), 'every route that changes data needs a MUTATIONS or SELF_SERVICE row');
    for (const read of READS) {
      const pattern = `get ${read.path.split('?')[0]}`;
      assert.ok(found.includes(pattern), `READS lists ${pattern}, which no longer exists`);
    }
  });
});

describe('unauthorized changes fail closed and change nothing (capability + resource + scope)', () => {
  for (const route of MUTATIONS) {
    const label = `${route.method.toUpperCase()} ${route.path}`;

    test(`${label}: ${NAME[route.allowed]} succeeds with the same request (control)`, async () => {
      const store = seed();
      const { url, body } = await route.setup(store);
      const res = await request(appAs(store, route.allowed))[route.method](url).send(body);
      assert.ok(res.status === 200 || res.status === 201, `${res.status} ${JSON.stringify(res.body)}`);
    });

    test(`${label}: every other person gets 403/404 and nothing changes`, async (t) => {
      const lines = captureConsole(t);
      for (const who of route.denied) {
        const store = seed();
        const { url, body } = await route.setup(store);
        const before = await snapshot(store);
        const res = await request(appAs(store, who))[route.method](url).send(body);
        assert.ok([403, 404].includes(res.status), `${NAME[who]}: expected 403 or 404, got ${res.status} ${JSON.stringify(res.body)}`);
        assert.equal(res.headers['cache-control'], 'no-store');
        assert.equal(await snapshot(store), before, `${NAME[who]} changed something`);
        for (const marker of LOG_MARKERS) assert.ok(!res.text.includes(marker), `${NAME[who]}: response leaks ${marker}`);
      }
      for (const marker of LOG_MARKERS) assert.ok(!lines.join('\n').includes(marker), `a log line leaks ${marker}`);
    });
  }

  test('a hidden referral and a missing one get the same answer on every referral change', async () => {
    for (const route of MUTATIONS.filter((r) => r.path.startsWith('/api/referrals/'))) {
      const store = seed();
      const { url, body } = await route.setup(store);
      const missing = url.replace(/\/api\/referrals\/\d+/, '/api/referrals/987654');
      const hidden = await request(appAs(store, P.OTHER_RECEIVER))[route.method](url).send(body);
      const absent = await request(appAs(store, P.OTHER_RECEIVER))[route.method](missing).send(body);
      assert.equal(hidden.status, absent.status, route.path);
      assert.deepEqual(hidden.body, absent.body, route.path);
    }
  });
});

describe('unauthorized reads are refused without leaking', () => {
  for (const read of READS) {
    test(`GET ${read.path}: allowed people read it, everyone else gets 403/404`, async () => {
      const store = seed();
      const id = await referral(store);
      for (const who of read.allowed) {
        const res = await request(appAs(store, who)).get(read.url(id));
        assert.equal(res.status, 200, `${NAME[who]} ${res.status}`);
      }
      for (const who of read.denied) {
        const res = await request(appAs(store, who)).get(read.url(id));
        assert.ok([403, 404].includes(res.status), `${NAME[who]}: expected 403 or 404, got ${res.status}`);
        for (const marker of LOG_MARKERS) assert.ok(!res.text.includes(marker), `${NAME[who]} sees ${marker}`);
      }
    });
  }

  test('list routes show each person only what they may see', async () => {
    const store = seed();
    await referral(store);
    for (const who of [P.OTHER_RECEIVER, P.DEMO_RECEIVER, P.MANAGER, P.ORG_ADMIN, P.PERMISSION_ADMIN, P.NOBODY]) {
      const received = await request(appAs(store, who)).get('/api/referrals/received');
      assert.equal(received.status, 200);
      assert.deepEqual(received.body.referrals, [], `${NAME[who]} sees Program 11's referrals`);
      const sent = await request(appAs(store, who)).get('/api/referrals/sent');
      assert.deepEqual(sent.body.referrals, [], `${NAME[who]} sees someone else's sent referrals`);
    }
    for (const who of [P.OTHER_MANAGER, P.WIDE_MANAGER, P.DEMO_MANAGER, P.ORG_ADMIN, P.RECEIVER, P.NOBODY]) {
      const managed = await request(appAs(store, who)).get(`${PM}/programs`);
      assert.equal(managed.status, 200);
      assert.ok(!managed.body.programs.some((p) => p.programId === 11), `${NAME[who]} may manage Program 11`);
    }
  });
});

describe('DEMO grants count only when demo grants are on (PRD 16.1, 17.4)', () => {
  test('the same DEMO people succeed in a test app with demo grants on, proving the refusals above are about DEMO', async () => {
    for (const [who, pick] of [
      [P.DEMO_RECEIVER, '/api/referrals/:referralId/response'],
      [P.DEMO_MANAGER, `${PM}/programs/:programId`],
      [P.DEMO_ORG_ADMIN, `${PM}/departments`],
    ]) {
      const route = MUTATIONS.find((r) => r.path === pick);
      const store = seed();
      const { url, body } = await route.setup(store);
      const off = await request(appAs(store, who))[route.method](url).send(body);
      assert.ok([403, 404].includes(off.status), `${NAME[who]} with demo grants off: ${off.status}`);
      const on = await request(appAs(store, who, { allowDemoGrants: true, nodeEnv: 'test' }))[route.method](url).send(body);
      assert.ok([200, 201].includes(on.status), `${NAME[who]} with demo grants on: ${on.status} ${JSON.stringify(on.body)}`);
    }
  });

  test('demo grants cannot be turned on in production', () => {
    assert.throws(() => appAs(seed(), P.DEMO_MANAGER, { allowDemoGrants: true, nodeEnv: 'production' }));
  });
});

describe('manipulated IDs in Program Management paths (PRD 3.3, 10.3)', () => {
  const BAD = ['0', '-1', '1.5', '1e3', '0x10', 'abc', '9007199254740993', '%00', '1%20OR%201=1'];
  const PARAMS = [...new Set(MUTATIONS.concat(READS.map((r) => ({ path: r.path, method: 'get' })))
    .filter((r) => r.path.startsWith(PM) && /:(programId|fieldId|optionId|departmentId)/.test(r.path))
    .map((r) => `${r.method} ${r.path}`))];

  for (const entry of PARAMS) {
    const [method, routePath] = entry.split(' ');
    test(`${method.toUpperCase()} ${routePath}: malformed IDs are refused (400/404), never a 500, nothing changes`, async () => {
      const store = seed();
      const before = await snapshot(store);
      for (const bad of BAD) {
        const url = routePath.replace(/:(programId|fieldId|optionId|departmentId)/g, bad);
        const res = await request(appAs(store, P.ORG_ADMIN))[method](url).send(method === 'get' ? undefined : { version: 'x' });
        assert.ok([400, 404].includes(res.status), `${url}: ${res.status}`);
        for (const echo of ['OR 1=1', '0x10', '1e3', '9007199254740993']) assert.ok(!res.text.includes(echo), `${url} echoed ${echo}`);
      }
      assert.equal(await snapshot(store), before);
    });
  }
});

describe('minimum-necessary responses (PRD 3.5, 5.5, 10.5, 11.3)', () => {
  test('no response, to anyone, ever includes a Program\'s notification email', async () => {
    const store = seed();
    const id = await referral(store, 'ACCEPTED');
    const urls = [
      '/api/programs', '/api/me/affiliation', `/api/referrals/${id}`, '/api/referrals/received', '/api/referrals/sent',
      '/api/gpme/need-categories', `${PM}/programs`, `${PM}/programs/11`, `${PM}/programs/12`, `${PM}/organization-programs`,
      `${PM}/departments`, '/api/reports/total-referrals?period=MONTHLY', '/api/reports/referral-activity?period=MONTHLY',
      '/api/reports/departments',
    ];
    for (const who of Object.values(P)) {
      for (const url of urls) {
        const res = await request(appAs(store, who)).get(url);
        assert.ok(!res.text.includes(M.routing), `${NAME[who]} ${url} returned the notification email`);
      }
    }
    // Changes return the Program too.
    const moved = await request(appAs(store, P.ORG_ADMIN)).post(`${PM}/programs/12/move`)
      .send({ version: await programVersion(store, 12), departmentId: 2 });
    assert.equal(moved.status, 200);
    assert.ok(!moved.text.includes(M.routing));
    const edited = await request(appAs(store, P.MANAGER)).patch(`${PM}/programs/11`)
      .send({ version: await programVersion(store, 11), site: 'Synthetic Site Y' });
    assert.equal(edited.status, 200);
    assert.ok(!edited.text.includes(M.routing));
  });

  test('lists and reports never carry contact details, notes or Not Appropriate explanations', async () => {
    const store = seed();
    await referral(store, 'NOT_APPROPRIATE');
    for (const [who, url] of [
      [P.REFERRER, '/api/referrals/sent'], [P.RECEIVER, '/api/referrals/received'], [P.VIEWER, '/api/referrals/received'],
      [P.PERMISSION_ADMIN, '/api/reports/referral-activity?period=MONTHLY'], [P.NOBODY, '/api/reports/total-referrals?period=MONTHLY'],
    ]) {
      const res = await request(appAs(store, who)).get(url);
      assert.equal(res.status, 200, `${NAME[who]} ${url}`);
      for (const marker of [M.contact, 'TASKFNOTES', 'TASKFEXPLAIN']) {
        assert.ok(!res.text.includes(marker), `${NAME[who]} ${url} includes ${marker}`);
      }
    }
  });
});
