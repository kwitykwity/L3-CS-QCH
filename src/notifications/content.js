// New-referral notification content (PRD 11.2).
//
// TEAM TECHNICAL DECISION: every notification is generic. It takes no
// arguments on purpose, so no participant name, contact detail, ZIP,
// Referral Context, Notes, or Program detail can reach the subject or body.
// Recipients sign in to QCH Connect to see the referral.
//
// The exact wording is a team decision and can change here without
// touching the delivery logic. It does not link to the app yet: that needs
// an application URL setting QCH IT has not provided.

export const NEW_REFERRAL = 'NEW_REFERRAL';

const NEW_REFERRAL_MESSAGE = Object.freeze({
  subject: 'New referral in QCH Connect',
  body: [
    'A new referral has been sent to your Program in QCH Connect.',
    '',
    'Sign in to QCH Connect to view and respond to it.',
    '',
    'This message is sent automatically. Please do not reply.',
  ].join('\n'),
});

export function buildNewReferralMessage() {
  return NEW_REFERRAL_MESSAGE;
}
