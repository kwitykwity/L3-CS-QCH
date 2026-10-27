// New Referral page: Direct Referral (Trello card 5) and guided matching
// (GPME, card 11), against the Final Technical PRD: 2.1 and 2.2 (two
// paths, one pipeline), 3.9 (affiliation), 5.3 and 5.5 (privacy), 7.1-7.6
// (submission, idempotency, recovery, unsaved changes), 8.1-8.10 (GPME),
// 13.2-13.4, 14.
//
// Both paths end in the same referral form and the same submission code.
// A GPME-assisted referral only adds the matching answers (`gpme`) so the
// server can re-check the recommendation and record source GPME_ASSISTED.
//
// Privacy rules for this file (PRD 5.5, 15.3):
// - Participant data lives only in the form fields and in memory while the
//   workflow is active. It is never put in a URL, localStorage,
//   sessionStorage, IndexedDB, or the console.
// - Server text is inserted with textContent only, never innerHTML.

import { api } from './api.js';
import {
  CONTACT_METHODS, SERVER_FIELD_MESSAGES, firstInvalidField, toRequestBody, validateReferralForm,
} from './validation.js';
import { interpretCheckResponse, interpretSubmitResponse, sendingState } from './submission.js';
import { interpretAffiliationSave } from './affiliation.js';
import { SIZES, loadSize, saveSize } from './textSize.js';
import {
  DESCRIBE_MESSAGES, GUIDED_FIELD_MESSAGES, GUIDED_MESSAGES, firstGuidedError, interpretCategoriesResponse,
  interpretInterpretResponse, interpretMatchResponse, notCheckedNote, toMatchRequest, validateDescription,
  validateGuidedForm,
} from './guided.js';

const $ = (id) => document.getElementById(id);

const FIELDS = ['participantName', 'contactValue', 'participantZip', 'referralContext', 'notes'];

const state = {
  programs: [],
  affiliation: null,          // { status, program } from the server
  path: null,                 // 'GUIDED' | 'DIRECT'; neither is preselected (PRD 2.1)
  selectedProgram: null,      // receiving Program chosen in step 1
  needCategories: null,       // loaded once for the guided form
  match: null,                // { answers } of the results on screen
  gpmeAnswers: null,          // answers behind a GPME-assisted choice; memory only
  retry: null,                // what "Try again" repeats: 'CATEGORIES' | 'MATCH'
  submissionId: null,         // one per logical referral (PRD 7.3); memory only
  afterConflict: false,       // server said the Submission ID is already in use
  phase: 'EDITING',           // EDITING | SENDING | NOT_CONFIRMED | DONE
};

// ---------------------------------------------------------------------------
// Text size (PRD 14.5)
// ---------------------------------------------------------------------------

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function applyTextSize(size) {
  document.documentElement.style.fontSize = `${SIZES[size]}px`;
  for (const btn of document.querySelectorAll('.text-size__btn')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.size === size));
  }
}

function initTextSize() {
  applyTextSize(loadSize(storage()));
  for (const btn of document.querySelectorAll('.text-size__btn')) {
    btn.addEventListener('click', () => {
      applyTextSize(btn.dataset.size);
      saveSize(storage(), btn.dataset.size);
    });
  }
}

// ---------------------------------------------------------------------------
// Status area
// ---------------------------------------------------------------------------

// VoiceOver (Safari) drops a live-region message that appears at the same
// moment focus moves, so after a failed send or search the summary ("...
// Nothing was sent.") was never heard. PRD 14.3 keeps focus on the first
// invalid field, so that field also carries the summary in its description
// until its error is fixed or the message is replaced.
function linkSummaryToFocused(textId) {
  unlinkSummary();
  const focused = document.activeElement;
  if (!focused || focused === document.body) return;
  // On a checkbox or radio, VoiceOver reads the group's description, not
  // the box's own (heard in the Safari run), so the summary goes on the group.
  const el = (focused.matches('input[type="checkbox"], input[type="radio"]')
    && focused.closest('fieldset[aria-describedby]')) || focused;
  const own = el.getAttribute('aria-describedby') ?? '';
  el.dataset.ownDescribedby = own;
  el.setAttribute('aria-describedby', `${textId} ${own}`.trim());
}

function unlinkSummary(only = null) {
  const elements = only ? [only] : [...document.querySelectorAll('[data-own-describedby]')];
  for (const el of elements) {
    if (!el || !('ownDescribedby' in el.dataset)) continue;
    const own = el.dataset.ownDescribedby;
    if (own) el.setAttribute('aria-describedby', own);
    else el.removeAttribute('aria-describedby');
    delete el.dataset.ownDescribedby;
  }
}

function showStatus(message, tone, { focus = true } = {}) {
  unlinkSummary();
  const box = $('status');
  box.className = `status status--${tone}`;
  box.querySelector('.status__text').textContent = message;
  box.hidden = false;
  if (focus) box.focus();
}

// Every new message replaces the previous one; actions that belonged to
// the previous message are hidden too, so no stale banner remains.
function hideStatus() {
  unlinkSummary();
  $('status').hidden = true;
  $('send-direct').hidden = true;
  $('check-again').hidden = true;
  $('start-new').hidden = true;
  $('new-submission').hidden = true;
}

// ---------------------------------------------------------------------------
// Program affiliation (PRD 3.9): self-selected, stored, never preselected
// ---------------------------------------------------------------------------

function affiliationIsSet() {
  return state.affiliation?.status === 'SET' && state.affiliation.program;
}

function renderAffiliation() {
  $('affiliation-loading').hidden = true;
  const set = affiliationIsSet();
  $('affiliation-view').hidden = !set;
  if (set) $('affiliation-name').textContent = state.affiliation.program.name;
  if (!set) openAffiliationForm({ cancellable: false });
  $('summary-referring').textContent = set ? state.affiliation.program.name : 'Not set: choose your Program affiliation above';
}

function fillAffiliationOptions() {
  const select = $('affiliation-select');
  select.length = 1; // keep "Choose your Program"
  for (const program of state.programs) {
    const option = document.createElement('option');
    option.value = String(program.programId);
    option.textContent = program.site ? `${program.name} (${program.site})` : program.name;
    select.append(option);
  }
}

function openAffiliationForm({ cancellable }) {
  const status = state.affiliation?.status;
  $('affiliation-prompt').textContent =
    status === 'PROGRAM_NOT_ACTIVE'
      ? 'Your saved Program is no longer active. Choose your current Program before sending referrals.'
      : status === 'SET'
        ? 'Choose your current Program. This changes the Referring Program for future referrals only.'
        : 'Before sending a referral, choose the Program you work in. Referrals you send will come from this Program.';
  $('affiliation-select').value = ''; // never preselect (PRD 3.9)
  setFieldError('affiliation-select', 'affiliation-error', null);
  $('affiliation-cancel').hidden = !cancellable;
  $('affiliation-form').hidden = false;
}

function closeAffiliationForm() {
  $('affiliation-form').hidden = true;
  $('affiliation-change').focus();
}

// Reloading does not help someone who is not signed in, so say so
// (PRD 7.5, 16.1: without sign-in the app fails closed).
const NOT_SIGNED_IN_LOAD = 'You are not signed in, so nothing can be shown. Sign in, then reload this page.';

async function loadAffiliation() {
  const res = await api.getAffiliation();
  if (res.networkError || res.status !== 200) {
    $('affiliation-loading').textContent = res.status === 401 ? NOT_SIGNED_IN_LOAD
      : 'Your Program affiliation could not be loaded. Reload the page to try again.';
    return;
  }
  state.affiliation = res.body;
  renderAffiliation();
}

async function saveAffiliation(event) {
  event.preventDefault();
  const value = $('affiliation-select').value;
  if (!value) {
    setFieldError('affiliation-select', 'affiliation-error', 'Choose your Program.');
    $('affiliation-select').focus();
    return;
  }
  const button = $('affiliation-save');
  button.disabled = true;
  const res = await api.setAffiliation(Number(value), state.affiliation?.version);
  button.disabled = false;

  // Any earlier message (for example a previous "saved") is replaced.
  const result = interpretAffiliationSave(res);
  showStatus(result.message, result.tone, { focus: false });

  if (result.state === 'SAVED') {
    state.affiliation = result.affiliation;
    $('affiliation-form').hidden = true;
    renderAffiliation();
    $('affiliation-heading').focus();
    return;
  }
  if (result.state === 'CHANGED_ELSEWHERE') {
    // Show the authoritative affiliation; nothing was saved (PRD 13.4).
    state.affiliation = result.affiliation;
    renderAffiliation();
    if ($('affiliation-form').hidden) openAffiliationForm({ cancellable: true });
  }
  setFieldError('affiliation-select', 'affiliation-error', result.fieldError);
  $('affiliation-select').focus();
}

// ---------------------------------------------------------------------------
// Step 1: choose the receiving Program (PRD 2.1 Direct path)
// ---------------------------------------------------------------------------

function renderProgramOptions() {
  const term = $('program-search').value.trim().toLowerCase();
  const list = $('program-options');
  list.replaceChildren();

  const matches = state.programs.filter((p) =>
    !term || [p.name, p.site, p.departmentName].some((v) => (v ?? '').toLowerCase().includes(term)));

  for (const program of matches) {
    const li = document.createElement('li');
    const label = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'receivingProgram';
    radio.value = String(program.programId);
    radio.checked = state.selectedProgram?.programId === program.programId;
    radio.addEventListener('change', () => {
      state.selectedProgram = program;
      state.gpmeAnswers = null;
      setGroupError('program-error', null);
    });
    const name = document.createElement('span');
    name.textContent = program.name;
    const meta = document.createElement('span');
    meta.className = 'program-meta';
    meta.textContent = [program.departmentName, program.site].filter(Boolean).join(' · ');
    label.append(radio, name, meta);
    li.append(label);
    list.append(li);
  }

  $('program-count').textContent =
    matches.length === 0 ? 'No Programs match your search.'
      : `${matches.length} Program${matches.length === 1 ? '' : 's'} shown.`;
}

async function loadPrograms() {
  const res = await api.listPrograms();
  $('programs-loading').hidden = true;
  if (res.networkError || res.status !== 200) {
    $('programs-loading').hidden = false;
    $('programs-loading').textContent = res.status === 401 ? NOT_SIGNED_IN_LOAD
      : 'Programs could not be loaded. Reload the page to try again.';
    return;
  }
  state.programs = res.body.programs;
  // If the chosen Program is no longer active, drop the stale choice.
  if (state.selectedProgram && !state.programs.some((p) => p.programId === state.selectedProgram.programId)) {
    state.selectedProgram = null;
  }
  fillAffiliationOptions();
  renderProgramOptions();
}

function setGroupError(errorId, message) {
  const el = $(errorId);
  el.textContent = message ?? '';
  el.hidden = !message;
}

function continueToDetails() {
  if (!state.selectedProgram) {
    setGroupError('program-error', 'Choose a Program to continue.');
    const first = document.querySelector('#program-options input');
    (first ?? $('program-search')).focus();
    return;
  }
  // A new logical referral gets its Submission ID when details start (PRD 7.3).
  if (!state.submissionId) state.submissionId = crypto.randomUUID();
  $('summary-receiving').textContent = state.selectedProgram.name;
  updateSummarySource();
  if (state.phase === 'EDITING') setSendButton({ enabled: true });
  $('step-program').hidden = true;
  $('step-details').hidden = false;
  $('step-details-heading').focus();
}

function updateSummarySource() {
  $('summary-source').textContent = state.gpmeAnswers
    ? 'Guided matching. The receiving Program still makes the decision.'
    : 'Direct Referral';
}

function backToProgramChoice() {
  // Entered referral details are kept in the form (PRD 7.5).
  $('step-details').hidden = true;
  $('step-program').hidden = false;
  renderProgramOptions();
  $('step-program-heading').focus();
}

// ---------------------------------------------------------------------------
// Path choice (PRD 2.1): guided matching or Direct Referral
// ---------------------------------------------------------------------------

function choosePath(path, { focus = true } = {}) {
  if (state.path !== path) {
    // A choice made on one path never carries over to the other.
    state.selectedProgram = null;
    state.gpmeAnswers = null;
    setGroupError('program-error', null);
    for (const radio of document.querySelectorAll('input[name="receivingProgram"]')) radio.checked = false;
  }
  state.path = path;
  $('path-guided').setAttribute('aria-pressed', String(path === 'GUIDED'));
  $('path-direct').setAttribute('aria-pressed', String(path === 'DIRECT'));
  $('guided').hidden = path !== 'GUIDED';
  $('direct').hidden = path !== 'DIRECT';
  if (path === 'GUIDED' && !state.needCategories) loadNeedCategories();
  if (focus) $(path === 'GUIDED' ? 'guided-heading' : 'direct-heading').focus();
}

function clearPath() {
  state.path = null;
  $('path-guided').setAttribute('aria-pressed', 'false');
  $('path-direct').setAttribute('aria-pressed', 'false');
  $('guided').hidden = true;
  $('direct').hidden = true;
}

// ---------------------------------------------------------------------------
// Guided matching (GPME, card 11; PRD 8)
// ---------------------------------------------------------------------------

const GUIDED_INPUTS = ['ageMin', 'ageMax', 'matchZip'];

function showMatchMessage(message, tone, { retry = null, edit = false, direct = false, focus = true } = {}) {
  unlinkSummary();
  const box = $('match-message');
  box.className = `status status--${tone}`;
  box.querySelector('.status__text').textContent = message;
  box.hidden = false;
  state.retry = retry;
  $('match-retry').hidden = !retry;
  $('match-edit').hidden = !edit;
  $('match-direct').hidden = !direct;
  if (focus) box.focus();
}

function hideMatchMessage() {
  unlinkSummary();
  $('match-message').hidden = true;
  $('match-retry').hidden = true;
  $('match-edit').hidden = true;
  $('match-direct').hidden = true;
  state.retry = null;
}

async function loadNeedCategories() {
  $('needs-loading').hidden = false;
  $('needs-loading').textContent = 'Loading need categories…';
  const result = interpretCategoriesResponse(await api.listNeedCategories());
  $('needs-loading').hidden = true;
  if (!result.ok) {
    showMatchMessage(result.message, 'error', { retry: 'CATEGORIES', direct: true, focus: false });
    return;
  }
  state.needCategories = result.needCategories;
  hideMatchMessage();
  const box = $('needs-options');
  box.replaceChildren();
  for (const category of result.needCategories) {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'need';
    checkbox.value = String(category.needCategoryId);
    checkbox.addEventListener('change', guidedAnswersChanged);
    label.append(checkbox, document.createTextNode(category.name));
    box.append(label);
  }
}

function readGuided() {
  return {
    needCategoryIds: [...document.querySelectorAll('input[name="need"]:checked')].map((b) => Number(b.value)),
    ageMin: $('ageMin').value,
    ageMax: $('ageMax').value,
    matchZip: $('matchZip').value,
  };
}

function hasGuidedAnswers() {
  const v = readGuided();
  return $('describe').value.trim().length > 0 || v.needCategoryIds.length > 0 || Boolean(v.ageMin.trim() || v.ageMax.trim() || v.matchZip.trim());
}

function setGuidedErrors(errors) {
  setFieldError(null, 'needs-error', errors.needs ?? null);
  setFieldError('ageMin', 'ageRange-error', errors.ageRange ?? null);
  $('ageMax').setAttribute('aria-invalid', errors.ageRange ? 'true' : 'false');
  setFieldError('matchZip', 'matchZip-error', errors.matchZip ?? null);
}

function focusGuidedField(field) {
  if (field === 'needs') (document.querySelector('input[name="need"]') ?? $('guided-heading')).focus();
  else if (field === 'ageRange') $('ageMin').focus();
  else if (field === 'matchZip') $('matchZip').focus();
}

// Describe-the-need step (Task D). The text only proposes answers; the worker
// checks and corrects them, and Find Programs matches on the confirmed answers.
function hideUnderstood() {
  $('understood').hidden = true;
  $('understood-list').replaceChildren();
  $('understood-notes').replaceChildren();
}

function fillList(listId, lines) {
  $(listId).replaceChildren(...lines.map((line) => {
    const li = document.createElement('li');
    li.textContent = line;
    return li;
  }));
}

async function describeNeed() {
  const text = $('describe').value;
  const problem = validateDescription(text);
  setFieldError('describe', 'describe-error', problem);
  if (problem) {
    $('describe').focus();
    return;
  }
  const button = $('describe-go');
  button.disabled = true;
  button.textContent = DESCRIBE_MESSAGES.WORKING;
  button.setAttribute('aria-busy', 'true');
  hideUnderstood();
  const result = interpretInterpretResponse(await api.interpretDescription(text));
  button.disabled = false;
  button.textContent = 'Fill in the answers below';
  button.removeAttribute('aria-busy');

  if (result.state === 'PROPOSED') {
    for (const box of document.querySelectorAll('input[name="need"]')) {
      box.checked = result.needCategoryIds.includes(Number(box.value));
    }
    $('ageMin').value = result.ageMin;
    $('ageMax').value = result.ageMax;
    $('matchZip').value = result.matchZip;
    guidedAnswersChanged();
    $('understood-message').textContent = result.message;
    fillList('understood-list', result.understood);
    fillList('understood-notes', [...result.warnings, ...result.notes,
      ...(result.needsStillRequired ? [GUIDED_FIELD_MESSAGES.needs] : [])]);
  } else {
    $('understood-message').textContent = result.message;
    fillList('understood-notes', result.notes ?? []);
  }
  const tone = result.state === 'PROPOSED' || result.state === 'NOTHING_UNDERSTOOD' ? 'info' : 'error';
  $('understood').className = `status status--${tone}`;
  $('understood').hidden = false;
  $('understood').focus();
}

function hideResults() {
  $('match-results').hidden = true;
  $('plausible-list').replaceChildren();
  $('possible-list').replaceChildren();
  state.match = null;
}

// Results belong to the answers that produced them. Once an answer
// changes they are cleared, so a referral is never sent with answers that
// were not the ones matched.
function guidedAnswersChanged() {
  setGuidedErrors({});
  const hadResults = !$('match-results').hidden || !$('match-message').hidden;
  if (state.gpmeAnswers) {
    state.selectedProgram = null;
    state.gpmeAnswers = null;
  }
  if (!hadResults) return;
  hideResults();
  showMatchMessage(GUIDED_MESSAGES.RESULTS_CLEARED, 'info', { focus: false });
}

function renderMatchItem(item) {
  const li = document.createElement('li');
  li.className = 'match';
  const head = document.createElement('div');
  head.className = 'match__head';
  const name = document.createElement('span');
  name.className = 'match__name';
  name.textContent = item.name;
  const meta = document.createElement('span');
  meta.className = 'match__meta';
  meta.textContent = [item.departmentName, item.site].filter(Boolean).join(' · ');
  head.append(name, meta);

  // Explanations come from the server, built from Program facts only
  // (PRD 8.6). textContent only.
  const whyId = `why-${item.programId}`;
  const whyLabel = document.createElement('p');
  whyLabel.className = 'match__why-label';
  whyLabel.id = whyId;
  whyLabel.textContent = 'What matching found:';
  const why = document.createElement('ul');
  why.className = 'match__why';
  why.setAttribute('aria-labelledby', whyId);
  for (const text of item.explanations) {
    const point = document.createElement('li');
    point.textContent = text;
    why.append(point);
  }

  const choose = document.createElement('button');
  choose.type = 'button';
  choose.className = 'btn btn--secondary';
  choose.textContent = `Choose ${item.name}`;
  choose.addEventListener('click', () => chooseMatch(item));

  li.append(head, whyLabel, why, choose);
  return li;
}

function renderResults(result) {
  $('suggestion-note').textContent = GUIDED_MESSAGES.SUGGESTION_NOTE;
  $('order-note').textContent = GUIDED_MESSAGES.ORDER_NOTE;
  $('plausible-list').replaceChildren(...result.plausible.map(renderMatchItem));
  $('possible-list').replaceChildren(...result.possible.map(renderMatchItem));
  $('plausible-group').hidden = result.plausible.length === 0;
  $('possible-group').hidden = result.possible.length === 0;
  const note = notCheckedNote(result.notCheckedForNeedCount);
  $('not-checked-note').textContent = note ?? '';
  $('not-checked-note').hidden = !note;
  $('match-results').hidden = false;
}

function setFindButton(searching) {
  const button = $('find-programs');
  button.disabled = searching;
  button.textContent = searching ? GUIDED_MESSAGES.SEARCHING : 'Find Programs';
  button.setAttribute('aria-busy', String(searching));
}

// Runs matching with the given answers and shows the outcome.
async function searchWith(answers, { focus = true } = {}) {
  hideResults();
  hideMatchMessage();
  setFindButton(true);
  const result = interpretMatchResponse(await api.matchPrograms(answers));
  setFindButton(false);

  if (result.state === 'RESULTS') {
    state.match = { answers };
    renderResults(result);
    if (focus) $('results-heading').focus();
    return result;
  }
  if (result.state === 'INVALID') {
    const errors = {};
    for (const field of result.fieldErrors) errors[field] = 'Check this answer.';
    showMatchMessage(result.message, result.tone, { focus: false });
    setGuidedErrors(errors);
    focusGuidedField(firstGuidedError(errors));
    linkSummaryToFocused('match-message-text');
    return result;
  }
  // No plausible match and technical failure are different states with
  // different wording and actions (PRD 8.5). Answers stay on screen (PRD 8.8).
  const note = result.state === 'NO_PLAUSIBLE_MATCH' ? notCheckedNote(result.notCheckedForNeedCount) : null;
  showMatchMessage(note ? `${result.message} ${note}` : result.message, result.tone, {
    retry: result.canRetry ? 'MATCH' : null,
    edit: result.state === 'NO_PLAUSIBLE_MATCH',
    direct: result.offerDirect,
    focus,
  });
  return result;
}

async function findPrograms(event) {
  event.preventDefault();
  const values = readGuided();
  const errors = validateGuidedForm(values);
  setGuidedErrors(errors);
  if (Object.keys(errors).length > 0) {
    // Nothing is searched; answers are kept (PRD 14.3).
    hideResults();
    showMatchMessage(GUIDED_MESSAGES.INVALID, 'error', { focus: false });
    focusGuidedField(firstGuidedError(errors));
    linkSummaryToFocused('match-message-text');
    return;
  }
  await searchWith(toMatchRequest(values));
}

function retryMatching() {
  if (state.retry === 'CATEGORIES') loadNeedCategories();
  else $('guided-form').requestSubmit();
}

// The worker picks a Program from the results (PRD 2.1: the worker makes
// the final selection; GPME never submits).
function chooseMatch(item) {
  state.selectedProgram = {
    programId: item.programId, name: item.name, departmentName: item.departmentName, site: item.site,
  };
  state.gpmeAnswers = state.match.answers;
  continueToDetails();
}

// ---------------------------------------------------------------------------
// Step 2: referral form
// ---------------------------------------------------------------------------

function renderContactMethods() {
  const box = $('contactMethod-options');
  for (const method of CONTACT_METHODS) {
    const label = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'contactMethod';
    radio.value = method.value;
    radio.addEventListener('change', updateContactField);
    label.append(radio, document.createTextNode(method.label));
    box.append(label);
  }
}

function selectedContactMethod() {
  return document.querySelector('input[name="contactMethod"]:checked')?.value ?? '';
}

function updateContactField() {
  const method = selectedContactMethod();
  const field = $('contactValue-field');
  const input = $('contactValue');
  setFieldError(null, 'contactMethod-error', null);
  field.hidden = !method || method === 'NOT_AVAILABLE';
  if (method === 'EMAIL') {
    $('contactValue-label').textContent = 'Email address';
    input.type = 'email';
    input.inputMode = 'email';
  } else {
    $('contactValue-label').textContent = 'Phone number';
    input.type = 'tel';
    input.inputMode = 'tel';
  }
  input.required = !field.hidden;
}

function readForm() {
  return {
    participantName: $('participantName').value,
    contactMethod: selectedContactMethod(),
    contactValue: $('contactValue').value,
    participantZip: $('participantZip').value,
    referralContext: $('referralContext').value,
    notes: $('notes').value,
  };
}

function setFieldError(inputId, errorId, message) {
  const error = $(errorId);
  error.textContent = message ?? '';
  error.hidden = !message;
  if (inputId) {
    // "false", not removed: without the attribute, Safari/VoiceOver reports
    // an empty required field as "invalid data" before the user did anything.
    $(inputId).setAttribute('aria-invalid', message ? 'true' : 'false');
  }
  // Fixed: the field (or its group) stops carrying the failed-send summary.
  if (!message) {
    for (const el of document.querySelectorAll('[data-own-describedby]')) {
      if (el.dataset.ownDescribedby.split(' ').includes(errorId)) unlinkSummary(el);
    }
  }
}

function clearFieldErrors() {
  for (const field of FIELDS) setFieldError(field, `${field}-error`, null);
  setFieldError(null, 'contactMethod-error', null);
}

function showFieldErrors(errors) {
  clearFieldErrors();
  for (const [field, message] of Object.entries(errors)) {
    if (field === 'contactMethod') setFieldError(null, 'contactMethod-error', message);
    else if (FIELDS.includes(field)) setFieldError(field, `${field}-error`, message);
  }
  // Move focus to the first invalid field (PRD 14.3).
  const first = firstInvalidField(errors);
  if (first === 'contactMethod') document.querySelector('input[name="contactMethod"]').focus();
  else if (first) $(first).focus();
}

function hasUnsavedWork() {
  if (state.phase === 'DONE') return false;
  const v = readForm();
  return hasGuidedAnswers() || Boolean(v.participantName.trim() || v.contactMethod || v.contactValue.trim() ||
    v.participantZip.trim() || v.referralContext.trim() || v.notes.trim());
}

function setLocked(locked) {
  $('referral-fields').disabled = locked;
  $('change-program').disabled = locked;
  $('cancel').disabled = locked;
  $('send-direct').disabled = locked;
}

function setSendButton({ enabled, sending = false }) {
  const send = $('send');
  send.disabled = !enabled;
  send.textContent = sending ? 'Sending referral ...' : 'Send referral';
  send.setAttribute('aria-busy', String(sending));
}

// Clears the guided answers and results (participant information).
function clearGuided() {
  $('guided-form').reset();
  hideUnderstood();
  setFieldError(null, 'describe-error', null);
  setGuidedErrors({});
  hideResults();
  hideMatchMessage();
  state.gpmeAnswers = null;
}

function resetReferral() {
  $('referral-form').reset();
  clearGuided();
  clearPath();
  updateContactField();
  clearFieldErrors();
  state.selectedProgram = null;
  state.submissionId = null;
  state.afterConflict = false;
  state.phase = 'EDITING';
  setLocked(false);
  setSendButton({ enabled: true });
  $('program-search').value = '';
  $('step-details').hidden = true;
  $('step-program').hidden = false;
  renderProgramOptions();
}

// Applies a result from submission.js to the page.
async function applyResult(result) {
  hideStatus();
  showStatus(result.message, result.tone);
  setLocked(Boolean(result.formLocked));
  setSendButton({ enabled: Boolean(result.canResend) });
  $('check-again').hidden = result.next !== 'CHECK_AGAIN';
  $('new-submission').hidden = result.next !== 'NEW_SUBMISSION';
  if (result.afterConflict) state.afterConflict = true;

  if (result.state === 'RECEIVED' || result.state === 'ALREADY_RECEIVED') {
    state.phase = 'DONE';
    // Clear participant data from the page once the server has it.
    $('referral-form').reset();
    clearGuided();
    updateContactField();
    state.submissionId = null;
    state.afterConflict = false;
    const id = result.referral?.referralId;
    if (id) showStatus(`${result.message} Referral ID: ${id}.`, result.tone);
    $('start-new').hidden = false;
    $('send').disabled = true;
    return;
  }

  state.phase = result.formLocked ? 'NOT_CONFIRMED' : 'EDITING';

  if (result.state === 'INVALID') {
    const errors = {};
    for (const field of result.fieldErrors) errors[field] = SERVER_FIELD_MESSAGES[field] ?? 'Check this field.';
    showStatus(result.message, result.tone, { focus: false });
    showFieldErrors(errors);
    linkSummaryToFocused('status-text');
    return;
  }
  if (result.next === 'CHOOSE_AFFILIATION' || result.next === 'RELOAD_AFFILIATION') {
    await loadAffiliation();
    if (!affiliationIsSet()) $('affiliation-select').focus();
    return;
  }
  if (result.next === 'REVIEW_MATCHES' || (result.next === 'CHOOSE_PROGRAM' && state.gpmeAnswers)) {
    await reviewMatchesAgain();
    return;
  }
  if (result.next === 'CHOOSE_PROGRAM') {
    await loadPrograms();
    backToProgramChoice();
    return;
  }
  if (result.next === 'SEND_AS_DIRECT') {
    // Matching could not be re-checked. The worker may send again, or send
    // to the same Program as a Direct Referral (PRD 8.8).
    $('send-direct').hidden = false;
    return;
  }
  if (result.needsCheck) {
    // Outcome unknown: ask the server whether this Submission ID arrived (PRD 7.4).
    await runSafeCheck();
  }
}

// The chosen Program is no longer a current match (or can no longer
// receive referrals). Nothing was sent. Show fresh results for the same
// answers; the referral details stay in the form (PRD 7.5).
async function reviewMatchesAgain() {
  const answers = state.gpmeAnswers;
  state.selectedProgram = null;
  state.gpmeAnswers = null;
  $('step-details').hidden = true;
  $('step-program').hidden = false;
  choosePath('GUIDED', { focus: false });
  if (answers) await searchWith(answers, { focus: false });
  $('status').focus();
}

function sendAsDirect() {
  state.gpmeAnswers = null;
  updateSummarySource();
  $('send-direct').hidden = true;
  $('referral-form').requestSubmit();
}

async function runSafeCheck() {
  $('check-again').disabled = true;
  const res = await api.checkSubmission(state.submissionId);
  $('check-again').disabled = false;
  await applyResult(interpretCheckResponse(res, {
    submissionId: state.submissionId,
    afterConflict: state.afterConflict,
  }));
}

// Explicit worker choice after the safe check found that the original
// Submission ID is not theirs (PRD 7.3, 7.4). Their information stays.
function startNewSubmission() {
  state.submissionId = crypto.randomUUID();
  state.afterConflict = false;
  state.phase = 'EDITING';
  setLocked(false);
  setSendButton({ enabled: true });
  hideStatus();
  showStatus('Ready to send as a new referral. Review the information, then choose Send referral.', 'info');
}

async function submitReferral(event) {
  event.preventDefault();
  if (state.phase === 'SENDING' || state.phase === 'NOT_CONFIRMED' || state.phase === 'DONE') return;

  hideStatus();
  const values = readForm();
  const errors = validateReferralForm(values);
  if (Object.keys(errors).length > 0) {
    // Nothing is sent; entered work is kept (PRD 14.3).
    showStatus('Some information needs attention. Nothing was sent.', 'error', { focus: false });
    showFieldErrors(errors);
    linkSummaryToFocused('status-text');
    return;
  }
  clearFieldErrors();

  if (!affiliationIsSet()) {
    showStatus('Choose your Program affiliation before sending. Your information has been preserved.', 'error', { focus: false });
    openAffiliationForm({ cancellable: false });
    $('affiliation-select').focus();
    return;
  }

  // Deliberate submit: disable the control and show "Sending referral ..." (PRD 7.1).
  state.phase = 'SENDING';
  const sending = sendingState();
  setLocked(true);
  setSendButton({ enabled: false, sending: true });
  showStatus(sending.message, sending.tone);

  const body = toRequestBody(values, {
    submissionId: state.submissionId,
    receivingProgramId: state.selectedProgram.programId,
  });
  // GPME-assisted: the same answers the results came from (PRD 2.2, 8.7).
  if (state.gpmeAnswers) body.gpme = state.gpmeAnswers;
  const res = await api.submitReferral(body);
  await applyResult(interpretSubmitResponse(res, { submissionId: body.submissionId }));
}

// Enter activates only the focused button; it never submits from a text
// field or radio button (PRD 14.2).
function blockImplicitSubmit(event) {
  if (event.key !== 'Enter') return;
  const target = event.target;
  if (target instanceof HTMLInputElement && target.type !== 'submit' && target.type !== 'button') {
    event.preventDefault();
  }
}

// ---------------------------------------------------------------------------
// Unsaved changes (PRD 7.6)
// ---------------------------------------------------------------------------

function confirmDiscard() {
  if (!hasUnsavedWork()) {
    resetReferral();
    hideStatus();
    $('step-program-heading').focus();
    return;
  }
  $('discard-dialog').showModal();
}

function initDiscardDialog() {
  const dialog = $('discard-dialog');
  $('discard-stay').addEventListener('click', () => {
    dialog.close();
    $('cancel').focus();
  });
  $('discard-leave').addEventListener('click', () => {
    dialog.close();
    resetReferral();
    hideStatus();
    $('step-program-heading').focus();
  });
}

window.addEventListener('beforeunload', (event) => {
  if (hasUnsavedWork() || state.phase === 'SENDING' || state.phase === 'NOT_CONFIRMED') {
    event.preventDefault();
    event.returnValue = '';
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

function init() {
  initTextSize();
  renderContactMethods();
  updateContactField();
  initDiscardDialog();

  $('affiliation-form').addEventListener('submit', saveAffiliation);
  $('affiliation-change').addEventListener('click', () => {
    openAffiliationForm({ cancellable: true });
    $('affiliation-select').focus();
  });
  $('affiliation-cancel').addEventListener('click', closeAffiliationForm);
  $('affiliation-form').addEventListener('keydown', blockImplicitSubmit);

  $('path-guided').addEventListener('click', () => choosePath('GUIDED'));
  $('path-direct').addEventListener('click', () => choosePath('DIRECT'));
  $('guided-form').addEventListener('submit', findPrograms);
  $('guided-form').addEventListener('keydown', blockImplicitSubmit);
  for (const id of GUIDED_INPUTS) $(id).addEventListener('input', guidedAnswersChanged);
  $('describe-go').addEventListener('click', describeNeed);
  $('match-retry').addEventListener('click', retryMatching);
  $('match-edit').addEventListener('click', () => focusGuidedField('needs'));
  $('match-direct').addEventListener('click', () => choosePath('DIRECT'));
  $('send-direct').addEventListener('click', sendAsDirect);

  $('program-search').addEventListener('input', renderProgramOptions);
  $('program-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
  $('program-continue').addEventListener('click', continueToDetails);
  $('change-program').addEventListener('click', backToProgramChoice);

  // A field's error clears as soon as the worker edits that field.
  for (const field of FIELDS) {
    $(field).addEventListener('input', () => setFieldError(field, `${field}-error`, null));
  }

  $('referral-form').addEventListener('submit', submitReferral);
  $('referral-form').addEventListener('keydown', blockImplicitSubmit);
  $('cancel').addEventListener('click', confirmDiscard);
  $('check-again').addEventListener('click', runSafeCheck);
  $('new-submission').addEventListener('click', startNewSubmission);
  $('start-new').addEventListener('click', () => {
    resetReferral();
    hideStatus();
    $('step-program-heading').focus();
  });

  // Load Programs first so the affiliation list is ready, then affiliation.
  loadPrograms().then(loadAffiliation);
}

init();
