// QCH Reporting Center - Frontend Application
//
// Shows server-calculated aggregate metrics from /api/reports. It does no
// report math (PRD 12.5). All text goes in with textContent. Nothing is
// logged, and nothing sensitive is stored in the browser (PRD 5.5). Only
// the non-sensitive text-size preference is saved.

import { api } from './api.js';
import { countView, formatCount, formatRate, formatTiming, formatAsOf } from './format.js';
import { SIZES, DEFAULT_SIZE, normalizeSize, loadSize, saveSize } from '/referral/textSize.js';

const $ = (id) => document.getElementById(id);
const els = {
  error: $('error'),
  filters: $('filters'),
  period: $('period'),
  date: $('date'),
  scopeType: $('scope-type'),
  scopeTargetGroup: $('scope-target-group'),
  scopeTarget: $('scope-target'),
  scopeTargetLabel: $('scope-target-label'),
  apply: $('apply'),
  status: $('status'),
  results: $('results'),
  ctxPeriod: $('ctx-period'),
  ctxRange: $('ctx-range'),
  ctxScope: $('ctx-scope'),
  ctxAsOf: $('ctx-asof'),
  scopeNote: $('scope-note'),
  partialNote: $('partial-note'),
  mismatchNote: $('mismatch-note'),
  counts: $('counts'),
  rates: $('rates'),
  timing: $('timing'),
  programsBody: $('programs-body'),
  departmentsBody: $('departments-body'),
};

const known = { programs: new Map(), departments: new Map() };
let runToken = 0;

/* ---------- text size (PRD 14.5) ---------- */

let storage = null;
try {
  storage = window.localStorage;
} catch {
  storage = null;
}

function applySize(size) {
  document.documentElement.style.fontSize = `${SIZES[size]}px`;
  for (const button of document.querySelectorAll('[data-size]')) {
    button.setAttribute('aria-pressed', String(button.dataset.size === size));
  }
}

applySize(loadSize(storage));
for (const button of document.querySelectorAll('[data-size]')) {
  button.addEventListener('click', () => {
    const size = normalizeSize(button.dataset.size ?? DEFAULT_SIZE);
    applySize(size);
    saveSize(storage, size);
  });
}

/* ---------- small DOM helpers (textContent only) ---------- */

function node(tag, text, className) {
  const n = document.createElement(tag);
  if (text !== undefined && text !== null) n.textContent = text;
  if (className) n.className = className;
  return n;
}

function metricCard(title, view) {
  const card = node('div', null, 'card metric');
  card.append(node('h3', title), node('p', view.label, 'metric__value'));
  if (view.badge) {
    const line = node('p', null, 'metric__meta');
    line.append(node('span', view.badge, `badge badge--${view.kind}`));
    if (view.detail) line.append(node('span', view.detail));
    card.append(line);
  } else if (view.detail) {
    card.append(node('p', view.detail, 'metric__meta'));
  }
  return card;
}

function rateCell(rate) {
  const view = formatRate(rate);
  const td = document.createElement('td');
  td.append(node('span', view.label, 'rate__value'), node('span', view.badge, `badge badge--${view.kind}`));
  if (view.detail) td.append(node('span', view.detail, 'rate__detail'));
  return td;
}

const COUNT_KEYS = ['made', 'received', 'accepted', 'notAppropriate', 'awaitingResponse', 'resultedInService'];

function tableRow(kind, item) {
  const id = kind === 'Program' ? item?.programId : item?.departmentId;
  const name = typeof item?.name === 'string' && item.name !== '' ? item.name : `Unknown ${kind} (ID ${formatCount(id)})`;
  const tr = document.createElement('tr');
  const th = node('th', name);
  th.scope = 'row';
  tr.append(th);
  for (const key of COUNT_KEYS) tr.append(node('td', formatCount(item?.[key]), 'num'));
  tr.append(rateCell(item?.acceptanceRate), rateCell(item?.resultedInServiceRate));
  return tr;
}

function fillTable(body, list, kind) {
  body.replaceChildren();
  let message = null;
  if (!Array.isArray(list)) message = 'Unknown: the server did not send this breakdown.';
  else if (list.length === 0) message = 'No referrals in this period and scope.';
  if (message) {
    const tr = document.createElement('tr');
    const td = node('td', message);
    td.colSpan = 9;
    tr.append(td);
    body.append(tr);
    return;
  }
  for (const item of list) body.append(tableRow(kind, item));
}

/* ---------- Program / Department picker ---------- */

function remember(map, list, idKey) {
  if (!Array.isArray(list)) return;
  for (const item of list) {
    const id = item?.[idKey];
    if (Number.isSafeInteger(id) && id > 0 && !map.has(id)) {
      map.set(id, typeof item.name === 'string' && item.name !== '' ? item.name : null);
    }
  }
}

function fillTargets(keepSelection) {
  const type = els.scopeType.value;
  const map = type === 'PROGRAM' ? known.programs : type === 'DEPARTMENT' ? known.departments : null;
  els.scopeTargetGroup.hidden = map === null;
  if (map === null) return;
  const word = type === 'PROGRAM' ? 'Program' : 'Department';
  const previous = keepSelection ? els.scopeTarget.value : '';
  els.scopeTargetLabel.textContent = word;
  els.scopeTarget.replaceChildren(new Option(`Choose a ${word}`, ''));
  const entries = [...map].sort((a, b) => String(a[1] ?? '').localeCompare(String(b[1] ?? '')));
  for (const [id, name] of entries) els.scopeTarget.append(new Option(name ?? `ID ${id}`, String(id)));
  els.scopeTarget.value = previous;
}

async function loadPrograms() {
  const res = await api.listPrograms();
  if (res.networkError || res.status !== 200 || !Array.isArray(res.body?.programs)) return;
  for (const p of res.body.programs) {
    if (Number.isSafeInteger(p?.programId) && p.programId > 0 && typeof p.name === 'string') {
      known.programs.set(p.programId, p.site ? `${p.name} (${p.site})` : p.name);
    }
  }
}

// Every Department, including ones with no referrals and ones no longer
// active, so a report can be scoped to any of them (history stays selectable).
async function loadDepartments() {
  const res = await api.listDepartments();
  if (res.networkError || res.status !== 200 || !Array.isArray(res.body?.departments)) return;
  for (const d of res.body.departments) {
    if (Number.isSafeInteger(d?.departmentId) && d.departmentId > 0 && typeof d.name === 'string' && d.name !== '') {
      const status = typeof d.lifecycleStatus === 'string' && d.lifecycleStatus !== 'ACTIVE'
        ? ` (${d.lifecycleStatus.toLowerCase()})`
        : '';
      known.departments.set(d.departmentId, `${d.name}${status}`);
    }
  }
  fillTargets(true);
}

/* ---------- query and errors ---------- */

function showError(message) {
  els.error.textContent = message;
  els.error.hidden = false;
}

function clearError() {
  els.error.textContent = '';
  els.error.hidden = true;
}

function readParams() {
  const params = { period: els.period.value };
  if (els.date.value) params.date = els.date.value;
  const type = els.scopeType.value;
  if (type !== 'ORGANIZATION') {
    if (!els.scopeTarget.value) {
      showError(`Choose a ${type === 'PROGRAM' ? 'Program' : 'Department'}, or switch the scope to All of QCH.`);
      els.scopeTarget.focus();
      return null;
    }
    params[type === 'PROGRAM' ? 'programId' : 'departmentId'] = els.scopeTarget.value;
  }
  return params;
}

function messageFor(res) {
  if (res.networkError) return 'Could not reach the server. Check your connection and try again.';
  const code = typeof res.body?.code === 'string' && /^[A-Z_]{1,40}$/.test(res.body.code) ? ` (${res.body.code})` : '';
  const fields = Array.isArray(res.body?.fields) ? res.body.fields : [];
  if (res.status === 401) return `You are not signed in. Sign in and try again.${code}`;
  if (res.status === 403) return `You do not have access to reporting.${code}`;
  if (res.status === 400 && fields.includes('date')) return 'That date is not allowed. Use a date from 2000-01-01 up to today.';
  if (res.status === 400 && (fields.includes('programId') || fields.includes('departmentId'))) {
    return 'That Program or Department was not recognized.';
  }
  if (res.status === 400) return `The report request was not accepted.${code}`;
  if (res.status === 503) return `Reporting is temporarily unavailable. Try again shortly.${code}`;
  return `The report could not be produced. Try again, and tell support if it keeps happening.${code}`;
}

/* ---------- rendering ---------- */

function scopeText(scope) {
  if (scope?.type === 'ORGANIZATION') return 'All of QCH';
  if (scope?.type === 'PROGRAM') {
    const name = known.programs.get(scope.programId);
    return name ? `Program: ${name}` : `Program (ID ${formatCount(scope.programId)})`;
  }
  if (scope?.type === 'DEPARTMENT') {
    const name = known.departments.get(scope.departmentId);
    return name ? `Department: ${name}` : `Department (ID ${formatCount(scope.departmentId)})`;
  }
  return 'Unknown';
}

function render(activity, total, timing) {
  const summary = activity.summary ?? {};
  const period = activity.period ?? {};

  els.ctxPeriod.textContent = typeof period.label === 'string' ? `${period.label} (${period.type})` : 'Unknown';
  els.ctxRange.textContent = period.start && period.endExclusive
    ? `${period.start} up to, but not including, ${period.endExclusive}`
    : 'Unknown';
  els.ctxScope.textContent = scopeText(activity.scope);
  els.ctxAsOf.textContent = formatAsOf(activity.asOf);
  els.scopeNote.hidden = activity.scope?.type === 'ORGANIZATION' || !activity.scope;
  els.partialNote.hidden = activity.partial !== true;
  els.mismatchNote.hidden = Number.isSafeInteger(total.value) && total.value === summary.totalReferrals;

  els.counts.replaceChildren(
    metricCard('Total referrals', countView(total.value)),
    metricCard('Awaiting response', countView(summary.awaitingResponse)),
    metricCard('Accepted', countView(summary.accepted)),
    metricCard('Not appropriate', countView(summary.notAppropriate)),
    metricCard('Resulted in service', countView(summary.resultedInService)),
    metricCard('Did not result in service', countView(summary.didNotResultInService)),
  );

  els.rates.replaceChildren(
    metricCard('Acceptance rate', formatRate(summary.acceptanceRate)),
    metricCard('Not appropriate rate', formatRate(summary.notAppropriateRate)),
    metricCard('Resulted-in-service rate', formatRate(summary.resultedInServiceRate)),
  );

  els.timing.replaceChildren(
    metricCard('Average time to first response', formatTiming(timing.timeToFirstResponse, 'averageMs')),
    metricCard('Median time to first response', formatTiming(timing.timeToFirstResponse, 'medianMs')),
    metricCard('Average time to recorded service', formatTiming(timing.timeToRecordedService, 'averageMs')),
    metricCard('Median time to recorded service', formatTiming(timing.timeToRecordedService, 'medianMs')),
  );

  fillTable(els.programsBody, activity.programs, 'Program');
  fillTable(els.departmentsBody, activity.departments, 'Department');
  els.results.hidden = false;
}

/* ---------- run a report ---------- */

function setBusy(busy) {
  els.apply.disabled = busy;
  els.status.textContent = busy ? 'Loading report...' : '';
}

async function run() {
  clearError();
  const params = readParams();
  if (!params) return;
  const token = ++runToken;
  setBusy(true);

  const [activity, total, timing] = await Promise.all([api.activity(params), api.total(params), api.timing(params)]);
  if (token !== runToken) return;
  setBusy(false);

  // One consistent result: if any of the three failed, show none of them.
  const failed = [activity, total, timing].find((r) => r.networkError || r.status !== 200 || !r.body);
  if (failed) {
    els.results.hidden = true;
    showError(messageFor(failed));
    return;
  }

  remember(known.programs, activity.body.programs, 'programId');
  remember(known.departments, activity.body.departments, 'departmentId');
  fillTargets(true);
  render(activity.body, total.body, timing.body);
  els.status.textContent = `Report loaded for ${activity.body.period?.label ?? 'the selected period'}.`;
}

/* ---------- wiring ---------- */

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
els.date.min = '2000-01-01';
els.date.max = today; // a hint only; the server enforces the date rule

els.scopeType.addEventListener('change', () => fillTargets(false));
els.filters.addEventListener('submit', (event) => {
  event.preventDefault();
  run();
});

await Promise.all([loadPrograms(), loadDepartments()]);
run();
