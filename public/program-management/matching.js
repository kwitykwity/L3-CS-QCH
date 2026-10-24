import { SIZES, loadSize, saveSize } from '/referral/textSize.js';

const $ = (id) => document.getElementById(id);
const programId = Number(new URL(location.href).searchParams.get('programId'));
const states = {
  NOT_ON_FILE: 'Information not on file',
  SET: 'Limit on file',
  NO_RESTRICTION: 'Confirmed no restriction',
  OTHER_LIMIT: 'Other limit not expressed by these fields',
};
let saved = null;
let latest = null;
let busy = false;
let needsReload = false;
let retained = false;
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
for (const id of ['age-limit-state', 'service-area-state']) {
  for (const [value, label] of Object.entries(states)) $(id).add(new Option(label, value));
}
for (const id of ['matching-age-min', 'matching-age-max']) {
  $(id).style.minHeight = '2.75rem';
  $(id).style.minWidth = '2.75rem';
}
function message(text, error = false, focus = true) {
  const box = $('matching-status');
  box.className = `status status--${error ? 'error' : 'info'}`;
  box.querySelector('.status__text').textContent = text;
  if (focus) box.focus();
}
function snapshot() {
  return JSON.stringify([
    [...document.querySelectorAll('[data-category]')].map((input) => [input.value, input.checked]),
    ...['age-limit-state', 'matching-age-min', 'matching-age-max', 'service-area-state', 'matching-zips']
      .map((id) => $(id).value),
  ]);
}
function dirty() { return retained || (original && snapshot() !== original); }
function visibility() {
  const ageSet = $('age-limit-state').value === 'SET';
  $('age-bounds').hidden = !ageSet;
  $('matching-age-min').disabled = !ageSet;
  $('matching-age-max').disabled = !ageSet;
  const areaSet = $('service-area-state').value === 'SET';
  $('matching-zip-group').hidden = !areaSet;
  $('matching-zips').disabled = !areaSet;
}
function controls() {
  $('reload-matching').disabled = busy;
  $('review-matching').disabled = busy;
  $('matching-controls').disabled = busy || !saved || saved.program.lifecycleStatus === 'RETIRED';
  $('save-matching').disabled = busy || needsReload || Boolean(latest)
    || !saved || saved.program.lifecycleStatus === 'RETIRED';
}
async function request(method, body) {
  try {
    const response = await fetch(`/api/program-management/programs/${programId}/matching-facts`, {
      method, credentials: 'same-origin', cache: 'no-store',
      ...(body === undefined ? {} : {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    });
    return { status: response.status, body: await response.json() };
  } catch { return { unknown: true }; }
}
function validFacts(facts) {
  return facts && Array.isArray(facts.needCategoryIds) && Array.isArray(facts.serviceAreaZips)
    && Object.hasOwn(states, facts.ageLimitState) && Object.hasOwn(states, facts.serviceAreaState);
}
function render(data) {
  saved = data;
  latest = null;
  needsReload = false;
  retained = false;
  $('matching-conflict').hidden = true;
  $('matching-program-name').textContent = data.program.name;
  const selected = new Set(data.facts.needCategoryIds);
  const options = $('matching-category-options');
  options.replaceChildren();
  for (const category of data.categories) {
    if (category.lifecycleStatus !== 'ACTIVE' && !selected.has(category.needCategoryId)) continue;
    const group = document.createElement('div');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = `matching-category-${category.needCategoryId}`;
    input.dataset.category = '';
    input.value = String(category.needCategoryId);
    input.checked = selected.has(category.needCategoryId);
    const label = document.createElement('label');
    label.htmlFor = input.id;
    label.textContent = `${category.name}${category.lifecycleStatus === 'ACTIVE' ? '' : ' (discontinued; existing selection)'}`;
    group.append(input, label);
    options.append(group);
  }
  $('age-limit-state').value = data.facts.ageLimitState;
  $('matching-age-min').value = data.facts.ageMin ?? '';
  $('matching-age-max').value = data.facts.ageMax ?? '';
  $('service-area-state').value = data.facts.serviceAreaState;
  $('matching-zips').value = data.facts.serviceAreaZips.join('\n');
  visibility();
  original = snapshot();
  controls();
}
function showCurrent(current) {
  const facts = current.matchingFacts;
  const names = new Map(saved.categories.map((row) => [row.needCategoryId, row.name]));
  const rows = [
    ['Service categories', facts.needCategoryIds.map((id) => names.get(id) ?? 'Category unavailable').join(', ') || 'Not on file'],
    ['Age rule', states[facts.ageLimitState]],
    ['Minimum age', facts.ageMin ?? 'Not set'],
    ['Maximum age', facts.ageMax ?? 'Not set'],
    ['Service-area rule', states[facts.serviceAreaState]],
    ['Service-area ZIP codes', facts.serviceAreaZips.join(', ') || 'None on file'],
  ];
  $('matching-current').replaceChildren();
  for (const [label, value] of rows) {
    const group = document.createElement('div');
    const term = document.createElement('dt');
    const detail = document.createElement('dd');
    term.textContent = label;
    detail.textContent = String(value);
    group.append(term, detail);
    $('matching-current').append(group);
  }
  $('matching-conflict').hidden = false;
}
async function load() {
  if (busy) return;
  if (dirty() && !window.confirm('Discard your entered matching edits and load the latest saved information?')) return;
  busy = true;
  controls();
  const result = await request('GET');
  busy = false;
  if (result.status === 200 && result.body?.program?.programId === programId
      && typeof result.body.program.version === 'string'
      && validFacts(result.body.facts) && Array.isArray(result.body.categories)) {
    render(result.body);
    message(saved.program.lifecycleStatus === 'RETIRED'
      ? 'This Program is retired. Saved matching facts are read-only.'
      : 'Saved matching information loaded.');
  } else {
    needsReload = true;
    message('Matching information could not be loaded. Check your Program permission or try again. Your edits remain.', true);
    controls();
  }
}
$('age-limit-state').addEventListener('change', visibility);
$('service-area-state').addEventListener('change', visibility);
$('reload-matching').addEventListener('click', load);
$('review-matching').addEventListener('click', () => {
  if (busy || !latest) return;
  if (!window.confirm('Confirm you reviewed the latest saved facts and want to retain your entered edits for another explicit save.')) return;
  saved.program = { ...saved.program, ...latest };
  saved.facts = latest.matchingFacts;
  latest = null;
  retained = true;
  $('matching-conflict').hidden = true;
  controls();
  message('Latest facts reviewed. Your edits remain; nothing has been saved.');
});
$('matching-form').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target instanceof HTMLInputElement
      && event.target.type !== 'checkbox') event.preventDefault();
});
$('matching-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || !saved || needsReload || latest || saved.program.lifecycleStatus === 'RETIRED') return;
  const form = $('matching-form');
  if (!form.checkValidity()) {
    message('Check the marked fields and age bounds.', true, false);
    form.querySelector('input:invalid, select:invalid, textarea:invalid')?.focus();
    return;
  }
  const ageSet = $('age-limit-state').value === 'SET';
  const min = $('matching-age-min').value;
  const max = $('matching-age-max').value;
  if (ageSet && ((!min && !max) || (min !== '' && max !== '' && Number(min) > Number(max)))) {
    message('Enter at least one age bound, with minimum no greater than maximum.', true, false);
    $('matching-age-min').focus();
    return;
  }
  const areaSet = $('service-area-state').value === 'SET';
  const zips = areaSet ? $('matching-zips').value.trim().split(/[\s,]+/).filter(Boolean) : [];
  if (areaSet && (!zips.length || zips.some((zip) => !/^\d{5}$/.test(zip))
      || new Set(zips).size !== zips.length)) {
    message('Enter distinct five-digit service-area ZIP codes.', true, false);
    $('matching-zips').focus();
    return;
  }
  const facts = {
    needCategoryIds: [...document.querySelectorAll('[data-category]:checked')].map((input) => Number(input.value)),
    ageLimitState: $('age-limit-state').value,
    ageMin: ageSet && min !== '' ? Number(min) : null,
    ageMax: ageSet && max !== '' ? Number(max) : null,
    serviceAreaState: $('service-area-state').value,
    serviceAreaZips: zips,
  };
  busy = true;
  controls();
  message('Saving matching information...', false, false);
  const result = await request('PUT', { version: saved.program.version, ...facts });
  busy = false;
  if (result.status === 200 && result.body?.program?.programId === programId
      && typeof result.body.program.version === 'string' && validFacts(result.body.facts)) {
    render({ ...result.body, categories: saved.categories });
    message('Matching information saved.');
  } else if (result.body?.code === 'PROGRAM_CHANGED'
      && typeof result.body.current?.version === 'string' && validFacts(result.body.current.matchingFacts)) {
    latest = result.body.current;
    showCurrent(latest);
    message('Nothing was saved. Review the latest facts; your entered edits remain.', true);
  } else if (result.body?.code === 'NO_CHANGE') {
    message('The saved matching information is unchanged.');
  } else if (result.unknown || result.status >= 500 || (result.status >= 200 && result.status < 300)) {
    needsReload = true;
    message('Save outcome is not confirmed. Your edits remain. Reload saved information before another save.', true);
  } else {
    message('Matching information was not saved. Check your access and entered facts. Your edits remain.', true, false);
    const fields = result.body?.fields ?? [];
    const id = fields.includes('needCategoryIds') ? 'matching-categories'
      : fields.some((field) => ['ageLimitState', 'ageRange', 'ageMin', 'ageMax'].includes(field)) ? 'age-limit-state'
        : fields.some((field) => ['serviceAreaState', 'serviceAreaZips'].includes(field)) ? 'service-area-state' : 'matching-status';
    $(id).tabIndex = -1;
    $(id).focus();
  }
  controls();
});
window.addEventListener('beforeunload', (event) => {
  if (dirty() || busy || needsReload || latest) {
    event.preventDefault();
    event.returnValue = '';
  }
});
if (Number.isSafeInteger(programId) && programId > 0) load();
else {
  $('reload-matching').disabled = true;
  message('Open matching information from a Program first.', true);
}
