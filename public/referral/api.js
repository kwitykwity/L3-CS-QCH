// Calls to the QCH Connect backend for the Direct Referral page.
//
// Contract (cards 2 and 3):
//   GET  /api/programs                         -> { programs: [...] }
//   GET  /api/me/affiliation                   -> { status, program, version }
//   PUT  /api/me/affiliation  { programId, version }
//                                              -> { status, program, version }
//                                                 409 AFFILIATION_CHANGED { current } if stale
//   POST /api/referrals       { ...referral }  -> 201 RECEIVED / 200 ALREADY_RECEIVED
//   GET  /api/referrals/submissions/:id        -> { status: RECEIVED | NOT_RECEIVED }
//   GET  /api/gpme/need-categories             -> { needCategories: [...] }
//   POST /api/gpme/match  { needCategoryIds, ageRange?, participantZip? }
//                                              -> RESULTS | NO_PLAUSIBLE_MATCH,
//                                                 503 UNABLE_TO_MATCH
//   POST /api/gpme/interpret  { text }         -> INTERPRETED (proposed criteria),
//                                                 503 UNABLE_TO_INTERPRET
//   A GPME-assisted referral adds `gpme` (the same matching answers) to the
//   POST /api/referrals body.
//
// - Participant data only ever travels in a POST body, never in a URL
//   or query string (PRD 5.5). The Submission ID in the check URL is a
//   random identifier, not participant data.
// - Nothing is logged to the console (PRD 5.5, 15.3).
// - Every call returns { status, body } or { networkError: true }; it never
//   throws, so the page always reaches a defined state.

const TIMEOUT_MS = 15000;

async function call(method, url, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    let parsed = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    return { status: response.status, body: parsed };
  } catch {
    // Offline, timed out, or connection dropped: the outcome is unknown.
    return { networkError: true };
  } finally {
    clearTimeout(timer);
  }
}

export const api = Object.freeze({
  listPrograms: () => call('GET', '/api/programs'),
  getAffiliation: () => call('GET', '/api/me/affiliation'),
  // `version` is the one GET /api/me/affiliation returned (PRD 9.4).
  setAffiliation: (programId, version) => call('PUT', '/api/me/affiliation', { programId, version }),
  submitReferral: (body) => call('POST', '/api/referrals', body),
  listNeedCategories: () => call('GET', '/api/gpme/need-categories'),
  // Matching answers describe a participant, so they go in a POST body,
  // never in the URL (PRD 5.5).
  // The description reads the participant's situation, so it is a POST body
  // too, and is never stored or sent with the referral.
  interpretDescription: (text) => call('POST', '/api/gpme/interpret', { text }),
  matchPrograms: (answers) => call('POST', '/api/gpme/match', answers),
  checkSubmission: (submissionId) =>
    call('GET', `/api/referrals/submissions/${encodeURIComponent(submissionId)}`),
});
