import test from 'node:test';
import assert from 'node:assert/strict';
import { enforceProductionSafety, validateEnvironment, sanitizeLogData } from '../src/middleware/security.js';

test('Security & Production-Safety Test Suite', async (t) => {
  await t.test('Fails closed on missing or invalid NODE_ENV', async () => {
    assert.throws(
      () => {
        enforceProductionSafety({ NODE_ENV: 'production', ALLOW_DEMO_BYPASS: 'true' });
      },
      (err) => err.message.includes('FATAL: Demo controls and bypass flags cannot be enabled')
    );

    assert.throws(
      () => {
        validateEnvironment({ NODE_ENV: 'production' }, ['NODE_ENV', 'JWT_SECRET']);
      },
      (err) => err.message.includes('FATAL: Missing required environment variables')
    );
  });

  await t.test('Production Error Handler Redacts Internal Details', async () => {
    const rawPayload = {
      user: 'admin',
      ssn: '000-00-0000',
      token: 'secret-auth-token',
      nested: { password: 'my-password' }
    };

    const sanitized = sanitizeLogData(rawPayload);
    assert.strictEqual(sanitized.ssn, '[REDACTED]');
    assert.strictEqual(sanitized.token, '[REDACTED]');
    assert.strictEqual(sanitized.nested.password, '[REDACTED]');
    assert.strictEqual(sanitized.user, 'admin');
  });
});
