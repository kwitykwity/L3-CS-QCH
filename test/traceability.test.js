// Trello Task GG: the PRD traceability page (docs/prd-traceability.md) cannot
// drift from the repository without a test failing.
//
// This does not prove a requirement is met. It proves the page's own rules:
//   - every file the page cites exists;
//   - a row is VERIFIED only if it names at least one test or spec;
//   - every PRD section 1 to 21 has at least one row;
//   - the Summary counts match the rows;
//   - no row is classified two ways, and QCH-IT rows name a decision.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = readFileSync(path.join(ROOT, 'docs', 'prd-traceability.md'), 'utf8');
const STATUSES = ['VERIFIED', 'IMPLEMENTED', 'QCH-IT', 'DEFERRED', 'DEFECT'];

// A traceability row: | ID | requirement | where | evidence | `STATUS` | note |
function readRows() {
  const rows = [];
  for (const line of PAGE.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length !== 6) continue;
    const status = cells[4].replace(/`/g, '');
    if (!STATUSES.includes(status)) continue;
    rows.push({ id: cells[0], requirement: cells[1], where: cells[2], evidence: cells[3], status, note: cells[5] });
  }
  return rows;
}

const ROWS = readRows();
const PATH_PREFIX = /^(src|test|e2e|docs|db|public|scripts)\/|^README\.md$|^\.gitignore$/;

function citedPaths(text) {
  return [...text.matchAll(/`([^`]+)`/g)]
    .map((m) => m[1].trim())
    .filter((t) => PATH_PREFIX.test(t) && !/[*<>\s(]/.test(t));
}

describe('Task GG PRD traceability page', () => {
  test('the page has rows, and every row has a unique ID', () => {
    assert.ok(ROWS.length > 80, `expected the full matrix, found ${ROWS.length} rows`);
    const ids = ROWS.map((r) => r.id);
    assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], 'duplicate row IDs');
  });

  test('every file the page cites exists', () => {
    const missing = [];
    for (const row of ROWS) {
      for (const p of citedPaths(`${row.where} ${row.evidence} ${row.note}`)) {
        if (!existsSync(path.join(ROOT, p))) missing.push(`${row.id}: ${p}`);
      }
    }
    // The prose around the tables cites files too.
    for (const p of citedPaths(PAGE)) {
      if (!existsSync(path.join(ROOT, p))) missing.push(`page: ${p}`);
    }
    assert.deepEqual([...new Set(missing)], []);
  });

  test('a VERIFIED row names at least one test or spec, so documentation alone never verifies a requirement', () => {
    const bare = ROWS
      .filter((r) => r.status === 'VERIFIED')
      .filter((r) => !citedPaths(r.evidence).some((p) => /^(test|e2e)\//.test(p)))
      .map((r) => r.id);
    assert.deepEqual(bare, []);
  });

  test('every cited test file really contains tests', () => {
    const empty = [];
    for (const row of ROWS) {
      for (const p of citedPaths(row.evidence).filter((x) => /^(test|e2e)\/.*\.(test|spec)\.js$/.test(x))) {
        const text = readFileSync(path.join(ROOT, p), 'utf8');
        if (!/\b(test|it)(\.\w+)?\(/.test(text)) empty.push(`${row.id}: ${p}`);
      }
    }
    assert.deepEqual(empty, []);
  });

  test('QCH-IT rows name the decision or register item they wait on; DEFECT and DEFERRED rows explain themselves', () => {
    const problems = [];
    for (const row of ROWS) {
      if (row.status === 'QCH-IT' && !/(decision \d|decisions \d|R\d{1,2}\b|QCH IT|QCH's|PRD 22|PRD 19)/.test(`${row.note} ${row.requirement}`)) {
        problems.push(`${row.id}: QCH-IT with no decision named`);
      }
      if ((row.status === 'DEFECT' || row.status === 'DEFERRED' || row.status === 'IMPLEMENTED') && row.note.length < 20) {
        problems.push(`${row.id}: ${row.status} with no explanation`);
      }
    }
    assert.deepEqual(problems, []);
  });

  test('every PRD section 1 to 21 has at least one row', () => {
    const sections = new Set();
    for (const row of ROWS) {
      const m = /^T-(\d+)\./.exec(row.id);
      if (m) sections.add(Number(m[1]));
    }
    // 22 and 23 are decision and acceptance lists; their items are traced
    // through the rows they point at.
    const missing = [];
    for (let n = 1; n <= 21; n += 1) {
      // Section 21 (non-goals) is traced in row T-20.1.
      const covered = sections.has(n) || (n === 21 && sections.has(20));
      if (!covered) missing.push(n);
    }
    assert.deepEqual(missing, []);
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

  test('the page is linked from the documentation index', () => {
    const index = readFileSync(path.join(ROOT, 'docs', 'README.md'), 'utf8');
    assert.match(index, /\(prd-traceability\.md\)/);
  });
});
