'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, ConfigError } = require('../src/config');
const { PRODUCTION_REQUIRED, PLACEHOLDER_MARKER } = require('../src/config/schema');

// Synthetic values only. These are fake and exist to exercise validation.
const SYNTHETIC_PRODUCTION_ENV = Object.freeze(
  Object.fromEntries(PRODUCTION_REQUIRED.map((name) => [name, `synthetic-${name.toLowerCase()}`]))
);

function productionEnv(overrides = {}) {
  return { APP_ENV: 'production', ...SYNTHETIC_PRODUCTION_ENV, ...overrides };
}

function problemsFor(env) {
  try {
    loadConfig(env);
  } catch (err) {
    assert.ok(err instanceof ConfigError);
    return err.problems;
  }
  return [];
}

test('valid development config loads with defaults', () => {
  const config = loadConfig({ APP_ENV: 'development' });
  assert.equal(config.appEnv, 'development');
  assert.equal(config.isProduction, false);
  assert.equal(config.port, 3000);
});

test('every non-production environment loads with only APP_ENV set', () => {
  for (const appEnv of ['development', 'demo', 'test']) {
    assert.equal(loadConfig({ APP_ENV: appEnv }).appEnv, appEnv);
  }
});

test('config object is frozen', () => {
  const config = loadConfig({ APP_ENV: 'development' });
  assert.ok(Object.isFrozen(config));
});

test('missing APP_ENV fails closed', () => {
  assert.equal(problemsFor({}).length, 1);
  assert.match(problemsFor({})[0], /APP_ENV is required/);
  assert.equal(problemsFor({ APP_ENV: '   ' }).length, 1);
});

test('unknown APP_ENV fails closed', () => {
  const problems = problemsFor({ APP_ENV: 'staging' });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /not a recognized environment/);
});

test('PORT is validated', () => {
  assert.equal(loadConfig({ APP_ENV: 'development', PORT: '8080' }).port, 8080);
  for (const bad of ['0', '65536', 'abc', '80.5', '-1']) {
    assert.match(problemsFor({ APP_ENV: 'development', PORT: bad }).join('\n'), /PORT must be/);
  }
});

test('production with all required variables loads', () => {
  const config = loadConfig(productionEnv());
  assert.equal(config.isProduction, true);
});

test('production fails when each required variable is missing', () => {
  for (const name of PRODUCTION_REQUIRED) {
    const env = productionEnv();
    delete env[name];
    const problems = problemsFor(env);
    assert.equal(problems.length, 1, `${name} should produce exactly one problem`);
    assert.match(problems[0], new RegExp(`${name} is required`));
  }
});

test('production fails when a required variable is blank', () => {
  assert.match(problemsFor(productionEnv({ KEY_VAULT_URI: '  ' })).join('\n'), /KEY_VAULT_URI is required/);
});

test('production rejects leftover placeholder values', () => {
  const problems = problemsFor(productionEnv({ ENTRA_TENANT_ID: PLACEHOLDER_MARKER }));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /ENTRA_TENANT_ID still contains the placeholder marker/);
});

test('error messages never include configured values', () => {
  const secretLooking = 'super-secret-value-12345';
  const env = productionEnv({
    PORT: secretLooking,
    ENTRA_CLIENT_ID: `${PLACEHOLDER_MARKER}${secretLooking}`,
  });
  delete env.KEY_VAULT_URI;
  let message = '';
  try {
    loadConfig(env);
  } catch (err) {
    message = err.message;
  }
  assert.ok(message.length > 0, 'expected a ConfigError');
  assert.ok(!message.includes(secretLooking), 'error message leaked a configured value');
  assert.ok(!message.includes('synthetic-'), 'error message leaked a configured value');

  const unknownEnv = problemsFor({ APP_ENV: secretLooking }).join('\n');
  assert.ok(!unknownEnv.includes(secretLooking), 'APP_ENV value was echoed');
});

test('all problems are reported together', () => {
  const problems = problemsFor({ APP_ENV: 'production', PORT: 'x' });
  assert.ok(problems.length > PRODUCTION_REQUIRED.length);
});
