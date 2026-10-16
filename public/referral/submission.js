// Submission and recovery states for a Direct Referral
// (PRD 7.1 to 7.5, 13.2, 13.3).
//
// Pure functions: given what the server answered (or that it could not be
// reached), decide what the worker sees and what they may do next.
// No DOM access, so this module also runs under Node for tests.
//
// Rules:
// - Success is shown ONLY after the server confirms the committed referral
//   (PRD 7.2). A click is never treated as success.
// - Locked user-facing copy (PRD 7.4), including the space before "!":
export const MESSAGES = Object.freeze({
  SENDING: 'Sending referral ...',
  RECEIVED: 'Referral received !',
  NOT_CONFIRMED: 'Referral not confirmed !',
  ALREADY_RECEIVED: 'Referral already received. Do not resend !',
  NOT_RECEIVED: 'Referral was not received. Your information has been preserved. You may safely resend !',
});

// Each result tells the page:
//   state        - name of the state
//   message      - text for the status area (locked copy where the PRD has it)
//   tone         - 'success' | 'error' | 'info' (styling only; never the sole signal)
//   canResend    - may the worker press Send again with the SAME Submission ID?
//   formLocked   - should the fields be read-only? (true while the outcome is unknown)
//   keepInput    - keep the worker's entered information? (PRD 7.5)
//   needsCheck   - run the safe status check next (PRD 7.4)
//   newSubmissionId - start a new logical submission (new ID)
//   fieldErrors  - server-reported invalid field names
//   next         - optional follow-up the page should offer

export function sendingState() {
  return { state: 'SENDING', message: MESSAGES.SENDING, tone: 'info', canResend: false, formLocked: true, keepInput: true };
}

const unconfirmed = () => ({
  state: 'NOT_CONFIRMED',
  message: MESSAGES.NOT_CONFIRMED,
  tone: 'error',
  canResend: false,     // unknown outcome: resending could look like a duplicate
  formLocked: true,     // editing now could change a referral that was received
  keepInput: true,
  needsCheck: true,
});

// response: { networkError: true } or { status, body } from the POST.
export function interpretSubmitResponse(response) {
  if (!response || response.networkError) return unconfirmed();

  const { status, body } = response;
  const code = body?.code;

  if (status === 201 && body?.status === 'RECEIVED') {
    return { state: 'RECEIVED', message: MESSAGES.RECEIVED, tone: 'success', referral: body.referral, keepInput: false, formLocked: true, canResend: false };
  }
  if (status === 200 && body?.status === 'ALREADY_RECEIVED') {
    return { state: 'ALREADY_RECEIVED', message: MESSAGES.ALREADY_RECEIVED, tone: 'success', referral: body.referral, keepInput: false, formLocked: true, canResend: false };
  }
  if (status === 400 && code === 'INVALID_REQUEST') {
    return {
      state: 'INVALID', message: 'Some information needs attention. Nothing was sent.', tone: 'error',
      fieldErrors: Array.isArray(body.fields) ? body.fields : [], keepInput: true, formLocked: false, canResend: true,
    };
  }
  if (status === 409 && (code === 'AFFILIATION_REQUIRED' || code === 'AFFILIATION_PROGRAM_NOT_ACTIVE')) {
    return {
      state: 'AFFILIATION_NEEDED', message: body.error, tone: 'error', next: 'CHOOSE_AFFILIATION',
      keepInput: true, formLocked: false, canResend: true,
    };
  }
  if (status === 422 && code === 'REFERRING_PROGRAM_MISMATCH') {
    // Affiliation changed elsewhere (e.g. another tab). Reload it, then resend.
    return {
      state: 'AFFILIATION_CHANGED', message: 'Your Program affiliation changed. Check it, then send again.', tone: 'error',
      next: 'RELOAD_AFFILIATION', keepInput: true, formLocked: false, canResend: true,
    };
  }
  if (status === 422 && code === 'RECEIVING_PROGRAM_NOT_SELECTABLE') {
    return {
      state: 'PROGRAM_UNAVAILABLE', message: body.error, tone: 'error', next: 'CHOOSE_PROGRAM',
      keepInput: true, formLocked: false, canResend: true,
    };
  }
  if (status === 409 && code === 'SUBMISSION_ID_CONFLICT') {
    // Should not happen with this page; start a fresh logical submission.
    return {
      state: 'CONFLICT', message: 'This referral could not be matched to an earlier attempt. Your information has been preserved. Review it and send again.',
      tone: 'error', keepInput: true, formLocked: false, canResend: true, newSubmissionId: true,
    };
  }
  if (status === 401 || status === 403) {
    return {
      state: 'NOT_SIGNED_IN', message: 'Your sign-in is not active. Your information has been preserved on this page. Sign in again, then send.',
      tone: 'error', keepInput: true, formLocked: false, canResend: true,
    };
  }
  // 5xx, 503, or anything unexpected: the outcome is unknown.
  return unconfirmed();
}

// response: { networkError: true } or { status, body } from the safe check.
export function interpretCheckResponse(response) {
  if (response && !response.networkError && response.status === 200) {
    if (response.body?.status === 'RECEIVED') {
      return { state: 'ALREADY_RECEIVED', message: MESSAGES.ALREADY_RECEIVED, tone: 'success', referral: response.body.referral, keepInput: false, formLocked: true, canResend: false };
    }
    if (response.body?.status === 'NOT_RECEIVED') {
      // Safe to resend with the same Submission ID (PRD 7.3, 7.4).
      return { state: 'NOT_RECEIVED', message: MESSAGES.NOT_RECEIVED, tone: 'info', keepInput: true, formLocked: false, canResend: true };
    }
  }
  // Still unknown. Stay locked and let the worker check again.
  return { ...unconfirmed(), needsCheck: false, next: 'CHECK_AGAIN' };
}
