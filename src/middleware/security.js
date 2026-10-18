/**
 * Security Middleware - Sanitization and Production Error Redaction
 * Source of Truth: PRD Task 16 / Security Pass
 */

export function enforceProductionSafety(env = process.env) {
  const isProd = env.NODE_ENV === 'production';
  const isDemoBypassActive = env.ALLOW_DEMO_BYPASS === 'true' || env.ENABLE_DEMO_MODE === 'true';

  if (isProd && isDemoBypassActive) {
    throw new Error('FATAL: Demo controls and bypass flags cannot be enabled in production environments.');
  }
}

export function validateEnvironment(env = process.env, requiredKeys = ['NODE_ENV', 'JWT_SECRET']) {
  const missing = requiredKeys.filter(key => !env[key]);
  if (missing.length > 0) {
    throw new Error(`FATAL: Missing required environment variables: ${missing.join(', ')}`);
  }
}

export function sanitizeLogData(data) {
  if (typeof data !== 'object' || data === null) return data;

  if (Array.isArray(data)) {
    return data.map(item => sanitizeLogData(item));
  }

  const sanitized = {};
  const sensitiveKeys = [
    'password', 'token', 'ssn', 'dob', 'client_name', 'email', 
    'participant_name', 'contact_value', 'referral_context', 'notes', 
    'participant_zip', 'phone', 'address'
  ];

  for (const [key, value] of Object.entries(data)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (sensitiveKeys.includes(normalizedKey)) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeLogData(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export function formatSafeError(err, env = process.env) {
  const isProd = env.NODE_ENV === 'production';
  const statusCode = err.statusCode || err.status || 500;

  if (isProd) {
    if (statusCode === 503) {
      return { error: 'Service Unavailable', statusCode: 503 };
    }
    if (statusCode === 500) {
      return { error: 'Internal Server Error', statusCode: 500 };
    }
  }

  return {
    error: err.message || 'An error occurred',
    statusCode,
    ...(isProd ? {} : { stack: err.stack })
  };
}
