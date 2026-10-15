import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('accepts each allowed NODE_ENV', () => {
  for (const nodeEnv of ['development', 'test', 'production']) {
    const config = loadConfig({ NODE_ENV: nodeEnv, PORT: '3000' });
    assert.equal(config.nodeEnv, nodeEnv);
    assert.equal(config.port, 3000);
  }
});

test('fails closed when NODE_ENV is missing, instead of defaulting to development', () => {
  assert.throws(() => loadConfig({ PORT: '3000' }), /NODE_ENV must be set/);
});

test('rejects empty, mistyped, or differently cased NODE_ENV values', () => {
  for (const bad of ['', ' ', 'dev', 'Production', 'production ', 'staging']) {
    assert.throws(
      () => loadConfig({ NODE_ENV: bad, PORT: '3000' }),
      /NODE_ENV must be set/,
      `expected NODE_ENV="${bad}" to be rejected`,
    );
  }
});

test('the NODE_ENV error does not echo the provided value', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'some-unexpected-value' }),
    (err) => !err.message.includes('some-unexpected-value'),
  );
});

test('still rejects an invalid PORT', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'test', PORT: '99999' }),
    /PORT must be an integer/,
  );
});
