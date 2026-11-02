// Reporting-specific error wording (Trello Task 228).
//
// Optional P1 hardening, not a Handoff PRD requirement. Reporting used to
// reuse referralErrors.invalidRequest, whose message ("The referral is not
// valid.") describes a referral, not a report request.
//
// Only the message changes. Status 400, code INVALID_REQUEST and the
// `fields` list (field names only, never values) stay exactly as before.
// The message is a fixed string and never contains request input
// (PRD 10.4, 15.4).
//
// It is still a ReferralError, so the reporting router's error handler and
// the final error handler's logging allowlist treat it exactly as before.

import { ReferralError } from '../referrals/errors.js';

export const reportingErrors = Object.freeze({
  invalidRequest: (fields) =>
    new ReferralError(400, 'INVALID_REQUEST', 'The report request is not valid.', { fields }),
});
