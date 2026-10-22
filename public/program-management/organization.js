import { SIZES, loadSize, saveSize } from '/referral/textSize.js';

const $ = (id) => document.getElementById(id);
let entries = [];
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
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function message(text, error = false) {
  const box = $('org-status');
  box.className = `status status--${error ? 'error' : 'info'}`;
  box.querySelector('.status__text').textContent = text;
  box.focus();
}
function dirty(entry) {
  return entry.inputs.some((input, index) => input.value !== entry.original[index]);
}
function controls() {
  $('reload-organization').disabled = busy;
  for (const entry of entries) {
    entry.fieldset.disabled = busy || entry.blocked || entry.retired;
  }
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
function validDepartment(row) {
  return Number.isSafeInteger(row?.departmentId) && row.departmentId > 0
    && typeof row.name === 'string' && typeof row.version === 'string'
    && ['ACTIVE', 'DISCONTINUED', 'RETIRED'].includes(row.lifecycleStatus);
}
function buildDepartment(row = null) {
  const panel = element('section', undefined, 'panel');
  panel.append(element('h2', row ? row.name : 'Create a Department'));
  if (row) {
    panel.append(element('p',
      `${row.lifecycleStatus} - ${row.activeProgramCount} active Programs, ${row.programCount} total Programs`));
  }
  const form = element('form');
  form.noValidate = true;
  const fieldset = element('fieldset', undefined, 'plain');
  fieldset.append(element('legend', row ? 'Department details' : 'New Department'));
  const input = element('input');
  input.id = row ? `department-name-${row.departmentId}` : 'new-department-name';
  input.type = 'text';
  input.maxLength = 200;
  input.required = true;
  input.setAttribute('aria-required', 'true');
  input.value = row?.name ?? '';
  const label = element('label', 'Department name *');
  label.htmlFor = input.id;
  const save = element('button', row ? 'Rename Department' : 'Create Department', 'btn btn--primary');
  save.type = 'submit';
  fieldset.append(label, input, save);
  form.append(fieldset);
  panel.append(form);
  const entry = {
    row, panel, fieldset, inputs: [input], original: [input.value],
    blocked: false, retired: row?.lifecycleStatus === 'RETIRED',
  };

  async function change(action = null) {
    if (busy || entry.blocked || entry.retired) return;
    if (action && dirty(entry)) {
      message('Save or reload the Department name edit before changing its status.', true);
      return;
    }
    if (!action && (!input.value.trim() || !form.checkValidity())) {
      message('Enter a Department name of up to 200 characters.', true);
      input.focus();
      return;
    }
    if (action && !window.confirm(action === 'discontinue'
      ? 'Discontinue this Department? All active Programs must first be moved or discontinued.'
      : 'Reactivate this Department?')) return;
    if (!action && row && !window.confirm('Rename this Department while preserving its identity and history?')) return;

    busy = true;
    controls();
    const path = row ? `/departments/${row.departmentId}${action ? `/${action}` : ''}` : '/departments';
    const body = row
      ? { version: row.version, ...(action ? {} : { name: input.value }) }
      : { name: input.value };
    const result = await request(row && !action ? 'PATCH' : 'POST', path, body);
    busy = false;
    const updated = result.body?.department;
    if ([200, 201].includes(result.status) && validDepartment(updated)
        && (!row || updated.departmentId === row.departmentId)) {
      const replacement = buildDepartment(updated);
      if (row) {
        panel.replaceWith(replacement.panel);
        entries[entries.indexOf(entry)] = replacement;
      } else {
        $('department-list').append(replacement.panel);
        entries.push(replacement);
        input.value = '';
      }
      message(row ? 'Department change saved.' : 'Department created.');
    } else if (result.body?.code === 'NO_CHANGE') {
      message('The Department name is unchanged.');
    } else if (result.body?.code === 'DEPARTMENT_HAS_ACTIVE_PROGRAMS') {
      message('Move or discontinue this Department’s active Programs before discontinuing it.', true);
    } else if (result.body?.code === 'DEPARTMENT_NAME_TAKEN') {
      message('That Department name is already in use. Your entry remains.', true);
    } else if (result.status === 409 || result.unknown || result.status >= 500
        || (result.status >= 200 && result.status < 300)) {
      entry.blocked = true;
      message(result.status === 409
        ? 'The Department changed or this action is unavailable. Your entries remain. Reload saved organization before continuing.'
        : 'Save outcome is not confirmed. Your entries remain. Reload saved organization before continuing.', true);
    } else {
      message(result.status === 403
        ? 'Organization permission is required for this action. Your entries remain.'
        : 'The Department was not saved. Check your access and entered name. Your entries remain.', true);
    }
    controls();
  }
  form.addEventListener('submit', (event) => { event.preventDefault(); change(); });
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
  });
  if (row) {
    const lifecycle = element('button',
      row.lifecycleStatus === 'DISCONTINUED' ? 'Reactivate Department' : 'Discontinue Department',
      'btn btn--secondary');
    lifecycle.type = 'button';
    lifecycle.disabled = row.lifecycleStatus === 'ACTIVE' && row.activeProgramCount > 0;
    fieldset.append(lifecycle);
    if (lifecycle.disabled) {
      fieldset.append(element('p', 'Move or discontinue active Programs before discontinuing this Department.', 'muted'));
    }
    lifecycle.addEventListener('click', () =>
      change(row.lifecycleStatus === 'DISCONTINUED' ? 'reactivate' : 'discontinue'));
  }
  return entry;
}
async function load() {
  if (busy) return;
  if (entries.some(dirty) && !window.confirm('Discard your unsaved organization edits and load saved information?')) return;
  busy = true;
  controls();
  const result = await request('GET', '/departments');
  busy = false;
  if (result.status !== 200 || !Array.isArray(result.body?.departments)
      || !result.body.departments.every(validDepartment)) {
    message(result.status === 403
      ? 'Organization management permission is required to view this screen.'
      : 'Departments could not be loaded. Your entered work remains. Try reloading.', true);
    controls();
    return;
  }
  const create = buildDepartment();
  const departments = result.body.departments.map(buildDepartment);
  entries = [create, ...departments];
  $('department-create').replaceChildren(create.panel);
  $('department-list').replaceChildren(...departments.map((entry) => entry.panel));
  controls();
  message('Saved Departments loaded.');
}
$('reload-organization').addEventListener('click', load);
window.addEventListener('beforeunload', (event) => {
  if (busy || entries.some((entry) => dirty(entry) || entry.blocked)) {
    event.preventDefault();
    event.returnValue = '';
  }
});
load();
