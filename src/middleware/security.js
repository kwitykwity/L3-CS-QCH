/**
 * Security & Production-Safety Middleware
 * Source of Truth: QCH_Connect_Final_Tech_PRD_Oct14_2026.docx (Task 16 / Security Pass)
 */

/**
 * Ensures demo/bypass modes fail-closed when NODE_ENV is production.
 */
function enforceProductionSafety(env = process.env) {
  const isProd = env.NODE_ENV === 'production';
  const isDemoBypassActive = env.ALLOW_DEMO_BYPASS === 'true' || env.ENABLE_DEMO_MODE === 'true';

  if (isProd && isDemoBypassActive) {
    throw new Error('FATAL: Demo controls and bypass flags cannot be enabled in production environments.');
  }
}

/**
 * Validates mandatory environment configuration variables.
 */
function validateEnvironment(env = process.env, requiredKeys = ['NODE_ENV', 'JWT_SECRET']) {
  const missing = requiredKeys.filter(key => !env[key]);
  if (missing.length > 0) {
    throw new Error(`FATAL: Missing required environment variables: ${missing.join(', ')}`);
  }
}

/**
 * Sanitizes server logs by stripping PII, passwords, and tokens.
 */
function sanitizeLogData(data) {
  if (typeof data !== 'object' || data === null) return data;
  const sanitized = { ...data };
  const sensitiveKeys = ['password', 'token', 'ssn', 'dob', 'client_name', 'email'];
  
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.includes(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof sanitized[key] === 'object') {
      sanitized[key] = sanitizeLogData(sanitized[key]);
    }
  }
  return sanitized;
}

/**
 * Production safe error formatter. Strips stack traces and internal details in production.
 */
function formatSafeError(err, env = process.env) {
  const isProd = env.NODE_ENV === 'production';
  return {
    error: isProd && (!err.statusCode || err.statusCode === 500) ? 'Internal Server Error' : err.message,
    statusCode: err.statusCode || 500,
    ...(isProd ? {} : { stack: err.stack })
  };
}

module.exports = {
  enforceProductionSafety,
  validateEnvironment,
  sanitizeLogData,
  formatSafeError
};