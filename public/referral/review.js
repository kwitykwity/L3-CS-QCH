// Review and submit (Task 227; Written Wireframe Page 8): what the worker
// checks before sending.
//
// Pure function: given the referral form values and the two Program names,
// return the rows the Review step shows. No DOM access, so this module
// also runs under Node for tests.
//
// Privacy (PRD 5.5): only the referral fields are passed in. Participant
// age and the Find a Program description are never given to this module,
// so they cannot appear on the Review step.

import { CONTACT_METHODS } from './validation.js';

// values: the same object readForm() passes to validateReferralForm().
// receiving, referring: Program names (referring may be a "not set" note).
// Returns [[term, value], ...] in the order shown. Values are trimmed the
// same way toRequestBody() trims them, so the worker sees what is sent.
export function reviewRows(values, { receiving, referring }) {
  const trim = (v) => (v ?? '').trim();
  const method = CONTACT_METHODS.find((m) => m.value === values.contactMethod);
  const rows = [
    ['Receiving Program', receiving],
    ['Referring Program', referring],
    ['Participant name', trim(values.participantName)],
    ['Best way to reach them', method?.label ?? ''],
  ];
  if (values.contactMethod !== 'NOT_AVAILABLE') {
    rows.push([values.contactMethod === 'EMAIL' ? 'Email address' : 'Phone number', trim(values.contactValue)]);
  }
  if (trim(values.participantZip)) rows.push(['ZIP code', trim(values.participantZip)]);
  rows.push(['Referral context', trim(values.referralContext)]);
  if (trim(values.notes)) rows.push(['Notes', trim(values.notes)]);
  return rows;
}
