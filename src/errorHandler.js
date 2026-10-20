import { STATUS_CODES } from 'node:http';

// Use the status an upstream error carries (for example a 400 or 413 from
// Express or a body parser) when it is a real HTTP error code. Anything
// else becomes 500.
// Where the error happened, without any client-supplied text: the mount
// point plus the matched route pattern (for example
// /api/referrals/:referralId), or only the mount point when no route
// matched. By the time this app-level handler runs, Express has reset
// req.baseUrl, so the mount point is chosen from this fixed list by
// prefix; the request path itself is never copied. Keep the list in step
// with the app.use() mounts in app.js (a test checks this).
export const MOUNT_POINTS = Object.freeze(['/api/referrals', '/api']);

export function safeLocation(req) {
  const url = typeof req.originalUrl === 'string' ? req.originalUrl.split('?')[0] : '';
  const mount = MOUNT_POINTS.find((m) => url === m || url.startsWith(`${m}/`)) ?? '';
  const pattern = typeof req.route?.path === 'string' ? req.route.path : null;
  if (pattern !== null) return `${mount}${pattern === '/' && mount ? '' : pattern}` || '/';
  return mount ? `${mount} (no matching route)` : '(no matching route)';
}

function resolveStatus(err) {
  const status = Number(err?.status ?? err?.statusCode);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

// Final Express error handler (PRD 15.3, 15.4).
//
// - Logs only safe metadata: method, the matched ROUTE PATTERN (for
//   example /api/referrals/:referralId), status, and error name/code.
//   Never the raw request path, which is text the client chose and could
//   hold participant data typed into a URL by mistake (PRD 5.5, 15.3), and
//   never the full error object, its message, its stack, the request body,
//   or the query string, any of which can hold PII or secrets.
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
    `[error] ${req.method} ${safeLocation(req)} -> ${status} (${name}${code})`,
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
