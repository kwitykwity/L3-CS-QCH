// One referral, seen by its receiving Program (Task A).
//
//   GET  /api/referrals/:id                    referral + viewerAccess
//   GET  /api/referrals/not-appropriate-reasons
//   POST /api/referrals/:id/response            first response
//   POST /api/referrals/:id/outcome             record the service outcome
//   POST /api/referrals/:id/outcome/correction  { outcome, version }
//   POST /api/referrals/:id/response/correction { decision, reasonId?, explanation?, version }
//
// - Which actions appear comes from viewerAccess, a hint from the server.
//   The server checks every action again (PRD 3.7); this page is never
//   the permission check.
// - After every change the page reloads the referral from the server and
//   shows that, not what it guessed (PRD 6.4).
// - Stale or unconfirmed changes (PRD 9.4, 13.4): nothing is merged or
//   retried. The page shows the latest information it has, keeps the
//   worker's choices on screen but locks every action until the worker
//   loads the latest information and chooses again.

import { CONTACT_METHODS } from '/referral/validation.js';
import {
  call, decisionText, formatDate, OUTCOME_LABELS, DECISION_LABELS, outcomeText,
  responseText, setupTextSize, showStatus, summaryRow,
} from './common.js';

const $ = (id) => document.getElementById(id);
const referralId = Number(new URLSearchParams(window.location.search).get('id'));
const ACTION_FIELDSETS = ['respond-fields', 'outcome-fields', 'correct-outcome-fields', 'correct-decision-fields'];
const ACTION_PANELS = ['respond-panel', 'outcome-panel', 'correct-outcome-panel', 'correct-decision-panel'];
// 409s that mean the referral is no longer in the state this page shows.
const STATE_MOVED = ['ALREADY_RESPONDED', 'OUTCOME_ALREADY_RECORDED', 'OUTCOME_NOT_ALLOWED', 'OUTCOME_NOT_RECORDED', 'NOT_RESPONDED'];

let referral = null;
let access = null;
let busy = false;
let blocked = false;

setupTextSize();

const base = () => `/api/referrals/${encodeURIComponent(referralId)}`;
const contactLabel = (value) => CONTACT_METHODS.find((m) => m.value === value)?.label ?? 'Unknown';
const checked = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value ?? '';

function controls() {
  for (const id of ACTION_FIELDSETS) $(id).disabled = busy || blocked;
  $('reload').disabled = busy;
  $('load-latest').disabled = busy;
}

// ----- errors on the forms (text with an icon, never color alone) -----

function setError(errorId, text) {
  const node = $(errorId);
  node.textContent = text ?? '';
  node.hidden = !text;
  const owner = document.querySelector(`[aria-describedby~="${errorId}"]`);
  if (owner && owner.tagName !== 'FIELDSET') {
    if (text) owner.setAttribute('aria-invalid', 'true');
    else owner.removeAttribute('aria-invalid');
  }
}

function clearErrors(form) {
  for (const node of form.querySelectorAll('.field__error')) setError(node.id, null);
}

// ----- showing the referral -----

function renderInfo() {
  const list = $('info-list');
  list.replaceChildren(
    summaryRow('Participant', referral.participantName),
    summaryRow('How to reach them', referral.contactMethod === 'NOT_AVAILABLE'
      ? contactLabel(referral.contactMethod)
      : `${contactLabel(referral.contactMethod)}: ${referral.contactValue ?? ''}`),
    ...(referral.participantZip ? [summaryRow('ZIP code', referral.participantZip)] : []),
    summaryRow('What they need', referral.referralContext ?? ''),
    ...(referral.notes ? [summaryRow('Notes', referral.notes)] : []),
    summaryRow('From', referral.referringProgram?.name ?? 'Unknown Program'),
    summaryRow('To', referral.receivingProgram?.name ?? 'Unknown Program'),
    summaryRow('Sent', formatDate(referral.createdAt)),
  );
  for (const dd of list.querySelectorAll('dd')) dd.classList.add('need');
}

function renderProgress() {
  $('response-value').textContent = referral.firstRespondedAt
    ? `${responseText(referral)} (first response ${formatDate(referral.firstRespondedAt)})`
    : responseText(referral);
  $('decision-value').textContent = decisionText(referral);

  const reason = referral.decision === 'NOT_APPROPRIATE' ? referral.notAppropriateReason?.label : null;
  $('reason-value').textContent = reason ? `Reason: ${reason}` : '';
  $('reason-value').hidden = !reason;
  const explanation = referral.decision === 'NOT_APPROPRIATE' ? referral.notAppropriateExplanation : null;
  $('explanation-value').textContent = explanation ? `Explanation: ${explanation}` : '';
  $('explanation-value').hidden = !explanation;

  $('outcome-value').textContent = referral.outcomeRecordedAt && referral.serviceOutcome !== 'NOT_RECORDED'
    ? `${outcomeText(referral)} (recorded ${formatDate(referral.outcomeRecordedAt)})`
    : outcomeText(referral);
  let note = '';
  if (referral.decision === 'ACCEPTED' && referral.serviceOutcome === 'NOT_RECORDED') {
    note = 'Accepted is not the same as served. Record the outcome once you know whether the person received service.';
  } else if (referral.decision === 'NOT_APPROPRIATE') {
    note = 'A Not appropriate referral cannot have a service outcome. To record one, the decision must first be corrected to Accepted.';
  }
  $('outcome-note').textContent = note;
  $('outcome-note').hidden = !note;
}

function fillReasons(select, reasons, keepId) {
  select.length = 1;
  for (const reason of reasons) select.add(new Option(reason.label, String(reason.reasonId)));
  // A reason that is no longer offered still shows when it is the saved one.
  if (keepId && !reasons.some((r) => r.reasonId === keepId) && referral?.notAppropriateReason?.label) {
    select.add(new Option(`${referral.notAppropriateReason.label} (no longer offered)`, String(keepId)));
  }
}

function resetForms() {
  for (const id of ['respond-form', 'outcome-form', 'correct-outcome-form', 'correct-decision-form']) {
    $(id).reset();
    clearErrors($(id));
  }
  // Corrections start from the saved values, so the worker sees what they change.
  if (referral.serviceOutcome) {
    const current = document.querySelector(`input[name="corrected-outcome"][value="${referral.serviceOutcome}"]`);
    if (current) current.checked = true;
  }
  if (referral.decision) {
    const current = document.querySelector(`input[name="corrected-decision"][value="${referral.decision}"]`);
    if (current) current.checked = true;
  }
  if (referral.decision === 'NOT_APPROPRIATE') {
    $('cd-reason').value = String(referral.notAppropriateReason?.reasonId ?? '');
    $('cd-explanation').value = referral.notAppropriateExplanation ?? '';
  }
  showReasonFields('respond');
  showReasonFields('cd');
}

function showReasonFields(prefix) {
  const name = prefix === 'respond' ? 'respond-decision' : 'corrected-decision';
  const na = checked(name) === 'NOT_APPROPRIATE';
  $(`${prefix}-reason-group`).hidden = !na;
  $(`${prefix}-explanation-group`).hidden = !na;
  $(`${prefix}-reason`).required = na;
  if (na) $(`${prefix}-reason`).setAttribute('aria-required', 'true');
  else $(`${prefix}-reason`).removeAttribute('aria-required');
}

function render() {
  $('referral-heading').textContent = `Referral ${referral.referralId}: ${referral.participantName}`;
  document.title = `Referral ${referral.referralId} · QCH Connect`;
  renderInfo();
  renderProgress();
  $('info').hidden = false;
  $('progress').hidden = false;

  const shown = {
    'respond-panel': access.canRespond === true,
    'outcome-panel': access.canRecordOutcome === true,
    'correct-outcome-panel': access.canCorrectOutcome === true,
    'correct-decision-panel': access.canCorrectResponse === true,
  };
  for (const id of ACTION_PANELS) $(id).hidden = !shown[id];
  const none = !Object.values(shown).some(Boolean);
  $('readonly-note').textContent = access.asReceiver
    ? 'You can view this referral, but there is nothing you have permission to change on it right now.'
    : 'You sent this referral. The receiving Program responds to it and records the service outcome.';
  $('readonly-note').hidden = !none;
  $('reload').hidden = false;
  resetForms();
}

function hideReferral() {
  for (const id of ['info', 'progress', 'conflict', 'readonly-note', ...ACTION_PANELS]) $(id).hidden = true;
}

let reasons = [];
async function loadReasons() {
  const result = await call('GET', '/api/referrals/not-appropriate-reasons');
  if (result.status === 200 && Array.isArray(result.body?.reasons)) reasons = result.body.reasons;
  const savedId = referral?.decision === 'NOT_APPROPRIATE' ? referral.notAppropriateReason?.reasonId : null;
  fillReasons($('respond-reason'), reasons, null);
  fillReasons($('cd-reason'), reasons, savedId);
}

// Loads the referral from the server and shows it. Returns true on success.
async function load() {
  if (!Number.isSafeInteger(referralId) || referralId <= 0) {
    hideReferral();
    showStatus('This referral is not available. It may not exist, or you may not have access to it.', 'error');
    return false;
  }
  busy = true;
  controls();
  const result = await call('GET', base());
  busy = false;
  if (result.status === 200 && result.body?.referral?.referralId === referralId && result.body.viewerAccess) {
    referral = result.body.referral;
    access = result.body.viewerAccess;
    blocked = false;
    $('conflict').hidden = true;
    if (access.canRespond || access.canCorrectResponse) await loadReasons();
    render();
    controls();
    return true;
  }
  controls();
  if (result.status === 404) {
    hideReferral();
    $('reload').hidden = true;
    showStatus('This referral is not available. It may not exist, or you may not have access to it.', 'error');
  } else if (result.status === 401) {
    showStatus('Sign in again to see this referral.', 'error');
  } else {
    $('reload').hidden = false;
    showStatus('The referral could not be loaded. Check your connection and try again.', 'error');
  }
  return false;
}

// ----- when a change cannot be confirmed or the referral moved on -----

function showConflict(message, current) {
  blocked = true;
  $('conflict-message').textContent = message;
  const list = $('conflict-current');
  if (current) {
    list.replaceChildren(
      summaryRow('Response now', responseText(current)),
      summaryRow('Decision now', current.decision === 'NOT_APPROPRIATE' && current.notAppropriateReason?.label
        ? `${decisionText(current)}: ${current.notAppropriateReason.label}`
        : decisionText(current)),
      summaryRow('Service outcome now', outcomeText(current)),
    );
  } else {
    list.replaceChildren();
  }
  list.hidden = !current;
  $('conflict').hidden = false;
  controls();
  showStatus('Your change was not saved. Review the latest information before trying again.', 'error', { focus: false });
  $('conflict-heading').focus();
}

const FIELD_ERRORS = {
  decision: ['decisionError', 'Choose a decision.'],
  reasonId: ['reasonError', 'Choose a reason.'],
  explanation: ['explanationError', 'Check the explanation. It can be up to 1000 characters.'],
  outcome: ['outcomeError', 'Choose an outcome.'],
};

// Shared handling for every change. `ids` names this form's error slots
// and first controls; `done` is the success message.
async function handle(result, ids, done) {
  const code = result.body?.code;
  if (result.status === 200) {
    if (await load()) showStatus(done, 'success');
    else showStatus(`${done} The page could not reload the referral; use Reload this referral.`, 'success');
    return;
  }
  if (result.networkError || result.status >= 500 || (result.status >= 200 && result.status < 300)) {
    showConflict('We could not confirm whether your change was saved. Nothing else will be sent. Load the latest information to check what was saved, then decide what to do.', null);
    return;
  }
  if (result.status === 409 && code === 'REFERRAL_CHANGED') {
    showConflict('Someone else changed this referral after you opened it, so your change was not saved. The steps above still show what you saw before; below is what is saved now. Load the latest information, review it, and choose again.', result.body.current ?? null);
    return;
  }
  if (result.status === 409 && STATE_MOVED.includes(code)) {
    showConflict(`${result.body.error ?? 'This referral changed.'} Your change was not saved. Load the latest information and review it.`, null);
    return;
  }
  if (result.status === 409 && code === 'NO_CHANGE') {
    showStatus('That is already the saved value. Nothing was changed.', 'info');
    return;
  }
  if (result.status === 409 && code === 'OUTCOME_RECORDED') {
    showStatus(result.body.error ?? 'A recorded service outcome blocks this change.', 'error');
    return;
  }
  if (result.status === 422 && code === 'REASON_NOT_SELECTABLE') {
    await loadReasons();
    setError(ids.reasonError, 'That reason can no longer be chosen. Choose another reason.');
    showStatus('Some information needs attention. Nothing was saved.', 'error', { focus: false });
    ids.reasonFocus?.focus();
    return;
  }
  if (result.status === 400 && Array.isArray(result.body?.fields) && result.body.fields.length) {
    let first = null;
    for (const field of result.body.fields) {
      const [slot, text] = FIELD_ERRORS[field] ?? [];
      if (slot && ids[slot]) {
        setError(ids[slot], text);
        first ??= ids[`${slot.replace('Error', '')}Focus`];
      }
    }
    showStatus('Some information needs attention. Nothing was saved.', 'error', { focus: !first });
    first?.focus();
    return;
  }
  if (result.status === 403) {
    showStatus('You do not have permission to make this change. Nothing was changed.', 'error');
    return;
  }
  if (result.status === 404) {
    hideReferral();
    showStatus('This referral is not available. It may not exist, or you may not have access to it.', 'error');
    return;
  }
  if (result.status === 401) {
    showStatus('Sign in again before making changes. Nothing was changed.', 'error');
    return;
  }
  showStatus('Nothing was saved. Check your choices and try again.', 'error');
}

async function submit(form, path, body, ids, question, done) {
  if (busy || blocked) return;
  if (!window.confirm(question)) return;
  busy = true;
  controls();
  showStatus('Saving…', 'info', { focus: false });
  const result = await call('POST', path, body);
  busy = false;
  controls();
  await handle(result, ids, done);
}

// Checks a decision form (first response or correction). Returns the
// request body, or null after showing errors and moving focus.
function readDecision(form, prefix, radioName, firstRadio) {
  clearErrors(form);
  const decision = checked(radioName);
  const errorId = prefix === 'respond' ? 'respond-decision-error' : 'correct-decision-choice-error';
  if (!decision) {
    setError(errorId, 'Choose a decision.');
    showStatus('Some information needs attention. Nothing was sent.', 'error', { focus: false });
    $(firstRadio).focus();
    return null;
  }
  if (decision === 'ACCEPTED') return { decision };
  const reasonId = Number($(`${prefix}-reason`).value);
  if (!Number.isSafeInteger(reasonId) || reasonId <= 0) {
    setError(`${prefix}-reason-error`, 'Choose a reason.');
    showStatus('Some information needs attention. Nothing was sent.', 'error', { focus: false });
    $(`${prefix}-reason`).focus();
    return null;
  }
  const explanation = $(`${prefix}-explanation`).value;
  return { decision, reasonId, ...(explanation.trim() ? { explanation } : {}) };
}

function readOutcome(form, radioName, errorId, firstRadio) {
  clearErrors(form);
  const outcome = checked(radioName);
  if (!outcome) {
    setError(errorId, 'Choose an outcome.');
    showStatus('Some information needs attention. Nothing was sent.', 'error', { focus: false });
    $(firstRadio).focus();
    return null;
  }
  return outcome;
}

// ----- the four actions -----

$('respond-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const body = readDecision($('respond-form'), 'respond', 'respond-decision', 'respond-accept');
  if (!body) return;
  submit($('respond-form'), `${base()}/response`, body, {
    decisionError: 'respond-decision-error', decisionFocus: $('respond-accept'),
    reasonError: 'respond-reason-error', reasonFocus: $('respond-reason'),
    explanationError: 'respond-explanation-error', explanationFocus: $('respond-explanation'),
  }, body.decision === 'ACCEPTED'
    ? 'Accept this referral? Accepting does not record that service happened.'
    : 'Mark this referral Not appropriate? The referring worker will see the reason you chose.',
  body.decision === 'ACCEPTED'
    ? 'Response sent: Accepted. The service outcome is not recorded yet.'
    : 'Response sent: Not appropriate.');
});

$('outcome-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const outcome = readOutcome($('outcome-form'), 'outcome', 'outcome-choice-error', 'outcome-resulted');
  if (!outcome) return;
  submit($('outcome-form'), `${base()}/outcome`, { outcome }, {
    outcomeError: 'outcome-choice-error', outcomeFocus: $('outcome-resulted'),
  }, `Record the service outcome as "${OUTCOME_LABELS[outcome]}"?`,
  `Service outcome recorded: ${OUTCOME_LABELS[outcome]}.`);
});

$('correct-outcome-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const outcome = readOutcome($('correct-outcome-form'), 'corrected-outcome', 'correct-outcome-choice-error', 'co-resulted');
  if (!outcome) return;
  submit($('correct-outcome-form'), `${base()}/outcome/correction`, { outcome, version: referral.version }, {
    outcomeError: 'correct-outcome-choice-error', outcomeFocus: $('co-resulted'),
  }, `Correct the service outcome to "${OUTCOME_LABELS[outcome]}"? The earlier value stays in the audit history.`,
  `Service outcome corrected to: ${OUTCOME_LABELS[outcome]}.`);
});

$('correct-decision-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const body = readDecision($('correct-decision-form'), 'cd', 'corrected-decision', 'cd-accept');
  if (!body) return;
  submit($('correct-decision-form'), `${base()}/response/correction`, { ...body, version: referral.version }, {
    decisionError: 'correct-decision-choice-error', decisionFocus: $('cd-accept'),
    reasonError: 'cd-reason-error', reasonFocus: $('cd-reason'),
    explanationError: 'cd-explanation-error', explanationFocus: $('cd-explanation'),
  }, `Correct the decision to "${DECISION_LABELS[body.decision]}"? The earlier value stays in the audit history.`,
  `Decision corrected to: ${DECISION_LABELS[body.decision]}.`);
});

for (const radio of document.querySelectorAll('input[name="respond-decision"]')) {
  radio.addEventListener('change', () => showReasonFields('respond'));
}
for (const radio of document.querySelectorAll('input[name="corrected-decision"]')) {
  radio.addEventListener('change', () => showReasonFields('cd'));
}
// Enter in a one-line field never sends anything.
for (const form of document.querySelectorAll('form')) {
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.type !== 'radio') event.preventDefault();
  });
}

$('load-latest').addEventListener('click', async () => {
  if (await load()) showStatus('Latest information loaded. Review it, then choose again.', 'info');
});
$('reload').addEventListener('click', async () => {
  if (await load()) showStatus('Referral reloaded.', 'info');
});

(async () => {
  showStatus('Loading referral…', 'info', { focus: false });
  if (await load()) showStatus('Referral loaded.', 'info', { focus: false });
})();
