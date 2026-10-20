// Guided Program Matching (GPME) screen logic (Trello card 11), against the
// Final Technical PRD 2.1, 5.3, 5.5, 8.1 to 8.10, 14.3.
//
// Pure functions: no DOM, so they also run under Node for tests.
//
// Rules this module keeps:
// - "No plausible match identified" is a valid result. "Unable to perform
//   matching" is a technical failure. They are separate states with
//   separate wording and are never mixed up (PRD 8.5).
// - On a technical failure the worker's answers stay on screen and the
//   page offers Try again or Direct Referral (PRD 8.8).
// - Results are suggestions for a person to review. No scores, no "best
//   match", no eligibility claims (PRD 8.1, 8.6). Programs in the same
//   group are equals; the list order is alphabetical, not a ranking
//   (PRD 8.4).
// - Only need categories, an age range and a ZIP are ever sent to
//   matching (PRD 8.2). Matching answers are not saved with the referral
//   (PRD 5.3).

export const GUIDED_MESSAGES = Object.freeze({
  SEARCHING: 'Finding Programs ...',
  NO_PLAUSIBLE_MATCH:
    'No plausible match identified. This does not mean QCH has no appropriate Program. '
    + 'You can change your answers, or use Direct Referral if you know a Program.',
  UNABLE_TO_MATCH:
    'Unable to perform matching right now. This is a technical problem, not a result. '
    + 'Your answers are still here. Try again, or use Direct Referral.',
  CATEGORIES_UNAVAILABLE:
    'Need categories could not be loaded. Try again, or use Direct Referral.',
  NOT_SIGNED_IN: 'Your sign-in is not active. Your answers are still here. Sign in again, then try again.',
  INVALID: 'Some answers need attention. Nothing was searched.',
  RESULTS_CLEARED: 'Your answers changed, so the earlier results were cleared. Choose Find Programs to search again.',
  RESULT_CHANGED:
    'The matching results changed after your search. Nothing was sent. '
    + 'Your information has been preserved. Review the current results and choose a Program.',
  GPME_UNAVAILABLE:
    'Matching could not be confirmed, so the referral was not saved. Your information has been preserved. '
    + 'Send again, or send it to the same Program as a Direct Referral.',
  ORDER_NOTE: 'Listed by Department, then Program name. The order does not rank them.',
  SUGGESTION_NOTE: 'These are suggestions to help you choose. They are not an eligibility decision. You choose the Program, and the receiving Program decides.',
});

export const GUIDED_FIELD_MESSAGES = Object.freeze({
  needs: 'Choose at least one need.',
  ageRange: {
    incomplete: 'Enter both ages, or leave both blank.',
    invalid: 'Enter whole ages from 0 to 120.',
    order: 'The first age must not be greater than the second.',
  },
  matchZip: 'Enter a 5-digit ZIP code, or leave it blank.',
});

// Same limits as src/gpme/validateMatchRequest.js.
export const MAX_AGE = 120;
const WHOLE_AGE = /^\d{1,3}$/;
const ZIP = /^\d{5}$/;

// Order of fields on screen, for moving focus to the first problem.
export const GUIDED_FIELD_ORDER = Object.freeze(['needs', 'ageRange', 'matchZip']);

// values: { needCategoryIds: number[], ageMin: string, ageMax: string, matchZip: string }
// Returns { field: message } for each problem; {} when the answers can be sent.
export function validateGuidedForm(values) {
  const errors = {};
  if (!Array.isArray(values.needCategoryIds) || values.needCategoryIds.length === 0) {
    errors.needs = GUIDED_FIELD_MESSAGES.needs;
  }

  const min = (values.ageMin ?? '').trim();
  const max = (values.ageMax ?? '').trim();
  if (min || max) {
    if (!min || !max) errors.ageRange = GUIDED_FIELD_MESSAGES.ageRange.incomplete;
    else if (!WHOLE_AGE.test(min) || !WHOLE_AGE.test(max) || Number(min) > MAX_AGE || Number(max) > MAX_AGE) {
      errors.ageRange = GUIDED_FIELD_MESSAGES.ageRange.invalid;
    } else if (Number(min) > Number(max)) errors.ageRange = GUIDED_FIELD_MESSAGES.ageRange.order;
  }

  const zip = (values.matchZip ?? '').trim();
  if (zip && !ZIP.test(zip)) errors.matchZip = GUIDED_FIELD_MESSAGES.matchZip;
  return errors;
}

export function firstGuidedError(errors) {
  return GUIDED_FIELD_ORDER.find((field) => field in errors) ?? null;
}

// The exact body for POST /api/gpme/match, and the `gpme` part of a
// GPME-assisted referral. Only the three approved inputs (PRD 8.2); blank
// optional answers are left out.
export function toMatchRequest(values) {
  const body = { needCategoryIds: [...new Set(values.needCategoryIds)].sort((a, b) => a - b) };
  const min = (values.ageMin ?? '').trim();
  const max = (values.ageMax ?? '').trim();
  if (min && max) body.ageRange = { min: Number(min), max: Number(max) };
  const zip = (values.matchZip ?? '').trim();
  if (zip) body.participantZip = zip;
  return body;
}

// Server fields the guided form shows errors for.
const SERVER_FIELD_TO_FORM = Object.freeze({
  needCategoryIds: 'needs',
  ageRange: 'ageRange',
  participantZip: 'matchZip',
});

function isProgram(item) {
  return Boolean(item && typeof item === 'object'
    && Number.isSafeInteger(item.programId) && item.programId > 0
    && typeof item.name === 'string'
    && Array.isArray(item.explanations) && item.explanations.every((e) => typeof e === 'string'));
}

function unable() {
  return { state: 'UNABLE_TO_MATCH', message: GUIDED_MESSAGES.UNABLE_TO_MATCH, tone: 'error', canRetry: true, offerDirect: true };
}

// response: { networkError: true } or { status, body } from POST /api/gpme/match.
// Each result tells the page:
//   state    RESULTS | NO_PLAUSIBLE_MATCH | UNABLE_TO_MATCH | INVALID | NOT_SIGNED_IN
//   message  text for the guided message area (null for RESULTS)
//   tone     'info' | 'error'
//   canRetry show "Try again" (technical failure only)
//   offerDirect show "Use Direct Referral"
//   plausible, possible, notCheckedForNeedCount, ruleVersion (results)
//   fieldErrors  form field names to mark (INVALID)
export function interpretMatchResponse(response) {
  if (!response || response.networkError) return unable();
  const { status, body } = response;

  if (status === 200 && body?.status === 'RESULTS'
    && Array.isArray(body.plausible) && Array.isArray(body.possible)
    && [...body.plausible, ...body.possible].every(isProgram)
    && body.plausible.length + body.possible.length > 0) {
    return {
      state: 'RESULTS',
      message: null,
      tone: 'info',
      plausible: body.plausible,
      possible: body.possible,
      notCheckedForNeedCount: Number.isSafeInteger(body.notCheckedForNeedCount) ? body.notCheckedForNeedCount : 0,
      ruleVersion: body.ruleVersion ?? null,
      canRetry: false,
      offerDirect: false,
    };
  }
  if (status === 200 && body?.status === 'NO_PLAUSIBLE_MATCH') {
    return {
      state: 'NO_PLAUSIBLE_MATCH',
      message: GUIDED_MESSAGES.NO_PLAUSIBLE_MATCH,
      tone: 'info',
      plausible: [],
      possible: [],
      notCheckedForNeedCount: Number.isSafeInteger(body.notCheckedForNeedCount) ? body.notCheckedForNeedCount : 0,
      canRetry: false,
      offerDirect: true,
    };
  }
  if (status === 400 && body?.code === 'INVALID_REQUEST') {
    const fieldErrors = (Array.isArray(body.fields) ? body.fields : [])
      .map((f) => SERVER_FIELD_TO_FORM[f]).filter(Boolean);
    return {
      state: 'INVALID', message: GUIDED_MESSAGES.INVALID, tone: 'error',
      fieldErrors: fieldErrors.length > 0 ? fieldErrors : ['needs'], canRetry: false, offerDirect: false,
    };
  }
  if (status === 401 || status === 403) {
    return { state: 'NOT_SIGNED_IN', message: GUIDED_MESSAGES.NOT_SIGNED_IN, tone: 'error', canRetry: true, offerDirect: false };
  }
  // 503 UNABLE_TO_MATCH, any other status, or a malformed body: a technical
  // failure, never shown as "no plausible match".
  return unable();
}

// "N Programs have no need categories on file ..." (PRD 8.10): those
// Programs were not evaluated, so the page says so instead of implying
// they were found unsuitable.
export function notCheckedNote(count) {
  if (!Number.isSafeInteger(count) || count <= 0) return null;
  const programs = count === 1 ? '1 Program has' : `${count} Programs have`;
  return `${programs} no need categories on file, so matching could not check ${count === 1 ? 'it' : 'them'}. `
    + 'If you know one of them fits, use Direct Referral.';
}

// Need categories for the form. Anything malformed is a technical failure.
export function interpretCategoriesResponse(response) {
  if (response && !response.networkError && response.status === 200
    && Array.isArray(response.body?.needCategories)
    && response.body.needCategories.every((c) => Number.isSafeInteger(c?.needCategoryId) && typeof c.name === 'string')) {
    return { ok: true, needCategories: response.body.needCategories };
  }
  return { ok: false, message: GUIDED_MESSAGES.CATEGORIES_UNAVAILABLE };
}
