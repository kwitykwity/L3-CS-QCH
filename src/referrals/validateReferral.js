// Server-side validation for a new Direct Referral (PRD 5.2, 10.3, 10.7).
//
// - Explicit allowlist: any other field is rejected, so a client cannot set
//   identity, timestamps, lifecycle state, source, or Department context
//   (PRD 10.3).
// - Field limits match db/migrations/001_core_schema.sql (PR #4).
// - No DOB, SSN, or address fields exist (PRD 5.2).
// - Errors list the names of invalid fields only, never their values.
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
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return undefined;
  if (CONTROL_CHARS.test(trimmed)) return undefined;
  if (singleLine && /[\r\n\t]/.test(trimmed)) return undefined;
  return trimmed;
}

function isEmpty(value) {
  return value === undefined || value === null || value === '';
}

// Returns { ok: true, value } or { ok: false, fields: [...] }.
export function validateDirectReferral(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, fields: [] };
  }

  const fields = [];
  const unknown = Object.keys(body).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unknown.length > 0) {
    // Field names only; values are never echoed.
    return { ok: false, fields: unknown.sort() };
  }

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
    if (typeof body.participantZip === 'string' && ZIP.test(body.participantZip.trim())) {
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
