// Configuration is validated explicitly and fails closed (PRD 18.5):
// a missing or unrecognized value stops startup instead of falling back
// to a default. This module has no side effects; server.js loads .env and
// calls loadConfig(process.env).

export const ALLOWED_NODE_ENVS = Object.freeze(['development', 'test', 'production']);

export function loadConfig(env) {
  const nodeEnv = env.NODE_ENV;

  // Exact match only. Unset, empty, mistyped, or differently cased values
  // are rejected. The value itself is not echoed back in the error.
  if (!ALLOWED_NODE_ENVS.includes(nodeEnv)) {
    throw new Error(
      `NODE_ENV must be set to one of: ${ALLOWED_NODE_ENVS.join(', ')}`,
    );
  }

  const port = Number.parseInt(env.PORT ?? '3000', 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  return Object.freeze({ port, nodeEnv });
}
