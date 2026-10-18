/**
 * Security Middleware - PRD Compliant (§15)
 */

export function enforceProductionSafety(env = process.env) {
  const isProd = env.NODE_ENV === 'production';
  const isDemoBypassActive = env.ALLOW_DEMO_BYPASS === 'true' || env.ENABLE_DEMO_MODE === 'true';

  if (isProd && isDemoBypassActive) {
    throw new Error('FATAL: Demo controls and bypass flags cannot be enabled in production environments.');
  }
}

export function validateEnvironment(env = process.env, requiredKeys = ['NODE_ENV']) {
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
    'password', 'token', 'ssn', 'dob', 'clientname', 'email',
    'participantname', 'contactvalue', 'referralcontext', 'notes',
    'participantzip', 'phone', 'address'
  ];

  for (const [key, value] of Object.entries(data)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
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

const HTTP_STATUS_NAMES = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  500: 'Internal Server Error',
  503: 'Service Unavailable'
};

export function formatSafeError(err, env = process.env) {
  const isProd = env.NODE_ENV === 'production';
  const statusCode = err.statusCode || err.status || 500;

  if (isProd) {
    if (statusCode >= 500) {
      return { error: HTTP_STATUS_NAMES[statusCode] || 'Internal Server Error', statusCode };
    }
    // Rule 4: Return fixed safe status text for 4xx errors unless explicitly marked as a safe domain message
    if (!err.isTrustedDomainError) {
      return { error: HTTP_STATUS_NAMES[statusCode] || 'Bad Request', statusCode };
    }
  }

  return {
    error: err.message || 'An error occurred',
    statusCode,
    ...(isProd ? {} : { stack: err.stack })
  };
}
