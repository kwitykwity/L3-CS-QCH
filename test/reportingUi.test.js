// Reporting Center UI (Task B). Checks the page is served, follows the
// project's privacy and accessibility rules, and shows server values
// faithfully. The numbers themselves are tested in referralActivity.test.js
// and timingMetrics.test.js; the UI must never recalculate them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import supertest from 'supertest';
import { createApp } from '../src/app.js';
import {
  countView, formatAsOf, formatCount, formatDuration, formatRate, formatTiming,
} from '../public/reporting/format.js';

const read = (p) => readFile(new URL(`../public/reporting/${p}`, import.meta.url), 'utf8');

test('the Reporting Center page is served with the backend period values', async () => {
  const res = await supertest(createApp()).get('/reporting/').expect(200);
  assert.match(res.text, /<title>QCH Connect - Reporting Center<\/title>/);
  assert.match(res.text, /<h1>Reporting Center<\/h1>/);
  for (const period of ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']) {
    assert.match(res.text, new RegExp(`<option value="${period}"`));
  }
  assert.doesNotMatch(res.text, /CUSTOM|THIS_MONTH|LAST_MONTH/);
});

test('the page has the text-size control, labelled controls, and accessible tables', async () => {
  const html = await read('index.html');
  for (const size of ['S', 'M', 'L', 'XL']) assert.match(html, new RegExp(`data-size="${size}"`));
  assert.equal((html.match(/<caption>/g) ?? []).length, 2);
  assert.ok((html.match(/scope="col"/g) ?? []).length >= 18);
  for (const id of ['period', 'date', 'scope-type', 'scope-target']) {
    assert.match(html, new RegExp(`<label[^>]*for="${id}"`));
  }
  assert.match(html, /role="alert"/);
  assert.match(html, /role="status"/);
  assert.match(html, /class="skip-link"/);
  assert.doesNotMatch(html, /\sstyle=/, 'no inline styles');
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)/, 'no inline scripts');
});

test('every Reporting Center asset is served', async () => {
  const client = supertest(createApp());
  for (const path of ['app.js', 'api.js', 'format.js', 'reporting.css']) {
    await client.get(`/reporting/${path}`).expect(200);
  }
});

test('the home page links to the Reporting Center', async () => {
  const res = await supertest(createApp()).get('/').expect(200);
  assert.match(res.text, /href="\/reporting\/"/);
});

test('the script reads the three reporting endpoints and nothing else is written', async () => {
  const api = await read('api.js');
  for (const path of ['/api/reports/referral-activity', '/api/reports/total-referrals', '/api/reports/timing-metrics']) {
    assert.ok(api.includes(path), `uses ${path}`);
  }
  assert.doesNotMatch(api, /method:\s*'(POST|PUT|PATCH|DELETE)'/);
});

test('the script keeps the privacy and safety rules (PRD 5.5, 14.6, 15.3)', async () => {
  for (const file of ['app.js', 'api.js', 'format.js']) {
    const src = await read(file);
    assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/, `${file}: no HTML injection`);
    assert.doesNotMatch(src, /console\./, `${file}: no console output`);
    assert.doesNotMatch(src, /sessionStorage|indexedDB/, `${file}: no browser storage`);
    assert.doesNotMatch(
      src,
      /participantName|participantZip|contactValue|contactMethod|referralContext|referralId|submissionId/,
      `${file}: no participant fields`,
    );
  }
});

test('the script does not recalculate report numbers (PRD 12.5)', async () => {
  for (const file of ['app.js', 'api.js']) {
    const src = await read(file);
    assert.doesNotMatch(src, /toFixed|\.reduce\(|\*\s*100|Math\./, `${file}: no frontend math`);
  }
  const format = await read('format.js');
  assert.doesNotMatch(format, /toFixed|\.reduce\(|\*\s*100|numerator\s*\//, 'format.js: no rate math');
});

test('counts: a real zero is shown as 0, a missing value as Unknown', () => {
  assert.equal(formatCount(0), '0');
  assert.deepEqual(countView(0), { label: '0' });
  assert.equal(formatCount(undefined), 'Unknown');
  assert.equal(formatCount(-1), 'Unknown');
  assert.deepEqual(countView(null), { label: 'Unknown', badge: 'Unknown', kind: 'unknown' });
});

test('rates: calculated, pending, no data and unknown stay different', () => {
  const calculated = formatRate({ numerator: 2, denominator: 3, value: 66.67, state: 'CALCULATED' });
  assert.equal(calculated.label, '66.67%');
  assert.equal(calculated.detail, '2 of 3');
  assert.equal(calculated.kind, 'calculated');

  const zero = formatRate({ numerator: 0, denominator: 4, value: 0, state: 'CALCULATED' });
  assert.equal(zero.label, '0%');
  assert.equal(zero.detail, '0 of 4');

  const pending = formatRate({ numerator: 0, denominator: 0, value: null, state: 'PENDING' });
  assert.equal(pending.label, 'Pending');
  assert.equal(pending.kind, 'pending');

  const noData = formatRate({ numerator: 0, denominator: 0, value: null, state: 'NO_DATA' });
  assert.equal(noData.label, 'No data');
  assert.equal(noData.kind, 'no-data');

  for (const bad of [undefined, null, {}, { state: 'WHATEVER' }, { state: 'CALCULATED', value: null }]) {
    assert.equal(formatRate(bad).label, 'Unknown');
    assert.equal(formatRate(bad).kind, 'unknown');
  }
  const labels = new Set([calculated, zero, pending, noData].map((v) => v.label));
  assert.equal(labels.size, 4);
});

test('timing: durations are words for the exact milliseconds the server sent', () => {
  assert.equal(formatDuration(5_400_000), '1 h 30 min');
  assert.equal(formatDuration(3_600_000), '1 h');
  assert.equal(formatDuration(1_800_000), '30 min');
  assert.equal(formatDuration(20_000), 'Under 1 minute');
  assert.equal(formatDuration(93_600_000), '1 d 2 h');
  assert.equal(formatDuration(-1), 'Unknown');
  assert.equal(formatDuration(null), 'Unknown');

  const ok = formatTiming({ status: 'OK', qualifyingCount: 3, pendingCount: 0, averageMs: 7_200_000, medianMs: 3_600_000 }, 'averageMs');
  assert.equal(ok.label, '2 h');
  assert.equal(ok.detail, 'From 3 referrals');
  assert.equal(formatTiming({ status: 'OK', qualifyingCount: 1, pendingCount: 0, averageMs: 60_000, medianMs: 60_000 }, 'medianMs').detail, 'From 1 referral');

  const na = formatTiming({ status: 'N/A', qualifyingCount: 0, pendingCount: 2, averageMs: null, medianMs: null }, 'averageMs');
  assert.equal(na.label, 'N/A');
  assert.equal(na.detail, 'No completed referrals yet. 2 still pending.');
  assert.equal(formatTiming({ status: 'N/A', qualifyingCount: 0, pendingCount: 0 }, 'medianMs').detail, 'No referrals qualify in this period and scope.');
  assert.equal(formatTiming(undefined, 'averageMs').label, 'Unknown');
});

test('data-as-of is shown in the QCH time zone', () => {
  const text = formatAsOf('2026-10-20T16:00:00.000Z');
  assert.match(text, /Oct 20, 2026/);
  assert.match(text, /ET$/);
  assert.equal(formatAsOf('not a date'), 'Unknown');
  assert.equal(formatAsOf(undefined), 'Unknown');
});
