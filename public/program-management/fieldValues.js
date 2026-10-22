import { SIZES, loadSize, saveSize } from '/referral/textSize.js';

const $ = (id) => document.getElementById(id);
const idText = new URL(location.href).searchParams.get('programId');
const programId = /^[1-9]\d*$/.test(idText ?? '') ? Number(idText) : null;
let entries = [];
let busy = false;
let createDirty = false;
let createBlocked = false;
let canCreate = false;

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
  const box = $('field-status');
  box.className = `status status--${error ? 'error' : 'info'}`;
  box.querySelector('.status__text').textContent = text;
  box.focus();
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
  } catch {
    return { unknown: true };
  }
}
function snapshot(entry) {
  return JSON.stringify([...entry.inputs, ...(entry.settingInputs ?? []), ...(entry.definitionInputs ?? []), ...(entry.optionInputs ?? [])].map((input) =>
    input.type === 'checkbox' ? input.checked : input.value));
}
function dirty() {
  return createDirty || entries.some((entry) => snapshot(entry) !== entry.original);
}
function controls() {
  $('reload-fields').disabled = busy;
  $('create-field-controls').disabled = busy || createBlocked || !canCreate;
  for (const entry of entries) {
    entry.fieldset.disabled = busy || !entry.editable;
    entry.save.disabled = busy || entry.blocked || !entry.editable;
    if (entry.retireButton) {
      entry.retireButton.disabled = busy || entry.blocked
        || entry.field.permissions?.canRetire !== true
        || entry.field.lifecycleStatus !== 'DISCONTINUED';
    }
    if (entry.optionsFieldset) {
      entry.optionsFieldset.disabled = busy || entry.blocked
        || entry.field.permissions?.canManageDefinition !== true
        || entry.field.lifecycleStatus === 'RETIRED';
    }
    entry.settingsFieldset.disabled = busy || entry.blocked || !entry.programEditable;
    entry.definitionFieldset.disabled = busy || entry.blocked
      || entry.field.permissions?.canManageDefinition !== true
      || entry.field.lifecycleStatus === 'RETIRED';
  }
}
function valueControl(field, entry) {
  const id = `value-${field.fieldId}`;
  const label = element('label', `${field.label}${field.applicability.isRequired ? ' *' : ''}`);
  label.htmlFor = id;
  entry.fieldset.append(label);

  let input;
  if (field.dataType === 'TEXT') {
    input = element('textarea');
    input.rows = 3;
    input.maxLength = 2000;
    input.value = field.value ?? '';
  } else if (['BOOLEAN', 'SINGLE_SELECT'].includes(field.dataType)) {
    input = element('select');
    input.add(new Option('Not set', ''));
    if (field.dataType === 'BOOLEAN') {
      input.add(new Option('Yes', 'true'));
      input.add(new Option('No', 'false'));
    } else {
      for (const option of field.options) {
        if (option.lifecycleStatus !== 'ACTIVE' && option.optionId !== field.value) continue;
        const item = new Option(
          `${option.label}${option.lifecycleStatus === 'ACTIVE' ? '' : ' (discontinued)'}`,
          String(option.optionId),
        );
        item.disabled = option.lifecycleStatus !== 'ACTIVE';
        input.add(item);
      }
    }
    input.value = field.value == null ? '' : String(field.value);
  } else if (field.dataType === 'MULTI_SELECT') {
    const selected = new Set(field.value ?? []);
    const group = element('div');
    group.id = id;
    // A fieldset and legend label the complete checkbox group.
    label.remove();
    entry.fieldset.prepend(element('legend', label.textContent));
    for (const option of field.options) {
      if (option.lifecycleStatus !== 'ACTIVE' && !selected.has(option.optionId)) continue;
      const checkbox = element('input');
      checkbox.type = 'checkbox';
      checkbox.id = `${id}-${option.optionId}`;
      checkbox.value = String(option.optionId);
      checkbox.checked = selected.has(option.optionId);
      const optionLabel = element('label',
        `${option.label}${option.lifecycleStatus === 'ACTIVE' ? '' : ' (discontinued; may be kept or removed)'}`);
      optionLabel.htmlFor = checkbox.id;
      group.append(checkbox, optionLabel);
      entry.inputs.push(checkbox);
    }
    entry.fieldset.append(group);
    return;
  } else {
    input = element('input');
    input.type = field.dataType === 'NUMBER' ? 'number' : 'date';
    if (field.dataType === 'NUMBER') input.step = '0.0001';
    else { input.min = '1900-01-01'; input.max = '2999-12-31'; }
    input.value = field.value == null ? '' : String(field.value);
  }
  input.id = id;
  input.style.minHeight = '2.75rem';
  input.style.minWidth = '2.75rem';
  if (field.applicability.isRequired) {
    input.required = true;
    input.setAttribute('aria-required', 'true');
  }
  entry.inputs.push(input);
  entry.fieldset.append(input);
}
function readValue(entry) {
  const { field, inputs } = entry;
  if (field.dataType === 'MULTI_SELECT') {
    return inputs.filter((input) => input.checked).map((input) => Number(input.value));
  }
  const raw = inputs[0].value;
  if (raw === '') return null;
  if (field.dataType === 'BOOLEAN') return raw === 'true';
  if (['NUMBER', 'SINGLE_SELECT'].includes(field.dataType)) return Number(raw);
  return raw;
}
async function save(entry) {
  if (busy || entry.blocked || !entry.editable) return;
  if (settingsChanged(entry) || definitionChanged(entry)) {
    message('Save or reload your required/order changes before saving the field value.', true);
    return;
  }
  busy = true;
  controls();
  const result = await request('PUT',
    `/programs/${programId}/field-values/${entry.field.fieldId}`,
    { version: entry.field.applicability.version, value: readValue(entry) });
  busy = false;
  const current = result.body;
  if (result.status === 200 && current?.fieldId === entry.field.fieldId
      && typeof current.applicability?.version === 'string') {
    entry.field.applicability = current.applicability;
    entry.field.value = current.value;
    // Reflect server normalization, while preserving other fields' edits.
    const replacement = buildEntry(entry.field, entry.editable);
    entry.panel.replaceWith(replacement.panel);
    entries[entries.indexOf(entry)] = replacement;
    message('Field value saved.');
  } else if (result.body?.code === 'NO_CHANGE') {
    message('The saved value is unchanged.');
  } else if (result.status === 409 || result.unknown || result.status >= 500
      || (result.status >= 200 && result.status < 300)) {
    entry.blocked = true;
    message(result.status === 409
      ? 'This field changed. Your edits remain. Reload saved fields and review them before saving again.'
      : 'Save outcome is not confirmed. Your edits remain. Reload saved fields before saving again.', true);
  } else {
    message(result.status === 403
      ? 'You are not authorized for this change. Your edits remain.'
      : result.status === 401
        ? 'Sign in again before saving. Your edits remain.'
        : 'Nothing was saved. Check the value, required setting, and allowed options. Your edits remain.', true);
  }
  controls();
}
function buildEntry(field, writable) {
  const entry = {
    field, inputs: [], blocked: false,
    editable: writable && field.permissions?.canManageValue === true,
    panel: element('section', undefined, 'panel'),
    fieldset: element('fieldset', undefined, 'plain'),
    save: element('button', 'Save field value', 'btn btn--primary'),
  };
  entry.panel.append(element('h2', field.label));
  entry.panel.append(element('p', `${field.dataType} - ${field.lifecycleStatus}`, 'muted'));
  const form = element('form');
  form.noValidate = true;
  valueControl(field, entry);
  entry.save.type = 'submit';
  form.append(entry.fieldset, entry.save);
  form.addEventListener('submit', (event) => { event.preventDefault(); save(entry); });
  entry.panel.append(form);
  entry.originalValues = JSON.stringify(entry.inputs.map((input) =>
    input.type === 'checkbox' ? input.checked : input.value));
  buildSettings(entry, writable);
  buildDefinition(entry);
  buildOptions(entry);
  buildRetirement(entry);
  if (field.permissions?.canManageDefinition === true && field.lifecycleStatus === 'ACTIVE') {
    const replacementLink = element('a', 'Replace field meaning', 'btn btn--secondary');
    replacementLink.href = `replace-field.html?programId=${programId}&fieldId=${field.fieldId}`;
    entry.panel.append(replacementLink);
  }
  entry.original = snapshot(entry);
  return entry;
}
async function load() {
  if (busy) return;
  if (dirty() && !window.confirm('Discard your unsaved field edits and load the latest saved fields?')) return;
  busy = true;
  controls();
  const program = await request('GET', `/programs/${programId}`);
  const result = program.status === 200
    ? await request('GET', `/programs/${programId}/fields`) : program;
  busy = false;
  if (program.status !== 200 || result.status !== 200 || !Array.isArray(result.body?.fields)) {
    message('Fields could not be loaded. Check your access or try again. Your entered edits remain.', true);
    controls();
    return;
  }
  $('program-name').textContent = program.body.program.name;
  canCreate = program.body.program.lifecycleStatus !== 'RETIRED';
  let reuseLink = $('reuse-existing-link');
  if (!reuseLink) {
    reuseLink = element('a', 'Reuse an existing field', 'btn btn--secondary');
    reuseLink.id = 'reuse-existing-link';
    $('create-field-panel').prepend(reuseLink);
  }
  reuseLink.href = `reuse-field.html?programId=${programId}`;
  $('create-field-panel').hidden = !canCreate;
  $('create-field-form').reset();
  $('new-options-group').hidden = true;
  $('new-field-options').required = false;
  $('new-field-options').removeAttribute('aria-required');
  createDirty = false;
  createBlocked = false;
  const writable = program.body.program.lifecycleStatus !== 'RETIRED';
  entries = result.body.fields.map((field) => buildEntry(field, writable));
  $('field-list').replaceChildren(...entries.map((entry) => entry.panel));
  controls();
  message(entries.length ? 'Saved fields loaded.' : 'This Program has no configurable fields yet.');
}
$('reload-fields').addEventListener('click', load);
window.addEventListener('beforeunload', (event) => {
  if (dirty() || busy || entries.some((entry) => entry.blocked)) {
    event.preventDefault();
    event.returnValue = '';
  }
});
if (Number.isSafeInteger(programId) && programId > 0) load();
else {
  $('reload-fields').disabled = true;
  message('Open a Program from Program Management first.', true);
}

function optionVisibility() {
  const selectType = $('new-field-type').value.includes('SELECT');
  $('new-options-group').hidden = !selectType;
  $('new-field-options').required = selectType;
  if (selectType) $('new-field-options').setAttribute('aria-required', 'true');
  else $('new-field-options').removeAttribute('aria-required');
}
$('new-field-type').addEventListener('change', optionVisibility);
$('create-field-form').addEventListener('input', () => { createDirty = true; });
$('create-field-form').addEventListener('change', () => { createDirty = true; });
$('create-field-form').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
});
$('create-field-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || createBlocked || !canCreate) return;
  const form = $('create-field-form');
  if (!form.checkValidity()) {
    message('Check the new field label, options, and display order.', true);
    form.querySelector(':invalid')?.focus();
    return;
  }
  const dataType = $('new-field-type').value;
  const body = {
    label: $('new-field-label').value,
    dataType,
    isRequired: $('new-field-required').checked,
    displayOrder: Number($('new-field-order').value),
  };
  if (dataType.includes('SELECT')) {
    body.options = $('new-field-options').value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }
  busy = true;
  controls();
  const result = await request('POST', `/programs/${programId}/fields`, body);
  busy = false;
  const field = result.body?.field;
  if (result.status === 201 && Number.isSafeInteger(field?.fieldId)
      && typeof field.applicability?.version === 'string') {
    const entry = buildEntry({
      ...field,
      value: dataType === 'MULTI_SELECT' ? [] : null,
      permissions: { canManageValue: true },
    }, canCreate);
    entries.push(entry);
    $('field-list').append(entry.panel);
    form.reset();
    optionVisibility();
    createDirty = false;
    message('Field created. You can now enter its value.');
  } else if (result.unknown || result.status >= 500
      || (result.status >= 200 && result.status < 300)) {
    createBlocked = true;
    message('Creation outcome is not confirmed. Your entries remain. Reload saved fields before creating another field.', true);
  } else {
    message(result.status === 403
      ? 'You are not authorized to create this field. Your entries remain.'
      : 'Field was not created. Check the label, options, and display order. Your entries remain.', true);
  }
  controls();
});
function settingsChanged(entry) {
  return JSON.stringify(entry.settingInputs.map((input) =>
    input.type === 'checkbox' ? input.checked : input.value)) !== entry.originalSettings;
}
function buildSettings(entry, writable) {
  entry.programEditable = writable;
  const form = element('form');
  form.noValidate = true;
  const fieldset = element('fieldset', undefined, 'plain');
  fieldset.append(element('legend', 'Settings for this Program'));

  const required = element('input');
  required.type = 'checkbox';
  required.id = `required-${entry.field.fieldId}`;
  required.checked = entry.field.applicability.isRequired;
  const requiredLabel = element('label', 'Require a value for this Program');
  requiredLabel.htmlFor = required.id;

  const order = element('input');
  order.type = 'number';
  order.id = `order-${entry.field.fieldId}`;
  order.min = '0';
  order.max = '10000';
  order.step = '1';
  order.value = String(entry.field.applicability.displayOrder);
  order.style.minHeight = '2.75rem';
  order.style.minWidth = '2.75rem';
  const orderLabel = element('label', 'Display order');
  orderLabel.htmlFor = order.id;

  const button = element('button', 'Save field settings', 'btn btn--secondary');
  button.type = 'submit';
  fieldset.append(required, requiredLabel, orderLabel, order, button);
  form.append(fieldset);
  entry.panel.append(form);
  entry.settingsFieldset = fieldset;
  entry.settingInputs = [required, order];
  entry.originalSettings = JSON.stringify([required.checked, order.value]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || entry.blocked || !entry.programEditable) return;
    const values = JSON.stringify(entry.inputs.map((input) =>
      input.type === 'checkbox' ? input.checked : input.value));
    if (values !== entry.originalValues || definitionChanged(entry)) {
      message('Save or reload your value edits before changing field settings.', true);
      return;
    }
    if (!order.value || !order.checkValidity()) {
      message('Display order must be a whole number from 0 to 10000.', true);
      order.focus();
      return;
    }
    busy = true;
    controls();
    const result = await request('PATCH',
      `/programs/${programId}/field-applicability/${entry.field.fieldId}`,
      {
        version: entry.field.applicability.version,
        isRequired: required.checked,
        displayOrder: Number(order.value),
      });
    busy = false;
    if (result.status === 200 && typeof result.body?.applicability?.version === 'string') {
      entry.field.applicability = result.body.applicability;
      const replacement = buildEntry(entry.field, entry.programEditable);
      entry.panel.replaceWith(replacement.panel);
      entries[entries.indexOf(entry)] = replacement;
      message('Field settings saved.');
    } else if (result.body?.code === 'NO_CHANGE') {
      message('The saved settings are unchanged.');
    } else if (result.status === 409 || result.unknown || result.status >= 500
        || (result.status >= 200 && result.status < 300)) {
      entry.blocked = true;
      message(result.status === 409
        ? 'This field changed. Your settings remain. Reload saved fields before saving again.'
        : 'Save outcome is not confirmed. Your settings remain. Reload saved fields before saving again.', true);
    } else {
      message('Settings were not saved. Check your access and entered settings. Your edits remain.', true);
    }
    controls();
  });
}
function definitionChanged(entry) {
  return entry.definitionInputs.some((input) => input.value !== entry.field.label) || optionsChanged(entry);
}
function otherEdits(entry) {
  const values = JSON.stringify(entry.inputs.map((input) =>
    input.type === 'checkbox' ? input.checked : input.value));
  return values !== entry.originalValues || settingsChanged(entry) || optionsChanged(entry);
}
function buildDefinition(entry) {
  const field = entry.field;
  const form = element('form');
  form.noValidate = true;
  const fieldset = element('fieldset', undefined, 'plain');
  fieldset.append(element('legend', 'Shared field definition'));
  fieldset.append(element('p',
    'Rename only when the meaning stays the same. Definition changes affect every Program using this field.'));
  const label = element('label', 'Field wording');
  const input = element('input');
  input.type = 'text';
  input.id = `wording-${field.fieldId}`;
  input.maxLength = 200;
  input.value = field.label;
  label.htmlFor = input.id;
  const rename = element('button', 'Rename field', 'btn btn--secondary');
  rename.type = 'submit';
  fieldset.append(label, input, rename);

  const lifecycle = element('button',
    field.lifecycleStatus === 'DISCONTINUED' ? 'Reactivate field' : 'Discontinue field',
    'btn btn--secondary');
  lifecycle.type = 'button';
  lifecycle.disabled = field.lifecycleStatus === 'DISCONTINUED' && field.replacedByFieldId != null;
  fieldset.append(lifecycle);
  form.append(fieldset);
  entry.panel.append(form);
  entry.definitionFieldset = fieldset;
  entry.definitionInputs = [input];

  if (field.permissions?.canManageDefinition !== true) {
    entry.panel.append(element('p',
      'Changing this shared definition requires management permission for every Program using it.', 'muted'));
  }

  async function change(action) {
    if (busy || entry.blocked || field.permissions?.canManageDefinition !== true
        || field.lifecycleStatus === 'RETIRED') return;
    if (otherEdits(entry) || (action && definitionChanged(entry))) {
      message('Save or reload your other field edits before changing the shared definition.', true);
      return;
    }
    if (!action && !input.value.trim()) {
      message('Enter the field wording before saving.', true);
      input.focus();
      return;
    }
    const question = action === 'discontinue'
      ? 'Discontinue this field for every Program using it? Existing values remain as history.'
      : action === 'reactivate'
        ? 'Reactivate this field for every Program using it?'
        : 'Confirm this changes wording only, with the same meaning, for every Program using this field.';
    if (!window.confirm(question)) return;

    busy = true;
    controls();
    const result = await request(action ? 'POST' : 'PATCH',
      `/fields/${field.fieldId}${action ? `/${action}` : ''}`,
      { version: field.version, ...(action ? {} : { label: input.value }) });
    busy = false;
    const updated = result.body?.field;
    if (result.status === 200 && updated?.fieldId === field.fieldId
        && typeof updated.version === 'string') {
      const replacement = buildEntry({
        ...entry.field,
        ...updated,
        permissions: {
          ...entry.field.permissions,
          canManageValue: entry.programEditable && updated.lifecycleStatus === 'ACTIVE',
        },
      }, entry.programEditable);
      entry.panel.replaceWith(replacement.panel);
      entries[entries.indexOf(entry)] = replacement;
      message('Shared field definition saved.');
    } else if (result.body?.code === 'NO_CHANGE') {
      message('The field wording is unchanged.');
    } else if (result.status === 409 || result.unknown || result.status >= 500
        || (result.status >= 200 && result.status < 300)) {
      entry.blocked = true;
      message(result.status === 409
        ? 'The field changed or cannot make this transition. Your edits remain. Reload saved fields before continuing.'
        : 'Save outcome is not confirmed. Your edits remain. Reload saved fields before continuing.', true);
    } else {
      message('The shared definition was not saved. Check your access and entered wording. Your edits remain.', true);
    }
    controls();
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    change(null);
  });
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
  });
  lifecycle.addEventListener('click', () =>
    change(field.lifecycleStatus === 'DISCONTINUED' ? 'reactivate' : 'discontinue'));
}
function optionsChanged(entry) {
  return (entry.optionInputs ?? []).some((input) => input.value !== input.dataset.saved);
}
function buildOptions(entry) {
  entry.optionInputs = [];
  if (!['SINGLE_SELECT', 'MULTI_SELECT'].includes(entry.field.dataType)) return;

  const fieldset = element('fieldset', undefined, 'plain');
  fieldset.append(element('legend', 'Shared options'));
  fieldset.append(element('p',
    'Option wording changes affect every Program using this field. Discontinued choices remain in saved history.'));
  entry.optionsFieldset = fieldset;
  entry.panel.append(fieldset);

  function textInput(id, value) {
    const input = element('input');
    input.type = 'text';
    input.id = id;
    input.maxLength = 200;
    input.value = value;
    input.dataset.saved = value;
    entry.optionInputs.push(input);
    return input;
  }
  function button(text, type = 'button') {
    const node = element('button', text, 'btn btn--secondary');
    node.type = type;
    return node;
  }
  async function change(action, option, input) {
    if (busy || entry.blocked || entry.field.permissions?.canManageDefinition !== true
        || entry.field.lifecycleStatus === 'RETIRED') return;
    const values = JSON.stringify(entry.inputs.map((item) =>
      item.type === 'checkbox' ? item.checked : item.value));
    const otherOptionEdits = entry.optionInputs.some((item) =>
      item !== input && item.value !== item.dataset.saved);
    const wordingEdits = entry.definitionInputs.some((item) => item.value !== entry.field.label);
    if (values !== entry.originalValues || settingsChanged(entry) || wordingEdits
        || otherOptionEdits || (action && input.value !== input.dataset.saved)) {
      message('Save or reload your other edits before changing this option.', true);
      return;
    }
    if (!action && !input.value.trim()) {
      message('Enter an option label.', true);
      input.focus();
      return;
    }
    const question = action
      ? `${action === 'discontinue' ? 'Discontinue' : 'Reactivate'} this option for every Program using the field? Existing saved selections remain.`
      : option
        ? 'Confirm this option wording changes without changing its meaning, for every Program using the field.'
        : 'Add this option for every Program using the field?';
    if (!window.confirm(question)) return;

    const base = `/fields/${entry.field.fieldId}/options`;
    const path = option ? `${base}/${option.optionId}${action ? `/${action}` : ''}` : base;
    const body = option
      ? { version: option.version, ...(action ? {} : { label: input.value }) }
      : { label: input.value };
    busy = true;
    controls();
    const result = await request(option && !action ? 'PATCH' : 'POST', path, body);
    busy = false;
    const updated = result.body?.field;
    if ([200, 201].includes(result.status) && updated?.fieldId === entry.field.fieldId
        && Array.isArray(updated.options) && typeof updated.version === 'string') {
      const replacement = buildEntry({ ...entry.field, ...updated }, entry.programEditable);
      entry.panel.replaceWith(replacement.panel);
      entries[entries.indexOf(entry)] = replacement;
      message('Field options saved.');
    } else if (result.body?.code === 'NO_CHANGE') {
      message('The option wording is unchanged.');
    } else if (result.status === 409 || result.unknown || result.status >= 500
        || (result.status >= 200 && result.status < 300)) {
      entry.blocked = true;
      message(result.status === 409
        ? 'The option changed or this action is unavailable. Your entries remain. Reload saved fields before continuing.'
        : 'Save outcome is not confirmed. Your entries remain. Reload saved fields before continuing.', true);
    } else {
      message('The option was not saved. Check your access and option label. Your entries remain.', true);
    }
    controls();
  }

  for (const option of entry.field.options) {
    const form = element('form');
    form.noValidate = true;
    const input = textInput(`option-wording-${entry.field.fieldId}-${option.optionId}`, option.label);
    const label = element('label', `Option wording (${option.lifecycleStatus})`);
    label.htmlFor = input.id;
    const rename = button('Rename option', 'submit');
    const lifecycle = button(option.lifecycleStatus === 'ACTIVE' ? 'Discontinue option' : 'Reactivate option');
    input.disabled = option.lifecycleStatus === 'RETIRED';
    rename.disabled = option.lifecycleStatus === 'RETIRED';
    lifecycle.disabled = option.lifecycleStatus === 'RETIRED'
      || (option.lifecycleStatus !== 'ACTIVE' && entry.field.lifecycleStatus !== 'ACTIVE');
    form.append(label, input, rename, lifecycle);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      change(null, option, input);
    });
    form.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
    });
    lifecycle.addEventListener('click', () =>
      change(option.lifecycleStatus === 'ACTIVE' ? 'discontinue' : 'reactivate', option, input));
    fieldset.append(form);
  }

  const form = element('form');
  form.noValidate = true;
  const input = textInput(`new-option-${entry.field.fieldId}`, '');
  const label = element('label', 'New option label');
  label.htmlFor = input.id;
  const add = button('Add option', 'submit');
  input.disabled = entry.field.lifecycleStatus !== 'ACTIVE';
  add.disabled = entry.field.lifecycleStatus !== 'ACTIVE';
  form.append(label, input, add);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    change(null, null, input);
  });
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
  });
  fieldset.append(form);
}
function buildRetirement(entry) {
  const field = entry.field;
  if (field.lifecycleStatus === 'RETIRED') {
    entry.panel.append(element('p',
      'This field is retired from operational use. Its saved values remain available as history.', 'muted'));
    return;
  }
  if (field.permissions?.canRetire !== true || field.lifecycleStatus !== 'DISCONTINUED') return;

  const group = element('fieldset', undefined, 'plain');
  group.append(element('legend', 'Organization retirement'));
  group.append(element('p',
    'Retirement ends operational use for every Program sharing this field. It preserves historical values and cannot be reversed here.'));
  group.append(element('p',
    'The server requires a 90-day review period after discontinuation before retirement.'));
  if (field.discontinuedAt) {
    group.append(element('p', `Discontinued: ${field.discontinuedAt}`, 'muted'));
  }
  const button = element('button', 'Retire field', 'btn btn--secondary');
  button.type = 'button';
  entry.retireButton = button;
  group.append(button);
  entry.panel.append(group);

  button.addEventListener('click', async () => {
    if (busy || entry.blocked || field.permissions?.canRetire !== true
        || field.lifecycleStatus !== 'DISCONTINUED') return;
    if (snapshot(entry) !== entry.original) {
      message('Save or reload your field edits before retiring this shared field.', true);
      return;
    }
    if (!window.confirm('Retire this shared field from operational use for every Program? Historical values will remain. This action cannot be reversed here.')) return;
    busy = true;
    controls();
    const result = await request('POST', `/fields/${field.fieldId}/retire`, { version: field.version });
    busy = false;
    const updated = result.body?.field;
    if (result.status === 200 && updated?.fieldId === field.fieldId
        && updated.lifecycleStatus === 'RETIRED' && typeof updated.version === 'string') {
      const replacement = buildEntry({
        ...entry.field,
        ...updated,
        permissions: { ...entry.field.permissions, canManageValue: false },
      }, entry.programEditable);
      entry.panel.replaceWith(replacement.panel);
      entries[entries.indexOf(entry)] = replacement;
      message('Field retired. Historical values are preserved.');
    } else if (result.body?.code === 'RETIRE_NOT_YET') {
      message('Nothing was changed. The field must complete its 90-day review period after discontinuation before retirement.', true);
    } else if (result.body?.code === 'FIELD_CHANGED'
        || result.body?.code === 'NOT_DISCONTINUED'
        || result.body?.code === 'FIELD_RETIRED') {
      entry.blocked = true;
      message('The saved field has changed. Reload saved fields and review its current status before continuing.', true);
    } else if (result.unknown || result.status >= 500
        || (result.status >= 200 && result.status < 300)) {
      entry.blocked = true;
      message('Retirement outcome is not confirmed. Reload saved fields before attempting another change.', true);
    } else {
      message(result.status === 403
        ? 'Organization management permission is required to retire this field. Nothing was changed.'
        : 'The field could not be retired. Reload saved fields and check your access before continuing.', true);
    }
    controls();
  });
}