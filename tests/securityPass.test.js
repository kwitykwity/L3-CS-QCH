const assert = require('assert');
const { enforceProductionSafety, validateEnvironment, sanitizeLogData, formatSafeError } = require('../src/middleware/security');

async function runSecurityTests() {
  console.log('Running Security & Production-Safety Test Suite...');

  // Test 1: Demo Controls Fail Closed in Production
  try {
    enforceProductionSafety({ NODE_ENV: 'production', ALLOW_DEMO_BYPASS: 'true' });
    assert.fail('Should have thrown fatal production safety error');
  } catch (err) {
    assert.match(err.message, /Demo controls and bypass flags cannot be enabled/);
    console.log('✔ Test 1 Passed: Demo Bypass Fails Closed in Production');
  }

  // Test 2: Environment Validation Flags Missing Required Keys
  try {
    validateEnvironment({ NODE_ENV: 'production' }, ['NODE_ENV', 'JWT_SECRET', 'DATABASE_URL']);
    assert.fail('Should have thrown missing env error');
  } catch (err) {
    assert.match(err.message, /Missing required environment variables/);
    console.log('✔ Test 2 Passed: Environment Validation Enforces Required Keys');
  }

  // Test 3: Sensitive Log Sanitization (PII Stripping)
  const rawLog = { user: 'admin', password: 'secret123', client_name: 'John Doe', token: 'bearer-123', programId: 'PROG-01' };
  const cleanLog = sanitizeLogData(rawLog);
  assert.strictEqual(cleanLog.password, '[REDACTED]');
  assert.strictEqual(cleanLog.client_name, '[REDACTED]');
  assert.strictEqual(cleanLog.token, '[REDACTED]');
  assert.strictEqual(cleanLog.programId, 'PROG-01');
  console.log('✔ Test 3 Passed: PII & Sensitive Credentials Redacted from Logs');

  // Test 4: Error Sanitization in Production Mode
  const rawErr = new Error('SELECT * FROM users WHERE id = 123 FAILED: DB Connection Lost');
  rawErr.stack = 'Error: stack trace details...';
  const prodErr = formatSafeError(rawErr, { NODE_ENV: 'production' });
  assert.strictEqual(prodErr.error, 'Internal Server Error');
  assert.strictEqual(prodErr.stack, undefined);
  console.log('✔ Test 4 Passed: Production Error Output Redacts Internal Stack Traces');

  console.log('All Security & Production-Safety tests passed successfully!');
}

runSecurityTests().catch(err => {
  console.error('Security Test execution failed:', err);
  process.exit(1);
});