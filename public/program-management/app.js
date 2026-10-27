import { SIZES, loadSize, saveSize } from '/referral/textSize.js';

const $ = (id) => document.getElementById(id);
const fields = ['site', 'description', 'eligibilityNotes', 'scheduleNotes', 'costNotes'];
const labels = {
  site: 'Site', description: 'Description', eligibilityNotes: 'Eligibility notes',
  scheduleNotes: 'Schedule notes', costNotes: 'Cost notes',
};
let saved = null;
let latest = null;
let busy = false;
let needsReload = false;

function storage() {
  try { return window.localStorage; } catch { return null; }
}
function size(value) {
  document.documentElement.style.fontSize = `${SIZES[value]}px`;
  for (const button of document.querySelectorAll('[data-size]')) {
    button.setAttribute('aria-pressed', String(button.dataset.size === value));
  }
}
size(loadSize(storage()));
for (const button of document.querySelectorAll('[data-size]')) {
  button.addEventListener('click', () => {
    size(button.dataset.size);
    saveSize(storage(), button.dataset.size);
  });
}

function message(text, tone = 'info', focus = true) {
  const box = $('status');
  box.className = `status status--${tone}`;
  box.querySelector('.status__text').textContent = text;
  box.hidden = false;
  if (focus) box.focus();
}
function dirty() {
  return saved && fields.some((field) => $(field).value !== (saved[field] ?? ''));
}
function controls() {
  const blocked = busy || needsReload || Boolean(latest);
  $('program-select').disabled = busy;
  $('open-program').disabled = busy;
  $('retry-list').disabled = busy;
  $('details-fields').disabled = busy || saved?.lifecycleStatus === 'RETIRED';
  $('save').disabled = blocked || !saved || saved.lifecycleStatus === 'RETIRED';
  $('discard').disabled = busy || !saved;
  $('lifecycle').disabled = blocked || !saved || saved.lifecycleStatus === 'RETIRED';
  $('reload-program').disabled = busy;
  $('load-current').disabled = busy;
}
function errors(names = []) {
  for (const field of fields) {
    const invalid = names.includes(field);
    $(`${field}-error`).textContent = invalid ? `Check ${labels[field].toLowerCase()} and its length.` : '';
    $(`${field}-error`).hidden = !invalid;
    if (invalid) $(field).setAttribute('aria-invalid', 'true');
    else $(field).removeAttribute('aria-invalid');
  }
  const first = fields.find((field) => names.includes(field));
  if (first) $(first).focus();
}
async function call(method, path, body) {
  try {
    const response = await fetch(`/api/program-management${path}`, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  } catch {
    return { networkError: true };
  }
}
function validProgram(row, id) {
  return row && row.programId === id && typeof row.name === 'string'
    && typeof row.version === 'string'
    && ['ACTIVE', 'DISCONTINUED', 'RETIRED'].includes(row.lifecycleStatus)
    && fields.every((field) => row[field] == null || typeof row[field] === 'string');
}
function render(row) {
  saved = row;
  let managementActions = document.getElementById('management-links');
  if (!managementActions) {
    managementActions = document.createElement('div');
    managementActions.id = 'management-links';
    managementActions.className = 'actions';
    document.getElementById('editor').append(managementActions);
  }
  let fieldLink = document.getElementById('manage-fields-link');
  if (!fieldLink) {
    fieldLink = document.createElement('a');
    fieldLink.id = 'manage-fields-link';
    fieldLink.className = 'btn btn--secondary';
    fieldLink.textContent = 'Manage configurable fields';
    managementActions.append(fieldLink);
  }
  fieldLink.href = `fields.html?programId=${row.programId}`;
  let matchingLink = document.getElementById('manage-matching-link');
  if (!matchingLink) {
    matchingLink = document.createElement('a');
    matchingLink.id = 'manage-matching-link';
    matchingLink.className = 'btn btn--secondary';
    matchingLink.textContent = 'Manage matching information';
    managementActions.append(matchingLink);
  }
  matchingLink.href = `matching.html?programId=${row.programId}`;
  latest = null;
  needsReload = false;
  $('editor').hidden = false;
  $('editor-heading').textContent = row.name;
  $('department-name').textContent = row.departmentName ?? 'Department unavailable';
  $('program-status').textContent = row.lifecycleStatus;
  $('retired-note').hidden = row.lifecycleStatus !== 'RETIRED';
  $('conflict').hidden = true;
  for (const field of fields) $(field).value = row[field] ?? '';
  $('lifecycle').textContent = row.lifecycleStatus === 'DISCONTINUED'
    ? 'Reactivate Program' : 'Discontinue Program';
  errors();
  controls();
}
function explain(response) {
  if (response.status === 401) return 'Sign in again before continuing. Your edits remain on this page.';
  if (response.status === 403) return 'You are not currently authorized for this action. Your edits remain on this page.';
  if (response.status === 404) return 'This Program is unavailable. Your edits remain on this page.';
  if (response.body?.code === 'DEPARTMENT_NOT_ACTIVE') return 'The Department must be active before this Program can be reactivated.';
  if (response.body?.code === 'NO_CHANGE') return 'No changes were saved because the information is unchanged.';
  return 'The action could not be completed. Your edits remain on this page.';
}

// Safari does not focus a button when it is clicked, so the browser cannot
// return focus to it when a dialog closes. Remember the last clicked button
// and return focus to it ourselves when the worker stays or presses Escape
// (docs/browser-verification.md).
let lastClickedButton = null;
document.addEventListener('click', (event) => { lastClickedButton = event.target.closest('button'); }, true);
let confirmOpener = null;
let confirmEscaped = false;
$('confirm-dialog').addEventListener('cancel', () => { confirmEscaped = true; });
$('confirm-dialog').addEventListener('close', () => {
  if (!confirmEscaped) return;
  confirmEscaped = false;
  confirmOpener?.focus();
});

function confirmAction(text, action) {
  const dialog = $('confirm-dialog');
  $('confirm-message').textContent = text;
  confirmOpener = lastClickedButton;
  $('confirm-proceed').onclick = () => {
    dialog.close();
    action();
  };
  dialog.showModal();
}
$('confirm-stay').addEventListener('click', () => {
  $('confirm-dialog').close();
  confirmOpener?.focus();
});

async function loadList() {
  if (busy) return;
  busy = true;
  controls();
  $('programs-loading').hidden = false;
  $('retry-list').hidden = true;
  const result = await call('GET', '/programs');
  busy = false;
  $('programs-loading').hidden = true;
  if (result.status !== 200 || !Array.isArray(result.body?.programs)) {
    message(explain(result), 'error');
    $('retry-list').hidden = false;
    controls();
    return;
  }
  const select = $('program-select');
  select.length = 1;
  for (const row of result.body.programs) {
    if (!Number.isSafeInteger(row.programId) || row.programId <= 0 || typeof row.name !== 'string') continue;
    const option = document.createElement('option');
    option.value = String(row.programId);
    option.textContent = `${row.name}${row.site ? ` (${row.site})` : ''} — ${row.lifecycleStatus}`;
    select.append(option);
  }
  $('programs-empty').hidden = select.length > 1;
  $('chooser-form').hidden = select.length === 1;
  controls();
}
async function openProgram(id) {
  if (busy) return;
  busy = true;
  controls();
  message('Loading Program…', 'info', false);
  const result = await call('GET', `/programs/${id}`);
  busy = false;
  if (result.status === 200 && validProgram(result.body?.program, id)) {
    render(result.body.program);
    $('status').hidden = true;
    $('editor-heading').focus();
  } else {
    message(explain(result), 'error');
    controls();
  }
}
$('chooser-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const id = Number($('program-select').value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    message('Choose a Program first.', 'error', false);
    $('program-select').focus();
    return;
  }
  if (dirty()) confirmAction('Discard your unsaved edits and open the selected Program?', () => openProgram(id));
  else openProgram(id);
});
$('retry-list').addEventListener('click', loadList);

async function mutate(action, changes) {
  if (busy || !saved || needsReload || latest) return;
  const id = saved.programId;
  busy = true;
  controls();
  errors();
  message('Saving…', 'info', false);
  const result = await call(action ? 'POST' : 'PATCH',
    `/programs/${id}${action ? `/${action}` : ''}`,
    { version: saved.version, ...changes });
  busy = false;
  if (result.status === 200 && validProgram(result.body?.program, id)) {
    render(result.body.program);
    const option = [...$('program-select').options].find((item) => item.value === String(id));
    if (option) option.textContent = `${saved.name}${saved.site ? ` (${saved.site})` : ''} — ${saved.lifecycleStatus}`;
    message(action ? 'Program status saved.' : 'Changes saved.', 'success');
  } else if (result.status === 409 && validProgram(result.body?.current, id)) {
    latest = result.body.current;
    $('current-values').replaceChildren();
    const pairs = [['Status', latest.lifecycleStatus], ...fields.map((field) => [labels[field], latest[field] ?? 'Not set'])];
    for (const [label, value] of pairs) {
      const group = document.createElement('div');
      const term = document.createElement('dt');
      const detail = document.createElement('dd');
      term.textContent = label;
      detail.textContent = value;
      group.append(term, detail);
      $('current-values').append(group);
    }
    $('conflict').hidden = false;
    message('Nothing was saved. This Program changed; your edits are preserved below.', 'error');
  } else if (result.networkError || result.status >= 500 || result.status === 200) {
    needsReload = true;
    message('Save outcome is not confirmed. Your edits remain here. Reload saved information before attempting another change.', 'error');
  } else {
    message(explain(result), 'error', false);
    errors(Array.isArray(result.body?.fields) ? result.body.fields : []);
  }
  controls();
}
$('details-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!saved) return;
  const changes = {};
  for (const field of fields) {
    if ($(field).value !== (saved[field] ?? '')) changes[field] = $(field).value;
  }
  if (!Object.keys(changes).length) {
    message('There are no changes to save.');
    return;
  }
  mutate(null, changes);
});
$('lifecycle').addEventListener('click', () => {
  if (!saved || busy) return;
  if (dirty()) {
    message('Save or discard your information edits before changing Program status.', 'error');
    return;
  }
  const action = saved.lifecycleStatus === 'DISCONTINUED' ? 'reactivate' : 'discontinue';
  confirmAction(action === 'discontinue'
    ? 'Discontinue this Program? It will leave new referral choices. Existing referrals remain available.'
    : 'Reactivate this Program so it can receive new referrals?', () => mutate(action, {}));
});
function reload() {
  if (!saved || busy) return;
  const id = saved.programId;
  if (dirty()) confirmAction('Discard your entered edits and load the latest saved information?', () => openProgram(id));
  else openProgram(id);
}
$('reload-program').addEventListener('click', reload);
$('discard').addEventListener('click', reload);
$('load-current').addEventListener('click', reload);
for (const field of fields) $(field).addEventListener('input', () => {
  $(field).removeAttribute('aria-invalid');
  $(`${field}-error`).hidden = true;
});
$('details-form').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
});
window.addEventListener('beforeunload', (event) => {
  if (dirty() || busy || needsReload) {
    event.preventDefault();
    event.returnValue = '';
  }
});
loadList();
