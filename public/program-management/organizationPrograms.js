import { SIZES, loadSize, saveSize } from '/referral/textSize.js';

const $ = (id) => document.getElementById(id);
let forms = [];
let programs = [];
let busy = false;
let blocked = false;
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
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function message(text, error = false) {
  const box = $('program-org-status');
  box.className = `status status--${error ? 'error' : 'info'}`;
  box.querySelector('.status__text').textContent = text;
  box.focus();
}
function snapshot(entry) { return JSON.stringify(entry.inputs.map((input) => input.value)); }
function dirty(entry) { return snapshot(entry) !== entry.original; }
function controls() {
  $('reload-program-organization').disabled = busy;
  for (const entry of forms) entry.fieldset.disabled = busy || blocked;
}
async function request(method, path, body) {
  try {
    const response = await fetch(`/api/program-management${path}`, {
      method, credentials: 'same-origin', cache: 'no-store',
      ...(body === undefined ? {} : {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    });
    return { status: response.status, body: await response.json() };
  } catch { return { unknown: true }; }
}
function formPanel(title) {
  const panel = element('section', undefined, 'panel');
  panel.append(element('h2', title));
  const form = element('form');
  form.noValidate = true;
  const fieldset = element('fieldset', undefined, 'plain');
  fieldset.append(element('legend', title));
  form.append(fieldset);
  panel.append(form);
  const entry = { panel, form, fieldset, inputs: [], original: '' };
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
  });
  return entry;
}
function addControl(entry, id, label, input, required = false) {
  const group = element('div', undefined, 'field');
  input.id = id;
  if (required) {
    input.required = true;
    input.setAttribute('aria-required', 'true');
  }
  const caption = element('label', `${label}${required ? ' *' : ''}`);
  caption.htmlFor = id;
  group.append(caption, input);
  entry.fieldset.append(group);
  entry.inputs.push(input);
  return input;
}
function departmentSelect(departments) {
  const select = element('select');
  select.add(new Option('Choose an active Department', ''));
  for (const row of departments.filter((item) => item.lifecycleStatus === 'ACTIVE')) {
    select.add(new Option(row.name, String(row.departmentId)));
  }
  return select;
}
async function mutate(entry, path, body, created) {
  if (busy || blocked) return;
  if (forms.some((other) => other !== entry && dirty(other))) {
    message('Save or reload edits in the other form before continuing.', true);
    return;
  }
  if (!entry.form.checkValidity()) {
    message('Check the required fields and text lengths.', true);
    entry.form.querySelector(':invalid')?.focus();
    return;
  }
  if (!window.confirm(created
    ? 'Create this Program in the selected Department? Program management permissions and notification routing must be configured separately.'
    : 'Move this Program to the selected Department? Past referrals retain their historical Department context.')) return;
  busy = true;
  controls();
  const result = await request('POST', path, body);
  busy = false;
  if (result.status === (created ? 201 : 200)
      && Number.isSafeInteger(result.body?.program?.programId)
      && typeof result.body.program.version === 'string') {
    blocked = true;
    if (await load(true)) {
      message(created ? 'Program created. Management permissions and notification routing require separate setup.' : 'Program moved. Historical referral context is preserved.');
    } else {
      message('The change was saved, but the updated lists could not be loaded. Reload saved organization before continuing.', true);
    }
  } else if (result.body?.code === 'NO_CHANGE') {
    message('The Program is already in that Department.');
  } else if (result.body?.code === 'PROGRAM_NAME_TAKEN') {
    message('A Program already uses that name and site. Your entries remain.', true);
  } else if (result.body?.code === 'DEPARTMENT_NOT_ACTIVE') {
    message('The target Department is no longer active. Your entries remain. Reload saved organization to review current choices.', true);
    blocked = true;
  } else if (result.body?.code === 'PROGRAM_CHANGED' || result.unknown || result.status >= 500
      || (result.status >= 200 && result.status < 300)) {
    blocked = true;
    message(result.status === 409
      ? 'The Program changed. Your entries remain. Reload saved organization before continuing.'
      : 'Save outcome is not confirmed. Your entries remain. Reload saved organization before continuing.', true);
  } else {
    message('The change was not saved. Check your organization permission and entered information. Your entries remain.', true);
  }
  controls();
}
function buildForms(departments) {
  const create = formPanel('Create a Program');
  const name = addControl(create, 'create-program-name', 'Program name', element('input'), true);
  name.type = 'text';
  name.maxLength = 200;
  const department = addControl(create, 'create-program-department', 'Department', departmentSelect(departments), true);
  const details = {};
  for (const [key, label, max] of [
    ['site', 'Site', 200], ['description', 'Description', 4000],
    ['eligibilityNotes', 'Eligibility notes', 4000], ['scheduleNotes', 'Schedule notes', 2000],
    ['costNotes', 'Cost notes', 1000],
  ]) {
    const input = element(key === 'site' ? 'input' : 'textarea');
    if (key === 'site') input.type = 'text';
    else input.rows = 3;
    input.maxLength = max;
    details[key] = addControl(create, `create-program-${key}`, label, input);
  }
  const createButton = element('button', 'Create Program', 'btn btn--primary');
  createButton.type = 'submit';
  create.fieldset.append(createButton);
  create.form.addEventListener('submit', (event) => {
    event.preventDefault();
    mutate(create, '/programs', {
      name: name.value, departmentId: Number(department.value),
      ...Object.fromEntries(Object.entries(details).map(([key, input]) => [key, input.value])),
    }, true);
  });

  const move = formPanel('Move a Program');
  const chooser = element('select');
  chooser.add(new Option('Choose a Program', ''));
  for (const row of programs.filter((item) => item.lifecycleStatus !== 'RETIRED')) {
    chooser.add(new Option(`${row.name}${row.site ? ` (${row.site})` : ''} - ${row.departmentName}`, String(row.programId)));
  }
  addControl(move, 'move-program', 'Program', chooser, true);
  const target = addControl(move, 'move-program-department', 'Target Department', departmentSelect(departments), true);
  const moveButton = element('button', 'Move Program', 'btn btn--primary');
  moveButton.type = 'submit';
  move.fieldset.append(moveButton);
  move.form.addEventListener('submit', (event) => {
    event.preventDefault();
    const program = programs.find((row) => row.programId === Number(chooser.value));
    if (!program) {
      message('Choose a Program first.', true);
      chooser.focus();
      return;
    }
    mutate(move, `/programs/${program.programId}/move`,
      { version: program.version, departmentId: Number(target.value) }, false);
  });
  forms = [create, move];
  for (const entry of forms) entry.original = snapshot(entry);
  $('program-org-forms').replaceChildren(...forms.map((entry) => entry.panel));
}
async function load(afterSave = false) {
  if (busy) return false;
  if (!afterSave && forms.some(dirty)
      && !window.confirm('Discard unsaved entries and reload saved organization?')) return false;
  busy = true;
  controls();
  const departments = await request('GET', '/departments');
  const list = departments.status === 200 ? await request('GET', '/organization-programs') : departments;
  busy = false;
  if (departments.status !== 200 || list.status !== 200
      || !Array.isArray(departments.body?.departments) || !Array.isArray(list.body?.programs)) {
    message('Organization lists could not be loaded. Organization permission is required. Your entered work remains.', true);
    controls();
    return false;
  }
  programs = list.body.programs;
  blocked = false;
  buildForms(departments.body.departments);
  controls();
  message('Saved organization loaded.');
  return true;
}
$('reload-program-organization').addEventListener('click', () => load());
window.addEventListener('beforeunload', (event) => {
  if (busy || blocked || forms.some(dirty)) {
    event.preventDefault();
    event.returnValue = '';
  }
});
load();
