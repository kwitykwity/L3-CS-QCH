// Trello Task LL: no-match versus technical failure, at the server and the
// screen-state boundary (Handoff PRD 4.2, 6.5; Handoff MVP 4.2, 7; MVP gate 10).
//
// A legitimate no-match is a RESULT: HTTP 200, the no-match status, no
// failure wording, and "change your answers or use Direct Referral". A
// technical failure is NOT a result: HTTP 503, the failure status, the
// recovery experience (try again, answers kept), and Direct Referral still
// works. The two must never be confused, at either step of Find a Program:
// reading the description (interpretation) and matching.
//
// This file adds what the existing tests do not combine:
//   - both steps, side by side, with disjoint wire shapes;
//   - a third class (invalid input) that is neither a result nor a failure;
//   - recovery: a failure is not sticky, and a legitimate no-match after a
//     failure is still shown as a no-match;
//   - an interpretation failure leaves Direct Referral and manual matching
//     working;
//   - a failure writes the description text nowhere.
//
// SYNTHETIC data only. The browser side is e2e/noMatchVsFailure.spec.js.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createMemoryReferralStore } from '../../src/referrals/memoryReferralStore.js';
import { syntheticSeed, DEV_USER_ID } from '../../scripts/syntheticSeed.js';
import {
  DESCRIBE_MESSAGES, GUIDED_MESSAGES, interpretInterpretResponse, interpretMatchResponse,
} from '../../public/referral/guided.js';

// Adult Evening Classes (Program 3) takes ages 18 and over; Older Adult
// Wellness Center (Program 6) takes ages 60 and over.
const NO_MATCH = { needCategoryIds: [5], ageRange: { min: 20, max: 25 } };
const A_MATCH = { needCategoryIds: [3], ageRange: { min: 20, max: 25 } };

function build({ interpreter } = {}) {
  const store = createMemoryReferralStore(syntheticSeed());
  const app = createApp({
    affiliationStore: store, referralStore: store, resolveIdentity: () => ({ userId: DEV_USER_ID }),
    nodeEnv: 'test', ...(interpreter ? { gpmeInterpreter: interpreter } : {}),
  });
  return { store, app };
}

async function affiliate(app) {
  const { body: current } = await request(app).get('/api/me/affiliation');
  await request(app).put('/api/me/affiliation').send({ programId: 1, version: current.version }).expect(200);
}

const failingInterpreter = {
  version: 'failing-test-interpreter',
  interpret() { throw new Error('synthetic interpreter failure'); },
};

// Runs fn with matching broken, then puts the real method back.
async function withMatchingDown(store, fn) {
  const original = store.listMatchablePrograms;
  store.listMatchablePrograms = async () => { throw new Error('synthetic matching failure'); };
  try {
    return await fn();
  } finally {
    store.listMatchablePrograms = original;
  }
}

// Silences and records what a failure writes to the console.
async function captureConsole(fn) {
  const lines = [];
  const originals = {};
  for (const level of ['log', 'info', 'warn', 'error']) {
    originals[level] = console[level];
    console[level] = (...args) => lines.push(args.map(String).join(' '));
  }
  try {
    await fn();
  } finally {
    Object.assign(console, originals);
  }
  return lines;
}

describe('Task LL reading the description: nothing understood is a result, a technical failure is not', () => {
  test('wire shapes are disjoint, and each maps to its own screen state', async () => {
    const ok = build();
    const nothing = await request(ok.app).post('/api/gpme/interpret').send({ text: 'please help' });
    assert.equal(nothing.status, 200);
    assert.equal(nothing.body.status, 'NOTHING_RECOGNIZED');
    assert.deepEqual(nothing.body.needs, []);
    assert.equal(interpretInterpretResponse(nothing).state, 'NOTHING_UNDERSTOOD');

    const down = build({ interpreter: failingInterpreter });
    const failed = await request(down.app).post('/api/gpme/interpret').send({ text: 'please help' });
    assert.equal(failed.status, 503);
    assert.deepEqual(failed.body, { status: 'UNABLE_TO_INTERPRET' }, 'a failure carries no needs, no age, no ZIP');
    assert.equal(interpretInterpretResponse(failed).state, 'UNABLE');

    // The same input, so only the condition differs: the screen wording differs too.
    const noWords = interpretInterpretResponse(nothing).message;
    const failWords = interpretInterpretResponse(failed).message;
    assert.notEqual(noWords, failWords);
    assert.match(failWords, /technical problem/i);
    assert.doesNotMatch(noWords, /technical problem|try again/i);
    assert.doesNotMatch(failWords, /did not point to|nothing was filled in/i);
  });

  test('a malformed answer or a dropped connection is a failure, never "nothing understood"', () => {
    for (const response of [
      { networkError: true },
      { status: 500, body: null },
      { status: 200, body: null },
      { status: 200, body: { status: 'NOTHING_RECOGNIZED', needs: 'nope', notes: [] } },
      { status: 200, body: { status: 'SOMETHING_ELSE', needs: [], notes: [] } },
    ]) {
      assert.equal(interpretInterpretResponse(response).state, 'UNABLE', JSON.stringify(response));
    }
  });

  test('a failed interpretation leaves manual matching and Direct Referral working', async () => {
    const { app, store } = build({ interpreter: failingInterpreter });
    await affiliate(app);
    assert.equal((await request(app).post('/api/gpme/interpret').send({ text: 'needs a job' })).status, 503);

    const match = await request(app).post('/api/gpme/match').send(A_MATCH);
    assert.equal(match.status, 200);
    assert.equal(match.body.status, 'RESULTS');

    const direct = await request(app).post('/api/referrals').send({
      submissionId: randomUUID(), receivingProgramId: 3, participantName: 'Synthetic Person Lambda',
      contactMethod: 'NOT_AVAILABLE', referralContext: 'Synthetic need for the no-match versus failure test',
    });
    assert.equal(direct.status, 201);
    assert.equal(store._referrals[0].source, 'DIRECT');
  });

  test('a failure writes the description text nowhere (Handoff PRD 34)', async () => {
    const { app } = build({ interpreter: failingInterpreter });
    const text = 'Synthetic Person Omega needs help finding a job';
    let response;
    const lines = await captureConsole(async () => {
      response = await request(app).post('/api/gpme/interpret').send({ text });
    });
    assert.equal(response.status, 503);
    assert.ok(!JSON.stringify(response.body).includes('Omega'));
    assert.ok(!lines.join('\n').includes('Omega'), `the log must not hold the description: ${lines.join(' | ')}`);
  });
});

describe('Task LL matching: no plausible match is a result, a technical failure is not', () => {
  test('wire shapes are disjoint, and each maps to its own screen state and actions', async () => {
    const { app, store } = build();

    const none = await request(app).post('/api/gpme/match').send(NO_MATCH);
    assert.equal(none.status, 200);
    assert.equal(none.body.status, 'NO_PLAUSIBLE_MATCH');
    assert.deepEqual([none.body.plausible, none.body.possible], [[], []]);
    const noMatchState = interpretMatchResponse(none);
    assert.equal(noMatchState.state, 'NO_PLAUSIBLE_MATCH');
    assert.equal(noMatchState.tone, 'info');
    assert.deepEqual([noMatchState.canRetry, noMatchState.offerDirect], [false, true]);

    await withMatchingDown(store, async () => {
      const failed = await request(app).post('/api/gpme/match').send(NO_MATCH);
      assert.equal(failed.status, 503);
      assert.equal(failed.body.status, 'UNABLE_TO_MATCH');
      for (const key of ['plausible', 'possible', 'notCheckedForNeedCount']) {
        assert.ok(!(key in failed.body), `a failure must not carry ${key}`);
      }
      const failedState = interpretMatchResponse(failed);
      assert.equal(failedState.state, 'UNABLE_TO_MATCH');
      assert.equal(failedState.tone, 'error');
      assert.deepEqual([failedState.canRetry, failedState.offerDirect], [true, true]);
      assert.notEqual(failedState.message, noMatchState.message);
      assert.doesNotMatch(failedState.message, /no plausible match/i);
      assert.doesNotMatch(noMatchState.message, /unable|technical|try again/i);
    });
  });

  test('a need no current Program serves is still a legitimate no-match, not a failure', async () => {
    const { app } = build();
    const res = await request(app).post('/api/gpme/match').send({ needCategoryIds: [5], ageRange: { min: 30, max: 35 } });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'NO_PLAUSIBLE_MATCH');
  });

  test('invalid input is a third state: neither a result nor a technical failure', async () => {
    const { app } = build();
    const res = await request(app).post('/api/gpme/match').send({});
    assert.equal(res.status, 400);
    const state = interpretMatchResponse(res);
    assert.equal(state.state, 'INVALID');
    assert.notEqual(state.message, GUIDED_MESSAGES.NO_PLAUSIBLE_MATCH);
    assert.notEqual(state.message, GUIDED_MESSAGES.UNABLE_TO_MATCH);
  });

  test('a failure is not sticky, and a legitimate no-match after it is still a no-match', async () => {
    const { app, store } = build();
    await withMatchingDown(store, async () => {
      assert.equal((await request(app).post('/api/gpme/match').send(A_MATCH)).status, 503);
      assert.equal((await request(app).post('/api/gpme/match').send(NO_MATCH)).status, 503);
    });
    // Recovered: results come back, and a real no-match is a no-match.
    assert.equal((await request(app).post('/api/gpme/match').send(A_MATCH)).body.status, 'RESULTS');
    const none = await request(app).post('/api/gpme/match').send(NO_MATCH);
    assert.equal(none.status, 200);
    assert.equal(none.body.status, 'NO_PLAUSIBLE_MATCH');
  });

  test('the two steps never borrow each other\'s wording', () => {
    const noMatchWords = [GUIDED_MESSAGES.NO_PLAUSIBLE_MATCH, DESCRIBE_MESSAGES.NOTHING_UNDERSTOOD];
    const failureWords = [GUIDED_MESSAGES.UNABLE_TO_MATCH, DESCRIBE_MESSAGES.UNABLE, GUIDED_MESSAGES.GPME_UNAVAILABLE];
    for (const words of noMatchWords) assert.doesNotMatch(words, /technical problem|unable to|could not/i);
    for (const words of failureWords) assert.doesNotMatch(words, /no plausible match|nothing was filled in|did not point to/i);
  });
});
