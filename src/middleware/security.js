/**
 * Security & Production-Safety Middleware
 * Source of Truth: QCH_Connect_Final_Tech_PRD_Oct14_2026.docx (Task 16 / Security Pass)
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
  const sensitiveKeys = ['password', 'token', 'ssn', 'dob', 'client_name', 'email', 'participant_name', 'notes', 'phone'];

  for (const [key, value] of Object.entries(data)) {
    if (sensitiveKeys.includes(key.toLowerCase())) {
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
  return {
    error: isProd && statusCode === 500 ? 'Internal Server Error' : (err.message || 'An error occurred'),
    statusCode,
    ...(isProd ? {} : { stack: err.stack })
  };
}
