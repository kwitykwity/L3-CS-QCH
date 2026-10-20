// Card 18: keeps the deployment and handoff docs in step with the code
// (PRD 18.2, 19.2), and keeps real values out of them (PRD 15.2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { listLicenses, formatLicenses } from '../scripts/list-licenses.js';

const root = path.join(import.meta.dirname, '..');
const docsDir = path.join(root, 'docs');
const read = (...parts) => readFileSync(path.join(root, ...parts), 'utf8');

const SET_BY_DEPLOYMENT = ['PORT', 'NODE_ENV'];

function envExampleKeys() {
  return read('.env.example')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => line.slice(0, line.indexOf('=')));
}

function docFiles() {
  return readdirSync(docsDir).filter((name) => name.endsWith('.md'));
}

// Rows of the first markdown table after a heading, as arrays of cells.
function tableAfter(markdown, heading) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  assert.ok(start >= 0, `missing heading: ${heading}`);
  const rows = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('#')) break;
    if (!line.startsWith('|')) {
      if (rows.length > 0) break;
      continue;
    }
    rows.push(line.split('|').slice(1, -1).map((cell) => cell.trim()));
  }
  return rows.slice(2); // drop the header row and the --- row
}

const firstCell = (rows) => rows.map((cells) => cells[0].replaceAll('`', ''));

test('every QCH IT variable in .env.example is listed in qch-it-requirements.md, and nothing extra', () => {
  const expected = envExampleKeys().filter((key) => !SET_BY_DEPLOYMENT.includes(key)).sort();
  assert.ok(expected.length > 0, 'expected .env.example to list QCH IT variables');

  const documented = firstCell(tableAfter(read('docs', 'qch-it-requirements.md'), '## Configuration values')).sort();
  assert.deepEqual(documented, expected);
});

test('every .env.example variable is mentioned in the deployment docs', () => {
  const docs = read('docs', 'deployment.md') + read('docs', 'qch-it-requirements.md');
  for (const key of envExampleKeys()) {
    assert.ok(docs.includes(`\`${key}\``), `${key} is not documented`);
  }
});

test('the direct dependency table matches package.json', () => {
  const pkg = JSON.parse(read('package.json'));
  const expected = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ].sort();

  const rows = tableAfter(read('docs', 'dependencies.md'), '## Direct dependencies');
  assert.deepEqual(firstCell(rows).sort(), expected);

  for (const cells of rows) {
    const name = cells[0].replaceAll('`', '');
    const scope = Object.hasOwn(pkg.dependencies ?? {}, name) ? 'Runtime' : 'Development';
    assert.equal(cells[2], scope, `${name} scope`);
  }
});

test('the documented licenses match package-lock.json', () => {
  const { packages } = listLicenses(JSON.parse(read('package-lock.json')));
  const rows = tableAfter(read('docs', 'dependencies.md'), '## Direct dependencies');

  for (const cells of rows) {
    const name = cells[0].replaceAll('`', '');
    const installed = packages.find((p) => p.name === name);
    assert.ok(installed, `${name} is not in package-lock.json`);
    assert.equal(cells[3], installed.license, `${name} license`);
  }
});

test('every link between docs points to a file that exists', () => {
  for (const name of docFiles()) {
    const text = read('docs', name);
    for (const [, target] of text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
      if (/^[a-z]+:/i.test(target)) continue; // external link
      assert.ok(existsSync(path.join(docsDir, target)), `${name} links to missing ${target}`);
    }
  }
});

// A limited guard: it catches a few known secret and identifier patterns
// (GUIDs, password=, AccountKey=, Azure SQL / Key Vault hosts, QCH email
// addresses). It cannot prove a document contains no secrets.
test('docs do not match known secret or identifier patterns (limited guard)', () => {
  const guid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
  const secretPatterns = [
    guid, // tenant and client IDs
    /password\s*=/i,
    /accountkey\s*=/i,
    /\.database\.windows\.net/i,
    /\.vault\.azure\.net/i,
    /@qchnyc\.org/i,
  ];
  for (const name of docFiles()) {
    const text = read('docs', name);
    for (const pattern of secretPatterns) {
      assert.ok(!pattern.test(text), `${name} matches ${pattern}`);
    }
  }
});

test('the licenses script lists every package with a license and counts them', () => {
  const lock = {
    packages: {
      '': { name: 'app' },
      'node_modules/a': { version: '1.0.0', license: 'MIT' },
      'node_modules/b': { version: '2.0.0', license: 'ISC', dev: true },
      'node_modules/a/node_modules/c': { version: '3.0.0' },
    },
  };
  const result = listLicenses(lock);

  assert.deepEqual(result.packages.map((p) => `${p.name}@${p.version} ${p.license} ${p.scope}`), [
    'a@1.0.0 MIT runtime',
    'b@2.0.0 ISC development',
    'c@3.0.0 UNKNOWN runtime',
  ]);
  assert.deepEqual(result.counts, { MIT: 1, ISC: 1, UNKNOWN: 1 });
  assert.match(formatLicenses(result), /UNKNOWN: 1/);
});
