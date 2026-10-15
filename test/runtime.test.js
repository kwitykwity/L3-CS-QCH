import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { validateRuntime, EXPECTED_VERSION } from '../scripts/check-runtime.js';

// These tests pass the version in, so they do not depend on which Node
// version runs the suite. To check the Node you are actually running, use
// `npm run check-runtime`.

function quietly(fn) {
  const log = mock.method(console, 'log', () => {});
  const warn = mock.method(console, 'warn', () => {});
  try {
    return { result: fn(), warnings: warn.mock.calls.map((c) => c.arguments[0]) };
  } finally {
    log.mock.restore();
    warn.mock.restore();
  }
}

test('the expected runtime is the team baseline v24.15.0', () => {
  assert.equal(EXPECTED_VERSION, 'v24.15.0');
});

test('accepts exactly v24.15.0', () => {
  assert.equal(quietly(() => validateRuntime('v24.15.0')).result, true);
});

test('rejects other Node 24 patch and minor versions', () => {
  for (const version of ['v24.14.0', 'v24.15.1', 'v24.16.0']) {
    assert.equal(
      quietly(() => validateRuntime(version)).result,
      false,
      `expected ${version} to be rejected`,
    );
  }
});

test('rejects other Node major versions', () => {
  for (const version of ['v22.22.0', 'v23.0.0', 'v25.0.0']) {
    assert.equal(
      quietly(() => validateRuntime(version)).result,
      false,
      `expected ${version} to be rejected`,
    );
  }
});

test('a mismatch reports the expected and received versions', () => {
  const { warnings } = quietly(() => validateRuntime('v22.22.0'));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /expected v24\.15\.0, received v22\.22\.0/);
});
