// Direct Referral UI (Trello card 5): logic modules, client/server parity,
// page structure, and the local synthetic dev server's safety guard.
// All data is SYNTHETIC.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { validateDirectReferral } from '../src/referrals/validateReferral.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
import {
  firstInvalidField, toRequestBody, validateReferralForm,
} from '../public/referral/validation.js';
import {
  MESSAGES, interpretCheckResponse, interpretSubmitResponse, sendingState,
} from '../public/referral/submission.js';
import { DEFAULT_SIZE, SIZES, loadSize, normalizeSize, saveSize } from '../public/referral/textSize.js';
import { syntheticSeed, DEV_USER_ID } from '../scripts/syntheticSeed.js';

const UI_DIR = new URL('../public/referral/', import.meta.url);
const read = (name) => readFileSync(new URL(name, UI_DIR), 'utf8');

const validForm = (overrides = {}) => ({
  participantName: 'Synthetic Person Alpha',
  contactMethod: 'PHONE_CALL',
  contactValue: '(555) 010-0147',
  participantZip: '11375',
  referralContext: 'Synthetic context: needs evening classes',
  notes: '',
  ...overrides,
});

describe('client validation', () => {
  test('a complete form has no errors', () => {
    assert.deepEqual(validateReferralForm(validForm()), {});
  });

  test('required fields are reported, in on-screen order', () => {
    const errors = validateReferralForm(validForm({ participantName: ' ', contactMethod: '', referralContext: '' }));
    assert.deepEqual(Object.keys(errors).sort(), ['contactMethod', 'participantName', 'referralContext']);
    assert.equal(firstInvalidField(errors), 'participantName');
  });

  test('the first invalid field follows the form order', () => {
    assert.equal(firstInvalidField(validateReferralForm(validForm({ participantZip: '12', notes: 'x'.repeat(4001) }))), 'participantZip');
  });

  test('contact value depends on the contact method', () => {
    assert.ok(validateReferralForm(validForm({ contactValue: '' })).contactValue);
    assert.ok(validateReferralForm(validForm({ contactMethod: 'EMAIL', contactValue: 'nope' })).contactValue);
    assert.deepEqual(validateReferralForm(validForm({ contactMethod: 'EMAIL', contactValue: 'synthetic@example.test' })), {});
    // Hidden field with NOT_AVAILABLE: nothing for the worker to fix.
    assert.deepEqual(validateReferralForm(validForm({ contactMethod: 'NOT_AVAILABLE', contactValue: 'leftover' })), {});
  });

  test('ZIP and notes are optional', () => {
    assert.deepEqual(validateReferralForm(validForm({ participantZip: '', notes: '' })), {});
  });

  test('error messages never repeat what the worker typed', () => {
    const errors = validateReferralForm(validForm({ contactValue: 'SECRET-X', participantZip: 'SECRET' }));
    assert.ok(!JSON.stringify(errors).includes('SECRET'));
  });

  test('the request body has only allowlisted fields and no Referring Program (PRD 3.9)', () => {
    const body = toRequestBody(validForm({ notes: '  ', participantZip: '' }), { submissionId: 'id-1', receivingProgramId: 3 });
    assert.deepEqual(Object.keys(body).sort(), [
      'contactMethod', 'contactValue', 'notes', 'participantName', 'participantZip',
      'receivingProgramId', 'referralContext', 'submissionId',
    ]);
    assert.equal(body.notes, null);
    assert.equal(body.participantZip, null);
  });

  test('NOT_AVAILABLE always sends a null contact value', () => {
    const body = toRequestBody(validForm({ contactMethod: 'NOT_AVAILABLE', contactValue: 'leftover' }), { submissionId: 'x', receivingProgramId: 1 });
    assert.equal(body.contactValue, null);
  });
});

describe('client and server validation agree', () => {
  const cases = [
    validForm(),
    validForm({ participantName: '' }),
    validForm({ participantName: 'a'.repeat(201) }),
    validForm({ participantName: 'two\nlines' }),
    validForm({ contactMethod: '' }),
    validForm({ contactMethod: 'FAX' }),
    validForm({ contactValue: '' }),
    validForm({ contactValue: '12-34' }),
    validForm({ contactValue: 'call me' }),
    validForm({ contactMethod: 'EMAIL', contactValue: 'synthetic@example.test' }),
    validForm({ contactMethod: 'EMAIL', contactValue: 'no-at-sign' }),
    validForm({ contactMethod: 'PHONE_TEXT', contactValue: '+1 555 010 0148' }),
    validForm({ contactMethod: 'NOT_AVAILABLE', contactValue: '' }),
    validForm({ participantZip: '1137' }),
    validForm({ participantZip: '11375-1234' }),
    validForm({ participantZip: '' }),
    validForm({ referralContext: '' }),
    validForm({ referralContext: 'x'.repeat(4001) }),
    validForm({ referralContext: 'bad\u0000value' }),
    validForm({ notes: 'x'.repeat(4001) }),
    validForm({ notes: 'Synthetic note' }),
  ];

  cases.forEach((values, i) => {
    test(`case ${i + 1}: same fields flagged on both sides`, () => {
      const clientFields = Object.keys(validateReferralForm(values)).sort();
      const contactMethodKnown = ['PHONE_CALL', 'PHONE_TEXT', 'EMAIL', 'NOT_AVAILABLE'].includes(values.contactMethod);
      // The client only builds a body for known contact methods; for unknown
      // ones send the raw value so the server sees the same input.
      const body = contactMethodKnown
        ? toRequestBody(values, { submissionId: randomUUID(), receivingProgramId: 1 })
        : { ...toRequestBody({ ...values, contactMethod: 'PHONE_CALL' }, { submissionId: randomUUID(), receivingProgramId: 1 }), contactMethod: values.contactMethod || undefined };
      const server = validateDirectReferral(body);
      const serverFields = server.ok ? [] : [...server.fields].sort();
      assert.deepEqual(clientFields, serverFields);
    });
  });
});

describe('submission and recovery states (PRD 7.1 to 7.5)', () => {
  test('locked copy is exact, including the space before "!"', () => {
    assert.equal(MESSAGES.SENDING, 'Sending referral ...');
    assert.equal(MESSAGES.RECEIVED, 'Referral received !');
    assert.equal(MESSAGES.NOT_CONFIRMED, 'Referral not confirmed !');
    assert.equal(MESSAGES.ALREADY_RECEIVED, 'Referral already received. Do not resend !');
    assert.equal(MESSAGES.NOT_RECEIVED, 'Referral was not received. Your information has been preserved. You may safely resend !');
  });

  test('sending locks the form and the button', () => {
    const s = sendingState();
    assert.equal(s.message, 'Sending referral ...');
    assert.equal(s.canResend, false);
    assert.equal(s.formLocked, true);
  });

  test('success only after the server confirms (201 RECEIVED)', () => {
    const r = interpretSubmitResponse({ status: 201, body: { status: 'RECEIVED', referral: { referralId: 7 } } });
    assert.equal(r.message, 'Referral received !');
    assert.equal(r.referral.referralId, 7);
  });

  test('a 2xx without a confirmed referral is NOT treated as success', () => {
    assert.equal(interpretSubmitResponse({ status: 200, body: null }).state, 'NOT_CONFIRMED');
    assert.equal(interpretSubmitResponse({ status: 201, body: {} }).state, 'NOT_CONFIRMED');
  });

  test('a retry the server already has → "Referral already received. Do not resend !"', () => {
    const r = interpretSubmitResponse({ status: 200, body: { status: 'ALREADY_RECEIVED', referral: { referralId: 7 } } });
    assert.equal(r.message, MESSAGES.ALREADY_RECEIVED);
    assert.equal(r.canResend, false);
  });

  for (const [label, response] of [
    ['network failure', { networkError: true }],
    ['server error', { status: 500, body: { error: 'Internal Server Error' } }],
    ['service unavailable', { status: 503, body: { code: 'NOT_CONFIGURED' } }],
    ['unexpected response', { status: 418, body: null }],
  ]) {
    test(`${label} → "Referral not confirmed !", locked, then safe check`, () => {
      const r = interpretSubmitResponse(response);
      assert.equal(r.message, MESSAGES.NOT_CONFIRMED);
      assert.equal(r.canResend, false, 'no resend while the outcome is unknown');
      assert.equal(r.formLocked, true);
      assert.equal(r.keepInput, true);
      assert.equal(r.needsCheck, true);
    });
  }

  test('safe check finds it → already received', () => {
    const r = interpretCheckResponse({ status: 200, body: { status: 'RECEIVED', referral: { referralId: 9 } } });
    assert.equal(r.message, MESSAGES.ALREADY_RECEIVED);
  });

  test('safe check does not find it → preserved, safe to resend', () => {
    const r = interpretCheckResponse({ status: 200, body: { status: 'NOT_RECEIVED', referral: null } });
    assert.equal(r.message, MESSAGES.NOT_RECEIVED);
    assert.equal(r.canResend, true);
    assert.equal(r.keepInput, true);
    assert.equal(r.formLocked, false);
  });

  test('safe check fails → still not confirmed, offer to check again, no resend', () => {
    const r = interpretCheckResponse({ networkError: true });
    assert.equal(r.message, MESSAGES.NOT_CONFIRMED);
    assert.equal(r.next, 'CHECK_AGAIN');
    assert.equal(r.canResend, false);
    assert.equal(r.needsCheck, false, 'no automatic loop');
  });

  test('validation errors keep input and return field names', () => {
    const r = interpretSubmitResponse({ status: 400, body: { code: 'INVALID_REQUEST', fields: ['participantZip'] } });
    assert.deepEqual(r.fieldErrors, ['participantZip']);
    assert.equal(r.keepInput, true);
    assert.equal(r.canResend, true);
  });

  test('missing affiliation sends the worker to choose one, keeping input', () => {
    const r = interpretSubmitResponse({ status: 409, body: { code: 'AFFILIATION_REQUIRED', error: 'Choose your Program affiliation first.' } });
    assert.equal(r.next, 'CHOOSE_AFFILIATION');
    assert.equal(r.keepInput, true);
  });

  test('an unavailable receiving Program sends the worker back to choose, keeping input', () => {
    const r = interpretSubmitResponse({ status: 422, body: { code: 'RECEIVING_PROGRAM_NOT_SELECTABLE', error: 'x' } });
    assert.equal(r.next, 'CHOOSE_PROGRAM');
    assert.equal(r.keepInput, true);
  });

  test('a Submission ID conflict starts a new submission ID', () => {
    const r = interpretSubmitResponse({ status: 409, body: { code: 'SUBMISSION_ID_CONFLICT' } });
    assert.equal(r.newSubmissionId, true);
    assert.equal(r.keepInput, true);
  });

  test('signed-out keeps input', () => {
    assert.equal(interpretSubmitResponse({ status: 401, body: {} }).keepInput, true);
  });
});

describe('text size preference (PRD 14.5)', () => {
  const memoryStorage = () => {
    const data = new Map();
    return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  };

  test('S/M/L/XL map to 12/14/18/24 px; default M', () => {
    assert.deepEqual(SIZES, { S: 12, M: 14, L: 18, XL: 24 });
    assert.equal(DEFAULT_SIZE, 'M');
  });

  test('a saved size is restored', () => {
    const s = memoryStorage();
    saveSize(s, 'XL');
    assert.equal(loadSize(s), 'XL');
  });

  test('unknown or missing values fall back to M', () => {
    assert.equal(normalizeSize('HUGE'), 'M');
    assert.equal(loadSize(memoryStorage()), 'M');
    assert.equal(loadSize(null), 'M');
  });

  test('blocked storage never breaks the page', () => {
    const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    assert.equal(loadSize(throwing), 'M');
    assert.doesNotThrow(() => saveSize(throwing, 'L'));
  });
});

describe('page structure, accessibility and privacy', () => {
  const html = read('index.html');
  // Code only: comments that explain what NOT to use must not trip the scan.
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  const scripts = readdirSync(UI_DIR).filter((f) => f.endsWith('.js')).map((f) => [f, stripComments(read(f))]);

  test('shows "Fields marked * are required."', () => {
    assert.match(html, /Fields marked <span aria-hidden="true">\*<\/span> are required\./);
  });

  test('every input, select and textarea has a persistent label', () => {
    const ids = [...html.matchAll(/<(input|select|textarea)\b[^>]*\bid="([^"]+)"/g)].map((m) => m[2]);
    assert.ok(ids.length >= 7);
    for (const id of ids) assert.match(html, new RegExp(`<label for="${id}"`), `label for #${id}`);
  });

  test('required fields are marked for assistive technology', () => {
    for (const id of ['participantName', 'referralContext', 'affiliation-select']) {
      assert.match(html, new RegExp(`id="${id}"[^>]*aria-required="true"`), id);
    }
  });

  test('status messages are announced (role=status, aria-live)', () => {
    assert.match(html, /id="status"[^>]*role="status"[^>]*aria-live="polite"/);
  });

  test('every field has an error element linked by aria-describedby', () => {
    for (const id of ['participantName', 'contactValue', 'participantZip', 'referralContext', 'notes']) {
      assert.match(html, new RegExp(`id="${id}"[^>]*aria-describedby="[^"]*${id}-error`), id);
      assert.match(html, new RegExp(`id="${id}-error"`), `${id}-error`);
    }
  });

  test('no DOB, SSN or address fields (PRD 5.2)', () => {
    assert.doesNotMatch(html, /birth|dob|ssn|social security|address line|street/i);
  });

  test('scripts never use innerHTML, console, sessionStorage or IndexedDB', () => {
    for (const [name, src] of scripts) {
      for (const banned of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'console.', 'sessionStorage', 'indexedDB', 'document.cookie']) {
        assert.ok(!src.includes(banned), `${name} must not use ${banned}`);
      }
    }
  });

  test('localStorage is used only for the text-size preference', () => {
    for (const [name, src] of scripts) {
      const uses = src.match(/localStorage/g) ?? [];
      if (name === 'app.js') assert.equal(uses.length, 1, 'app.js passes localStorage to textSize only');
      else assert.equal(uses.length, 0, `${name} must not use localStorage`);
    }
  });

  test('participant data is never placed in a URL (PRD 5.5)', () => {
    const api = read('api.js');
    const urls = [...api.matchAll(/'\/api[^']*'|`\/api[^`]*`/g)].map((m) => m[0]);
    for (const url of urls) {
      assert.doesNotMatch(url, /participant|contact|context|notes|zip|name/i, url);
    }
  });

  test('the page and its scripts are served', async () => {
    const app = createApp();
    const page = await request(app).get('/referral/');
    assert.equal(page.status, 200);
    assert.match(page.text, /Direct Referral/);
    for (const file of ['app.js', 'api.js', 'validation.js', 'submission.js', 'textSize.js', 'referral.css']) {
      const res = await request(app).get(`/referral/${file}`);
      assert.equal(res.status, 200, file);
    }
  });
});

describe('local synthetic dev server', () => {
  const run = (nodeEnv) => spawnSync(process.execPath, ['scripts/dev-synthetic-server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { PATH: process.env.PATH, NODE_ENV: nodeEnv, PORT: '3999', DOTENV_CONFIG_PATH: '/nonexistent' },
    timeout: 5000,
    encoding: 'utf8',
  });

  for (const nodeEnv of ['production', 'test']) {
    test(`refuses to start when NODE_ENV=${nodeEnv}`, () => {
      const result = run(nodeEnv);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Refusing to start/);
    });
  }

  test('synthetic seed works end to end through the real API', async () => {
    const store = createMemoryReferralStore(syntheticSeed());
    const app = createApp({ affiliationStore: store, referralStore: store, resolveIdentity: () => ({ userId: DEV_USER_ID }) });

    const before = await request(app).post('/api/referrals')
      .send(toRequestBody(validForm(), { submissionId: randomUUID(), receivingProgramId: 3 }));
    assert.equal(before.body.code, 'AFFILIATION_REQUIRED', 'first use requires choosing an affiliation');

    const { body: current } = await request(app).get('/api/me/affiliation');
    await request(app).put('/api/me/affiliation').send({ programId: 1, version: current.version }).expect(200);
    const sent = await request(app).post('/api/referrals')
      .send(toRequestBody(validForm(), { submissionId: randomUUID(), receivingProgramId: 3 }));
    assert.equal(sent.status, 201);
    assert.equal(sent.body.status, 'RECEIVED');
  });
});
