// Shared pieces for the receiving-side screens (Task A; Final Technical
// PRD 2.3, 3.3, 3.7, 6.1, 6.2, 6.5, 9.4, 13.4, 14).
//
// - The server is the authority for state and permission. These screens
//   only show what the server returned and ask it to make changes; every
//   action is checked again on the server (PRD 3.7, 6.4).
// - Response, Decision and Service Outcome are three separate things and
//   are always shown separately. Accepted never reads as "service
//   happened" (PRD 6.1).
// - Participant data never goes into a URL or browser storage, and
//   nothing is written to the console (PRD 5.5, 15.3). Only the text-size
//   preference is stored.

import { SIZES, loadSize, saveSize } from '/referral/textSize.js';

const TIMEOUT_MS = 15000;

// Returns { status, body } or { networkError: true }. Never throws.
export async function call(method, url, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: body === undefined
        ? { Accept: 'application/json' }
        : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    let parsed = null;
    try { parsed = await response.json(); } catch { parsed = null; }
    return { status: response.status, body: parsed };
  } catch {
    return { networkError: true };
  } finally {
    clearTimeout(timer);
  }
}

// S / M / L / XL (PRD 14.5): 12 / 14 / 18 / 24 px on the root.
export function setupTextSize() {
  let storage = null;
  try { storage = window.localStorage; } catch { storage = null; }
  const apply = (size) => {
    document.documentElement.style.fontSize = `${SIZES[size]}px`;
    for (const button of document.querySelectorAll('[data-size]')) {
      button.setAttribute('aria-pressed', String(button.dataset.size === size));
    }
  };
  apply(loadSize(storage));
  for (const button of document.querySelectorAll('[data-size]')) {
    button.addEventListener('click', () => {
      apply(button.dataset.size);
      saveSize(storage, button.dataset.size);
    });
  }
}

export const RESPONSE_LABELS = Object.freeze({
  AWAITING_RESPONSE: 'Awaiting response',
  RESPONDED: 'Responded',
});

export const DECISION_LABELS = Object.freeze({
  ACCEPTED: 'Accepted',
  NOT_APPROPRIATE: 'Not appropriate',
});

export const OUTCOME_LABELS = Object.freeze({
  NOT_RECORDED: 'Not recorded',
  RESULTED_IN_SERVICE: 'Resulted in service',
  DID_NOT_RESULT_IN_SERVICE: 'Did not result in service',
});

export const STAGE_LABELS = Object.freeze({
  AWAITING_RESPONSE: 'Awaiting response',
  ACCEPTED_OUTCOME_PENDING: 'Accepted, service outcome not recorded',
  COMPLETE: 'Complete',
});

export function responseText(referral) {
  return RESPONSE_LABELS[referral.responseStatus] ?? 'Unknown';
}

export function decisionText(referral) {
  if (referral.responseStatus === 'AWAITING_RESPONSE' || !referral.decision) return 'No decision yet';
  return DECISION_LABELS[referral.decision] ?? 'Unknown';
}

// The outcome is described on its own terms. An accepted referral with no
// outcome says so plainly: accepted is not the same as served (PRD 6.1).
export function outcomeText(referral) {
  if (referral.decision === 'NOT_APPROPRIATE') return 'Not applicable (the decision is Not appropriate)';
  if (referral.responseStatus === 'AWAITING_RESPONSE') return 'Not recorded (no decision yet)';
  return OUTCOME_LABELS[referral.serviceOutcome] ?? 'Unknown';
}

export function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function summaryRow(term, value, id) {
  const row = element('div');
  const dt = element('dt', term);
  const dd = element('dd', value);
  if (id) dd.id = id;
  row.append(dt, dd);
  return row;
}

export function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

// One status box per page (role="status"). Focus moves to it so the
// message is read out and keyboard users land on it.
export function showStatus(text, tone = 'info', { focus = true } = {}) {
  const box = document.getElementById('status');
  box.className = `status status--${tone}`;
  box.querySelector('.status__text').textContent = text;
  box.hidden = false;
  if (focus) box.focus();
}

export function hideStatus() {
  document.getElementById('status').hidden = true;
}
