import { STATUS_CODES } from 'node:http';

// Use the status an upstream error carries (for example a 400 or 413 from
// Express or a body parser) when it is a real HTTP error code. Anything
// else becomes 500.
function resolveStatus(err) {
  const status = Number(err?.status ?? err?.statusCode);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

// Final Express error handler (PRD 15.3, 15.4).
//
// - Logs only safe metadata: method, path, status, and error name/code.
//   Never the full error object, its message, its stack, the request
//   body, or the query string, any of which can hold PII or secrets.
// - Clients get the standard HTTP status text, never err.message or a stack.
//   Every 5xx response is the same generic "Internal Server Error".
// - If the response has already started, the connection is closed. We do
//   not call next(err): Express's built-in handler would log err.stack.
//
// Express identifies error handlers by their four parameters, so `next`
// must stay in the signature even though it is not called.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status = resolveStatus(err);
  const name = typeof err?.name === 'string' ? err.name : 'UnknownError';
  const code = typeof err?.code === 'string' ? ` code=${err.code}` : '';

  console.error(
    `[error] ${req.method} ${req.path} -> ${status} (${name}${code})`,
  );

  if (res.headersSent) {
    res.destroy();
    return;
  }

  res.set('Cache-Control', 'no-store');
  res.status(status).json({
    error: status >= 500 ? 'Internal Server Error' : (STATUS_CODES[status] ?? 'Error'),
  });
}
