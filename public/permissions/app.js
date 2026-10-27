// Permissions screen (Trello Task Y, PRD 3.7, 3.8, 13.3, 13.4, 14).
//
// Hiding a control never replaces the server's check (PRD 3.7): every
// action is decided by the server, and this page only shows the result.
// Nothing about staff or permissions is put in the URL or browser storage
// (PRD 5.5); only the text size is remembered.

import { SIZES, loadSize, saveSize } from '/referral/textSize.js';
import {
  MESSAGES, describeGrant, interpretChange, personHeading, personOptionLabel, readOnlyReason, validateAdd,
} from './logic.js';

const $ = (id) => document.getElementById(id);
let overview = null;   // { users, programs, grantable }
let person = null;     // { user, canChange, grants }
let busy = false;

let storage;
try { storage = window.localStorage; } catch { storage = null; }
function resize(size) {
  document.documentElement.style.fontSize = `${SIZES[size]}px`;
  for (const button of document.querySelectorAll('[data-size]')) {
    button.setAttribute('aria-pressed', String(button.dataset.size === size));
  }
}
resize(loadSize(storage));
for (const button of document.querySelectorAll('[data-size]')) {
  button.addEventListener('click', () => {
    resize(button.dataset.size);
    saveSize(storage, button.dataset.size);
  });
}

function message(text, tone = 'info', focus = true) {
  const box = $('perm-status');
  box.className = `status status--${tone}`;
  box.querySelector('.status__text').textContent = text;
  if (focus) box.focus();
}

async function request(method, path, body) {
  try {
    const response = await fetch(`/api/permissions${path}`, {
      method, credentials: 'same-origin', cache: 'no-store',
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  } catch { return { unknown: true }; }
}

function controls() {
  $('choose-controls').disabled = busy || !overview;
  $('add-controls').disabled = busy;
  for (const button of document.querySelectorAll('[data-remove]')) button.disabled = busy;
}

function option(value, text) {
  const node = document.createElement('option');
  node.value = String(value);
  node.textContent = text;
  return node;
}

function fillOverview(data) {
  overview = data;
  const people = $('person-select');
  const chosen = people.value;
  people.replaceChildren(option('', 'Choose a staff member'),
    ...data.users.map((u) => option(u.userId, personOptionLabel(u))));
  people.value = data.users.some((u) => String(u.userId) === chosen) ? chosen : '';

  $('permission-select').replaceChildren(option('', 'Choose a permission'),
    ...data.grantable.map((g) => option(g.permission, g.label)));
  $('program-select').replaceChildren(option('', 'Choose a Program'),
    ...data.programs.map((p) => option(p.programId,
      `${p.name}${p.site ? ` (${p.site})` : ''}${p.lifecycleStatus === 'DISCONTINUED' ? ' - discontinued' : ''}`)));
}

function showProgramField() {
  const rule = overview?.grantable.find((g) => g.permission === $('permission-select').value);
  const needsProgram = rule?.scopeType === 'PROGRAM';
  $('program-field').hidden = !needsProgram;
  $('program-select').required = needsProgram;
  $('program-select').setAttribute('aria-required', String(needsProgram));
}

function addError(text, field) {
  const box = $('add-error');
  box.hidden = !text;
  box.textContent = text ?? '';
  for (const id of ['permission-select', 'program-select']) $(id).setAttribute('aria-invalid', 'false');
  if (field) {
    const id = field === 'program' ? 'program-select' : 'permission-select';
    $(id).setAttribute('aria-invalid', 'true');
    $(id).focus();
  }
}

function renderGrants(grants) {
  person.grants = grants;
  const list = $('grant-list');
  list.replaceChildren();
  for (const grant of grants) {
    const item = document.createElement('li');
    const text = document.createElement('span');
    text.className = 'grant__text';
    text.textContent = describeGrant(grant);
    item.append(text);
    const reason = readOnlyReason(grant);
    if (reason) {
      const note = document.createElement('span');
      note.className = 'grant__note muted';
      note.textContent = reason;
      item.append(note);
    } else if (person.canChange) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn--secondary';
      remove.dataset.remove = String(grant.grantId);
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${describeGrant(grant)}`);
      remove.addEventListener('click', () => removeGrant(grant));
      item.append(remove);
    }
    list.append(item);
  }
  $('no-grants').hidden = grants.length > 0;
  controls();
}

function renderPerson(data) {
  person = { ...data };
  $('person-panel').hidden = false;
  $('person-heading').textContent = personHeading(data.user);
  const note = !data.canChange ? MESSAGES.SELF : (!data.user.isActive ? MESSAGES.INACTIVE : null);
  $('person-note').hidden = !note;
  $('person-note').textContent = note ?? '';
  $('add-form').hidden = !data.canChange || !data.user.isActive;
  addError(null);
  renderGrants(data.grants);
}

async function loadOverview() {
  busy = true;
  controls();
  const result = await request('GET', '/overview');
  busy = false;
  if (result.status === 200 && Array.isArray(result.body?.users) && Array.isArray(result.body.programs)
      && Array.isArray(result.body.grantable)) {
    fillOverview(result.body);
    message(MESSAGES.LOADED, 'info', false);
  } else if (result.status === 401) {
    message(MESSAGES.SIGNED_OUT, 'error');
  } else if (result.status === 403) {
    message(MESSAGES.NOT_ADMIN, 'error');
  } else {
    message(MESSAGES.LOAD_FAILED, 'error');
  }
  controls();
}

async function loadPerson(userId) {
  busy = true;
  controls();
  const result = await request('GET', `/users/${userId}/grants`);
  busy = false;
  if (result.status === 200 && result.body?.user?.userId === userId && Array.isArray(result.body.grants)) {
    renderPerson(result.body);
    message(MESSAGES.PERSON_LOADED, 'info', false);
    $('person-heading').focus();
  } else {
    const outcome = interpretChange(result);
    message(outcome.state === 'NOT_ADMIN' ? outcome.message : MESSAGES.PERSON_FAILED, 'error');
  }
  controls();
}

function applyChange(outcome) {
  if (outcome.grants) renderGrants(outcome.grants);
  if (outcome.state === 'NOT_ADMIN') {
    $('person-panel').hidden = true;
    overview = null;
  }
  if (outcome.state === 'UNKNOWN') {
    // Not confirmed: block further changes until this person is reloaded.
    $('add-controls').disabled = true;
    for (const button of document.querySelectorAll('[data-remove]')) button.disabled = true;
  }
  message(outcome.message, outcome.tone);
}

async function removeGrant(grant) {
  if (busy || !person) return;
  if (!window.confirm(`Remove "${describeGrant(grant)}" from ${person.user.displayName}?`)) return;
  busy = true;
  controls();
  message(MESSAGES.SAVING, 'info', false);
  const result = await request('POST', `/users/${person.user.userId}/grants/${grant.grantId}/revoke`, {});
  busy = false;
  controls();
  applyChange(interpretChange(result, { added: grant }));
}

$('choose-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (busy) return;
  const userId = Number($('person-select').value);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    message(MESSAGES.CHOOSE_PERSON, 'error', false);
    $('person-select').focus();
    return;
  }
  loadPerson(userId);
});

$('reload').addEventListener('click', async () => {
  await loadOverview();
  if (overview && person) await loadPerson(person.user.userId);
});

$('permission-select').addEventListener('change', () => { showProgramField(); addError(null); });

$('add-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || !person || !overview) return;
  const checked = validateAdd(
    { permission: $('permission-select').value, programId: $('program-select').value },
    overview.grantable,
  );
  if (!checked.ok) {
    addError(checked.message, checked.field);
    return;
  }
  addError(null);
  busy = true;
  controls();
  message(MESSAGES.SAVING, 'info', false);
  const result = await request('POST', `/users/${person.user.userId}/grants`, checked.body);
  busy = false;
  controls();
  const outcome = interpretChange(result);
  applyChange(outcome);
  if (outcome.state === 'GRANTED') {
    $('permission-select').value = '';
    $('program-select').value = '';
    showProgramField();
  }
});

showProgramField();
loadOverview();
