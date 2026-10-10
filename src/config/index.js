'use strict';

const {
  ENVIRONMENTS,
  PLACEHOLDER_MARKER,
  PRODUCTION_REQUIRED,
  DEFAULT_PORT,
} = require('./schema');

/**
 * Thrown when configuration is invalid. Messages name variables and rules only;
 * they never include configured values (PRD 15.3, 15.4).
 */
class ConfigError extends Error {
  constructor(problems) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

/**
 * Validate environment variables and return a frozen config object.
 * Fails closed: any problem throws ConfigError and the app must not start.
 *
 * @param {Record<string, string | undefined>} env defaults to process.env
 */
function loadConfig(env = process.env) {
  const problems = [];

  // APP_ENV: required everywhere; unknown values are rejected, never defaulted.
  const appEnv = isBlank(env.APP_ENV) ? undefined : String(env.APP_ENV).trim();
  if (appEnv === undefined) {
    problems.push(`APP_ENV is required. Allowed values: ${ENVIRONMENTS.join(', ')}.`);
  } else if (!ENVIRONMENTS.includes(appEnv)) {
    problems.push(`APP_ENV is not a recognized environment. Allowed values: ${ENVIRONMENTS.join(', ')}.`);
  }
  const isProduction = appEnv === 'production';

  // PORT: optional; integer 1-65535.
  let port = DEFAULT_PORT;
  if (!isBlank(env.PORT)) {
    const raw = String(env.PORT).trim();
    const parsed = Number(raw);
    if (!/^\d+$/.test(raw) || parsed < 1 || parsed > 65535) {
      problems.push('PORT must be an integer between 1 and 65535.');
    } else {
      port = parsed;
    }
  }

  // Production-only requirements (PRD 18.5): present and not a leftover placeholder.
  if (isProduction) {
    for (const name of PRODUCTION_REQUIRED) {
      if (isBlank(env[name])) {
        problems.push(`${name} is required when APP_ENV=production.`);
      } else if (String(env[name]).includes(PLACEHOLDER_MARKER)) {
        problems.push(`${name} still contains the placeholder marker; set the value provided by QCH IT.`);
      }
    }
  }

  if (problems.length > 0) {
    throw new ConfigError(problems);
  }

  return Object.freeze({
    appEnv,
    isProduction,
    port,
  });
}

module.exports = { loadConfig, ConfigError };
