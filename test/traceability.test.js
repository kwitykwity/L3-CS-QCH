// Trello Task GG: the handoff traceability page (docs/prd-traceability.md)
// cannot drift from the frozen requirements or the repository without a test
// failing.
//
// Requirements source of truth, in order: the Frozen Handoff PRD (Oct 28,
// 2026), the Handoff MVP, the Current Handoff Wireframes. The Oct 14 Final
// Technical PRD is historical and is checked only to stay labelled that way.
//
// This does NOT prove a requirement is met. Passing execution evidence is
// recorded on the page from a real test run and cannot be produced by this
// file. What this file does prove is the page's own contract:
//   - all 36 MVP 32 acceptance gates are present, worded as the MVP words them;
//   - every Handoff PRD section 1 to 37 and every Handoff MVP section 2 to 31
//     is cited by at least one row;
//   - every wireframe 1 to 21 is listed;
//   - a row uses only the MVP 33 classes (plus production dependency);
//   - VERIFIED needs a behavioral test or spec that exists and contains tests,
//     not documents and not structural guard tests, and a stated limit;
//   - OPEN-PR rows name the pull request; TRUE-GAP rows say what was checked;
//   - the page records the tested revision and the executed runs;
//   - the Summary counts match the rows;
//   - every file the page cites exists.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const PAGE = read('docs', 'prd-traceability.md');
const HISTORY = read('docs', 'historical-oct14-implementation-map.md');

const STATUSES = [
  'VERIFIED',
  'MERGED-NEEDS-VERIFICATION',
  'OPEN-PR-MATCHES',
  'OPEN-PR-MISMATCH',
  'TRUE-GAP',
  'PRODUCTION-DEPENDENCY',
];

// Handoff MVP 32, as worded in the Handoff MVP.
const GATES = [
  'Find a Program end to end.',
  'Direct Referral end to end.',
  'Both paths entering the same referral lifecycle.',
  'Open-ended need description.',
  'Human review/correction before GPME.',
  'Exact age input.',
  'Age-range input.',
  'No participant age/range persisted after referral creation.',
  'Deterministic advisory GPME.',
  'Legitimate no-match behavior.',
  'Human Program selection.',
  'Language displayed and non-exclusionary.',
  'Availability/waitlist displayed and non-exclusionary.',
  'Language not used as an unapproved GPME criterion.',
  'Availability not used as an unapproved GPME criterion.',
  'Current employee-facing Program information.',
  'Correct Program contact fallback instruction.',
  'Configurable Program information.',
  'Configurable Department/Program structure.',
  'Multiple-location support.',
  'Shared referral lifecycle.',
  'Receiving Program response.',
  'Separate response and service outcome.',
  'Decision/outcome correction with history.',
  'Idempotent referral submission.',
  'Referral survives notification failure.',
  'Server-side authorization.',
  'Controlled permission administration.',
  'Aggregate reporting.',
  'Privacy/data-minimization protections.',
  'Synthetic-data separation.',
  'No external AI integration in the delivered MVP.',
  'WCAG 2.2 AA accessibility target.',
  'Stable synthetic demonstration environment.',
  'Accurate production architecture handoff.',
  'Production dependencies explicitly documented.',
];

// Tests that check the documents or the repository's shape, not product
// behavior. They never establish compliance (MVP 33).
const STRUCTURAL = new Set([
  'test/traceability.test.js',
  'test/docs.test.js',
  'test/envExample.test.js',
  'test/runtime.test.js',
  'test/auditCoverage.test.js',
]);

// | ID | requirement | frozen source | where | evidence | `STATUS` | limits |
function readRows() {
  const rows = [];
  for (const line of PAGE.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length !== 7) continue;
    const status = cells[5].replace(/`/g, '');
    if (!STATUSES.includes(status)) continue;
    rows.push({
      id: cells[0], requirement: cells[1], source: cells[2], where: cells[3],
      evidence: cells[4], status, limits: cells[6],
    });
  }
  return rows;
}

const ROWS = readRows();
const GATE_ROWS = ROWS.filter((r) => /^G-\d+$/.test(r.id));
const PATH_PREFIX = /^(src|test|e2e|docs|db|public|scripts)\/|^README\.md$|^\.gitignore$/;

function citedPaths(text) {
  return [...text.matchAll(/`([^`]+)`/g)]
    .map((m) => m[1].trim())
    .filter((t) => PATH_PREFIX.test(t) && !/[*<>\s(]/.test(t));
}

// "PRD 3.1, 4.1, 5; MVP 4.1, 5" -> { PRD: Set{3,4,5}, MVP: Set{4,5} }
function sectionsCited(source) {
  const out = { PRD: new Set(), MVP: new Set() };
  for (const kind of ['PRD', 'MVP']) {
    for (const m of source.matchAll(new RegExp(`${kind} ([\\d.,\\s]+)`, 'g'))) {
      for (const part of m[1].split(',')) {
        const n = Number.parseInt(part.trim(), 10);
        if (Number.isInteger(n)) out[kind].add(n);
      }
    }
  }
  return out;
}

describe('Task GG handoff traceability page: authority', () => {
  test('the page names the frozen documents as governing and the Oct 14 PRD and register as historical', () => {
    assert.match(PAGE, /Frozen Handoff PRD/);
    assert.match(PAGE, /Handoff MVP/);
    assert.match(PAGE, /Current Handoff Wireframes/);
    assert.match(PAGE, /Oct(ober)? 14 Final Technical PRD[\s\S]{0,200}historical/i);
    assert.match(PAGE, /Handoff PRD governs/);
  });

  test('the Oct 14 audit is kept apart, labelled historical, and does not use the current classifications', () => {
    assert.match(HISTORY, /historical reference/i);
    assert.match(HISTORY, /Not a requirements document/i);
    for (const status of STATUSES) {
      const asCell = new RegExp(`\\|\\s*\`${status}\`\\s*\\|`);
      assert.ok(!asCell.test(HISTORY), `historical page must not carry the current status ${status}`);
    }
  });

  test('the page is linked from the documentation index and links the historical page', () => {
    assert.match(read('docs', 'README.md'), /\(prd-traceability\.md\)/);
    assert.match(PAGE, /\(historical-oct14-implementation-map\.md\)/);
  });
});

describe('Task GG handoff traceability page: coverage of the frozen documents', () => {
  test('all 36 MVP acceptance gates are present once each, worded as MVP 32 words them', () => {
    assert.equal(GATE_ROWS.length, 36, `expected 36 gate rows, found ${GATE_ROWS.length}`);
    GATES.forEach((text, i) => {
      const matching = GATE_ROWS.filter((r) => r.id === `G-${i + 1}`);
      assert.equal(matching.length, 1, `G-${i + 1} must appear exactly once`);
      assert.equal(matching[0].requirement, text, `G-${i + 1} wording differs from MVP 32`);
    });
  });

  test('every Handoff PRD section 1 to 37 is cited by at least one row', () => {
    const seen = new Set();
    for (const row of ROWS) for (const n of sectionsCited(row.source).PRD) seen.add(n);
    const missing = [];
    for (let n = 1; n <= 37; n += 1) if (!seen.has(n)) missing.push(n);
    assert.deepEqual(missing, [], 'Handoff PRD sections with no row');
  });

  test('every Handoff MVP section 2 to 31 is cited by at least one row', () => {
    // 1 is the purpose; 32 is the gate list itself; 33 is the classification
    // rule (checked below); 34 is MVP authority.
    const seen = new Set();
    for (const row of ROWS) for (const n of sectionsCited(row.source).MVP) seen.add(n);
    const missing = [];
    for (let n = 2; n <= 31; n += 1) if (!seen.has(n)) missing.push(n);
    assert.deepEqual(missing, [], 'Handoff MVP sections with no row');
  });

  test('every wireframe 1 to 21 is listed', () => {
    const section = PAGE.split('## Wireframes (v1.6)')[1].split('\n## ')[0];
    const listed = new Set();
    for (const line of section.split('\n')) {
      const m = /^\|\s*(\d+)\s*\|/.exec(line);
      if (m) listed.add(Number(m[1]));
    }
    const missing = [];
    for (let n = 1; n <= 21; n += 1) if (!listed.has(n)) missing.push(n);
    assert.deepEqual(missing, []);
  });

  test('every ID is unique', () => {
    const ids = ROWS.map((r) => r.id);
    assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), []);
  });
});

describe('Task GG handoff traceability page: classification rules (MVP 33)', () => {
  test('every row uses one of the MVP 33 classes, plus production dependency', () => {
    for (const row of ROWS) assert.ok(STATUSES.includes(row.status), `${row.id}: ${row.status}`);
    for (const name of ['VERIFIED', 'MERGED-NEEDS-VERIFICATION', 'OPEN-PR-MATCHES', 'OPEN-PR-MISMATCH', 'TRUE-GAP', 'PRODUCTION-DEPENDENCY']) {
      assert.ok(PAGE.includes(`| \`${name}\` |`), `the legend must define ${name}`);
    }
    assert.match(PAGE, /An open pull request is not an approved deferral/);
  });

  test('VERIFIED needs a behavioral test that exists and contains tests, never documents or structural guards alone', () => {
    const problems = [];
    for (const row of ROWS.filter((r) => r.status === 'VERIFIED')) {
      const tests = citedPaths(row.evidence).filter((p) => /^(test|e2e)\//.test(p) && !STRUCTURAL.has(p));
      if (tests.length === 0) problems.push(`${row.id}: no behavioral test or spec cited`);
      for (const p of tests.filter((x) => /\.(test|spec)\.js$/.test(x))) {
        if (!existsSync(path.join(ROOT, p))) { problems.push(`${row.id}: ${p} does not exist`); continue; }
        if (!/\b(test|it)(\.\w+)?\(/.test(read(p))) problems.push(`${row.id}: ${p} has no tests`);
      }
      if (row.limits.length < 5) problems.push(`${row.id}: VERIFIED must state its limits`);
      // A row backed only by a browser spec is verified for the browser run.
      const onlyBrowser = tests.length > 0 && tests.every((p) => p.startsWith('e2e/'));
      if (onlyBrowser && !/Chromium/.test(row.limits)) problems.push(`${row.id}: browser-only evidence must say Chromium`);
    }
    assert.deepEqual(problems, []);
  });

  test('a row backed only by documents or structural tests is never VERIFIED', () => {
    for (const row of ROWS.filter((r) => r.status === 'VERIFIED')) {
      const cited = citedPaths(row.evidence);
      assert.ok(cited.some((p) => /^(test|e2e)\//.test(p) && !STRUCTURAL.has(p)), row.id);
    }
  });

  test('OPEN-PR rows name the pull request; they are not approved deferrals', () => {
    for (const row of ROWS.filter((r) => r.status.startsWith('OPEN-PR'))) {
      assert.match(`${row.where} ${row.evidence} ${row.limits}`, /#\d{2,3}\b/, `${row.id} must name its pull request`);
      assert.match(row.limits, /(Not executed here|not run here|rerun)/i, `${row.id} must say the open pull request was not executed`);
    }
  });

  test('TRUE-GAP rows record what was checked before declaring the gap', () => {
    for (const row of ROWS.filter((r) => r.status === 'TRUE-GAP')) {
      assert.match(row.limits, /Checked:/, `${row.id} must say what was checked`);
      assert.ok(row.limits.length > 80, `${row.id} must explain itself`);
    }
  });

  test('PRODUCTION-DEPENDENCY rows are limited to production infrastructure the frozen PRD names', () => {
    const allowed = /PRD (21|22|27|28|29|30|37)\b|MVP (21|22|28|29|31)\b/;
    for (const row of ROWS.filter((r) => r.status === 'PRODUCTION-DEPENDENCY')) {
      assert.match(row.source, allowed, `${row.id}: not tied to a production-architecture section`);
      assert.ok(row.limits.length > 30, `${row.id} must say who provides it`);
    }
  });

  test('external AI is not a pending implementation or dependency item', () => {
    const gate = GATE_ROWS.find((r) => r.id === 'G-32');
    assert.ok(gate && /^(VERIFIED|MERGED-NEEDS-VERIFICATION)$/.test(gate.status));
    assert.match(gate.limits, /not.*pending|excluded from the MVP/i);
    for (const row of ROWS.filter((r) => r.id !== 'G-32' && /PRODUCTION-DEPENDENCY|TRUE-GAP/.test(r.status))) {
      assert.ok(!/\bexternal AI\b|\bAI service\b/i.test(`${row.requirement} ${row.limits}`), `${row.id} lists AI as pending`);
    }
  });

  test('SharePoint Lists and Azure Functions are recorded as confirmed planned architecture, apart from provisioning and verification', () => {
    const section = PAGE.split('## Production architecture: confirmed, provisioned and verified')[1].split('\n## ')[0];
    assert.match(section, /Confirmed by the frozen PRD/);
    assert.match(section, /Provisioning/);
    assert.match(section, /Production verification/);
    assert.match(section, /SharePoint Lists in a dedicated private site/);
    assert.match(section, /Azure Functions with managed identity/);
    assert.match(section, /Sites\.Selected/);
    // The earlier "SharePoint or Azure SQL is undecided" framing must not return.
    assert.ok(!/SharePoint Lists or (the )?Azure SQL/i.test(PAGE.split('## Historical findings')[0].replace(/Checked:[^|]*/g, '')), 'the page must not present the data store as undecided');
  });
});

describe('Task GG handoff traceability page: evidence record', () => {
  test('the page records the tested revision and the executed runs, and what was not run', () => {
    const section = PAGE.split('## Tested revision and execution evidence')[1].split('\n## ')[0];
    assert.match(section, /Product code audited:\*\* `[0-9a-f]{7,40}`/);
    assert.match(section, /`node --test`, run at `[0-9a-f]{7,40}`[\s\S]{0,200}\d+ tests, \d+ pass, \d+ fail/);
    assert.match(section, /`npx playwright test` \(Chromium\), run at `[0-9a-f]{7,40}`[\s\S]{0,200}\d+ passed/);
    assert.match(section, /Not run for this audit/);
  });

  test('the Summary counts match the rows', () => {
    const counts = Object.fromEntries(STATUSES.map((s) => [s, ROWS.filter((r) => r.status === s).length]));
    const summary = PAGE.split('## Summary')[1].split('\n## ')[0];
    for (const status of STATUSES) {
      const m = new RegExp(`\\|\\s*\`${status}\`\\s*\\|\\s*(\\d+)\\s*\\|`).exec(summary);
      assert.ok(m, `Summary is missing ${status}`);
      assert.equal(Number(m[1]), counts[status], `Summary says ${m[1]} ${status}; the rows have ${counts[status]}`);
    }
  });

  test('every file either page cites exists', () => {
    const missing = [];
    for (const [name, text] of [['page', PAGE], ['history', HISTORY]]) {
      for (const p of citedPaths(text)) {
        if (!existsSync(path.join(ROOT, p))) missing.push(`${name}: ${p}`);
      }
    }
    assert.deepEqual([...new Set(missing)], []);
  });
});
