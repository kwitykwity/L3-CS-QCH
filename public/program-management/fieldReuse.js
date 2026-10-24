import { SIZES, loadSize, saveSize } from '/referral/textSize.js';

const $ = (id) => document.getElementById(id);
const programId = Number(new URL(location.href).searchParams.get('programId'));
let fields = [];
let busy = false;
let blocked = false;
let completed = false;
let writable = false;
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
$('reuse-order').style.minHeight = '2.75rem';
$('reuse-order').style.minWidth = '2.75rem';
function snapshot() {
  return JSON.stringify([$('reuse-field').value, $('reuse-mandatory').checked, $('reuse-order').value]);
}
function controls() {
  $('reload-reuse').disabled = busy;
  $('reuse-controls').disabled = busy || blocked || completed || !writable || !fields.length;
}
function message(text, error = false) {
  const box = $('reuse-status');
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
  } catch { return { unknown: true }; }
}
function preview() {
  const field = fields.find((row) => row.fieldId === Number($('reuse-field').value));
  $('reuse-preview').textContent = field
    ? `${field.label} - ${field.dataType}${field.options.length ? `. Options: ${field.options.map((option) => `${option.label} (${option.lifecycleStatus})`).join(', ')}` : ''}`
    : '';
}
async function load() {
  if (busy) return;
  if (original && snapshot() !== original
      && !window.confirm('Discard your field selection and settings and reload available fields?')) return;
  busy = true;
  controls();
  const program = await request('GET', `/programs/${programId}`);
  const result = program.status === 200
    ? await request('GET', `/programs/${programId}/available-fields`) : program;
  busy = false;
  if (program.status !== 200 || result.status !== 200 || !Array.isArray(result.body?.fields)) {
    message('Available fields could not be loaded. Check your Program permission or try again. Your entries remain.', true);
    controls();
    return;
  }
  fields = result.body.fields;
  writable = program.body.program.lifecycleStatus !== 'RETIRED';
  blocked = false;
  completed = false;
  $('reuse-form').reset();
  $('reuse-field').length = 1;
  for (const field of fields) {
    $('reuse-field').add(new Option(`${field.label} (${field.dataType})`, String(field.fieldId)));
  }
  preview();
  original = snapshot();
  controls();
  message(!writable ? 'This Program is retired.'
    : fields.length ? 'Available fields loaded. Review the definition before sharing it.'
      : 'No unused active fields are available from your managed Programs.');
}
$('reuse-field').addEventListener('change', preview);
$('reload-reuse').addEventListener('click', load);
$('reuse-form').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
});
$('reuse-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || blocked || completed || !writable) return;
  if (!$('reuse-form').checkValidity() || !$('reuse-order').value) {
    message('Choose a field and a whole display order from 0 to 10000.', true);
    ($('reuse-form').querySelector('input:invalid, select:invalid, textarea:invalid') ?? $('reuse-order')).focus();
    return;
  }
  const field = fields.find((row) => row.fieldId === Number($('reuse-field').value));
  if (!field) return;
  if (!window.confirm('Use this shared field for this Program? Its definition remains shared, and existing values from other Programs will not be copied.')) return;
  busy = true;
  controls();
  const result = await request('POST', `/programs/${programId}/field-applicability/${field.fieldId}`, {
    isRequired: $('reuse-mandatory').checked,
    displayOrder: Number($('reuse-order').value),
  });
  busy = false;
  if (result.status === 201 && result.body?.field?.fieldId === field.fieldId
      && result.body.field.applicability?.programId === programId) {
    completed = true;
    original = snapshot();
    message('Field added to this Program. Return to Program fields to enter its separate value.');
  } else if (result.status === 409 || result.unknown || result.status >= 500
      || (result.status >= 200 && result.status < 300)) {
    blocked = true;
    message('The field changed, is already in use here, or the save outcome is uncertain. Your entries remain. Reload available fields before continuing.', true);
  } else {
    message('The field was not added. Check your permission and settings. Your entries remain.', true);
  }
  controls();
});
window.addEventListener('beforeunload', (event) => {
  if (busy || blocked || (original && snapshot() !== original)) {
    event.preventDefault();
    event.returnValue = '';
  }
});
if (Number.isSafeInteger(programId) && programId > 0) {
  $('reuse-back').href = `fields.html?programId=${programId}`;
  load();
} else {
  $('reload-reuse').disabled = true;
  message('Open field reuse from a Program first.', true);
}
