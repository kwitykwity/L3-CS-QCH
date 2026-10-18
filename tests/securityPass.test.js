import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { errorHandler } from '../src/errorHandler.js';

test('Security & Production-Safety Test Suite', async (t) => {
  await t.test('Fails closed on missing or invalid NODE_ENV', async () => {
    assert.throws(() => {
      loadConfig({ NODE_ENV: 'invalid_env' });
    });
  });

  await t.test('Production Error Handler Redacts Internal Details', async () => {
    let statusCode = 0;
    let jsonBody = null;

    const req = {};
    const res = {
      headersSent: false,
      set() {
        return this;
      },
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        jsonBody = body;
        return this;
      }
    };

    const error = new Error('Sensitive SQL details');
    errorHandler(error, req, res, () => {});

    assert.strictEqual(statusCode, 500);
    assert.strictEqual(jsonBody.error, 'Internal Server Error');
    assert.strictEqual(jsonBody.stack, undefined);
  });
});
