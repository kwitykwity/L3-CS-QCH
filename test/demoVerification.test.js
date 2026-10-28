// Trello Task FF: demo data and reset verification (Final Technical PRD
// 15.5, 16.1, 16.2, 16.4, 17.4).
//
// test/demoEnvironment.test.js already proves the plain starting state and
// that a restart undoes a basic run. This file covers what that one does not:
//   - a fuller demo journey (corrections, a failed notification, reporting)
//     gives the same result on every fresh start;
//   - the completed Program-information fields and languages of service
//     reset to the same state, in both demo modes (one fixed person, and
//     demo sign-in);
//   - the repository holds no real QCH data and the demo identities are
//     clearly marked as demo data.
//
// SYNTHETIC data only. See docs/demo-environment.md.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { syntheticSeed } from '../scripts/syntheticSeed.js';
import { DEMO_PERSONAS } from '../scripts/demoPersonas.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

async function startDemo(extraEnv = {}) {
  const port = String(35400 + Math.floor(Math.random() * 400));
  const child = spawn(process.execPath, ['scripts/dev-synthetic-server.js'], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, NODE_ENV: 'development', PORT: port, DOTENV_CONFIG_PATH: '/nonexistent', ...extraEnv },
  });
  const output = { text: '' };
  child.stdout.on('data', (d) => { output.text += String(d); });
  child.stderr.on('data', (d) => { output.text += String(d); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('demo server did not start')), 10000);
    child.stdout.on('data', (d) => { if (String(d).includes('SYNTHETIC DATA ONLY')) { clearTimeout(timer); resolve(); } });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`demo server exited ${code}`)); });
  });
  return { child, output, base: `http://127.0.0.1:${port}` };
}

async function stopDemo({ child }) {
  if (child.exitCode !== null) return;
  await new Promise((resolve) => { child.once('exit', resolve); child.kill(); });
}

const json = async (res) => { assert.ok(res.ok, `${res.url} -> ${res.status}`); return res.json(); };
const send = (base, method, url, body) => fetch(`${base}${url}`, {
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const post = async (base, url, body) => json(await send(base, 'POST', url, body));

async function createReferral(base, receivingProgramId, participantName) {
  const created = await post(base, '/api/referrals', {
    submissionId: randomUUID(), receivingProgramId, participantName,
    contactMethod: 'NOT_AVAILABLE', referralContext: 'Synthetic need for the demo verification',
  });
  return created.referral.referralId;
}

const version = async (base, id) => (await json(await fetch(`${base}/api/referrals/${id}`))).referral.version;

// The full demo journey from docs/demo-runbook.md plus the response and
// outcome corrections, as the one synthetic demo person. Returns what a
// viewer sees in Reporting (counts only: elapsed times depend on pace).
async function runFullJourney(base) {
  const affiliation = await json(await fetch(`${base}/api/me/affiliation`));
  await json(await send(base, 'PUT', '/api/me/affiliation', { programId: 1, version: affiliation.version }));

  // Find a Program, then a referral to the Program it found.
  const match = await post(base, '/api/gpme/match', { needCategoryIds: [3], ageRange: { min: 20, max: 25 } });
  assert.equal(match.plausible[0].name, 'Adult Evening Classes (sample)');
  assert.equal(match.possible[0].name, 'Job Readiness Workshop (sample)');

  // A: accepted, resulted in service, then the outcome is corrected.
  const a = await createReferral(base, 4, 'Synthetic Person A');
  await post(base, `/api/referrals/${a}/response`, { decision: 'ACCEPTED' });
  await post(base, `/api/referrals/${a}/outcome`, { outcome: 'RESULTED_IN_SERVICE' });
  await post(base, `/api/referrals/${a}/outcome/correction`, { outcome: 'DID_NOT_RESULT_IN_SERVICE', version: await version(base, a) });

  // B: not appropriate, then the decision is corrected to accepted.
  const b = await createReferral(base, 4, 'Synthetic Person B');
  await post(base, `/api/referrals/${b}/response`, { decision: 'NOT_APPROPRIATE', reasonId: 1 });
  await post(base, `/api/referrals/${b}/response/correction`, { decision: 'ACCEPTED', version: await version(base, b) });

  // C: to the Program with no notification address. Still saved.
  const c = await createReferral(base, 5, 'Synthetic Person C');
  const sent = await json(await fetch(`${base}/api/referrals/sent`));
  assert.deepEqual(sent.referrals.map((r) => r.referralId).sort(), [a, b, c].sort());

  const { summary } = await json(await fetch(`${base}/api/reports/referral-activity?period=MONTHLY`));
  return summary;
}

describe('Task FF demo journeys repeat from a reset', () => {
  test('the full journey, with corrections and a failed notification, gives the same result on every fresh start', async () => {
    const results = [];
    for (let run = 0; run < 2; run += 1) {
      const demo = await startDemo();
      try {
        const summary = await runFullJourney(demo.base);
        // Notifications: the simulated outbox reports one SENT per Program
        // with an address, and a FAILED NO_RECIPIENT for Program 5 on
        // purpose. Referral C still exists (checked in runFullJourney).
        const lines = demo.output.text.split('\n').filter((l) => l.includes('[notification]'));
        assert.equal(lines.filter((l) => l.includes('outcome=SENT')).length, 2, lines.join('\n'));
        assert.equal(lines.filter((l) => l.includes('outcome=FAILED') && l.includes('category=NO_RECIPIENT')).length, 1, lines.join('\n'));
        // No participant details reach the log.
        assert.ok(!/Synthetic Person|Synthetic need/.test(demo.output.text));
        results.push(summary);
      } finally {
        await stopDemo(demo);
      }
    }
    assert.equal(results[0].totalReferrals, 3);
    assert.equal(results[0].accepted, 2, 'A and the corrected B');
    assert.equal(results[0].awaitingResponse, 1, 'C has no response yet');
    assert.equal(results[0].didNotResultInService, 1, 'the corrected outcome, not the first one');
    assert.equal(results[0].resultedInService, 0);
    const counts = (s) => Object.fromEntries(Object.entries(s).filter(([, v]) => typeof v === 'number'));
    assert.deepEqual(counts(results[1]), counts(results[0]));
  });

  test('Program information, languages of service and both demo modes reset to the same state', async () => {
    for (const extraEnv of [
      { QCH_TASK_C_SYNTHETIC_DEMO: 'true' },
      { QCH_TASK_C_SYNTHETIC_DEMO: 'true', QCH_DEMO_SIGN_IN: 'true' },
    ]) {
      const views = [];
      for (let run = 0; run < 2; run += 1) {
        const demo = await startDemo(extraEnv);
        try {
          // Changing the Program information during a run must not survive a reset.
          if (extraEnv.QCH_DEMO_SIGN_IN) {
            // Nobody is signed in until a demo person is chosen, so there
            // is no view to compare; prove that instead.
            assert.equal((await fetch(`${demo.base}/api/program-management/programs/3/fields`)).status, 401);
            views.push(null);
            continue;
          }
          const before = await json(await fetch(`${demo.base}/api/program-management/programs/3/fields`));
          const first = before.fields[0];
          const edited = await send(demo.base, 'PUT', `/api/program-management/programs/3/field-values/${first.fieldId}`, {
            version: first.applicability.version, value: 'Synthetic edit that a reset must undo',
          });
          assert.ok(edited.ok, `the edit itself must succeed: ${edited.status}`);
          const after = await json(await fetch(`${demo.base}/api/program-management/programs/3/fields`));
          assert.equal(after.fields[0].value, 'Synthetic edit that a reset must undo');
          views.push(before);
        } finally {
          await stopDemo(demo);
        }
      }
      // Run 2 starts from the same state run 1 started from, even though
      // run 1 edited the Program information before stopping.
      assert.deepEqual(views[1], views[0], JSON.stringify(extraEnv));
      if (!extraEnv.QCH_DEMO_SIGN_IN) {
        const labels = views[0].fields.map((f) => f.label);
        assert.deepEqual(labels, [
          'Current Program information', 'Current availability', 'Wait-list information', 'Estimated wait time',
          'Additional locations', 'Primary Program contact', 'Enrollment and cycle information',
        ]);
        assert.ok(views[0].fields.every((f) => /synthetic/i.test(f.value)), 'every example value says it is synthetic');
      }
    }
  });

  test('Find a Program shows languages of service, including "not on file"', async () => {
    const demo = await startDemo();
    try {
      const match = await post(demo.base, '/api/gpme/match', { needCategoryIds: [3], ageRange: { min: 20, max: 25 } });
      assert.deepEqual(match.plausible[0].serviceLanguages, { status: 'ON_FILE', names: ['Chinese', 'English', 'Spanish'] });
      assert.deepEqual(match.possible[0].serviceLanguages, { status: 'NOT_ON_FILE', names: [] });
    } finally {
      await stopDemo(demo);
    }
  });
});

describe('Task FF no real data, and demo data is labelled', () => {
  const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);

  test('no spreadsheet, CSV, PDF, Word or database file, and no Program Directory file, is committed', () => {
    const forbidden = tracked.filter((f) => /\.(xlsx?|csv|tsv|pdf|docx?|db|sqlite3?|bak|bacpac)$/i.test(f)
      || /program[ _-]?directory/i.test(path.basename(f)) || f.startsWith('data/private/'));
    assert.deepEqual(forbidden, []);
  });

  test('every email address in the demo code and seeds is on a reserved example domain', () => {
    const files = tracked.filter((f) => /^(scripts\/|db\/seeds\/)/.test(f));
    const bad = [];
    for (const f of files) {
      const text = readFileSync(path.join(ROOT, f), 'utf8');
      for (const m of text.matchAll(/[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g)) {
        if (!/(^|\.)(example\.(org|test|invalid|com)|invalid|test)$/i.test(m[1])) bad.push(`${f}: ${m[0]}`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test('every synthetic Program, Department, need category and demo person is marked as sample or demo', () => {
    const seed = syntheticSeed();
    const marked = (name) => /\((sample|demo)\)|\bSample\b/.test(name);
    for (const item of [...seed.departments, ...seed.programs, ...seed.needCategories]) {
      assert.ok(marked(item.name), `${item.name} is not marked as sample data`);
    }
    for (const persona of DEMO_PERSONAS) {
      assert.match(persona.displayName, /\(demo\)$/);
    }
    // ZIP codes are from outside New York on purpose.
    for (const program of seed.programs) {
      for (const zip of program.serviceAreaZips) assert.match(zip, /^999\d\d$/);
    }
  });
});
