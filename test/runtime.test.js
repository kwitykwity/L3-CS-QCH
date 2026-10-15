import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateRuntime } from '../scripts/check-runtime.js';

const root = new URL('../', import.meta.url);

test('running Node matches the pinned v24.15.0', () => {
  assert.equal(
    validateRuntime(),
    true,
    `Expected Node v24.15.0, received ${process.version}`
  );
});

test('rejects a mismatched Node version', () => {
  assert.equal(validateRuntime('v22.0.0'), false);
});

test('package.json engines pin is 24.15.x', () => {
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  assert.equal(pkg.engines.node, '>=24.15.0 <25.0.0');
});

test('.nvmrc is v24.15.0', () => {
  const nvmrc = readFileSync(new URL('.nvmrc', root), 'utf8').trim();
  assert.equal(nvmrc, 'v24.15.0');
});
