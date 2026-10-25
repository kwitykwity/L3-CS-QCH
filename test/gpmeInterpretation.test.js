// Find a Program interpretation layer (Task D): proposes matching criteria
// from a short description; the worker confirms; GPME is unchanged.
// All data is SYNTHETIC.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
import { createRuleBasedInterpreter } from '../src/gpme/interpretation/ruleBasedInterpreter.js';
import { createGpmeService } from '../src/gpme/gpmeService.js';
import { syntheticSeed, DEV_USER_ID } from '../scripts/syntheticSeed.js';
import {
  DESCRIBE_MESSAGES, interpretInterpretResponse, toMatchRequest, validateDescription,
} from '../public/referral/guided.js';

const CATEGORIES = [
  { needCategoryId: 1, name: 'Childcare (sample)', lifecycleStatus: 'ACTIVE' },
  { needCategoryId: 2, name: 'Education (sample)', lifecycleStatus: 'ACTIVE' },
  { needCategoryId: 3, name: 'Employment (sample)', lifecycleStatus: 'ACTIVE' },
  { needCategoryId: 4, name: 'Housing (sample)', lifecycleStatus: 'ACTIVE' },
  { needCategoryId: 5, name: 'Older adult support (sample)', lifecycleStatus: 'ACTIVE' },
  { needCategoryId: 6, name: 'Retired category', lifecycleStatus: 'DISCONTINUED' },
];

const read = (text) => createRuleBasedInterpreter().interpret({ text, needCategories: CATEGORIES });

describe('rule-based interpreter', () => {
  test('finds a need from everyday wording and the category name', () => {
    assert.deepEqual(read('She is looking for a job').needCategoryIds, [3]);
    assert.deepEqual(read('facing eviction, needs housing').needCategoryIds, [4]);
    assert.deepEqual(read('needs daycare for her toddler').needCategoryIds, [1]);
    assert.deepEqual(read('wants to finish school and find work').needCategoryIds, [2, 3]);
  });

  test('reports the vocabulary terms behind a need, not the worker text', () => {
    const { reasons } = read('Looking for a job');
    assert.deepEqual(reasons.get(3), ['job']);
  });

  test('never proposes a discontinued category', () => {
    assert.deepEqual(read('retired category').needCategoryIds, []);
  });

  test('a renamed or new category is recognized with no code change', () => {
    const live = [{ needCategoryId: 9, name: 'Immigration legal help', lifecycleStatus: 'ACTIVE' }];
    const out = createRuleBasedInterpreter().interpret({ text: 'needs a lawyer for a visa', needCategories: live });
    assert.deepEqual(out.needCategoryIds, [9]);
  });

  test('reads an exact age or a range only next to age wording', () => {
    assert.deepEqual(read('a 17 year old').ageRange, { min: 17, max: 17 });
    assert.deepEqual(read('17-year-old').ageRange, { min: 17, max: 17 });
    assert.deepEqual(read('ages 18 to 24').ageRange, { min: 18, max: 24 });
    assert.deepEqual(read('18-24 years old').ageRange, { min: 18, max: 24 });
    assert.deepEqual(read('aged 70').ageRange, { min: 70, max: 70 });
    assert.equal(read('needs 5 bags of groceries').ageRange, null);
  });

  test('everyday wording gives a starting range for the worker to check', () => {
    assert.deepEqual(read('a teenager who needs school help').ageRange, { min: 13, max: 19 });
    assert.deepEqual(read('an elderly neighbor').ageRange, { min: 60, max: 120 });
  });

  test('two different ages are ambiguous: none is proposed', () => {
    const out = read('a 35 year old with a 3 year old child');
    assert.equal(out.ageRange, null);
    assert.deepEqual(out.notes, ['MULTIPLE_AGES']);
  });

  test('an impossible age is left out and noted', () => {
    const out = read('a 200 year old');
    assert.equal(out.ageRange, null);
    assert.deepEqual(out.notes, ['INVALID_AGE']);
  });

  test('reads one ZIP; several are ambiguous', () => {
    assert.equal(read('lives in 11101').participantZip, '11101');
    const two = read('lives in 11101 or 11373');
    assert.equal(two.participantZip, null);
    assert.deepEqual(two.notes, ['MULTIPLE_ZIPS']);
  });

  test('same text and categories give the same proposal', () => {
    const text = 'a 19 year old who needs a job, ZIP 11354';
    assert.deepEqual(read(text), read(text));
  });

  test('nothing recognized returns an empty proposal, not a guess', () => {
    const out = read('please help');
    assert.deepEqual([out.needCategoryIds, out.ageRange, out.participantZip], [[], null, null]);
  });

  test('only the three approved criteria can come out', () => {
    assert.deepEqual(
      Object.keys(read('a 17 year old who needs a job')).sort(),
      ['ageRange', 'needCategoryIds', 'notes', 'participantZip', 'reasons'],
    );
  });
});

function setup({ interpreter, store: given } = {}) {
  const store = given ?? createMemoryReferralStore(syntheticSeed());
  const app = createApp({
    affiliationStore: store, referralStore: store, resolveIdentity: () => ({ userId: DEV_USER_ID }),
    nodeEnv: 'test', ...(interpreter ? { gpmeInterpreter: interpreter } : {}),
  });
  return { store, app };
}

describe('POST /api/gpme/interpret', () => {
  test('proposes criteria and reports how many current Programs offer each need', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/gpme/interpret').send({ text: 'A 20 year old who needs a job, ZIP 11101' });
    assert.equal(res.status, 200);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.body.status, 'INTERPRETED');
    assert.equal(res.body.interpreterVersion, 'interpret-rules-v1');
    assert.deepEqual(res.body.ageRange, { min: 20, max: 20 });
    assert.equal(res.body.participantZip, '11101');
    assert.equal(res.body.needs.length, 1);
    assert.equal(res.body.needs[0].name, 'Employment (sample)');
    assert.equal(res.body.needs[0].currentProgramCount, 2);
  });

  test('never echoes the description back', async () => {
    const { app } = setup();
    const text = 'Maria Synthetic needs a job, call 555-0100';
    const res = await request(app).post('/api/gpme/interpret').send({ text });
    assert.equal(res.status, 200);
    const serialized = JSON.stringify(res.body).toLowerCase();
    for (const secret of ['maria', 'synthetic', '555', 'call']) assert.ok(!serialized.includes(secret), secret);
  });

  test('current Program Management data changes the counts and the matches', async () => {
    const { app, store } = setup();
    const before = await request(app).post('/api/gpme/interpret').send({ text: 'needs a job' });
    assert.equal(before.body.needs[0].currentProgramCount, 2);
    // Program 5 stops offering Employment in Program Management.
    await store.updateProgramMatchingFacts({ programId: 5, needCategoryIds: [] });
    const after = await request(app).post('/api/gpme/interpret').send({ text: 'needs a job' });
    assert.equal(after.body.needs[0].currentProgramCount, 1);
    const matched = await request(app).post('/api/gpme/match').send({ needCategoryIds: [3] });
    const ids = [...matched.body.plausible, ...matched.body.possible].map((p) => p.programId);
    assert.ok(!ids.includes(5));
  });

  test('rejects anything but a bounded text field', async () => {
    const { app } = setup();
    for (const body of [{}, { text: '' }, { text: '   ' }, { text: 5 }, { text: 'x'.repeat(401) }]) {
      const res = await request(app).post('/api/gpme/interpret').send(body);
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 40));
      assert.equal(res.body.code, 'INVALID_REQUEST');
    }
    const extra = await request(app).post('/api/gpme/interpret').send({ text: 'job', participantName: 'x' });
    assert.equal(extra.status, 400);
    assert.equal(extra.body.code, 'UNEXPECTED_FIELD');
    assert.ok(!JSON.stringify(extra.body).includes('participantName'));
  });

  test('refuses query parameters and unauthenticated callers', async () => {
    const { app } = setup();
    const q = await request(app).post('/api/gpme/interpret?text=job').send({ text: 'job' });
    assert.equal(q.status, 400);
    const anon = createApp({
      affiliationStore: createMemoryReferralStore(syntheticSeed()), referralStore: createMemoryReferralStore(syntheticSeed()),
      resolveIdentity: () => null, nodeEnv: 'test',
    });
    assert.equal((await request(anon).post('/api/gpme/interpret').send({ text: 'job' })).status, 401);
  });

  test('a failing interpreter is a technical failure, and logs no text', async () => {
    const logged = [];
    const store = createMemoryReferralStore(syntheticSeed());
    const service = createGpmeService({
      store,
      interpreter: { version: 'broken', interpret() { throw new Error('boom Maria 555-0100'); } },
      logFailure: (err) => logged.push(err.message),
    });
    const out = await service.interpret(DEV_USER_ID, { text: 'needs a job' });
    assert.deepEqual(out, { status: 'UNABLE_TO_INTERPRET' });
    assert.equal(logged.length, 1);
  });

  test('the interpretation layer is replaceable', async () => {
    const service = createGpmeService({
      store: createMemoryReferralStore(syntheticSeed()),
      interpreter: {
        version: 'fixed-test-interpreter',
        interpret: async () => ({ needCategoryIds: [4], reasons: new Map(), ageRange: null, participantZip: null, notes: [] }),
      },
    });
    const out = await service.interpret(DEV_USER_ID, { text: 'anything' });
    assert.equal(out.interpreterVersion, 'fixed-test-interpreter');
    assert.deepEqual(out.needs.map((n) => n.needCategoryId), [4]);
  });

  test('interpretation does not match, create, or route anything', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/gpme/interpret').send({ text: 'needs a job' });
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body).sort(), ['ageRange', 'interpreterVersion', 'needs', 'notes', 'participantZip', 'status']);
  });
});

describe('confirm, then match: the full flow with GPME unchanged', () => {
  test('a corrected proposal is what gets matched', async () => {
    const { app } = setup();
    const proposal = await request(app).post('/api/gpme/interpret').send({ text: 'needs a job, ZIP 11101' });
    // The worker adds Education and drops the ZIP: the confirmed answers rule.
    const confirmed = { needCategoryIds: [...proposal.body.needs.map((n) => n.needCategoryId), 2] };
    const res = await request(app).post('/api/gpme/match').send(confirmed);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'RESULTS');
    assert.ok(res.body.plausible.length + res.body.possible.length > 0);
  });

  test('no match stays a valid result, and nothing is chosen for the worker', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/gpme/match')
      .send({ needCategoryIds: [4], ageRange: { min: 5, max: 5 }, participantZip: '11101' });
    // Either outcome is valid; what matters is no automatic Program choice or referral.
    assert.ok(['RESULTS', 'NO_PLAUSIBLE_MATCH'].includes(res.body.status));
    assert.ok(!('selectedProgramId' in res.body) && !('referralId' in res.body));
  });

  test('the description cannot be sent to /match', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/gpme/match').send({ needCategoryIds: [3], text: 'a job' });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'UNEXPECTED_FIELD');
  });
});

describe('screen logic for the describe step', () => {
  const body = (extra = {}) => ({
    status: 200,
    body: {
      status: 'INTERPRETED', interpreterVersion: 'v', notes: [], ageRange: null, participantZip: null,
      needs: [{ needCategoryId: 3, name: 'Employment', matchedTerms: ['job'], currentProgramCount: 2 }], ...extra,
    },
  });

  test('validates the description before sending', () => {
    assert.equal(validateDescription(''), DESCRIBE_MESSAGES.EMPTY);
    assert.equal(validateDescription('x'.repeat(401)), DESCRIBE_MESSAGES.TOO_LONG);
    assert.equal(validateDescription('needs a job'), null);
  });

  test('a proposal fills the answers and shows what was understood', () => {
    const r = interpretInterpretResponse(body({ ageRange: { min: 17, max: 17 }, participantZip: '11101' }));
    assert.equal(r.state, 'PROPOSED');
    assert.deepEqual([r.needCategoryIds, r.ageMin, r.ageMax, r.matchZip], [[3], '17', '17', '11101']);
    assert.deepEqual(r.understood, ['Need: Employment', 'Age: 17', 'ZIP code: 11101']);
  });

  test('the filled answers become exactly the three approved criteria', () => {
    const r = interpretInterpretResponse(body({ ageRange: { min: 18, max: 24 } }));
    assert.deepEqual(toMatchRequest(r), { needCategoryIds: [3], ageRange: { min: 18, max: 24 } });
  });

  test('warns when no current Program lists a need', () => {
    const r = interpretInterpretResponse(body({ needs: [{ needCategoryId: 4, name: 'Housing', matchedTerms: [], currentProgramCount: 0 }] }));
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /No current Program lists this need/);
  });

  test('nothing understood and technical failure are different states', () => {
    assert.equal(interpretInterpretResponse(body({ needs: [] })).state, 'NOTHING_UNDERSTOOD');
    assert.equal(interpretInterpretResponse({ status: 503, body: { status: 'UNABLE_TO_INTERPRET' } }).state, 'UNABLE');
    assert.equal(interpretInterpretResponse({ networkError: true }).state, 'UNABLE');
    assert.equal(interpretInterpretResponse({ status: 401, body: {} }).state, 'NOT_SIGNED_IN');
    assert.equal(interpretInterpretResponse({ status: 200, body: { status: 'INTERPRETED', needs: 'bad' } }).state, 'UNABLE');
  });

  test('ambiguity notes are shown to the worker', () => {
    const r = interpretInterpretResponse(body({ notes: ['MULTIPLE_AGES'] }));
    assert.deepEqual(r.notes, [DESCRIBE_MESSAGES.NOTES.MULTIPLE_AGES]);
  });
});

describe('privacy and scope boundaries', () => {
  const ui = (name) => readFileSync(new URL(`../public/referral/${name}`, import.meta.url), 'utf8');
  const src = (name) => readFileSync(new URL(`../src/gpme/${name}`, import.meta.url), 'utf8');

  test('the description is never put in browser storage, a URL, or the console', () => {
    const code = (file) => ui(file).replace(/\/\/.*$/gm, '');
    for (const file of ['guided.js', 'api.js']) {
      assert.ok(!/localStorage|sessionStorage|indexedDB|console\./.test(code(file)), file);
    }
    // app.js uses localStorage only for the text-size preference (PRD 5.5).
    const app = code('app.js');
    assert.ok(!/console\./.test(app));
    assert.ok(!/sessionStorage|indexedDB/.test(app));
    assert.equal((app.match(/localStorage/g) ?? []).length, 1);
    assert.ok(!/interpret\?/.test(code('api.js')));
  });

  test('no external AI service or network client is used by the interpretation layer', () => {
    for (const file of ['interpretation/ruleBasedInterpreter.js', 'interpretation/validateInterpretRequest.js', 'gpmeService.js']) {
      const code = src(file).replace(/\/\/.*$/gm, '');
      assert.ok(!/\bfetch\(|https?:\/\/|from 'node:(http|https|net)'|openai|anthropic|axios/i.test(code), file);
    }
  });

  test('the description is not sent with a referral', () => {
    const code = ui('app.js');
    assert.ok(!/describe['"]\)\.value/.test(code.replace(/hasGuidedAnswers[\s\S]*?\n}\n/, '')
      .replace(/async function describeNeed[\s\S]*?\n}\n/, '')));
  });

  test('the page offers the describe step and keeps Direct Referral', () => {
    const html = ui('index.html');
    assert.match(html, /id="describe"/);
    assert.match(html, /<label for="describe">/);
    assert.match(html, /id="path-direct"/);
  });
});
