// Trello Task FF: demo data and reset verification (Handoff PRD 35 and 36;
// Handoff MVP 25 and 32, gates 31 and 34).
//
// test/demoEnvironment.test.js already proves the plain starting state and
// that a restart undoes a basic run. This file covers what that one does not:
//   - a fuller demo journey (a GPME-assisted referral from Find a Program,
//     Direct referrals, corrections, a failed notification, reporting)
//     gives the same result on every fresh start;
//   - Program information and languages of service are edited, and a restart
//     puts them back (one fixed synthetic person);
//   - under demo sign-in, work done by signed-in demo people (a referral and
//     a response) and the sign-ins themselves are gone after a restart;
//   - the specific safeguards against real data: invented names, reserved
//     example domains, no SSN-shaped values, no Program Directory file.
//
// Not covered here: editing Program information or languages while signed in
// as a demo person. The demo people hold no Program-management rights, so
// that edit is refused; the demo sign-in test proves the refusal, not a reset
// of an edit. Edits and their reset are proved in the one-person mode.
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

const MATCHING = { needCategoryIds: [3], ageRange: { min: 20, max: 25 } };
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Paths in a parsed API response that look like a participant age or age range:
// a key beginning with "age", or an object holding numeric min and max. Walks the
// structure, so it does not depend on how the JSON text happens to be formatted.
export function ageFieldPaths(value, at = '') {
  if (value === null || typeof value !== 'object') return [];
  const found = [];
  if (!Array.isArray(value) && typeof value.min === 'number' && typeof value.max === 'number') found.push(at || '(root)');
  for (const [key, child] of Object.entries(value)) {
    const here = at ? at + '.' + key : key;
    if (/^age/i.test(key)) found.push(here);
    found.push(...ageFieldPaths(child, here));
  }
  return found;
}

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

// Waits, up to a limit, for the server's notification log to satisfy a check.
// Notifications are sent after the referral is saved, so their log lines can
// arrive after the HTTP response.
async function waitForLog(demo, check, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  const lines = () => demo.output.text.split('\n').filter((l) => l.includes('[notification]'));
  while (Date.now() < deadline) {
    if (check(lines())) return lines();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`notification log did not settle within ${timeoutMs} ms:\n${lines().join('\n')}`);
}

const json = async (res) => { assert.ok(res.ok, `${res.url} -> ${res.status}`); return res.json(); };
const send = (base, method, url, body) => fetch(`${base}${url}`, {
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const post = async (base, url, body) => json(await send(base, 'POST', url, body));

// `gpme` makes it a GPME-assisted referral: the matching answers the worker
// gave Find a Program travel with the referral, and the server re-runs the
// match to confirm the Program was among the results.
async function createReferral(base, receivingProgramId, participantName, gpme) {
  const created = await post(base, '/api/referrals', {
    submissionId: randomUUID(), receivingProgramId, participantName,
    contactMethod: 'NOT_AVAILABLE', referralContext: 'Synthetic need for the demo verification',
    ...(gpme ? { gpme } : {}),
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

  // Find a Program, then a GPME-assisted referral to the Program it listed first.
  const match = await post(base, '/api/gpme/match', MATCHING);
  assert.equal(match.plausible[0].name, 'Adult Evening Classes (sample)');
  assert.equal(match.possible[0].name, 'Job Readiness Workshop (sample)');

  // A: GPME-assisted. The worker runs Find a Program for a Housing need, and
  // the referral goes to the Program it listed (Housing Help Desk, the one
  // Program this demo person receives for). Accepted, resulted in service,
  // then the outcome is corrected.
  const housing = { needCategoryIds: [4], ageRange: { min: 25, max: 35 } };
  const housingMatch = await post(base, '/api/gpme/match', housing);
  const listed = [...housingMatch.plausible, ...housingMatch.possible].find((p) => p.programId === 4);
  assert.ok(listed, 'Find a Program lists Housing Help Desk for a Housing need');
  const a = await createReferral(base, listed.programId, 'Synthetic Person A', housing);
  await post(base, `/api/referrals/${a}/response`, { decision: 'ACCEPTED' });
  await post(base, `/api/referrals/${a}/outcome`, { outcome: 'RESULTED_IN_SERVICE' });
  await post(base, `/api/referrals/${a}/outcome/correction`, { outcome: 'DID_NOT_RESULT_IN_SERVICE', version: await version(base, a) });

  // B: Direct (no matching): not appropriate, then the decision is corrected to accepted.
  const b = await createReferral(base, 4, 'Synthetic Person B');
  await post(base, `/api/referrals/${b}/response`, { decision: 'NOT_APPROPRIATE', reasonId: 1 });
  await post(base, `/api/referrals/${b}/response/correction`, { decision: 'ACCEPTED', version: await version(base, b) });

  // C: Direct, to the Program with no notification address. Still saved.
  const c = await createReferral(base, 5, 'Synthetic Person C');
  const sent = await json(await fetch(`${base}/api/referrals/sent`));
  assert.deepEqual(sent.referrals.map((r) => r.referralId).sort(), [a, b, c].sort());

  // Both entry paths are what they claim: A is GPME_ASSISTED, B and C DIRECT.
  const details = {};
  for (const id of [a, b, c]) details[id] = (await json(await fetch(`${base}/api/referrals/${id}`))).referral;
  assert.deepEqual(
    Object.fromEntries([a, b, c].map((id) => [id, details[id].source])),
    { [a]: 'GPME_ASSISTED', [b]: 'DIRECT', [c]: 'DIRECT' },
  );
  // API response only: the referral as the server returns it carries no age or
  // age range (Handoff PRD 5.4). What is stored is a separate question, checked
  // by test/regression/workflowJourneys.test.js (the stored evidence), not here.
  assert.deepEqual(ageFieldPaths(details[a]), [], 'no age or age range in the referral response');

  const { summary } = await json(await fetch(`${base}/api/reports/referral-activity?period=MONTHLY`));
  return summary;
}

describe('Task FF age check on the referral response', () => {
  test('ageFieldPaths finds a planted age or age range, wherever it sits and however the JSON is formatted', () => {
    const clean = { referralId: 'R1', source: 'GPME_ASSISTED', program: { programId: 4 }, history: [{ value: 'ACCEPTED' }] };
    assert.deepEqual(ageFieldPaths(clean), []);
    assert.deepEqual(ageFieldPaths({ ...clean, ageRange: { min: 25, max: 35 } }).sort(), ['ageRange', 'ageRange']);
    assert.deepEqual(ageFieldPaths({ ...clean, participantRange: { min: 25, max: 35 } }), ['participantRange']);
    assert.deepEqual(ageFieldPaths({ ...clean, history: [{ range: { min: 1, max: 2 } }] }), ['history.0.range']);
    assert.deepEqual(ageFieldPaths({ ...clean, program: { age: 30 } }), ['program.age']);
    assert.deepEqual(ageFieldPaths({ ...clean, ageMin: 25 }), ['ageMin']);
  });
});

describe('Task FF demo journeys repeat from a reset', () => {
  test('the full journey (guided and Direct referrals, corrections, a failed notification) gives the same result on every fresh start', async () => {
    const results = [];
    for (let run = 0; run < 2; run += 1) {
      const demo = await startDemo();
      try {
        const summary = await runFullJourney(demo.base);
        // Notifications: the simulated outbox reports a SENT for A (Program 4)
        // and B (Program 4), and a FAILED NO_RECIPIENT for C (Program 5, no
        // address, on purpose). C still exists (checked in runFullJourney).
        // They are sent after the referral is saved, so wait, with a limit.
        const isSent = (l) => l.includes('outcome=SENT');
        const isNoRecipient = (l) => l.includes('outcome=FAILED') && l.includes('category=NO_RECIPIENT');
        const lines = await waitForLog(demo, (ls) => ls.filter(isSent).length >= 2 && ls.filter(isNoRecipient).length >= 1);
        assert.equal(lines.filter(isSent).length, 2, lines.join('\n'));
        assert.equal(lines.filter(isNoRecipient).length, 1, lines.join('\n'));
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

  test('Program information and languages of service, edited during a run, are back to the same state after a restart', async () => {
    const views = [];
    for (let run = 0; run < 2; run += 1) {
      const demo = await startDemo({ QCH_TASK_C_SYNTHETIC_DEMO: 'true' });
      try {
        const languagesOf = async () => (await post(demo.base, '/api/gpme/match', MATCHING)).plausible[0].serviceLanguages;
        const before = {
          fields: await json(await fetch(`${demo.base}/api/program-management/programs/3/fields`)),
          languages: await languagesOf(),
        };
        assert.deepEqual(before.languages, { status: 'ON_FILE', names: ['Chinese', 'English', 'Spanish'] });

        // Edit Program information.
        const first = before.fields.fields[0];
        const edited = await send(demo.base, 'PUT', `/api/program-management/programs/3/field-values/${first.fieldId}`, {
          version: first.applicability.version, value: 'Synthetic edit that a reset must undo',
        });
        assert.ok(edited.ok, `the Program-information edit must succeed: ${edited.status}`);
        const after = await json(await fetch(`${demo.base}/api/program-management/programs/3/fields`));
        assert.equal(after.fields[0].value, 'Synthetic edit that a reset must undo');

        // Edit languages of service: Adult Evening Classes drops Spanish and Chinese.
        const facts = await json(await fetch(`${demo.base}/api/program-management/programs/3/matching-facts`));
        const changed = await send(demo.base, 'PUT', '/api/program-management/programs/3/matching-facts', {
          ...facts.facts, version: facts.program.version, languageIds: [1],
        });
        assert.ok(changed.ok, `the language edit must succeed: ${changed.status}`);
        assert.deepEqual(await languagesOf(), { status: 'ON_FILE', names: ['English'] }, 'the edit is visible during the run');
        views.push(before);
      } finally {
        await stopDemo(demo);
      }
    }
    // Run 2 starts from the state run 1 started from, although run 1 edited
    // both the Program information and the languages before it stopped.
    assert.deepEqual(views[1], views[0]);
    assert.deepEqual(views[0].fields.fields.map((f) => f.label), [
      'Current Program information', 'Current availability', 'Wait-list information', 'Estimated wait time',
      'Additional locations', 'Primary Program contact', 'Enrollment and cycle information',
    ]);
    assert.ok(views[0].fields.fields.every((f) => /synthetic/i.test(f.value)), 'every example value says it is synthetic');
  });

  test('demo sign-in: work done by signed-in demo people, and the sign-ins, are gone after a restart', async () => {
    const env = { QCH_TASK_C_SYNTHETIC_DEMO: 'true', QCH_DEMO_SIGN_IN: 'true' };
    const signIn = async (base, person) => {
      const res = await send(base, 'POST', '/demo/api/sign-in', { person });
      assert.equal(res.status, 200, `signing in as ${person}`);
      return res.headers.get('set-cookie').split(';')[0];
    };
    const as = (base, cookie) => (method, url, body) => fetch(`${base}${url}`, {
      method, headers: { 'Content-Type': 'application/json', Cookie: cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    // What each demo person sees right after signing in.
    const startingViews = async (base) => {
      const referrer = as(base, await signIn(base, 'referring-worker'));
      const receiver = as(base, await signIn(base, 'housing-receiver'));
      return {
        sent: await json(await referrer('GET', '/api/referrals/sent')),
        queue: await json(await receiver('GET', '/api/referrals/received?programId=4')),
      };
    };

    const first = await startDemo(env);
    let staleCookie;
    let startingView;
    try {
      // Nobody is signed in until a demo person is chosen.
      assert.equal((await fetch(`${first.base}/api/referrals/sent`)).status, 401);
      startingView = await startingViews(first.base);
      assert.deepEqual(startingView.sent.referrals, []);
      assert.deepEqual(startingView.queue.referrals, []);

      // Authorized demo work: the referring worker sends a referral, the
      // Housing receiver answers it.
      staleCookie = await signIn(first.base, 'referring-worker');
      const referrer = as(first.base, staleCookie);
      const receiver = as(first.base, await signIn(first.base, 'housing-receiver'));
      const created = await json(await referrer('POST', '/api/referrals', {
        submissionId: randomUUID(), receivingProgramId: 4, participantName: 'Synthetic Person D',
        contactMethod: 'NOT_AVAILABLE', referralContext: 'Synthetic need for the demo verification',
      }));
      const id = created.referral.referralId;
      assert.equal((await receiver('POST', `/api/referrals/${id}/response`, { decision: 'ACCEPTED' })).status, 200);
      assert.match(JSON.stringify(await json(await referrer('GET', '/api/referrals/sent'))), /ACCEPTED/);
      // The demo people hold no Program-management rights. The refusal is what
      // is proved here, so a language edit is not part of this mode.
      assert.equal((await referrer('GET', '/api/program-management/programs/3/matching-facts')).status, 403);
    } finally {
      await stopDemo(first);
    }

    const second = await startDemo(env);
    try {
      // The old sign-in no longer works: sign-ins lived in the stopped server.
      assert.equal((await as(second.base, staleCookie)('GET', '/api/referrals/sent')).status, 401);
      // Signing in again shows the same starting views as the first start.
      assert.deepEqual(await startingViews(second.base), startingView);
    } finally {
      await stopDemo(second);
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

describe('Task FF safeguards against real data, and demo data is labelled', () => {
  const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  const isImage = (f) => /\.(png|jpe?g|gif|ico|webp|woff2?)$/i.test(f);

  // Handoff PRD 35 prohibits real participant/referral information in the
  // repository, tests, screenshots and demos, and the internal QCH Program
  // Directory in a public repository. File types are not themselves banned.
  // These tests check specific prohibited content. They do not prove that no
  // real data exists anywhere: they are safeguards, not an inspection of
  // every value in every file.
  test('no Program Directory file or private-data folder is committed (by name; other files are not searched for Directory content)', () => {
    const forbidden = tracked.filter((f) => /program[ _-]?directory/i.test(path.basename(f)) || f.startsWith('data/private/'));
    assert.deepEqual(forbidden, []);
  });

  test('no tracked text file holds a valid-looking Social Security Number', () => {
    const found = [];
    for (const f of tracked.filter((name) => !isImage(name) && !/package-lock\.json$/.test(name))) {
      let text;
      try { text = readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
      if (text.includes('\u0000')) continue; // binary
      // Valid-looking only: area 000, 666 and 9xx, group 00 and serial 0000 are never issued, so a marker such as 000-00-0000 is not a real SSN.
      if (/(?<![\d-])(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?![\d-])/.test(text)) found.push(f);
    }
    assert.deepEqual(found, []);
  });

  test('every email address in the demo code and seeds is on a reserved example domain', () => {
    const files = tracked.filter((f) => /^(scripts\/|db\/seeds\/)/.test(f));
    const bad = [];
    for (const f of files) {
      const text = readFileSync(path.join(ROOT, f), 'utf8');
      for (const m of text.matchAll(/[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g)) {
        const reserved = /(^|\.)(example\.(org|test|invalid|com)|invalid|test)$/i.test(m[1]);
        if (!reserved) bad.push(`${f}: ${m[0]}`);
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
