// Received referrals list (Task A). GET /api/referrals/received returns
// only referrals for Programs this user holds a receiving grant for; the
// browser never filters a wider list (PRD 3.3, 3.6).

import {
  call, decisionText, element, formatDate, outcomeText, responseText,
  setupTextSize, showStatus, STAGE_LABELS, summaryRow,
} from './common.js';

const $ = (id) => document.getElementById(id);
const NEED_PREVIEW = 160;
let nextCursor = null;
let shown = 0;
let busy = false;

setupTextSize();

function query({ cursor } = {}) {
  const params = new URLSearchParams();
  if ($('program-filter').value) params.set('programId', $('program-filter').value);
  if ($('stage-filter').value) params.set('stage', $('stage-filter').value);
  if (cursor) params.set('cursor', cursor);
  const text = params.toString();
  return `/api/referrals/received${text ? `?${text}` : ''}`;
}

function preview(text) {
  if (!text) return '';
  return text.length > NEED_PREVIEW ? `${text.slice(0, NEED_PREVIEW).trimEnd()}…` : text;
}

function item(referral) {
  const li = element('li', undefined, 'queue-item');
  const heading = element('h3');
  const link = element('a', `Referral ${referral.referralId}: ${referral.participantName}`);
  link.href = `referral.html?id=${encodeURIComponent(referral.referralId)}`;
  heading.append(link);

  const meta = element('p', undefined, 'muted');
  meta.textContent = `${STAGE_LABELS[referral.stage] ?? 'Unknown'}. Sent ${formatDate(referral.createdAt)} from ${referral.referringProgram?.name ?? 'an unknown Program'} to ${referral.receivingProgram?.name ?? 'an unknown Program'}.`;

  const trio = element('dl', undefined, 'summary trio');
  trio.append(
    summaryRow('Response', responseText(referral)),
    summaryRow('Decision', referral.decision === 'NOT_APPROPRIATE' && referral.notAppropriateReason?.label
      ? `${decisionText(referral)}: ${referral.notAppropriateReason.label}`
      : decisionText(referral)),
    summaryRow('Service outcome', outcomeText(referral)),
  );

  li.append(heading, meta, trio);
  if (referral.referralContext) {
    const need = element('p', undefined, 'need');
    need.append(element('span', 'Need: ', 'muted'), document.createTextNode(preview(referral.referralContext)));
    li.append(need);
  }
  return li;
}

function explain(result) {
  if (result.networkError) return 'Referrals could not be loaded. Check your connection and try again.';
  if (result.status === 401) return 'Sign in again to see received referrals.';
  if (result.status === 403) return 'You do not have access to referrals for that Program.';
  return 'Referrals could not be loaded. Try again.';
}

function controls() {
  $('show').disabled = busy;
  $('load-more').disabled = busy;
  $('retry').disabled = busy;
}

async function load({ append = false, first = false } = {}) {
  if (busy) return;
  busy = true;
  controls();
  if (!append) showStatus('Loading referrals…', 'info', { focus: false });
  const result = await call('GET', query({ cursor: append ? nextCursor : null }));
  busy = false;
  controls();

  const body = result.body;
  if (result.status !== 200 || !Array.isArray(body?.referrals) || !Array.isArray(body?.programs)) {
    showStatus(explain(result), 'error');
    $('retry').hidden = !first;
    return;
  }
  $('retry').hidden = true;

  if (first) {
    if (body.programs.length === 0) {
      showStatus('You do not receive referrals for any Program yet. An administrator can give you access.', 'info');
      return;
    }
    for (const program of body.programs) {
      $('program-filter').add(new Option(program.name ?? `Program ${program.programId}`, String(program.programId)));
    }
    $('filters').hidden = false;
  }

  const list = $('referral-list');
  if (!append) {
    list.replaceChildren();
    shown = 0;
  }
  for (const referral of body.referrals) list.append(item(referral));
  shown += body.referrals.length;
  nextCursor = body.hasMore ? body.nextCursor : null;
  $('load-more').hidden = !nextCursor;
  $('results').hidden = false;
  $('results-count').textContent = shown === 0
    ? 'No referrals match.'
    : `Showing ${shown} referral${shown === 1 ? '' : 's'}${nextCursor ? '. More are available.' : '.'}`;

  if (append) {
    showStatus(`Showing ${shown} referrals.`, 'info', { focus: false });
  } else {
    showStatus(shown === 0 ? 'No referrals match.' : 'Referrals loaded.', 'info', { focus: false });
    if (!first) $('results-heading').focus();
  }
}

$('filter-form').addEventListener('submit', (event) => {
  event.preventDefault();
  load();
});
$('load-more').addEventListener('click', () => load({ append: true }));
$('retry').addEventListener('click', () => load({ first: true }));

load({ first: true });
