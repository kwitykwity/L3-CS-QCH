// .env.example is the contract with QCH IT: every variable this project will
// need is listed, and every one that QCH IT must supply is left as an unfilled
// PROVIDED_BY_QCH_IT placeholder. These tests guard that, and guard that the
// placeholders stay unread by the scaffold.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';

const PLACEHOLDER = 'PROVIDED_BY_QCH_IT';
const READ_BY_CODE = ['PORT', 'NODE_ENV'];

// Parse the literal file text rather than using dotenv, so that trailing
// whitespace or a filled-in real value is visible to the assertions.
function parseEnvExample() {
  const file = path.join(import.meta.dirname, '..', '.env.example');
  const entries = readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const separator = line.indexOf('=');
      assert.ok(separator > 0, `expected KEY=VALUE, got: ${line}`);
      return [line.slice(0, separator), line.slice(separator + 1)];
    });

  return Object.fromEntries(entries);
}

test('every variable except PORT and NODE_ENV is an unfilled placeholder', () => {
  const env = parseEnvExample();
  const placeholders = Object.keys(env).filter((key) => !READ_BY_CODE.includes(key));

  // Guards against an empty or mis-parsed file passing the loop vacuously.
  assert.ok(placeholders.length > 0, 'expected .env.example to list placeholder variables');

  for (const key of placeholders) {
    assert.equal(env[key], PLACEHOLDER, `expected ${key} to be exactly ${PLACEHOLDER}`);
  }
});

test('loadConfig returns only port and nodeEnv, even when the placeholders are passed in', () => {
  const config = loadConfig(parseEnvExample());

  assert.deepEqual(Object.keys(config), ['port', 'nodeEnv']);
  assert.equal(config.port, 3000);
  assert.equal(config.nodeEnv, 'development');
});
