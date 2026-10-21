// Server-side validation for a GPME match request (PRD 5.3, 8.2, 8.3,
// 10.3, 10.7).
//
// - Explicit allowlist: only need categories, an age range, and a ZIP.
//   Notes, Referral Context, identity, or anything else is rejected, so
//   hidden factors can never reach the engine (PRD 8.2, 10.3).
// - Need is required on the guided path (team decision, Oct 18). Without
//   it, the screen offers Direct Referral.
// - Age range and ZIP are optional. Leaving them out never blocks
//   matching (PRD 8.3). Age is a typed range, never a single exact age
//   requirement (team decision, Oct 18).
// - Errors name invalid fields only, never their values. An unexpected
//   property is reported without its name (PRD 10.4, 15.4).
// - Nothing here is stored or logged (PRD 5.3).

const ALLOWED_FIELDS = new Set(['needCategoryIds', 'ageRange', 'participantZip']);
const ALLOWED_AGE_FIELDS = new Set(['min', 'max']);

export const MAX_NEED_CATEGORIES = 50;
export const MAX_AGE = 120;
// Only three small fields are allowed, so 2 KB is generous (PRD 10.7).
export const MAX_BODY_BYTES = 2 * 1024;

const ZIP = /^\d{5}$/;

function isEmpty(value) {
  return value === undefined || value === null || value === '';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isAge(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_AGE;
}

// Returns { ok: true, value }, { ok: false, fields: [...] } with allowlisted
// field names only, or { ok: false, unexpectedField: true } with no names.
export function validateMatchRequest(body) {
  if (!isPlainObject(body)) return { ok: false, fields: [] };

  if (Object.keys(body).some((key) => !ALLOWED_FIELDS.has(key))) {
    return { ok: false, unexpectedField: true };
  }
  if (isPlainObject(body.ageRange)
    && Object.keys(body.ageRange).some((key) => !ALLOWED_AGE_FIELDS.has(key))) {
    return { ok: false, unexpectedField: true };
  }

  const fields = [];

  let needCategoryIds;
  const ids = body.needCategoryIds;
  if (
    Array.isArray(ids)
    && ids.length > 0
    && ids.length <= MAX_NEED_CATEGORIES
    && ids.every((id) => Number.isSafeInteger(id) && id > 0)
  ) {
    needCategoryIds = [...new Set(ids)].sort((a, b) => a - b);
  } else {
    fields.push('needCategoryIds');
  }

  let ageRange = null;
  if (!isEmpty(body.ageRange)) {
    const range = body.ageRange;
    if (isPlainObject(range) && isAge(range.min) && isAge(range.max) && range.min <= range.max) {
      ageRange = { min: range.min, max: range.max };
    } else {
      fields.push('ageRange');
    }
  }

  let participantZip = null;
  if (!isEmpty(body.participantZip)) {
    const zip = body.participantZip;
    if (typeof zip === 'string' && zip.length <= 10 && ZIP.test(zip.trim())) {
      participantZip = zip.trim();
    } else {
      fields.push('participantZip');
    }
  }

  if (fields.length > 0) return { ok: false, fields };
  return { ok: true, value: { needCategoryIds, ageRange, participantZip } };
}
