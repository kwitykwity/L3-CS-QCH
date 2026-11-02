// Task 228: Reporting-specific invalid-request wording. All data is SYNTHETIC.
//
// Optional P1 hardening, not a Handoff PRD requirement and not a freeze
// blocker. Reporting used to reuse the referral error, so a bad report
// period or date answered "The referral is not valid." Reporting now says
// "The report request is not valid." with everything else unchanged:
// HTTP 400, code INVALID_REQUEST, the same `fields` list, and no echo of
// the invalid input. Referral validation keeps its referral wording.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';

const REPORT_MESSAGE = 'The report request is not valid.';
const REFERRAL_MESSAGE = 'The referral is not valid.';
const NOW = '2026-10-18T16:00:00.000Z'; // Oct 18, 2026 12:00 EDT

function build() {
  return createMemoryReferralStore({
    departments: [{ departmentId: 1, name: 'Synthetic Dept A', lifecycleStatus: 'ACTIVE' }],
    programs: [
      { programId: 10, departmentId: 1, name: 'Program Ten', site: null, lifecycleStatus: 'ACTIVE' },
      { programId: 11, departmentId: 1, name: 'Program Eleven', site: null, lifecycleStatus: 'ACTIVE' },
    ],
    users: [{ userId: 100, isActive: true, currentProgramId: 10 }],
    grants: [],
  }, { now: () => new Date(NOW) });
}

const appFor = (store) => createApp({
  referralStore: store,
  affiliationStore: store,
  resolveIdentity: () => ({ userId: 100 }),
  now: () => new Date(NOW),
});

const REPORTS = ['total-referrals', 'timing-metrics', 'referral-activity'];

// [query, expected fields]. The marker strings let us prove no input is echoed.
const INVALID = [
  [{}, ['period']],
  [{ period: 'DAILY_ECHO_MARKER' }, ['period']],
  [{ period: 'YEARLY', date: '2026-02-30' }, ['date']],
  [{ period: 'YEARLY', date: 'not-a-date-ECHO_MARKER' }, ['date']],
  [{ period: 'MONTHLY', date: '2026-10-19' }, ['date']],   // tomorrow in New York
  [{ period: 'MONTHLY', date: '1999-12-31' }, ['date']],   // before reporting starts
  [{ period: 'YEARLY', programId: 'abc' }, ['programId']],
  [{ period: 'YEARLY', programId: '999' }, ['programId']], // unknown Program
  [{ period: 'YEARLY', departmentId: '999' }, ['departmentId']],
  [{ period: 'YEARLY', programId: '10', departmentId: '1' }, ['programId', 'departmentId']],
];

describe('Reporting invalid requests use Reporting wording (Task 228)', () => {
  for (const report of REPORTS) {
    test(`${report}: invalid period gets Reporting wording, same status and code`, async () => {
      const res = await request(appFor(build())).get(`/api/reports/${report}`).query({ period: 'DAILY' });
      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'INVALID_REQUEST');
      assert.deepEqual(res.body.fields, ['period']);
      assert.equal(res.body.error, REPORT_MESSAGE);
    });

    test(`${report}: invalid date gets Reporting wording, same status and code`, async () => {
      for (const date of ['2026-02-30', '10/18/2026', '2026-10-19']) {
        const res = await request(appFor(build())).get(`/api/reports/${report}`).query({ period: 'YEARLY', date });
        assert.equal(res.status, 400, date);
        assert.equal(res.body.code, 'INVALID_REQUEST', date);
        assert.deepEqual(res.body.fields, ['date'], date);
        assert.equal(res.body.error, REPORT_MESSAGE, date);
      }
    });

    test(`${report}: every invalid query keeps its fields and never echoes input`, async () => {
      const app = appFor(build());
      for (const [query, fields] of INVALID) {
        const label = `${report} ${JSON.stringify(query)}`;
        const res = await request(app).get(`/api/reports/${report}`).query(query);
        assert.equal(res.status, 400, label);
        assert.deepEqual(Object.keys(res.body).sort(), ['code', 'error', 'fields'], label);
        assert.equal(res.body.code, 'INVALID_REQUEST', label);
        assert.deepEqual(res.body.fields, fields, label);
        assert.equal(res.body.error, REPORT_MESSAGE, label);
        assert.doesNotMatch(res.text, /ECHO_MARKER|referral is not valid/i, label);
        assert.equal(res.headers['cache-control'], 'no-store', label);
      }
    });
  }

  test('an unknown query parameter is still UNEXPECTED_FIELD, unchanged', async () => {
    const res = await request(appFor(build())).get('/api/reports/total-referrals').query({ period: 'YEARLY', userId: '100' });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'UNEXPECTED_FIELD');
    assert.equal(res.body.error, 'The request contains a field that is not allowed.');
  });

  test('valid Reporting requests still answer 200 with aggregate results', async () => {
    const app = appFor(build());
    const total = await request(app).get('/api/reports/total-referrals').query({ period: 'MONTHLY', date: '2026-10-18' });
    assert.equal(total.status, 200);
    assert.equal(total.body.metric, 'TOTAL_REFERRALS');
    assert.equal(total.body.value, 0);
    assert.equal(total.body.period.label !== undefined, true);
    assert.equal(total.body.error, undefined);

    for (const report of ['timing-metrics', 'referral-activity']) {
      const res = await request(app).get(`/api/reports/${report}`).query({ period: 'MONTHLY' });
      assert.equal(res.status, 200, report);
      assert.equal(res.body.error, undefined, report);
    }
  });
});

describe('Referral validation keeps referral wording (Task 228)', () => {
  test('an invalid referral still answers "The referral is not valid."', async () => {
    const res = await request(appFor(build())).post('/api/referrals').send({
      submissionId: 'not-a-uuid',
      receivingProgramId: 11,
      participantName: 'Synthetic Person',
      contactMethod: 'PHONE_CALL',
      contactValue: '555-010-0147',
      referralContext: 'Synthetic need',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'INVALID_REQUEST');
    assert.equal(res.body.error, REFERRAL_MESSAGE);
    assert.ok(Array.isArray(res.body.fields) && res.body.fields.length > 0);
  });
});
