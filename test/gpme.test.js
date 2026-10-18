// Guided Program Matching Engine (Trello card 10).
// T1 to T18 come from the GPME Decision Proposal, approved Oct 18, 2026.
// All data below is SYNTHETIC: made-up Programs and ZIP codes from
// outside New York. No real QCH Program data is used (PRD 15.5).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryStore } from '../src/affiliation/memoryStore.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
import { createGpmeService, safeErrorKind } from '../src/gpme/gpmeService.js';
import { matchPrograms, GPME_RULE_VERSION } from '../src/gpme/matchPrograms.js';
import { findMatchingFactProblems, readMatchingFacts } from '../src/gpme/programFacts.js';
import { validateMatchRequest } from '../src/gpme/validateMatchRequest.js';

// Need category IDs used below.
const FOOD = 1;
const EMPLOYMENT = 2;
const HOUSING = 3;
const LEGAL = 4;

const NEED_CATEGORIES = [
  { needCategoryId: FOOD, name: 'Food', lifecycleStatus: 'ACTIVE' },
  { needCategoryId: EMPLOYMENT, name: 'Employment', lifecycleStatus: 'ACTIVE' },
  { needCategoryId: HOUSING, name: 'Housing', lifecycleStatus: 'ACTIVE' },
  { needCategoryId: LEGAL, name: 'Legal', lifecycleStatus: 'ACTIVE' },
];

// The seven synthetic Programs from the proposal (P1 to P7).
const DEPARTMENTS = [
  { departmentId: 1, name: 'Synthetic Department A', lifecycleStatus: 'ACTIVE' },
  { departmentId: 2, name: 'Synthetic Department B', lifecycleStatus: 'ACTIVE' },
];

const NONE = { serviceAreaState: 'NO_RESTRICTION', serviceAreaZips: [] };
const NO_AGE = { ageLimitState: 'NO_RESTRICTION', ageMin: null, ageMax: null };

const PROGRAMS = [
  { programId: 1, departmentId: 1, name: 'Synthetic Food Program', site: null, lifecycleStatus: 'ACTIVE',
    needCategoryIds: [FOOD], ...NO_AGE, ...NONE },
  { programId: 2, departmentId: 2, name: 'Synthetic Job Training', site: null, lifecycleStatus: 'ACTIVE',
    needCategoryIds: [EMPLOYMENT], ageLimitState: 'SET', ageMin: 18, ageMax: 24,
    serviceAreaState: 'SET', serviceAreaZips: ['99901', '99902'] },
  { programId: 3, departmentId: 2, name: 'Synthetic Youth Jobs', site: null, lifecycleStatus: 'ACTIVE',
    needCategoryIds: [EMPLOYMENT], ageLimitState: 'SET', ageMin: 16, ageMax: 21, ...NONE },
  { programId: 4, departmentId: 2, name: 'Synthetic Trades', site: null, lifecycleStatus: 'ACTIVE',
    needCategoryIds: [EMPLOYMENT], ageLimitState: 'NOT_ON_FILE', ageMin: null, ageMax: null, ...NONE },
  { programId: 5, departmentId: 1, name: 'Synthetic Housing Help', site: null, lifecycleStatus: 'ACTIVE',
    needCategoryIds: [HOUSING], ...NO_AGE, serviceAreaState: 'OTHER_LIMIT', serviceAreaZips: [] },
  { programId: 6, departmentId: 1, name: 'Synthetic Untagged Program', site: null, lifecycleStatus: 'ACTIVE',
    needCategoryIds: [], ...NO_AGE, ...NONE },
  { programId: 7, departmentId: 1, name: 'Synthetic Closed Pantry', site: null, lifecycleStatus: 'DISCONTINUED',
    needCategoryIds: [FOOD], ...NO_AGE, ...NONE },
];

const USERS = [
  { userId: 100, isActive: true, currentProgramId: 1 },
  { userId: 102, isActive: false },
];

function seedStore() {
  return createMemoryStore({
    departments: DEPARTMENTS,
    programs: PROGRAMS,
    users: USERS,
    needCategories: NEED_CATEGORIES,
  });
}

function serviceFor(store = seedStore(), options = {}) {
  return createGpmeService({ store, logFailure: () => {}, ...options });
}

function input(needs, ageRange, participantZip) {
  return {
    needCategoryIds: needs,
    ...(ageRange ? { ageRange: { min: ageRange[0], max: ageRange[1] } } : {}),
    ...(participantZip ? { participantZip } : {}),
  };
}

const ids = (items) => items.map((p) => p.programId);
const byId = (items, programId) => items.find((p) => p.programId === programId);
const T2_INPUT = input([EMPLOYMENT], [19, 20], '99901');

function appFor(store, userId = 100) {
  return createApp({
    affiliationStore: store,
    resolveIdentity: () => (userId === null ? null : { userId }),
  });
}

// --------------------------------------------------------------------------
// T1 to T16: the approved expected results
// --------------------------------------------------------------------------

describe('GPME expected results (T1 to T16)', () => {
  test('T1 expected match: Food -> P1 plausible, discontinued P7 absent', async () => {
    const result = await serviceFor().match(100, input([FOOD], [40, 45], '99999'));
    assert.equal(result.status, 'RESULTS');
    assert.deepEqual(ids(result.plausible), [1]);
    assert.deepEqual(ids(result.possible), []);
    assert.equal(result.notCheckedForNeedCount, 1);
  });

  test('T2 multiple matches: P2 and P3 plausible, P4 possible (age not on file)', async () => {
    const result = await serviceFor().match(100, T2_INPUT);
    assert.equal(result.status, 'RESULTS');
    assert.deepEqual(ids(result.plausible), [2, 3]);
    assert.deepEqual(ids(result.possible), [4]);
    assert.ok(byId(result.possible, 4).explanations.includes('Age limits not on file'));
  });

  test('T3 ties: same group, same order on every run, no score in output', async () => {
    const service = serviceFor();
    const first = await service.match(100, T2_INPUT);
    const second = await service.match(100, T2_INPUT);
    assert.deepEqual(first, second);
    const json = JSON.stringify(first);
    assert.doesNotMatch(json, /score|confidence|rank|best/i);
  });

  test('T4 missing age range: P2, P4, P3 possible, ages "not provided"', async () => {
    const result = await serviceFor().match(100, input([EMPLOYMENT], null, '99901'));
    assert.deepEqual(ids(result.plausible), []);
    assert.deepEqual(ids(result.possible), [2, 4, 3]);
    assert.ok(byId(result.possible, 2).explanations.includes('Serves ages 18 to 24; age range not provided'));
    assert.ok(byId(result.possible, 3).explanations.includes('Serves ages 16 to 21; age range not provided'));
  });

  test('T5 unavailable ZIP: P3 plausible, P2 and P4 possible, "ZIP not provided"', async () => {
    const result = await serviceFor().match(100, input([EMPLOYMENT], [19, 20], null));
    assert.deepEqual(ids(result.plausible), [3]);
    assert.deepEqual(ids(result.possible), [2, 4]);
    assert.ok(byId(result.possible, 2).explanations.includes('Serves listed ZIP codes; ZIP not provided'));
  });

  test('T6 no plausible match: both groups empty, untagged count 1', async () => {
    const result = await serviceFor().match(100, input([LEGAL], [40, 45], '99999'));
    assert.equal(result.status, 'NO_PLAUSIBLE_MATCH');
    assert.deepEqual(result.plausible, []);
    assert.deepEqual(result.possible, []);
    assert.equal(result.notCheckedForNeedCount, 1);
  });

  test('T7 real exclusion: ages outside P2 and P3 remove them, P4 stays possible', async () => {
    const result = await serviceFor().match(100, input([EMPLOYMENT], [30, 35], '99901'));
    assert.deepEqual(ids(result.plausible), []);
    assert.deepEqual(ids(result.possible), [4]);
  });

  test('T8 unknown never excludes: P4 is never removed for any age range', async () => {
    const service = serviceFor();
    for (let min = 0; min <= 118; min += 3) {
      const result = await service.match(100, input([EMPLOYMENT], [min, min + 2], '99901'));
      assert.ok(ids(result.possible).includes(4), `range starting at ${min}`);
    }
  });

  test('T9 limit ZIPs cannot express: P5 possible, never plausible', async () => {
    const result = await serviceFor().match(100, input([HOUSING], [40, 45], '99901'));
    assert.deepEqual(ids(result.plausible), []);
    assert.deepEqual(ids(result.possible), [5]);
    assert.ok(byId(result.possible, 5).explanations.includes(
      'Serves residents of a specific area; confirm with the program',
    ));
  });

  test('T10 partial age overlap is Possible; no overlap is removed', async () => {
    const result = await serviceFor().match(100, input([EMPLOYMENT], [22, 26], '99901'));
    assert.deepEqual(ids(result.plausible), []);
    assert.deepEqual(ids(result.possible), [2, 4]);
    assert.ok(byId(result.possible, 2).explanations.includes(
      'Serves ages 18 to 24; part of the age range given is outside this',
    ));
  });

  test('T11 inactive Programs are never returned, even if a store sends them', async () => {
    const result = await serviceFor().match(100, input([FOOD], [40, 45]));
    assert.ok(!ids(result.plausible).includes(7));
    assert.ok(!ids(result.possible).includes(7));

    // Engine-level guard: a store that wrongly includes P7 still cannot leak it.
    const p7 = { program: PROGRAMS[6], department: DEPARTMENTS[0] };
    const direct = matchPrograms(input([FOOD]), { candidates: [p7], needCategories: NEED_CATEGORIES });
    assert.equal(direct.status, 'NO_PLAUSIBLE_MATCH');
  });

  test('T12 hidden factors: Notes and Referral Context change nothing and are rejected', async () => {
    const store = seedStore();
    const candidates = await store.listMatchablePrograms();
    const plain = matchPrograms(T2_INPUT, { candidates, needCategories: NEED_CATEGORIES });
    const withExtras = matchPrograms(
      { ...T2_INPUT, notes: 'Synthetic note', referralContext: 'Synthetic context', userId: 999 },
      { candidates, needCategories: NEED_CATEGORIES },
    );
    assert.deepEqual(withExtras, plain);

    const res = await request(appFor(store))
      .post('/api/gpme/match')
      .send({ ...T2_INPUT, notes: 'Synthetic note', referralContext: 'Synthetic context' });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'UNEXPECTED_FIELD');
    assert.doesNotMatch(JSON.stringify(res.body), /notes|referralContext|Synthetic/);
  });

  test('T13 explanations use Program facts only, never participant values', async () => {
    const service = serviceFor();
    const cases = [
      [T2_INPUT, ['19', '20', '99901']],
      [input([EMPLOYMENT], [22, 26], '99901'), ['22', '26', '99901']],
      [input([FOOD], [40, 45], '99999'), ['40', '45', '99999']],
      [input([HOUSING], [40, 45], '99901'), ['40', '45', '99901']],
    ];
    for (const [request_, values] of cases) {
      const result = await service.match(100, request_);
      const text = [...result.plausible, ...result.possible].flatMap((p) => p.explanations).join(' | ');
      for (const value of values) assert.ok(!text.includes(value), `explanations must not contain ${value}`);
    }
  });

  test('T14 rule versions: each result carries the version that produced it', async () => {
    const store = seedStore();
    const v1 = await serviceFor(store, { ruleVersion: 'gpme-test-v1' }).match(100, T2_INPUT);
    const v2 = await serviceFor(store, { ruleVersion: 'gpme-test-v2' }).match(100, T2_INPUT);
    assert.equal(v1.ruleVersion, 'gpme-test-v1');
    assert.equal(v2.ruleVersion, 'gpme-test-v2');
    assert.equal((await serviceFor(store).match(100, T2_INPUT)).ruleVersion, GPME_RULE_VERSION);
  });

  test('T15 technical failure: UNABLE_TO_MATCH, never the no-match result', async () => {
    const store = seedStore();
    store._failMatching();
    const logged = [];
    const service = createGpmeService({ store, logFailure: (err) => logged.push(err.name) });

    const result = await service.match(100, T2_INPUT);
    assert.equal(result.status, 'UNABLE_TO_MATCH');
    assert.notEqual(result.status, 'NO_PLAUSIBLE_MATCH');
    assert.equal(result.plausible, undefined);
    assert.deepEqual(logged, ['Error']);

    const res = await request(appFor(store)).post('/api/gpme/match').send(T2_INPUT);
    assert.equal(res.status, 503);
    assert.equal(res.body.status, 'UNABLE_TO_MATCH');
  });

  test('T15 failure logging never prints a raw error name (PRD 15.3)', async () => {
    const store = seedStore();
    store.listMatchablePrograms = async () => {
      const err = new Error('boom');
      err.name = 'Synthetic Person Gamma 99901';
      throw err;
    };
    const lines = [];
    const original = console.error;
    console.error = (line) => lines.push(line);
    try {
      const result = await createGpmeService({ store }).match(100, T2_INPUT);
      assert.equal(result.status, 'UNABLE_TO_MATCH');
    } finally {
      console.error = original;
    }
    assert.deepEqual(lines, ['[gpme] matching unavailable (OtherError)']);
    assert.equal(safeErrorKind(new TypeError('x')), 'TypeError');
    assert.equal(safeErrorKind(null), 'OtherError');
  });

  test('T16 determinism: 100 runs give identical output', async () => {
    const service = serviceFor();
    const first = await service.match(100, T2_INPUT);
    for (let i = 0; i < 100; i += 1) {
      assert.deepEqual(await service.match(100, T2_INPUT), first);
    }
  });
});

// --------------------------------------------------------------------------
// T17 and T18
// --------------------------------------------------------------------------

describe('state rules and Direct Referral independence (T17, T18)', () => {
  test('T17 backend rejects inconsistent Program facts (mirrors migration 003 CHECKs)', () => {
    assert.deepEqual(findMatchingFactProblems({ ageLimitState: 'SET', ageMin: null, ageMax: null }), ['ageLimitState']);
    assert.deepEqual(findMatchingFactProblems({ ageLimitState: 'NO_RESTRICTION', ageMin: 18, ageMax: 24 }), ['ageLimitState']);
    assert.deepEqual(findMatchingFactProblems({ ageLimitState: 'SET', ageMin: 30, ageMax: 20 }), ['ageRange']);
    // Cross-table rule the database cannot CHECK:
    assert.deepEqual(findMatchingFactProblems({ serviceAreaState: 'SET', serviceAreaZips: [] }), ['serviceAreaState']);
    assert.deepEqual(findMatchingFactProblems({ serviceAreaState: 'OTHER_LIMIT', serviceAreaZips: ['99901'] }), ['serviceAreaState']);
    assert.deepEqual(findMatchingFactProblems({ serviceAreaState: 'SET', serviceAreaZips: ['9990'] }), ['serviceAreaZips']);
    assert.deepEqual(findMatchingFactProblems({ ageLimitState: 'UNKNOWN' }), ['ageLimitState']);
    assert.deepEqual(findMatchingFactProblems({}), []);

    assert.throws(
      () => createMemoryStore({ programs: [{ programId: 1, serviceAreaState: 'SET', serviceAreaZips: [] }] }),
      /invalid Program matching facts/,
    );
  });

  test('T17 the SQL migration defines the same states and CHECKs', async () => {
    const sql = await readFile(new URL('../db/migrations/003_gpme_matching_states.sql', import.meta.url), 'utf8')
      .catch(() => null);
    if (sql === null) return; // Migration 003 ships in its own database PR.
    for (const name of ['ck_programs_age_limit_state', 'ck_programs_service_area_state', 'ck_programs_age_limit_values']) {
      assert.ok(sql.includes(name), name);
    }
    assert.ok(sql.includes("'SET','NO_RESTRICTION','NOT_ON_FILE','OTHER_LIMIT'"));
  });

  test('T18 Direct Referral succeeds while GPME is failing', async () => {
    const affiliationStore = seedStore();
    affiliationStore._failMatching();
    const referralStore = createMemoryReferralStore({
      departments: DEPARTMENTS,
      programs: PROGRAMS,
      users: USERS,
    });
    const app = createApp({ affiliationStore, referralStore, resolveIdentity: () => ({ userId: 100 }) });

    const gpme = await request(app).post('/api/gpme/match').send(T2_INPUT);
    assert.equal(gpme.status, 503);

    const referral = await request(app).post('/api/referrals').send({
      submissionId: randomUUID(),
      receivingProgramId: 2,
      participantName: 'Synthetic Person Beta',
      contactMethod: 'NOT_AVAILABLE',
      referralContext: 'Synthetic context',
    });
    assert.equal(referral.status, 201);
    assert.equal(referral.body.status, 'RECEIVED');
  });

  test('T18 Direct Referral code never imports GPME', async () => {
    for (const file of ['routes.js', 'referralService.js', 'validateReferral.js', 'memoryReferralStore.js']) {
      const source = await readFile(new URL(`../src/referrals/${file}`, import.meta.url), 'utf8');
      assert.doesNotMatch(source, /gpme/i, file);
    }
  });
});

// --------------------------------------------------------------------------
// Explanations, fail-safe reads, and engine edges
// --------------------------------------------------------------------------

describe('GPME explanations and edges', () => {
  function single(program, request_) {
    return matchPrograms(request_, {
      candidates: [{ program: { programId: 9, departmentId: 1, name: 'Synthetic X', lifecycleStatus: 'ACTIVE',
        needCategoryIds: [FOOD], ...NO_AGE, ...NONE, ...program }, department: DEPARTMENTS[0] }],
      needCategories: NEED_CATEGORIES,
    });
  }

  test('a ZIP outside the service-area list removes the Program', async () => {
    const result = await serviceFor().match(100, input([EMPLOYMENT], [19, 20], '99999'));
    assert.deepEqual(ids(result.plausible), [3]);
    assert.deepEqual(ids(result.possible), [4]);
  });

  test('order inside a group is Department name first, then Program name', () => {
    const department = (departmentId, name) => ({ departmentId, name, lifecycleStatus: 'ACTIVE' });
    const program = (programId, name) => ({ programId, name, lifecycleStatus: 'ACTIVE', needCategoryIds: [FOOD], ...NO_AGE, ...NONE });
    const result = matchPrograms(input([FOOD]), {
      candidates: [
        { program: program(1, 'Alpha'), department: department(2, 'Zulu Department') },
        { program: program(2, 'Zulu'), department: department(1, 'Alpha Department') },
        { program: program(3, 'Bravo'), department: department(1, 'Alpha Department') },
      ],
      needCategories: NEED_CATEGORIES,
    });
    assert.deepEqual(ids(result.plausible), [3, 2, 1]);
  });

  test('one-sided age limits read naturally and still exclude correctly', () => {
    const up = single({ ageLimitState: 'SET', ageMin: 60, ageMax: null }, input([FOOD], [65, 70]));
    assert.deepEqual(up.plausible[0].explanations, ['Offers: Food', 'Serves ages 60 and up', 'No area limit']);
    assert.equal(single({ ageLimitState: 'SET', ageMin: 60, ageMax: null }, input([FOOD], [30, 40])).status, 'NO_PLAUSIBLE_MATCH');

    const upTo = single({ ageLimitState: 'SET', ageMin: null, ageMax: 21 }, input([FOOD], [10, 12]));
    assert.equal(upTo.plausible[0].explanations[1], 'Serves ages up to 21');
  });

  test('age rule about someone else (OTHER_LIMIT) is never checked and never removes', () => {
    const result = single({ ageLimitState: 'OTHER_LIMIT' }, input([FOOD], [90, 95]));
    assert.deepEqual(ids(result.possible), [9]);
    assert.equal(result.possible[0].explanations[1], 'Has an age rule GPME does not check; see program details');
  });

  test('service area not on file is shown as possible, never removed', () => {
    const result = single({ serviceAreaState: 'NOT_ON_FILE' }, input([FOOD], null, '99999'));
    assert.deepEqual(ids(result.possible), [9]);
    assert.equal(result.possible[0].explanations[2], 'Service area not on file');
  });

  test('several picked needs: matches any, explanation lists only the matched ones', () => {
    const result = single({ needCategoryIds: [FOOD, HOUSING] }, input([FOOD, LEGAL]));
    assert.equal(result.plausible[0].explanations[0], 'Offers: Food');
    const both = single({ needCategoryIds: [FOOD, HOUSING] }, input([HOUSING, FOOD]));
    assert.equal(both.plausible[0].explanations[0], 'Offers: Food, Housing');
  });

  test('tags on a discontinued category count as no tags', () => {
    const result = matchPrograms(input([FOOD]), {
      candidates: [{ program: { ...PROGRAMS[0], needCategoryIds: [HOUSING] }, department: DEPARTMENTS[0] }],
      needCategories: NEED_CATEGORIES.map((c) => (c.needCategoryId === HOUSING ? { ...c, lifecycleStatus: 'DISCONTINUED' } : c)),
    });
    assert.equal(result.notCheckedForNeedCount, 1);
  });

  test('bad Program data fails safe: read as not on file, never removes', () => {
    const facts = readMatchingFacts({ ageLimitState: 'SET', ageMin: null, ageMax: null, serviceAreaState: 'SET', serviceAreaZips: [] });
    assert.equal(facts.age.state, 'NOT_ON_FILE');
    assert.equal(facts.area.state, 'NOT_ON_FILE');

    const result = matchPrograms(input([FOOD], [1, 2], '11111'), {
      candidates: [{ program: { ...PROGRAMS[0], serviceAreaState: 'SET', serviceAreaZips: [] }, department: DEPARTMENTS[0] }],
      needCategories: NEED_CATEGORIES,
    });
    assert.deepEqual(ids(result.possible), [1]);
  });

  test('results return minimum-necessary Program fields only', async () => {
    const result = await serviceFor().match(100, T2_INPUT);
    assert.deepEqual(Object.keys(result.plausible[0]).sort(),
      ['departmentId', 'departmentName', 'explanations', 'name', 'programId', 'site']);
    assert.deepEqual(Object.keys(result).sort(),
      ['notCheckedForNeedCount', 'plausible', 'possible', 'ruleVersion', 'status']);
  });
});

// --------------------------------------------------------------------------
// Request validation
// --------------------------------------------------------------------------

describe('GPME request validation', () => {
  test('need is required', () => {
    assert.deepEqual(validateMatchRequest({}).fields, ['needCategoryIds']);
    assert.deepEqual(validateMatchRequest({ needCategoryIds: [] }).fields, ['needCategoryIds']);
    assert.deepEqual(validateMatchRequest({ needCategoryIds: ['1'] }).fields, ['needCategoryIds']);
  });

  test('age range and ZIP are optional; empty values mean "not provided"', () => {
    const result = validateMatchRequest({ needCategoryIds: [2, 1, 2], ageRange: null, participantZip: '' });
    assert.deepEqual(result, { ok: true, value: { needCategoryIds: [1, 2], ageRange: null, participantZip: null } });
  });

  test('age range must be two whole ages in order', () => {
    for (const ageRange of [{ min: 20, max: 18 }, { min: 18 }, { min: -1, max: 5 }, { min: 1.5, max: 3 }, { min: 1, max: 121 }, 19]) {
      assert.deepEqual(validateMatchRequest({ needCategoryIds: [1], ageRange }).fields, ['ageRange']);
    }
  });

  test('extra fields, including inside ageRange, are rejected without echoing names', () => {
    assert.equal(validateMatchRequest({ needCategoryIds: [1], notes: 'x' }).unexpectedField, true);
    assert.equal(validateMatchRequest({ needCategoryIds: [1], ageRange: { min: 1, max: 2, exact: 1 } }).unexpectedField, true);
  });

  test('ZIP must be five digits', () => {
    assert.deepEqual(validateMatchRequest({ needCategoryIds: [1], participantZip: '1234' }).fields, ['participantZip']);
    assert.equal(validateMatchRequest({ needCategoryIds: [1], participantZip: ' 99901 ' }).value.participantZip, '99901');
  });

  test('unknown or inactive need categories are rejected', async () => {
    await assert.rejects(serviceFor().match(100, input([999])), (err) => {
      assert.equal(err.code, 'INVALID_REQUEST');
      assert.deepEqual(err.fields, ['needCategoryIds']);
      return true;
    });
  });
});

// --------------------------------------------------------------------------
// HTTP access boundary
// --------------------------------------------------------------------------

describe('GPME HTTP routes', () => {
  test('need categories list: active only, sorted by name, minimal fields', async () => {
    const res = await request(appFor(seedStore())).get('/api/gpme/need-categories');
    assert.equal(res.status, 200);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.deepEqual(res.body.needCategories.map((c) => c.name), ['Employment', 'Food', 'Housing', 'Legal']);
    assert.deepEqual(Object.keys(res.body.needCategories[0]).sort(), ['name', 'needCategoryId']);
  });

  test('match over HTTP returns the T2 result and is never cached', async () => {
    const res = await request(appFor(seedStore())).post('/api/gpme/match').send(T2_INPUT);
    assert.equal(res.status, 200);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.deepEqual(ids(res.body.plausible), [2, 3]);
  });

  test('no sign-in -> 401; inactive user -> 403; no store -> 503', async () => {
    assert.equal((await request(appFor(seedStore(), null)).post('/api/gpme/match').send(T2_INPUT)).status, 401);
    const inactive = await request(appFor(seedStore(), 102)).post('/api/gpme/match').send(T2_INPUT);
    assert.equal(inactive.status, 403);
    assert.equal(inactive.body.code, 'USER_NOT_ACTIVE');
    const noStore = createApp({ resolveIdentity: () => ({ userId: 100 }) });
    assert.equal((await request(noStore).post('/api/gpme/match').send(T2_INPUT)).status, 503);
  });

  test('invalid input -> 400 with field names only; malformed JSON -> 400', async () => {
    const app = appFor(seedStore());
    const bad = await request(app).post('/api/gpme/match').send({ needCategoryIds: [2], participantZip: 'ABCDE' });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.body.fields, ['participantZip']);
    assert.doesNotMatch(JSON.stringify(bad.body), /ABCDE/);

    const malformed = await request(app).post('/api/gpme/match').set('Content-Type', 'application/json').send('{"needCategoryIds":');
    assert.equal(malformed.status, 400);
  });

  test('oversized bodies are rejected', async () => {
    const res = await request(appFor(seedStore()))
      .post('/api/gpme/match')
      .send({ needCategoryIds: [2], participantZip: 'x'.repeat(5000) });
    assert.equal(res.status, 400);
  });
});
