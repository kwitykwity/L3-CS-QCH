// Server-side validation for Program maintenance requests (PRD 4.1, 4.2,
// 10.3, 10.7).
//
// - Explicit allowlist. Only the common Program information fields below
//   can be changed here. Name, Department, routing (notification email),
//   lifecycle status, and GPME matching facts are NOT editable through this
//   request, so a client cannot change them by adding a property
//   (PRD 4.2: core identity, routing, and security fields; PRD 10.3).
// - Text: a string or null. Trimmed; empty or whitespace-only means
//   "clear" (null). Limits count the text as sent, before trimming.
// - `version` from the last read is required (PRD 9.4, 13.4).
// - Errors name allowlisted fields only. An unexpected property is
//   reported without its name (PRD 10.4, 15.4).
//
// Limits match db/migrations/001_core_schema.sql where the column has
// one; NVARCHAR(MAX) columns get an engineering limit (PRD 10.7).

export const EDITABLE_FIELDS = Object.freeze({
  site: { column: 'site', max: 200, singleLine: true },
  description: { column: 'description', max: 4000 },
  eligibilityNotes: { column: 'eligibility_notes', max: 4000 },
  scheduleNotes: { column: 'schedule_notes', max: 2000 },
  costNotes: { column: 'cost_notes', max: 1000 },
});

const VERSION_MAX = 64;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

// The largest accepted body (6 bytes per UTF-16 unit covers escaped JSON,
// plus room for keys and punctuation), so a valid request always fits.
export const MAX_BODY_BYTES =
  6 * Object.values(EDITABLE_FIELDS).reduce((sum, f) => sum + f.max, 0) + 4 * 1024;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const validVersion = (v) => typeof v === 'string' && v.length > 0 && v.length <= VERSION_MAX;

// Returns the cleaned value (string or null), or undefined if invalid.
function cleanText(value, { max, singleLine }) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > max) return undefined;
  const text = value.trim();
  if (text.length === 0) return null;
  if (CONTROL_CHARS.test(text)) return undefined;
  if (singleLine && /[\r\n\t]/.test(text)) return undefined;
  return text;
}

// PATCH body: { version, <one or more editable fields> }.
export function validateProgramDetails(body) {
  if (!isPlainObject(body)) return { ok: false, fields: [] };
  const allowed = new Set(['version', ...Object.keys(EDITABLE_FIELDS)]);
  if (Object.keys(body).some((k) => !allowed.has(k))) return { ok: false, unexpectedField: true };

  const fields = [];
  if (!validVersion(body.version)) fields.push('version');

  const changes = {};
  for (const [name, rule] of Object.entries(EDITABLE_FIELDS)) {
    if (!(name in body)) continue;
    const value = cleanText(body[name], rule);
    if (value === undefined) fields.push(name);
    else changes[name] = value;
  }
  if (fields.length === 0 && Object.keys(changes).length === 0) fields.push('changes');

  if (fields.length > 0) return { ok: false, fields };
  return { ok: true, value: { version: body.version, changes } };
}

// Discontinue / reactivate body: { version }.
export function validateLifecycleChange(body) {
  if (!isPlainObject(body)) return { ok: false, fields: [] };
  if (Object.keys(body).some((k) => k !== 'version')) return { ok: false, unexpectedField: true };
  if (!validVersion(body.version)) return { ok: false, fields: ['version'] };
  return { ok: true, value: { version: body.version } };
}
