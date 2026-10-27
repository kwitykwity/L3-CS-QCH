// Trello Task S: the demo environment is repeatable and its reset is safe
// (Final Technical PRD 16.2, 16.4, 17.4).
//
// The demo runs on the synthetic dev server, whose data lives only in
// memory. Resetting the demo means stopping the server and starting it
// again. These tests prove that:
//   - every fresh start shows the same synthetic starting state, and
//   - a restart undoes everything a demo run changed.
// The guards that stop the reset path from running outside development
// already have tests in test/securityPass.test.js ("the synthetic dev
// server refuses every environment except development", "the production
// server starts with no sign-in fallback").
//
// SYNTHETIC data only. See docs/demo-environment.md.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Starts the synthetic dev server on a free-ish port; resolves once it listens.
async function startDemo() {
  const port = String(35000 + Math.floor(Math.random() * 400));
  const child = spawn(process.execPath, ['scripts/dev-synthetic-server.js'], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, NODE_ENV: 'development', PORT: port, DOTENV_CONFIG_PATH: '/nonexistent' },
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('demo server did not start')), 10000);
    child.stdout.on('data', (d) => { if (String(d).includes('SYNTHETIC DATA ONLY')) { clearTimeout(timer); resolve(); } });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`demo server exited ${code}`)); });
  });
  return { child, base: `http://127.0.0.1:${port}` };
}

async function stopDemo({ child }) {
  if (child.exitCode !== null) return;
  await new Promise((resolve) => { child.once('exit', resolve); child.kill(); });
}

const json = async (res) => { assert.ok(res.ok, `${res.url} -> ${res.status}`); return res.json(); };
const send = (base, method, url, body) => fetch(`${base}${url}`, {
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

// Everything a demo viewer could see, as the synthetic user. Version
// tokens and timestamps are left out: they are new on every write.
async function snapshot(base) {
  const strip = (value) => JSON.parse(JSON.stringify(value, (key, v) => (
    ['version', 'createdAt', 'updatedAt', 'asOf'].includes(key) ? undefined : v)));
  const paths = [
    '/api/me/affiliation', '/api/programs', '/api/gpme/need-categories',
    '/api/referrals/sent', '/api/referrals/received?programId=4',
    '/api/program-management/programs/3', '/api/program-management/programs/3/matching-facts',
    '/api/reports/referral-activity?period=MONTHLY',
  ];
  const out = {};
  for (const p of paths) out[p] = strip(await json(await fetch(`${base}${p}`)));
  return out;
}

// What a demo run changes: affiliation, a referral, the response, the
// outcome, and a Program Management edit.
async function runDemoChanges(base) {
  const affiliation = await json(await fetch(`${base}/api/me/affiliation`));
  await json(await send(base, 'PUT', '/api/me/affiliation', { programId: 1, version: affiliation.version }));
  const created = await json(await send(base, 'POST', '/api/referrals', {
    submissionId: randomUUID(), receivingProgramId: 4, participantName: 'Synthetic Demo Participant',
    contactMethod: 'NOT_AVAILABLE', referralContext: 'Synthetic need for the reset check',
  }));
  const id = created.referral.referralId;
  await json(await send(base, 'POST', `/api/referrals/${id}/response`, { decision: 'ACCEPTED' }));
  await json(await send(base, 'POST', `/api/referrals/${id}/outcome`, { outcome: 'RESULTED_IN_SERVICE' }));
  const { program } = await json(await fetch(`${base}/api/program-management/programs/3`));
  await json(await send(base, 'PATCH', '/api/program-management/programs/3', {
    version: program.version, scheduleNotes: 'Synthetic change made during a demo',
  }));
}

describe('Task S demo environment', () => {
  test('every fresh start shows the same synthetic state, and a restart undoes a demo run', async () => {
    const first = await startDemo();
    let start;
    try {
      start = await snapshot(first.base);
      // The demo starts clean: no affiliation chosen and no referrals.
      assert.equal(start['/api/me/affiliation'].status, 'NOT_SET');
      assert.deepEqual(start['/api/referrals/sent'].referrals, []);
      assert.equal(start['/api/reports/referral-activity?period=MONTHLY'].summary.totalReferrals, 0);

      await runDemoChanges(first.base);
      const changed = await snapshot(first.base);
      assert.notDeepEqual(changed, start, 'the demo run changed what a viewer sees');
      assert.equal(changed['/api/reports/referral-activity?period=MONTHLY'].summary.resultedInService, 1);
    } finally {
      await stopDemo(first);
    }

    // Reset: start again. Nothing from the demo run survives.
    const second = await startDemo();
    try {
      assert.deepEqual(await snapshot(second.base), start);
    } finally {
      await stopDemo(second);
    }
  });

  test('the sample Programs can show every matching result a demo needs', async () => {
    const demo = await startDemo();
    try {
      const match = async (body) => json(await send(demo.base, 'POST', '/api/gpme/match', body));
      const names = (list) => list.map((p) => p.name);

      const strong = await match({ needCategoryIds: [2], ageRange: { min: 30, max: 35 } });
      assert.deepEqual(names(strong.plausible), ['Adult Evening Classes (sample)']);

      const possible = await match({ needCategoryIds: [4] });
      assert.deepEqual(names(possible.possible), ['Housing Help Desk (sample)']);

      const both = await match({ needCategoryIds: [3], ageRange: { min: 20, max: 25 } });
      assert.ok(both.plausible.length > 0 && both.possible.length > 0, 'strong and possible together');

      assert.equal((await match({ needCategoryIds: [1], ageRange: { min: 30, max: 35 } })).status, 'NO_PLAUSIBLE_MATCH');

      const inArea = await match({ needCategoryIds: [2], ageRange: { min: 8, max: 10 }, participantZip: '99901' });
      const outOfArea = await match({ needCategoryIds: [2], ageRange: { min: 8, max: 10 }, participantZip: '11375' });
      assert.deepEqual(names(inArea.plausible), ['After-School Homework Club (sample)']);
      assert.equal(outOfArea.status, 'NO_PLAUSIBLE_MATCH');
    } finally {
      await stopDemo(demo);
    }
  });
});
