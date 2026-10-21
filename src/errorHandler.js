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
export const MOUNT_POINTS = Object.freeze(['/api/referrals', '/api/program-management', '/api/reports', '/api/gpme', '/api']);

export function safeLocation(req) {
  const url = typeof req.originalUrl === 'string' ? req.originalUrl.split('?')[0] : '';
  const mount = MOUNT_POINTS.find((m) => url === m || url.startsWith(`${m}/`)) ?? '';
  const pattern = typeof req.route?.path === 'string' ? req.route.path : null;
  if (pattern !== null) return `${mount}${pattern === '/' && mount ? '' : pattern}` || '/';
  return mount ? `${mount} (no matching route)` : '(no matching route)';
}

// What may appear in a log line about an error (PRD 15.3, 15.4).
//
// An error object's `name` and `code` can hold any text: a library, a
// database driver, or code that copied request data into an error could
// put participant data, secrets or line breaks there (a forged second log
// line). So only names and codes on these fixed lists are logged; anything
// else is a fixed placeholder. Add to a list only values that are fixed
// identifiers, never text that can vary per request.
const LOGGABLE_NAMES = new Set([
  // JavaScript built-ins
  'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'AggregateError',
  // Express body parser (http-errors)
  'BadRequestError', 'PayloadTooLargeError', 'UnsupportedMediaTypeError', 'InternalServerError',
  // This application
  'ReferralError', 'AffiliationError', 'ProgramError', 'DuplicateSubmissionError', 'NotificationSendError', 'GpmeError',
]);

const LOGGABLE_CODES = new Set([
  // Node.js network and stream errors
  'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN',
  'ERR_HTTP_HEADERS_SENT', 'ERR_STREAM_PREMATURE_CLOSE', 'ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE',
  // SQL Server driver (mssql / tedious), for the future Azure SQL store
  'ELOGIN', 'ESOCKET', 'ETIMEOUT', 'EREQUEST', 'EABORT', 'ECANCEL', 'ENOCONN', 'ETRANSACTION',
  // This application's fixed error codes
  'INVALID_REQUEST', 'UNEXPECTED_FIELD', 'NOT_AUTHENTICATED', 'NOT_AUTHORIZED', 'USER_NOT_ACTIVE',
  'NOT_CONFIGURED', 'REFERRAL_NOT_FOUND', 'PROGRAM_NOT_FOUND', 'ALREADY_RESPONDED', 'SUBMISSION_ID_CONFLICT',
]);

const LOGGABLE_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

export function safeErrorName(err) {
  const name = err?.name;
  return typeof name === 'string' && LOGGABLE_NAMES.has(name) ? name : 'OtherError';
}

// null when the error has no code at all.
export function safeErrorCode(err) {
  const code = err?.code;
  if (code === undefined || code === null) return null;
  return typeof code === 'string' && LOGGABLE_CODES.has(code) ? code : 'OTHER';
}

function safeMethod(req) {
  return typeof req?.method === 'string' && LOGGABLE_METHODS.has(req.method) ? req.method : 'OTHER';
}

function resolveStatus(err) {
  const status = Number(err?.status ?? err?.statusCode);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

// Final Express error handler (PRD 15.3, 15.4).
//
// - Logs only safe metadata: method, the matched ROUTE PATTERN (for
//   example /api/referrals/:referralId), status, and an allowlisted error
//   name and code (anything else is "OtherError" / "OTHER").
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
  const code = safeErrorCode(err);

  console.error(
    `[error] ${safeMethod(req)} ${safeLocation(req)} -> ${status} (${safeErrorName(err)}${code ? ` code=${code}` : ''})`,
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
