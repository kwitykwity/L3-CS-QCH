// Client-side validation for the Direct Referral form (PRD 10.3, 14.3).
//
// This is for usability only. The server (src/referrals/validateReferral.js)
// is authoritative and re-validates everything. The rules here mirror the
// server's so staff see problems before submitting; a parity test in
// test/referralUi.test.js keeps the two in step.
//
// No DOM access: this module also runs under Node for tests.

export const CONTACT_METHODS = Object.freeze([
  { value: 'PHONE_CALL', label: 'Phone call' },
  { value: 'PHONE_TEXT', label: 'Phone text' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'NOT_AVAILABLE', label: 'No reliable contact' },
]);

export const LIMITS = Object.freeze({
  participantName: 200,
  contactValue: 320,
  referralContext: 4000,
  notes: 4000,
});

const ZIP = /^\d{5}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_CHARS = /^[0-9+\-(). ]+$/;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

// Order matches the order of fields on the form, so the first error found
// is the first invalid field on screen (PRD 14.3).
export const FIELD_ORDER = Object.freeze([
  'participantName',
  'contactMethod',
  'contactValue',
  'participantZip',
  'referralContext',
  'notes',
]);

const MESSAGES = Object.freeze({
  participantName: {
    required: "Enter the participant's name.",
    tooLong: `Use ${LIMITS.participantName} characters or fewer.`,
    invalid: 'Use a single line with no special control characters.',
  },
  contactMethod: { required: 'Choose the best way to reach the participant.' },
  contactValue: {
    phone: 'Enter a phone number with 7 to 15 digits.',
    email: 'Enter an email address, for example name@example.org.',
  },
  participantZip: { invalid: 'Enter a 5-digit ZIP code, or leave it empty.' },
  referralContext: {
    required: 'Describe what the participant needs.',
    tooLong: `Use ${LIMITS.referralContext} characters or fewer.`,
    invalid: 'Remove special control characters.',
  },
  notes: {
    tooLong: `Use ${LIMITS.notes} characters or fewer.`,
    invalid: 'Remove special control characters.',
  },
});

// Human-readable error for a field the SERVER rejected (it returns field
// names only, never reasons).
export const SERVER_FIELD_MESSAGES = Object.freeze({
  participantName: "Check the participant's name.",
  contactMethod: 'Choose the best way to reach the participant.',
  contactValue: 'Check the contact details.',
  participantZip: 'Enter a 5-digit ZIP code, or leave it empty.',
  referralContext: 'Check what the participant needs.',
  notes: 'Check the notes.',
});

function textProblem(value, max, { required, singleLine = false }) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length === 0) return required ? 'required' : null;
  if (trimmed.length > max) return 'tooLong';
  if (CONTROL_CHARS.test(trimmed)) return 'invalid';
  if (singleLine && /[\r\n\t]/.test(trimmed)) return 'invalid';
  return null;
}

function phoneOk(value) {
  if (!PHONE_CHARS.test(value)) return false;
  const digits = value.replace(/\D/g, '').length;
  return digits >= 7 && digits <= 15;
}

// values: { participantName, contactMethod, contactValue, participantZip,
//           referralContext, notes } as strings from the form.
// Returns { [field]: message } for every invalid field; empty when valid.
export function validateReferralForm(values) {
  const errors = {};

  const nameProblem = textProblem(values.participantName, LIMITS.participantName, {
    required: true,
    singleLine: true,
  });
  if (nameProblem) errors.participantName = MESSAGES.participantName[nameProblem];

  const method = values.contactMethod;
  if (!CONTACT_METHODS.some((m) => m.value === method)) {
    errors.contactMethod = MESSAGES.contactMethod.required;
  } else {
    const contact = (values.contactValue ?? '').trim();
    // With NOT_AVAILABLE the contact field is hidden and always sent as null
    // (see toRequestBody), so there is nothing for the worker to fix.
    if (method !== 'NOT_AVAILABLE') {
      const tooLong = contact.length > LIMITS.contactValue;
      const ok = !tooLong && contact.length > 0 && !CONTROL_CHARS.test(contact) &&
        (method === 'EMAIL' ? EMAIL.test(contact) : phoneOk(contact));
      if (!ok) errors.contactValue = method === 'EMAIL' ? MESSAGES.contactValue.email : MESSAGES.contactValue.phone;
    }
  }

  const zip = (values.participantZip ?? '').trim();
  if (zip.length > 0 && !ZIP.test(zip)) errors.participantZip = MESSAGES.participantZip.invalid;

  const contextProblem = textProblem(values.referralContext, LIMITS.referralContext, { required: true });
  if (contextProblem) errors.referralContext = MESSAGES.referralContext[contextProblem];

  const notesProblem = textProblem(values.notes, LIMITS.notes, { required: false });
  if (notesProblem) errors.notes = MESSAGES.notes[notesProblem];

  return errors;
}

export function firstInvalidField(errors) {
  return FIELD_ORDER.find((field) => field in errors) ?? null;
}

// Builds the request body the server expects. Empty optional values are
// sent as null. Only allowlisted fields are ever included (PRD 10.3).
export function toRequestBody(values, { submissionId, receivingProgramId }) {
  const blankToNull = (v) => {
    const t = (v ?? '').trim();
    return t.length > 0 ? t : null;
  };
  return {
    submissionId,
    receivingProgramId,
    participantName: values.participantName.trim(),
    contactMethod: values.contactMethod,
    contactValue: values.contactMethod === 'NOT_AVAILABLE' ? null : blankToNull(values.contactValue),
    participantZip: blankToNull(values.participantZip),
    referralContext: values.referralContext.trim(),
    notes: blankToNull(values.notes),
  };
}
