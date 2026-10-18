import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSafeError, sanitizeLogData } from '../src/middleware/security.js';

test('Security & Production-Safety Test Suite', async (t) => {
  await t.test('Production Error Redaction (503 / 500)', async () => {
    const err503 = new Error('Database connection pool exhausted at tcp://sqlserver.internal:1433');
    err503.statusCode = 503;

    const formatted = formatSafeError(err503, { NODE_ENV: 'production' });
    assert.strictEqual(formatted.error, 'Service Unavailable');
    assert.strictEqual(formatted.statusCode, 503);
    assert.strictEqual(formatted.stack, undefined);
  });

  await t.test('Production 4xx Raw Message Redaction', async () => {
    const err400 = new Error('Internal SQL Syntax Error near line 1');
    err400.statusCode = 400;

    const formatted = formatSafeError(err400, { NODE_ENV: 'production' });
    assert.strictEqual(formatted.error, 'Bad Request');
    assert.strictEqual(formatted.statusCode, 400);
  });

  await t.test('Schema Participant PII Redaction', async () => {
    const payload = {
      participant_name: 'Jane Doe',
      contact_value: 'jane@example.com',
      referral_context: 'Sensitive intake context',
      notes: 'Private notes',
      participant_zip: '11355'
    };

    const sanitized = sanitizeLogData(payload);
    assert.strictEqual(sanitized.participant_name, '[REDACTED]');
    assert.strictEqual(sanitized.contact_value, '[REDACTED]');
    assert.strictEqual(sanitized.referral_context, '[REDACTED]');
    assert.strictEqual(sanitized.notes, '[REDACTED]');
    assert.strictEqual(sanitized.participant_zip, '[REDACTED]');
  });
});
