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
  // Current Program information shown with each result (Task X).
  PROGRAM_INFO_HEADING: 'Current Program information:',
  PROGRAM_INFO_NOT_ON_FILE: 'Not on file',
  // Neutral: the Program keeps no additional (flexible) information fields.
  // It says nothing about availability or contact, which may be unknown.
  PROGRAM_INFO_NONE: 'No additional Program information is on file.',
  PROGRAM_INFO_UNAVAILABLE: 'Current Program information could not be loaded.',
  // Handoff MVP §11 (Program Contact Boundary): refer through QCH Connect;
  // call or email the Program contact only when staff cannot find what they
  // need in QCH Connect. Shown with every result, whatever the state.
  PROGRAM_INFO_REFER_FIRST:
    'Send referrals through QCH Connect. Call or email the Program contact only if you cannot find what you need here.',
});

// Current Program information on a match result (Task X): an array of
// { label, value } where value null means not on file, or null when the
// server could not load it. Anything malformed is treated as not loaded,
// never as "available". Display only; never stored or put in a URL.
export function programInformationOf(item) {
  const info = item?.programInformation;
  if (!Array.isArray(info)) return null;
  const valid = info.every((field) => field && typeof field === 'object'
    && typeof field.label === 'string' && field.label.trim() !== ''
    && (field.value === null || typeof field.value === 'string'));
  return valid ? info : null;
}

// Describe-the-need step (Task D). The description only PROPOSES answers
// for the worker to check; matching still runs on the confirmed need
// categories, age range, and ZIP alone (PRD 8.2). The text is held in memory
// for this screen only, sent in a POST body to /api/gpme/interpret, and never
// saved, logged, or sent with the referral.
export const DESCRIBE_MESSAGES = Object.freeze({
  EMPTY: 'Type a short description first, or choose the answers below yourself.',
  TOO_LONG: 'Keep the description to 500 characters or fewer.',
  WORKING: 'Reading the description ...',
  NOTHING_UNDERSTOOD:
    'The description did not point to any need category, age, or ZIP. Nothing was filled in. '
    + 'Choose the answers below yourself, or use Direct Referral.',
  UNABLE:
    'Could not read the description right now. This is a technical problem. Your text is still here. '
    + 'Try again, or choose the answers below yourself.',
  NOT_SIGNED_IN: 'Your sign-in is not active. Your text is still here. Sign in again, then try again.',
  CHECK_PROMPT:
    'This is what the application understood. It may be wrong or incomplete. '
    + 'Check the answers below, change anything that is off, then choose Find Programs.',
  NO_CURRENT_PROGRAM:
    'No current Program lists this need, so matching is unlikely to find one. Direct Referral is still available.',
  NOTES: Object.freeze({
    MULTIPLE_AGES: "More than one age was mentioned, so no age range was filled in. Enter the participant's age range yourself.",
    MULTIPLE_ZIPS: "More than one ZIP code was mentioned, so none was filled in. Enter the participant's ZIP code yourself.",
    INVALID_AGE: 'An age in the description could not be used, so it was left out.',
    NOT_REQUESTED: 'A service in the description was said not to be wanted, so it was not filled in. Check the needs below.',
  }),
});

export const MAX_DESCRIPTION_CHARS = 500;

export function validateDescription(text) {
  const value = typeof text === 'string' ? text : '';
  if (value.trim().length === 0) return DESCRIBE_MESSAGES.EMPTY;
  if (value.length > MAX_DESCRIPTION_CHARS) return DESCRIBE_MESSAGES.TOO_LONG;
  return null;
}

// response: { networkError: true } or { status, body } from POST /api/gpme/interpret.
// Returns { state: 'PROPOSED' | 'NOTHING_UNDERSTOOD' | 'UNABLE' | 'NOT_SIGNED_IN' | 'INVALID', ... }.
// PROPOSED carries what to fill in (needCategoryIds, ageMode, ageExact, ageMin,
// ageMax, matchZip) and the lines the page shows under "What the application
// understood". One age is proposed as an exact age, never as a range
// (Handoff PRD 5.3).
export function interpretInterpretResponse(response) {
  if (!response || response.networkError) return { state: 'UNABLE', message: DESCRIBE_MESSAGES.UNABLE };
  const { status, body } = response;
  if (status === 401 || status === 403) return { state: 'NOT_SIGNED_IN', message: DESCRIBE_MESSAGES.NOT_SIGNED_IN };
  if (status === 400) return { state: 'INVALID', message: DESCRIBE_MESSAGES.EMPTY };

  const wellFormed = status === 200
    && ['INTERPRETED', 'NOTHING_RECOGNIZED'].includes(body?.status)
    && Array.isArray(body.needs)
    && body.needs.every((n) => Number.isSafeInteger(n?.needCategoryId) && typeof n.name === 'string')
    && Array.isArray(body.notes);
  if (!wellFormed) return { state: 'UNABLE', message: DESCRIBE_MESSAGES.UNABLE };

  const age = body.ageRange && Number.isSafeInteger(body.ageRange.min) && Number.isSafeInteger(body.ageRange.max)
    ? body.ageRange : null;
  const zip = typeof body.participantZip === 'string' && /^\d{5}$/.test(body.participantZip) ? body.participantZip : null;
  const notes = body.notes.map((code) => DESCRIBE_MESSAGES.NOTES[code]).filter(Boolean);

  const understood = [];
  const warnings = [];
  for (const need of body.needs) {
    understood.push(`Need: ${need.name}`);
    if (need.currentProgramCount === 0) warnings.push(`${need.name}: ${DESCRIBE_MESSAGES.NO_CURRENT_PROGRAM}`);
  }
  if (age) understood.push(age.min === age.max ? `Age: ${age.min}` : `Age range: ${age.min} to ${age.max}`);
  if (zip) understood.push(`ZIP code: ${zip}`);

  const hasConcepts = body.needs.length > 0 || Boolean(age) || Boolean(zip);
  // Successful interpretation and successful-but-empty are distinct API outcomes.
  // Contradictory responses are technical failures, never matching results.
  if ((body.status === 'INTERPRETED') !== hasConcepts) {
    return { state: 'UNABLE', message: DESCRIBE_MESSAGES.UNABLE };
  }
  if (body.status === 'NOTHING_RECOGNIZED') {
    return { state: 'NOTHING_UNDERSTOOD', message: DESCRIBE_MESSAGES.NOTHING_UNDERSTOOD, notes };
  }
  return {
    state: 'PROPOSED',
    message: DESCRIBE_MESSAGES.CHECK_PROMPT,
    needCategoryIds: body.needs.map((n) => n.needCategoryId),
    ...proposedAge(age),
    matchZip: zip ?? '',
    understood,
    warnings,
    notes,
    // No need recognized: matching needs one, so the page asks for it.
    needsStillRequired: body.needs.length === 0,
  };
}

// How a proposed age fills the form: one age goes in the Exact age box, a
// range in the From and To boxes. Nothing proposed leaves the mode alone.
function proposedAge(age) {
  if (!age) return { ageMode: null, ageExact: '', ageMin: '', ageMax: '' };
  if (age.min === age.max) return { ageMode: 'exact', ageExact: String(age.min), ageMin: '', ageMax: '' };
  return { ageMode: 'range', ageExact: '', ageMin: String(age.min), ageMax: String(age.max) };
}

export const GUIDED_FIELD_MESSAGES = Object.freeze({
  needs: 'Choose at least one need.',
  ageRange: {
    incomplete: 'Enter both ages, or leave both blank.',
    invalid: 'Enter whole ages from 0 to 120.',
    order: 'The first age must not be greater than the second.',
    exactInvalid: 'Enter a whole age from 0 to 120, or leave it blank.',
  },
  matchZip: 'Enter a 5-digit ZIP code, or leave it blank.',
});

// Same limits as src/gpme/validateMatchRequest.js.
export const MAX_AGE = 120;
const WHOLE_AGE = /^\d{1,3}$/;
const ZIP = /^\d{5}$/;

// Order of fields on screen, for moving focus to the first problem.
export const GUIDED_FIELD_ORDER = Object.freeze(['needs', 'ageRange', 'matchZip']);

// values: { needCategoryIds: number[], ageMode?: 'exact' | 'range',
//           ageExact?: string, ageMin: string, ageMax: string, matchZip: string }
// The screen always passes ageMode; Exact age is the screen's default
// (Current Handoff Wireframes, screen 2). A caller that passes no ageMode
// is read as a range. Only the boxes for the chosen mode count.
// Returns { field: message } for each problem; {} when the answers can be sent.
export function validateGuidedForm(values) {
  const errors = {};
  if (!Array.isArray(values.needCategoryIds) || values.needCategoryIds.length === 0) {
    errors.needs = GUIDED_FIELD_MESSAGES.needs;
  }

  const exact = (values.ageExact ?? '').trim();
  const min = (values.ageMin ?? '').trim();
  const max = (values.ageMax ?? '').trim();
  if (values.ageMode === 'exact') {
    if (exact && (!WHOLE_AGE.test(exact) || Number(exact) > MAX_AGE)) {
      errors.ageRange = GUIDED_FIELD_MESSAGES.ageRange.exactInvalid;
    }
  } else if (min || max) {
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
// optional answers are left out. An exact age is sent as that one age
// (min equals max), never widened into a range (Handoff PRD 5.3).
export function toMatchRequest(values) {
  const body = { needCategoryIds: [...new Set(values.needCategoryIds)].sort((a, b) => a - b) };
  if (values.ageMode === 'exact') {
    const exact = (values.ageExact ?? '').trim();
    if (exact) body.ageRange = { min: Number(exact), max: Number(exact) };
  } else {
    const min = (values.ageMin ?? '').trim();
    const max = (values.ageMax ?? '').trim();
    if (min && max) body.ageRange = { min: Number(min), max: Number(max) };
  }
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

// Language of service on a result (Task W). Information for staff only:
// matching never uses it. "Not on file" is never shown as English only.
// Returns null when the server sent no language information (for example
// the language list could not be read), so the page says nothing rather
// than guessing.
export function serviceLanguagesText(serviceLanguages) {
  if (!serviceLanguages || typeof serviceLanguages !== 'object') return null;
  const { status, names } = serviceLanguages;
  if (status === 'NOT_ON_FILE') return 'Languages of service: not on file';
  if (status === 'ON_FILE' && Array.isArray(names) && names.length > 0
      && names.every((name) => typeof name === 'string' && name.length > 0)) {
    return `Languages of service: ${names.join(', ')}`;
  }
  return null;
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
