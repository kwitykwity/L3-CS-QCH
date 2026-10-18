// Direct Referral page (Trello card 5), against the Final Technical PRD:
// 2.1 (Direct path), 3.9 (affiliation), 5.5 (browser privacy), 7.1-7.6
// (submission, idempotency, recovery, unsaved changes), 13.2-13.4, 14.
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

const $ = (id) => document.getElementById(id);

const FIELDS = ['participantName', 'contactValue', 'participantZip', 'referralContext', 'notes'];

const state = {
  programs: [],
  affiliation: null,          // { status, program } from the server
  selectedProgram: null,      // receiving Program chosen in step 1
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

function showStatus(message, tone, { focus = true } = {}) {
  const box = $('status');
  box.className = `status status--${tone}`;
  box.querySelector('.status__text').textContent = message;
  box.hidden = false;
  if (focus) box.focus();
}

// Every new message replaces the previous one; actions that belonged to
// the previous message are hidden too, so no stale banner remains.
function hideStatus() {
  $('status').hidden = true;
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

async function loadAffiliation() {
  const res = await api.getAffiliation();
  if (res.networkError || res.status !== 200) {
    $('affiliation-loading').textContent = 'Your Program affiliation could not be loaded. Reload the page to try again.';
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
    $('programs-loading').textContent = 'Programs could not be loaded. Reload the page to try again.';
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
  $('step-program').hidden = true;
  $('step-details').hidden = false;
  $('step-details-heading').focus();
}

function backToProgramChoice() {
  // Entered referral details are kept in the form (PRD 7.5).
  $('step-details').hidden = true;
  $('step-program').hidden = false;
  renderProgramOptions();
  $('step-program-heading').focus();
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
    if (message) $(inputId).setAttribute('aria-invalid', 'true');
    else $(inputId).removeAttribute('aria-invalid');
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
  return Boolean(v.participantName.trim() || v.contactMethod || v.contactValue.trim() ||
    v.participantZip.trim() || v.referralContext.trim() || v.notes.trim());
}

function setLocked(locked) {
  $('referral-fields').disabled = locked;
  $('change-program').disabled = locked;
  $('cancel').disabled = locked;
}

function setSendButton({ enabled, sending = false }) {
  const send = $('send');
  send.disabled = !enabled;
  send.textContent = sending ? 'Sending referral ...' : 'Send referral';
  send.setAttribute('aria-busy', String(sending));
}

function resetReferral() {
  $('referral-form').reset();
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
    return;
  }
  if (result.next === 'CHOOSE_AFFILIATION' || result.next === 'RELOAD_AFFILIATION') {
    await loadAffiliation();
    if (!affiliationIsSet()) $('affiliation-select').focus();
    return;
  }
  if (result.next === 'CHOOSE_PROGRAM') {
    await loadPrograms();
    backToProgramChoice();
    return;
  }
  if (result.needsCheck) {
    // Outcome unknown: ask the server whether this Submission ID arrived (PRD 7.4).
    await runSafeCheck();
  }
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
