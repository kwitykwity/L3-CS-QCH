import { SIZES, loadSize, saveSize } from '/referral/textSize.js';

const $ = (id) => document.getElementById(id);
const params = new URL(location.href).searchParams;
const programId = Number(params.get('programId'));
const fieldId = Number(params.get('fieldId'));
const inputs = ['replacement-label', 'replacement-type', 'replacement-options'];
let field = null;
let busy = false;
let blocked = false;
let completed = false;
let original = '';
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
function snapshot() { return JSON.stringify(inputs.map((id) => $(id).value)); }
function message(text, error = false) {
  const box = $('replacement-status');
  box.className = `status status--${error ? 'error' : 'info'}`;
  box.querySelector('.status__text').textContent = text;
  box.focus();
}
function controls() {
  $('reload-replacement').disabled = busy;
  $('replacement-controls').disabled = busy || blocked || completed
    || field?.permissions?.canManageDefinition !== true || field.lifecycleStatus !== 'ACTIVE';
}
function options() {
  const needed = $('replacement-type').value.includes('SELECT');
  $('replacement-options-group').hidden = !needed;
  $('replacement-options').required = needed;
  if (needed) $('replacement-options').setAttribute('aria-required', 'true');
  else $('replacement-options').removeAttribute('aria-required');
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
async function load() {
  if (busy) return;
  if (original && snapshot() !== original
      && !window.confirm('Discard your replacement entries and load the latest saved definition?')) return;
  busy = true;
  controls();
  const result = await request('GET', `/programs/${programId}/fields`);
  busy = false;
  const current = result.body?.fields?.find((item) => item.fieldId === fieldId);
  if (result.status !== 200 || !current) {
    message('The field could not be loaded. Check your access or try again. Your entries remain.', true);
    controls();
    return;
  }
  field = current;
  blocked = false;
  completed = false;
  $('old-field-name').textContent = `Current field: ${field.label} (${field.lifecycleStatus})`;
  $('replacement-form').reset();
  options();
  original = snapshot();
  controls();
  message(field.permissions?.canManageDefinition !== true
    ? 'Replacement requires management permission for every Program using this field.'
    : field.lifecycleStatus !== 'ACTIVE'
      ? 'Only an active field can be replaced.'
      : 'Saved definition loaded. Enter the replacement meaning.');
}
$('replacement-type').addEventListener('change', options);
$('reload-replacement').addEventListener('click', load);
$('replacement-form').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
});
$('replacement-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || blocked || completed || !field
      || field.permissions?.canManageDefinition !== true || field.lifecycleStatus !== 'ACTIVE') return;
  if (!$('replacement-form').checkValidity()) {
    message('Check the replacement label, type, and options.', true);
    $('replacement-form').querySelector('input:invalid, select:invalid, textarea:invalid')?.focus();
    return;
  }
  if (!window.confirm('Replace this field for every Program using it? The old field will be discontinued. Its saved values remain as history and will not be copied to the replacement.')) return;
  const body = {
    version: field.version,
    label: $('replacement-label').value,
    dataType: $('replacement-type').value,
  };
  if (body.dataType.includes('SELECT')) {
    body.options = $('replacement-options').value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }
  busy = true;
  controls();
  const result = await request('POST', `/fields/${fieldId}/replace`, body);
  busy = false;
  if (result.status === 201 && result.body?.field?.fieldId === fieldId
      && Number.isSafeInteger(result.body?.replacement?.fieldId)
      && result.body.replacement.fieldId !== fieldId) {
    completed = true;
    original = snapshot();
    message('Field replaced. Return to Program fields to review the new field and the preserved history.');
  } else if (result.status === 409 || result.unknown || result.status >= 500
      || (result.status >= 200 && result.status < 300)) {
    blocked = true;
    message(result.status === 409
      ? 'The field changed or cannot be replaced. Your entries remain. Reload the saved definition before continuing.'
      : 'Replacement outcome is not confirmed. Your entries remain. Reload the saved definition before continuing.', true);
  } else {
    message('The replacement was not saved. Check your access and entered definition. Your entries remain.', true);
  }
  controls();
});
window.addEventListener('beforeunload', (event) => {
  if (busy || blocked || (original && snapshot() !== original)) {
    event.preventDefault();
    event.returnValue = '';
  }
});
if ([programId, fieldId].every((id) => Number.isSafeInteger(id) && id > 0)) {
  $('back-to-fields').href = `fields.html?programId=${programId}`;
  load();
} else {
  $('reload-replacement').disabled = true;
  message('Open replacement from a Program field first.', true);
}
