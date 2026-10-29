// Guided matching screen (Trello card 11): logic modules, client/server
// parity, page structure, and the guided path end to end through the real
// API with the synthetic dev seed. All data is SYNTHETIC.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
import { validateMatchRequest } from '../src/gpme/validateMatchRequest.js';
import {
  GUIDED_FIELD_MESSAGES, GUIDED_MESSAGES, firstGuidedError, interpretCategoriesResponse, interpretMatchResponse,
  notCheckedNote, toMatchRequest, validateGuidedForm,
} from '../public/referral/guided.js';
import { interpretSubmitResponse } from '../public/referral/submission.js';
import { toRequestBody } from '../public/referral/validation.js';
import { syntheticSeed, DEV_USER_ID } from '../scripts/syntheticSeed.js';

const UI_DIR = new URL('../public/referral/', import.meta.url);
const read = (name) => readFileSync(new URL(name, UI_DIR), 'utf8');

const answers = (overrides = {}) => ({ needCategoryIds: [3], ageMin: '', ageMax: '', matchZip: '', ...overrides });

const program = (programId, name) => ({
  programId, name, site: null, departmentId: 1, departmentName: 'Synthetic Department', explanations: ['Offers: Food'],
});

describe('guided form validation', () => {
  test('a need is required; age and ZIP are optional', () => {
    assert.deepEqual(validateGuidedForm(answers()), {});
    assert.deepEqual(validateGuidedForm(answers({ needCategoryIds: [] })), { needs: GUIDED_FIELD_MESSAGES.needs });
  });

  test('age is a whole-number range; both ends or neither', () => {
    assert.deepEqual(validateGuidedForm(answers({ ageMin: '18', ageMax: '24' })), {});
    assert.deepEqual(validateGuidedForm(answers({ ageMin: ' 20 ', ageMax: '20' })), {}, 'one exact age is a range of one');
    assert.equal(validateGuidedForm(answers({ ageMin: '18' })).ageRange, GUIDED_FIELD_MESSAGES.ageRange.incomplete);
    assert.equal(validateGuidedForm(answers({ ageMax: '18' })).ageRange, GUIDED_FIELD_MESSAGES.ageRange.incomplete);
    for (const [ageMin, ageMax] of [['18.5', '20'], ['-1', '5'], ['0', '121'], ['abc', '5'], ['1e1', '20']]) {
      assert.equal(validateGuidedForm(answers({ ageMin, ageMax })).ageRange, GUIDED_FIELD_MESSAGES.ageRange.invalid, `${ageMin}-${ageMax}`);
    }
    assert.equal(validateGuidedForm(answers({ ageMin: '30', ageMax: '20' })).ageRange, GUIDED_FIELD_MESSAGES.ageRange.order);
    assert.equal(validateGuidedForm(answers({ ageMin: '21', ageMax: '20' })).ageRange, GUIDED_FIELD_MESSAGES.ageRange.order, 'off by one');
  });

  test('an exact age is one whole number, never an error for being one age (Handoff PRD 5.3, Task HH)', () => {
    const exact = (ageExact, extra = {}) => answers({ ageMode: 'exact', ageExact, ...extra });
    assert.deepEqual(validateGuidedForm(exact('37')), {});
    assert.deepEqual(validateGuidedForm(exact(' 0 ')), {});
    assert.deepEqual(validateGuidedForm(exact('120')), {});
    assert.deepEqual(validateGuidedForm(exact('')), {}, 'blank is fine: age is optional');
    for (const bad of ['121', '-1', '18.5', 'abc', '1e1', '12 14']) {
      assert.equal(validateGuidedForm(exact(bad)).ageRange, GUIDED_FIELD_MESSAGES.ageRange.exactInvalid, bad);
    }
    // Only the chosen mode counts: leftover range boxes never block an exact age.
    assert.deepEqual(validateGuidedForm(exact('37', { ageMin: '18' })), {});
    assert.deepEqual(validateGuidedForm(answers({ ageMode: 'range', ageExact: 'abc', ageMin: '18', ageMax: '24' })), {});
  });

  test('ZIP is five digits or blank', () => {
    assert.equal(validateGuidedForm(answers({ matchZip: '1234' })).matchZip, GUIDED_FIELD_MESSAGES.matchZip);
    assert.equal(validateGuidedForm(answers({ matchZip: '12345-6789' })).matchZip, GUIDED_FIELD_MESSAGES.matchZip);
    assert.deepEqual(validateGuidedForm(answers({ matchZip: ' 99901 ' })), {});
  });

  test('focus goes to the first problem in screen order', () => {
    assert.equal(firstGuidedError({ matchZip: 'x', ageRange: 'x' }), 'ageRange');
    assert.equal(firstGuidedError({ matchZip: 'x', needs: 'x' }), 'needs');
    assert.equal(firstGuidedError({}), null);
  });
});

describe('the request sent to matching', () => {
  test('only the three approved inputs; blanks left out (PRD 8.2, 8.3)', () => {
    assert.deepEqual(toMatchRequest(answers()), { needCategoryIds: [3] });
    assert.deepEqual(toMatchRequest(answers({ needCategoryIds: [3, 1, 3], ageMin: '19', ageMax: '20', matchZip: ' 99901 ' })),
      { needCategoryIds: [1, 3], ageRange: { min: 19, max: 20 }, participantZip: '99901' });
  });

  test('an exact age is sent as that one age, never widened; the other mode\'s boxes are ignored', () => {
    assert.deepEqual(toMatchRequest(answers({ ageMode: 'exact', ageExact: ' 37 ', ageMin: '18', ageMax: '24' })),
      { needCategoryIds: [3], ageRange: { min: 37, max: 37 } });
    assert.deepEqual(toMatchRequest(answers({ ageMode: 'exact', ageExact: '' })), { needCategoryIds: [3] });
    assert.deepEqual(toMatchRequest(answers({ ageMode: 'range', ageExact: '37', ageMin: '18', ageMax: '24' })),
      { needCategoryIds: [3], ageRange: { min: 18, max: 24 } });
  });

  test('everything the client accepts, the server accepts too (parity)', () => {
    const cases = [
      answers(),
      answers({ ageMin: '0', ageMax: '120' }),
      answers({ ageMode: 'exact', ageExact: '0' }),
      answers({ ageMode: 'exact', ageExact: '120' }),
      answers({ ageMin: '7', ageMax: '7', matchZip: '00001' }),
      answers({ needCategoryIds: [1, 2, 3, 4, 5] }),
    ];
    for (const values of cases) {
      assert.deepEqual(validateGuidedForm(values), {});
      assert.equal(validateMatchRequest(toMatchRequest(values)).ok, true, JSON.stringify(values));
    }
  });
});

describe('reading the matching answer', () => {
  test('RESULTS keeps both groups and the not-checked count', () => {
    const r = interpretMatchResponse({ status: 200, body: {
      status: 'RESULTS', ruleVersion: 'gpme-v1', plausible: [program(2, 'B'), program(3, 'C')], possible: [program(4, 'D')], notCheckedForNeedCount: 2,
    } });
    assert.equal(r.state, 'RESULTS');
    assert.deepEqual(r.plausible.map((p) => p.programId), [2, 3]);
    assert.deepEqual(r.possible.map((p) => p.programId), [4]);
    assert.equal(r.notCheckedForNeedCount, 2);
    assert.equal(r.message, null);
  });

  test('ties are kept exactly as the server ordered them; nothing is ranked or scored', () => {
    const plausible = [program(9, 'Zed'), program(2, 'Alpha')];
    const r = interpretMatchResponse({ status: 200, body: { status: 'RESULTS', plausible, possible: [] } });
    assert.deepEqual(r.plausible, plausible);
    assert.ok(!Object.keys(r).some((k) => /score|rank|best|confidence/i.test(k)));
  });

  test('"no plausible match" and "unable to match" are never the same state (PRD 8.5)', () => {
    const none = interpretMatchResponse({ status: 200, body: { status: 'NO_PLAUSIBLE_MATCH', plausible: [], possible: [], notCheckedForNeedCount: 0 } });
    assert.equal(none.state, 'NO_PLAUSIBLE_MATCH');
    assert.equal(none.message, GUIDED_MESSAGES.NO_PLAUSIBLE_MATCH);
    assert.equal(none.canRetry, false);
    assert.equal(none.offerDirect, true);
    assert.match(none.message, /does not mean QCH has no appropriate Program/);

    for (const response of [
      { status: 503, body: { status: 'UNABLE_TO_MATCH', ruleVersion: 'gpme-v1' } },
      { networkError: true },
      { status: 500, body: null },
      { status: 502, body: { status: 'NO_PLAUSIBLE_MATCH' } },
      { status: 200, body: { status: 'RESULTS', plausible: [], possible: [] } },
      { status: 200, body: { status: 'RESULTS', plausible: [{ programId: 'x' }], possible: [] } },
      { status: 200, body: null },
    ]) {
      const r = interpretMatchResponse(response);
      assert.equal(r.state, 'UNABLE_TO_MATCH', JSON.stringify(response));
      assert.equal(r.message, GUIDED_MESSAGES.UNABLE_TO_MATCH);
      assert.equal(r.canRetry, true);
      assert.equal(r.offerDirect, true);
    }
    assert.notEqual(GUIDED_MESSAGES.NO_PLAUSIBLE_MATCH, GUIDED_MESSAGES.UNABLE_TO_MATCH);
    assert.doesNotMatch(GUIDED_MESSAGES.UNABLE_TO_MATCH, /no plausible match/i);
    assert.doesNotMatch(GUIDED_MESSAGES.NO_PLAUSIBLE_MATCH, /unable|technical|try again/i);
  });

  test('server validation errors map to the guided fields', () => {
    const r = interpretMatchResponse({ status: 400, body: { code: 'INVALID_REQUEST', fields: ['participantZip', 'ageRange'] } });
    assert.equal(r.state, 'INVALID');
    assert.deepEqual(r.fieldErrors, ['matchZip', 'ageRange']);
    assert.deepEqual(interpretMatchResponse({ status: 400, body: { code: 'INVALID_REQUEST' } }).fieldErrors, ['needs']);
  });

  test('sign-in problems are their own state', () => {
    for (const status of [401, 403]) assert.equal(interpretMatchResponse({ status, body: {} }).state, 'NOT_SIGNED_IN');
  });

  test('need categories: anything malformed is a technical failure with Direct offered', () => {
    assert.deepEqual(interpretCategoriesResponse({ status: 200, body: { needCategories: [{ needCategoryId: 1, name: 'Food' }] } }),
      { ok: true, needCategories: [{ needCategoryId: 1, name: 'Food' }] });
    for (const response of [{ networkError: true }, { status: 503, body: {} }, { status: 200, body: { needCategories: [{ name: 'x' }] } }]) {
      const r = interpretCategoriesResponse(response);
      assert.equal(r.ok, false);
      assert.match(r.message, /Direct Referral/);
    }
  });

  test('Programs with no need categories are described as not checked, never as unsuitable (PRD 8.10)', () => {
    assert.equal(notCheckedNote(0), null);
    assert.equal(notCheckedNote(undefined), null);
    assert.match(notCheckedNote(1), /^1 Program has no need categories on file, so matching could not check it\./);
    assert.match(notCheckedNote(3), /^3 Programs have .* check them\./);
    assert.doesNotMatch(notCheckedNote(3), /not (eligible|suitable)|excluded|rejected/i);
  });

  test('screen copy never claims eligibility, certainty or a best match (PRD 8.6)', () => {
    const copy = [...Object.values(GUIDED_MESSAGES), read('index.html')].join(' ');
    assert.doesNotMatch(copy, /best match|top match|recommended for you|eligible|guarantee|confiden|% match|score/i);
    assert.match(GUIDED_MESSAGES.ORDER_NOTE, /does not rank/);
    assert.match(GUIDED_MESSAGES.SUGGESTION_NOTE, /not an eligibility decision/);
  });
});

describe('GPME-assisted submission recovery', () => {
  test('GPME_RESULT_CHANGED: nothing saved, review results, same Submission ID kept', () => {
    const r = interpretSubmitResponse({ status: 409, body: { code: 'GPME_RESULT_CHANGED', error: 'x' } }, { submissionId: randomUUID() });
    assert.equal(r.state, 'GPME_RESULT_CHANGED');
    assert.equal(r.next, 'REVIEW_MATCHES');
    assert.equal(r.keepInput, true);
    assert.equal(r.formLocked, false);
    assert.ok(!r.needsCheck, 'a definite answer; no safe check needed');
    assert.equal(r.message, GUIDED_MESSAGES.RESULT_CHANGED);
  });

  test('GPME_UNAVAILABLE: nothing saved, resend or send as Direct Referral (PRD 8.8)', () => {
    const r = interpretSubmitResponse({ status: 503, body: { code: 'GPME_UNAVAILABLE', error: 'x' } }, { submissionId: randomUUID() });
    assert.equal(r.state, 'GPME_UNAVAILABLE');
    assert.equal(r.next, 'SEND_AS_DIRECT');
    assert.equal(r.canResend, true);
    assert.equal(r.formLocked, false);
    assert.ok(!r.needsCheck);
  });

  test('any other 503 is still an unknown outcome that needs the safe check (PRD 7.4)', () => {
    for (const body of [{ code: 'NOT_CONFIGURED' }, { code: 'UNABLE_TO_MATCH' }, null]) {
      const r = interpretSubmitResponse({ status: 503, body }, { submissionId: randomUUID() });
      assert.equal(r.state, 'NOT_CONFIRMED');
      assert.equal(r.needsCheck, true);
    }
  });
});

describe('page structure', () => {
  const html = read('index.html');

  test('two equal paths, neither preselected (PRD 2.1)', () => {
    assert.match(html, /id="path-guided"[^>]*aria-pressed="false"/);
    assert.match(html, /id="path-direct"[^>]*aria-pressed="false"/);
    assert.match(html, /<div id="guided" class="path-panel" hidden>/);
    assert.match(html, /<div id="direct" class="path-panel" hidden>/);
  });

  test('guided fields have labels, hints and linked error elements', () => {
    for (const id of ['ageMin', 'ageMax', 'matchZip']) assert.match(html, new RegExp(`<label for="${id}"`), id);
    assert.match(html, /id="needs" aria-describedby="needs-hint needs-error"/);
    assert.match(html, /id="ageMin"[^>]*aria-describedby="ageRange-error"/);
    assert.match(html, /id="matchZip"[^>]*aria-describedby="matchZip-hint matchZip-error"/);
  });

  test('participant age opens on Exact age, as in the Current Handoff Wireframes (screen 2; Handoff PRD 5.3)', () => {
    assert.match(html, /id="ageMode-exact"[^>]*\bchecked\b/);
    assert.doesNotMatch(html, /id="ageMode-range"[^>]*\bchecked\b/);
    assert.match(html, /<div class="range" id="ageExact-group">/, 'the Exact age box is shown');
    assert.match(html, /<div class="range" id="ageRange-group" hidden>/, 'the range boxes start hidden');
    assert.match(html, /<label for="ageExact">/);
    // The wording says this is the participant's age and that it is not saved,
    // keeping it apart from the Program age limits shown with results.
    assert.match(html, /Age is used only to find Programs and is not saved with the referral/);
  });

  test('the guided outcome is announced; Try again and Direct Referral are offered', () => {
    assert.match(html, /id="match-message"[^>]*role="status"[^>]*aria-live="polite"/);
    for (const id of ['match-retry', 'match-edit', 'match-direct', 'send-direct']) assert.match(html, new RegExp(`id="${id}"`), id);
  });

  test('the matching answers are described as not saved with the referral (PRD 5.3)', () => {
    assert.match(html, /They are not saved with the referral\./);
  });

  test('guided.js is served', async () => {
    const res = await request(createApp()).get('/referral/guided.js');
    assert.equal(res.status, 200);
  });
});

describe('guided path end to end with the synthetic dev seed', () => {
  async function signedIn() {
    const store = createMemoryReferralStore(syntheticSeed());
    const app = createApp({ affiliationStore: store, referralStore: store, resolveIdentity: () => ({ userId: DEV_USER_ID }) });
    const { body: current } = await request(app).get('/api/me/affiliation');
    await request(app).put('/api/me/affiliation').send({ programId: 1, version: current.version }).expect(200);
    return { app, store };
  }

  const form = {
    participantName: 'Synthetic Person Delta',
    contactMethod: 'NOT_AVAILABLE',
    contactValue: '',
    participantZip: '',
    referralContext: 'Synthetic context: looking for evening classes',
    notes: '',
  };

  test('categories -> match -> choose -> the same referral pipeline, saved as GPME_ASSISTED', async () => {
    const { app, store } = await signedIn();
    const categories = interpretCategoriesResponse(await request(app).get('/api/gpme/need-categories').then((r) => ({ status: r.status, body: r.body })));
    assert.equal(categories.ok, true);
    assert.ok(categories.needCategories.length >= 5);

    const values = answers({ needCategoryIds: [2, 3], ageMin: '19', ageMax: '30' });
    assert.deepEqual(validateGuidedForm(values), {});
    const matchBody = toMatchRequest(values);
    const res = await request(app).post('/api/gpme/match').send(matchBody);
    const result = interpretMatchResponse({ status: res.status, body: res.body });
    assert.equal(result.state, 'RESULTS');
    assert.deepEqual(result.plausible.map((p) => p.programId), [3]);
    assert.deepEqual(result.possible.map((p) => p.programId), [5]);

    // The page sends the referral form body plus the same answers.
    const body = { ...toRequestBody(form, { submissionId: randomUUID(), receivingProgramId: 5 }), gpme: matchBody };
    const sent = await request(app).post('/api/referrals').send(body);
    assert.equal(sent.status, 201);
    assert.equal(interpretSubmitResponse({ status: sent.status, body: sent.body }, { submissionId: body.submissionId }).state, 'RECEIVED');
    const [row] = store._referrals;
    assert.equal(row.source, 'GPME_ASSISTED');
    const evaluation = await store.getGpmeEvaluation(row.gpmeEvaluationId);
    assert.deepEqual(evaluation.results.filter((r) => r.wasSelected).map((r) => r.programId), [5]);
  });

  test('no plausible match through the real API is a result, not a failure', async () => {
    const { app } = await signedIn();
    // Childcare is offered only for ages 0 to 5.
    const res = await request(app).post('/api/gpme/match').send(toMatchRequest(answers({ needCategoryIds: [1], ageMin: '40', ageMax: '45' })));
    const result = interpretMatchResponse({ status: res.status, body: res.body });
    assert.equal(result.state, 'NO_PLAUSIBLE_MATCH');
  });

  test('a technical failure through the real API is UNABLE_TO_MATCH, and Direct Referral still works', async () => {
    const { app, store } = await signedIn();
    store._failMatching();
    const res = await request(app).post('/api/gpme/match').send({ needCategoryIds: [3] });
    assert.equal(interpretMatchResponse({ status: res.status, body: res.body }).state, 'UNABLE_TO_MATCH');
    const direct = await request(app).post('/api/referrals').send(toRequestBody(form, { submissionId: randomUUID(), receivingProgramId: 3 }));
    assert.equal(direct.status, 201);
    assert.equal(store._referrals[0].source, 'DIRECT');
  });
});
