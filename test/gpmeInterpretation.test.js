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
import { MAX_DESCRIPTION_CHARS as MAX_SERVER_DESCRIPTION_CHARS } from '../src/gpme/interpretation/validateInterpretRequest.js';
import { syntheticSeed, DEV_USER_ID } from '../scripts/syntheticSeed.js';
import {
  DESCRIBE_MESSAGES, MAX_DESCRIPTION_CHARS, interpretInterpretResponse, toMatchRequest, validateDescription,
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

  test('a new category with no attached wording is recognized by its current name words', () => {
    const live = [{ needCategoryId: 9, name: 'Immigration legal help', lifecycleStatus: 'ACTIVE' }];
    const out = createRuleBasedInterpreter().interpret({ text: 'needs immigration advice', needCategories: live });
    assert.deepEqual(out.needCategoryIds, [9]);
  });

  test('attached wording follows the category id, so renaming a category changes nothing', () => {
    const as = (name) => [{ needCategoryId: 3, name, lifecycleStatus: 'ACTIVE' }];
    const texts = ['looking for a job', 'is unemployed and needs a resume', 'needs housing', 'wants to work'];
    for (const text of texts) {
      const before = createRuleBasedInterpreter().interpret({ text, needCategories: as('Employment (sample)') });
      for (const name of ['Jobs and careers', 'Housing support', 'Zebra services']) {
        const after = createRuleBasedInterpreter().interpret({ text, needCategories: as(name) });
        assert.deepEqual(after.needCategoryIds, before.needCategoryIds, `${text} / ${name}`);
      }
    }
  });

  test('a name that contains another group\'s word gains no wording from it', () => {
    const out = createRuleBasedInterpreter().interpret({
      text: 'needs a tutor for school', needCategories: [{ needCategoryId: 3, name: 'Employment and school help', lifecycleStatus: 'ACTIVE' }],
    });
    assert.deepEqual(out.needCategoryIds, []);
  });

  test('the attachments are replaceable by category id', () => {
    const live = [{ needCategoryId: 77, name: 'Anything', lifecycleStatus: 'ACTIVE' }];
    const out = createRuleBasedInterpreter({ attachments: { 77: ['bus pass'] } })
      .interpret({ text: 'needs a bus pass', needCategories: live });
    assert.deepEqual(out.needCategoryIds, [77]);
  });

  test('reads an exact age or a range only next to age wording', () => {
    assert.deepEqual(read('a 17 year old').ageRange, { min: 17, max: 17 });
    assert.deepEqual(read('17-year-old').ageRange, { min: 17, max: 17 });
    assert.deepEqual(read('ages 18 to 24').ageRange, { min: 18, max: 24 });
    assert.deepEqual(read('18-24 years old').ageRange, { min: 18, max: 24 });
    assert.deepEqual(read('aged 70').ageRange, { min: 70, max: 70 });
    assert.equal(read('needs 5 bags of groceries').ageRange, null);
  });

  test('no age range is assumed from everyday wording', () => {
    for (const text of ['a teenager who needs school help', 'an elderly neighbor', 'teens and seniors', 'an older adult']) {
      assert.equal(read(text).ageRange, null, text);
    }
    // The need is still recognized; only the age is left to the worker.
    assert.deepEqual(read('an elderly neighbor').needCategoryIds, [5]);
  });

  test('"ages 6 and 9" is two ages, not a range', () => {
    for (const text of ['ages 6 and 9', 'children ages 6 and 9', 'kids aged 6 and 9', 'a 6 and 9 year old', 'ages 6, 9 and 12', 'ages 6 or 9']) {
      const out = read(text);
      assert.equal(out.ageRange, null, text);
      assert.deepEqual(out.notes, ['MULTIPLE_AGES'], text);
    }
  });

  test('an age joined onto a range is not silently dropped', () => {
    for (const text of ['ages 6 to 9 and 12', 'age 6-9 and 12', '6 to 9 years old or 12']) {
      const out = read(text);
      assert.equal(out.ageRange, null, text);
      assert.deepEqual(out.notes, ['MULTIPLE_AGES'], text);
    }
    assert.deepEqual(read('ages 6 to 9 and a ZIP of 11101').ageRange, { min: 6, max: 9 });
  });

  test('an explicit range is still read', () => {
    assert.deepEqual(read('between 6 and 9 years old').ageRange, { min: 6, max: 9 });
    assert.deepEqual(read('between ages 6 and 9').ageRange, { min: 6, max: 9 });
    assert.deepEqual(read('ages 6 to 9').ageRange, { min: 6, max: 9 });
    assert.deepEqual(read('ages 6-9').ageRange, { min: 6, max: 9 });
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

  test('reads one ZIP next to ZIP wording; several are ambiguous', () => {
    for (const text of ['ZIP 11101', 'zip code 11101', 'Zip code: 11101', 'her zipcode is 11101', 'postal code 11101']) {
      assert.equal(read(text).participantZip, '11101', text);
    }
    for (const text of ['zip 11101 or 11373', 'zip codes 11101 and 11373', 'zip 11101, 11373']) {
      const two = read(text);
      assert.equal(two.participantZip, null, text);
      assert.deepEqual(two.notes, ['MULTIPLE_ZIPS'], text);
    }
  });

  test('an unrelated five-digit number is not a ZIP', () => {
    for (const text of [
      'lives in 11101', 'lives at 12345 Main Street', 'owes 12345 dollars', 'case number 54321 needs a job',
      'call 555 12345', 'badge 11101', 'zip 111012', 'zip 11101-1234 area',
    ]) {
      assert.equal(read(text).participantZip, null, text);
    }
    // A ZIP next to wording is found even with other numbers around.
    assert.equal(read('case 54321, zip 11101').participantZip, '11101');
  });

  test('a service the participant refused or did not ask for is not proposed', () => {
    for (const text of [
      "doesn't need housing", 'does not need any help with housing', 'not interested in housing', 'declined housing help',
      'refused the shelter', 'no longer needs housing', 'does not want housing services',
    ]) {
      const out = read(text);
      assert.deepEqual(out.needCategoryIds, [], text);
      assert.deepEqual(out.notes, ['NOT_REQUESTED'], text);
    }
  });

  test('a refusal only removes what it refers to', () => {
    assert.deepEqual(read("doesn't need housing but needs a job").needCategoryIds, [3]);
    assert.deepEqual(read("doesn't need housing, needs a job").needCategoryIds, [3]);
    assert.deepEqual(read('does not need housing and needs a job').needCategoryIds, [3]);
    assert.deepEqual(read('needs a job. Not interested in housing.').needCategoryIds, [3]);
    assert.deepEqual(read('needs housing and does not need a job').needCategoryIds, [4]);
    // Mentioned both ways: it was requested, so it is kept.
    assert.deepEqual(read("needs housing. She doesn't need housing help right now").needCategoryIds, [4]);
    // The refused service never becomes a matched term.
    assert.equal(read("doesn't need housing but needs a job").reasons.has(4), false);
  });

  test('wording that is not a refusal by the participant is left alone', () => {
    assert.deepEqual(read('was refused housing by a landlord').needCategoryIds, [4]);
    assert.deepEqual(read('she is without housing').needCategoryIds, [4]);
    assert.deepEqual(read('needs housing').notes, []);
  });

  test('the version changes with the rules', () => {
    assert.equal(createRuleBasedInterpreter().version, 'interpret-rules-v2');
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
    assert.equal(res.body.interpreterVersion, 'interpret-rules-v2');
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
    for (const body of [{}, { text: '' }, { text: '   ' }, { text: 5 }, { text: 'x'.repeat(501) }]) {
      const res = await request(app).post('/api/gpme/interpret').send(body);
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 40));
      assert.equal(res.body.code, 'INVALID_REQUEST');
    }
    const extra = await request(app).post('/api/gpme/interpret').send({ text: 'job', participantName: 'x' });
    assert.equal(extra.status, 400);
    assert.equal(extra.body.code, 'UNEXPECTED_FIELD');
    assert.ok(!JSON.stringify(extra.body).includes('participantName'));
  });

  test('the limit is 500 characters on the server and in the page, and agrees', async () => {
    const { app } = setup();
    const ok = await request(app).post('/api/gpme/interpret').send({ text: `needs a job ${'x'.repeat(488)}` });
    assert.equal(ok.status, 200);
    const over = await request(app).post('/api/gpme/interpret').send({ text: `needs a job ${'x'.repeat(489)}` });
    assert.equal(over.status, 400);
    assert.deepEqual(over.body.fields, ['text']);
    // 500 characters that each need a six-byte JSON escape still fit the body limit.
    const heavy = await request(app).post('/api/gpme/interpret').send({ text: `a${'\u0001'.repeat(499)}` });
    assert.notEqual(heavy.status, 413);
    assert.equal(heavy.status, 200);
    const html = readFileSync(new URL('../public/referral/index.html', import.meta.url), 'utf8');
    assert.match(html, /id="describe"[^>]*maxlength="500"/);
    // The limit is also stated to the worker, not only enforced (PRD 10.7).
    assert.match(html, /id="describe-hint"[^>]*>[^<]*Up to 500 characters/);
    assert.equal(MAX_DESCRIPTION_CHARS, 500);
    assert.equal(MAX_SERVER_DESCRIPTION_CHARS, MAX_DESCRIPTION_CHARS);
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

describe('replaceable interpreter output is validated before it crosses the boundary', () => {
  const GOOD = {
    needCategoryIds: [3], reasons: new Map([[3, ['job']]]), ageRange: { min: 18, max: 24 }, participantZip: '11101', notes: [],
  };
  const run = async (output, { version = 'test-interpreter', store = createMemoryReferralStore(syntheticSeed()) } = {}) => {
    const logged = [];
    const service = createGpmeService({
      store, interpreter: { version, interpret: async () => output }, logFailure: (err) => logged.push(err.message),
    });
    return { out: await service.interpret(DEV_USER_ID, { text: 'anything' }), logged };
  };

  test('well-formed output passes unchanged', async () => {
    const { out } = await run(GOOD);
    assert.equal(out.status, 'INTERPRETED');
    assert.deepEqual(out.needs.map((n) => n.needCategoryId), [3]);
    assert.deepEqual(out.ageRange, { min: 18, max: 24 });
    assert.equal(out.participantZip, '11101');
  });

  test('anything unexpected is a technical failure, and nothing from it is returned', async () => {
    const bad = [
      ['unknown id', { ...GOOD, needCategoryIds: [999] }],
      ['inactive category', { ...GOOD, needCategoryIds: [3, 6] }],
      ['duplicate ids', { ...GOOD, needCategoryIds: [3, 3] }],
      ['non-integer id', { ...GOOD, needCategoryIds: ['3'] }],
      ['prose in place of ids', { ...GOOD, needCategoryIds: 'Employment' }],
      ['extra key', { ...GOOD, summary: 'Maria Synthetic needs a job' }],
      ['age as text', { ...GOOD, ageRange: '18 to 24' }],
      ['age with an extra key', { ...GOOD, ageRange: { min: 18, max: 24, label: 'adult' } }],
      ['age out of bounds', { ...GOOD, ageRange: { min: 18, max: 500 } }],
      ['age reversed', { ...GOOD, ageRange: { min: 30, max: 20 } }],
      ['age not whole', { ...GOOD, ageRange: { min: 1.5, max: 4 } }],
      ['four-digit zip', { ...GOOD, participantZip: '1110' }],
      ['zip with text', { ...GOOD, participantZip: '11101 Main St' }],
      ['zip as number', { ...GOOD, participantZip: 11101 }],
      ['unknown note', { ...GOOD, notes: ['Call Maria at 555-0100'] }],
      ['notes not a list', { ...GOOD, notes: 'MULTIPLE_AGES' }],
      ['sentence as a matched term', { ...GOOD, reasons: new Map([[3, ['Maria Synthetic needs a job at 555-0100']]]) }],
      ['reasons for an id not proposed', { ...GOOD, reasons: new Map([[4, ['housing']]]) }],
      ['reasons as a plain object', { ...GOOD, reasons: { 3: ['job'] } }],
      ['not an object', 'needs a job'],
      ['null', null],
      ['array', [3]],
    ];
    for (const [label, output] of bad) {
      const { out, logged } = await run(output);
      assert.deepEqual(out, { status: 'UNABLE_TO_INTERPRET' }, label);
      assert.equal(logged.length, 1, label);
      assert.ok(!/maria|555/i.test(logged[0]), label);
    }
  });

  test('a bad version label is refused too', async () => {
    for (const version of ['', 'has spaces and prose', 'x'.repeat(65), null]) {
      const { out } = await run(GOOD, { version });
      assert.deepEqual(out, { status: 'UNABLE_TO_INTERPRET' }, String(version));
    }
  });

  test('a category retired after the list was read is refused, not passed along', async () => {
    const store = createMemoryReferralStore(syntheticSeed());
    const { out } = await run({ ...GOOD, needCategoryIds: [3], reasons: new Map() }, {
      store: { ...store, listNeedCategories: async () => [{ needCategoryId: 3, name: 'Employment', lifecycleStatus: 'DISCONTINUED' }] },
    });
    assert.deepEqual(out, { status: 'UNABLE_TO_INTERPRET' });
  });

  test('only the approved shape comes out of the service', async () => {
    const { out } = await run({ ...GOOD, notes: ['NOT_REQUESTED', 'NOT_REQUESTED'] });
    assert.deepEqual(out.notes, ['NOT_REQUESTED']);
    assert.deepEqual(Object.keys(out).sort(), ['ageRange', 'interpreterVersion', 'needs', 'notes', 'participantZip', 'status']);
  });

  test('a refused service never reaches the worker as a proposed need, end to end', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/gpme/interpret').send({ text: "She doesn't need housing but needs a job" });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.needs.map((n) => n.name), ['Employment (sample)']);
    const refusedOnly = await request(app).post('/api/gpme/interpret').send({ text: 'Not interested in housing' });
    assert.deepEqual(refusedOnly.body.needs, []);
    assert.deepEqual(refusedOnly.body.notes, ['NOT_REQUESTED']);
  });
});

describe('language is not a matching criterion (PRD 8.2)', () => {
  test('neither route accepts a language, and Programs are never excluded by one', async () => {
    const { app } = setup();
    for (const path of ['/api/gpme/match', '/api/gpme/interpret']) {
      const body = path.endsWith('match') ? { needCategoryIds: [3], preferredLanguage: 'es' } : { text: 'a job', preferredLanguage: 'es' };
      const res = await request(app).post(path).send(body);
      assert.equal(res.status, 400, path);
      assert.equal(res.body.code, 'UNEXPECTED_FIELD', path);
    }
    const src = (name) => readFileSync(new URL(`../src/gpme/${name}`, import.meta.url), 'utf8');
    for (const file of ['matchPrograms.js', 'validateMatchRequest.js', 'programFacts.js', 'interpretation/ruleBasedInterpreter.js']) {
      assert.ok(!/language/i.test(src(file).replace(/\/\/.*$/gm, '')), file);
    }
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
    assert.equal(validateDescription('x'.repeat(501)), DESCRIBE_MESSAGES.TOO_LONG);
    assert.equal(validateDescription('x'.repeat(500)), null);
    assert.match(DESCRIBE_MESSAGES.TOO_LONG, /500/);
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
    assert.equal(interpretInterpretResponse(body({ status: 'NOTHING_RECOGNIZED', needs: [] })).state, 'NOTHING_UNDERSTOOD');
    assert.equal(interpretInterpretResponse({ status: 503, body: { status: 'UNABLE_TO_INTERPRET' } }).state, 'UNABLE');
    assert.equal(interpretInterpretResponse({ networkError: true }).state, 'UNABLE');
    assert.equal(interpretInterpretResponse({ status: 401, body: {} }).state, 'NOT_SIGNED_IN');
    assert.equal(interpretInterpretResponse({ status: 200, body: { status: 'INTERPRETED', needs: 'bad' } }).state, 'UNABLE');
  });

  test('ambiguity notes are shown to the worker', () => {
    const r = interpretInterpretResponse(body({ notes: ['MULTIPLE_AGES'] }));
    assert.deepEqual(r.notes, [DESCRIBE_MESSAGES.NOTES.MULTIPLE_AGES]);
  });

  test('a note for a service that was not wanted is shown, and names no service', () => {
    const r = interpretInterpretResponse(body({ notes: ['NOT_REQUESTED'] }));
    assert.deepEqual(r.notes, [DESCRIBE_MESSAGES.NOTES.NOT_REQUESTED]);
    assert.ok(DESCRIBE_MESSAGES.NOTES.NOT_REQUESTED.length > 0);
  });
});

describe('privacy and scope boundaries', () => {
  // Checkouts use LF or CRLF (core.autocrlf on Windows); these source checks
  // must not depend on which, so everything is read as LF.
  const lf = (text) => text.replace(/\r\n?/g, '\n');
  const ui = (name) => lf(readFileSync(new URL(`../public/referral/${name}`, import.meta.url), 'utf8'));
  const src = (name) => lf(readFileSync(new URL(`../src/gpme/${name}`, import.meta.url), 'utf8'));

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

  // A source-level guard only. The proof that the description is not in a
  // referral request is the browser test "the description never rides along
  // with the referral" in e2e/gpme.spec.js, which checks the real request body.
  test('the description is not read anywhere near the referral payload', () => {
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

describe('PR 59 interpretation contract regressions', () => {
  test('successful empty interpretation returns NOTHING_RECOGNIZED, including notes-only output', async () => {
    const { app } = setup();
    for (const text of ['please help', 'not interested in housing']) {
      const res = await request(app).post('/api/gpme/interpret').send({ text });
      assert.equal(res.status, 200);
      assert.equal(res.headers['cache-control'], 'no-store');
      assert.equal(res.body.status, 'NOTHING_RECOGNIZED');
      assert.deepEqual(res.body.needs, []);
      assert.equal(res.body.ageRange, null);
      assert.equal(res.body.participantZip, null);
      assert.equal(interpretInterpretResponse(res).state, 'NOTHING_UNDERSTOOD');
      assert.ok(!('plausible' in res.body) && !('possible' in res.body));
      if (text.startsWith('not interested')) {
        assert.deepEqual(res.body.notes, ['NOT_REQUESTED']);
        assert.deepEqual(
          interpretInterpretResponse(res).notes,
          [DESCRIBE_MESSAGES.NOTES.NOT_REQUESTED],
        );
      }
    }
  });

  test('an interpreter failure returns HTTP 503 and UNABLE_TO_INTERPRET', async () => {
    const { app } = setup({
      interpreter: {
        version: 'failing-test-interpreter',
        interpret() { throw new Error('synthetic test failure'); },
      },
    });
    const res = await request(app).post('/api/gpme/interpret').send({ text: 'needs a job' });
    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { status: 'UNABLE_TO_INTERPRET' });
    assert.equal(interpretInterpretResponse(res).state, 'UNABLE');
  });

  test('age-only or ZIP-only recognition is INTERPRETED and still requires an employee-selected need', async () => {
    const { app } = setup();
    for (const text of ['age 17', 'ZIP 11101']) {
      const res = await request(app).post('/api/gpme/interpret').send({ text });
      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'INTERPRETED');
      const view = interpretInterpretResponse(res);
      assert.equal(view.state, 'PROPOSED');
      assert.equal(view.needsStillRequired, true);
    }
  });

  test('exact ages and ranges remain reviewable, are not broadened, and are accepted for matching', async () => {
    const { validateGuidedForm } = await import('../public/referral/guided.js');
    const { app } = setup();
    const cases = [
      ['age 17, needs a job', { min: 17, max: 17 }, 'Age: 17'],
      ['ages 18 to 24, needs a job', { min: 18, max: 24 }, 'Age range: 18 to 24'],
    ];
    for (const [text, expected, label] of cases) {
      const proposal = await request(app).post('/api/gpme/interpret').send({ text });
      assert.equal(proposal.status, 200);
      assert.equal(proposal.body.status, 'INTERPRETED');
      assert.deepEqual(proposal.body.ageRange, expected);
      assert.ok(!proposal.body.notes.includes('INVALID_AGE'));

      const view = interpretInterpretResponse(proposal);
      assert.equal(view.state, 'PROPOSED');
      assert.ok(view.understood.includes(label));
      assert.equal(view.message, DESCRIBE_MESSAGES.CHECK_PROMPT);
      assert.deepEqual(validateGuidedForm(view), {});

      const confirmed = toMatchRequest(view);
      assert.deepEqual(confirmed.ageRange, expected);
      const matched = await request(app).post('/api/gpme/match').send(confirmed);
      assert.equal(matched.status, 200);
      assert.ok(['RESULTS', 'NO_PLAUSIBLE_MATCH'].includes(matched.body.status));
    }
  });

  test('contradictory interpretation responses and match outcomes are not accepted as interpretation success', () => {
    const empty = { needs: [], ageRange: null, participantZip: null, notes: [] };
    for (const body of [
      { ...empty, status: 'INTERPRETED' },
      { ...empty, status: 'NOTHING_RECOGNIZED', ageRange: { min: 17, max: 17 } },
      { ...empty, status: 'NO_PLAUSIBLE_MATCH' },
    ]) {
      assert.equal(interpretInterpretResponse({ status: 200, body }).state, 'UNABLE');
    }
  });
});
