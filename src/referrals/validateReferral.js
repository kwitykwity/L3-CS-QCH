// Server-side validation for a new Direct Referral (PRD 5.2, 10.3, 10.7).
//
// - Explicit allowlist: any other field is rejected, so a client cannot set
//   identity, timestamps, lifecycle state, source, or Department context
//   (PRD 10.3).
// - Field limits match db/migrations/001_core_schema.sql (PR #4).
// - No DOB, SSN, or address fields exist (PRD 5.2).
// - Errors list the names of invalid fields only, never their values. A
//   property outside the allowlist is reported as a fixed "unexpected
//   field" error without its name: the name is arbitrary request content
//   and could itself carry participant data (PRD 10.4, 15.4).
// - Length limits apply to the text as sent, before trimming, so every
//   accepted request fits the HTTP body limit below (PRD 10.7).
//
// Exact limits and formats are engineering decisions (PRD 10.7, Section 22)
// and can be changed in one place here.

const ALLOWED_FIELDS = new Set([
  'submissionId',
  'receivingProgramId',
  'referringProgramId',
  'participantName',
  'contactMethod',
  'contactValue',
  'participantZip',
  'referralContext',
  'notes',
]);

export const CONTACT_METHODS = Object.freeze(['PHONE_CALL', 'PHONE_TEXT', 'EMAIL', 'NOT_AVAILABLE']);

export const LIMITS = Object.freeze({
  participantName: 200,
  contactValue: 320,
  referralContext: 4000,
  notes: 4000,
});

// The largest body an accepted referral can need, so the HTTP limit never
// rejects a valid referral (PRD 10.7). Lengths are UTF-16 code units, the
// same unit as JavaScript .length and SQL NVARCHAR. The worst case for one
// code unit is the 6-byte JSON escape "\uXXXX" (raw UTF-8 needs at most 3
// bytes), so 6 bytes per unit covers raw UTF-8, escaped JSON, and emoji.
// Fixed-size fields (Submission ID, IDs, ZIP, contact method) and JSON
// keys/punctuation fit comfortably in the 4 KB allowance, including
// pretty-printed JSON.
const WORST_CASE_BYTES_PER_UNIT = 6;
const STRUCTURE_ALLOWANCE_BYTES = 4 * 1024;
export const MAX_BODY_BYTES =
  WORST_CASE_BYTES_PER_UNIT * Object.values(LIMITS).reduce((a, b) => a + b, 0)
  + STRUCTURE_ALLOWANCE_BYTES;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZIP = /^\d{5}$/;
// Deliberately simple: one @, no spaces, a dot in the domain.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Digits plus common separators; 7 to 15 digits in total.
const PHONE_CHARS = /^[0-9+\-(). ]+$/;
// Control characters other than tab, newline, carriage return.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

// Returns the trimmed string, or undefined if the value is not usable text.
function cleanText(value, max, { singleLine = false } = {}) {
  if (typeof value !== 'string' || value.length > max) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (CONTROL_CHARS.test(trimmed)) return undefined;
  if (singleLine && /[\r\n\t]/.test(trimmed)) return undefined;
  return trimmed;
}

function isEmpty(value) {
  return value === undefined || value === null || value === '';
}

// Returns { ok: true, value }, { ok: false, fields: [...] } with allowlisted
// field names only, or { ok: false, unexpectedField: true } with no names.
export function validateDirectReferral(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, fields: [] };
  }

  if (Object.keys(body).some((key) => !ALLOWED_FIELDS.has(key))) {
    // Never echo the name: it is arbitrary request content.
    return { ok: false, unexpectedField: true };
  }

  const fields = [];

  const submissionId =
    typeof body.submissionId === 'string' && UUID.test(body.submissionId)
      ? body.submissionId.toLowerCase()
      : undefined;
  if (!submissionId) fields.push('submissionId');

  if (!isPositiveInteger(body.receivingProgramId)) fields.push('receivingProgramId');

  // Optional. If sent it must be an integer; whether it matches the user's
  // affiliation is checked later against authoritative data (PRD 3.9).
  let referringProgramId;
  if (!isEmpty(body.referringProgramId)) {
    if (isPositiveInteger(body.referringProgramId)) referringProgramId = body.referringProgramId;
    else fields.push('referringProgramId');
  }

  const participantName = cleanText(body.participantName, LIMITS.participantName, { singleLine: true });
  if (!participantName) fields.push('participantName');

  const contactMethod = CONTACT_METHODS.includes(body.contactMethod) ? body.contactMethod : undefined;
  if (!contactMethod) fields.push('contactMethod');

  let contactValue = null;
  if (contactMethod === 'NOT_AVAILABLE') {
    // Matches ck_referrals_contact_value: no value when no reliable contact.
    if (!isEmpty(body.contactValue)) fields.push('contactValue');
  } else if (contactMethod) {
    const text = cleanText(body.contactValue, LIMITS.contactValue, { singleLine: true });
    const valid =
      text !== undefined &&
      (contactMethod === 'EMAIL'
        ? EMAIL.test(text)
        : PHONE_CHARS.test(text) && (() => {
            const digits = text.replace(/\D/g, '').length;
            return digits >= 7 && digits <= 15;
          })());
    if (valid) contactValue = text;
    else fields.push('contactValue');
  }

  // Optional: unknown or unavailable ZIP does not block a referral (PRD 5.2).
  let participantZip = null;
  if (!isEmpty(body.participantZip)) {
    if (typeof body.participantZip === 'string' && body.participantZip.length <= 10
      && ZIP.test(body.participantZip.trim())) {
      participantZip = body.participantZip.trim();
    } else {
      fields.push('participantZip');
    }
  }

  const referralContext = cleanText(body.referralContext, LIMITS.referralContext);
  if (!referralContext) fields.push('referralContext');

  // Optional. Stored as plain text. How bold/italic is represented
  // (PRD 5.4, 14.6) is decided with the referral form UI card.
  let notes = null;
  if (!isEmpty(body.notes)) {
    const text = cleanText(body.notes, LIMITS.notes);
    if (text) notes = text;
    else fields.push('notes');
  }

  if (fields.length > 0) return { ok: false, fields };

  return {
    ok: true,
    value: {
      submissionId,
      receivingProgramId: body.receivingProgramId,
      referringProgramId,
      participantName,
      contactMethod,
      contactValue,
      participantZip,
      referralContext,
      notes,
    },
  };
}
