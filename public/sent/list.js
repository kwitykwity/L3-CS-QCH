// Referrals I sent (Trello Task L). GET /api/referrals/sent returns only
// referrals this user created; the browser never filters a wider list
// (PRD 3.3, 3.4). The list carries no contact details, notes or Not
// Appropriate explanations (PRD 10.5). Nothing is stored in the browser
// and nothing about a participant goes into a URL (PRD 5.5).

import {
  call, decisionText, element, formatDate, outcomeText, responseText,
  setupTextSize, showStatus, STAGE_LABELS, summaryRow,
} from '/receiving/common.js';

const $ = (id) => document.getElementById(id);
let nextCursor = null;
let shown = 0;
let busy = false;

setupTextSize();

function query({ cursor } = {}) {
  const params = new URLSearchParams();
  if ($('stage-filter').value) params.set('stage', $('stage-filter').value);
  if (cursor) params.set('cursor', cursor);
  const text = params.toString();
  return `/api/referrals/sent${text ? `?${text}` : ''}`;
}

function item(referral) {
  const li = element('li', undefined, 'queue-item');
  const heading = element('h3');
  const link = element('a', `Referral ${referral.referralId}: ${referral.participantName}`);
  link.href = `referral.html?id=${encodeURIComponent(referral.referralId)}`;
  heading.append(link);

  // Awaiting response stays awaiting until the receiving Program responds;
  // time passing never changes it (PRD 6.2). Said in words, not color.
  const where = element('p', undefined, referral.stage === 'AWAITING_RESPONSE' ? 'awaiting' : 'muted');
  where.textContent = referral.stage === 'AWAITING_RESPONSE'
    ? `Awaiting response from ${referral.receivingProgram?.name ?? 'the receiving Program'}. Sent ${formatDate(referral.createdAt)}.`
    : `${STAGE_LABELS[referral.stage] ?? 'Unknown'}. Sent ${formatDate(referral.createdAt)} to ${referral.receivingProgram?.name ?? 'an unknown Program'}.`;

  const trio = element('dl', undefined, 'summary trio');
  trio.append(
    summaryRow('Response', responseText(referral)),
    summaryRow('Decision', referral.decision === 'NOT_APPROPRIATE' && referral.notAppropriateReason?.label
      ? `${decisionText(referral)}: ${referral.notAppropriateReason.label}`
      : decisionText(referral)),
    summaryRow('Service outcome', outcomeText(referral)),
  );
  li.append(heading, where, trio);
  return li;
}

function explain(result) {
  if (result.networkError) return 'Your referrals could not be loaded. Check your connection and try again.';
  if (result.status === 401) return 'Sign in again to see the referrals you sent.';
  if (result.status === 403) return 'Your account cannot see referrals right now. Ask an administrator.';
  return 'Your referrals could not be loaded. Try again.';
}

// Removes every referral an earlier load showed. Used when access is lost
// (401 or 403), so no participant name or link stays on screen (review on #49).
function clearList() {
  $('referral-list').replaceChildren();
  shown = 0;
  nextCursor = null;
  $('results-count').textContent = '';
  for (const id of ['results', 'filters', 'load-more']) $(id).hidden = true;
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
  if (!append) showStatus('Loading your referrals…', 'info', { focus: false });
  const result = await call('GET', query({ cursor: append ? nextCursor : null }));
  busy = false;
  controls();

  const body = result.body;
  if (result.status !== 200 || !Array.isArray(body?.referrals)) {
    const accessLost = result.status === 401 || result.status === 403;
    if (accessLost) clearList();
    // Focus goes to the message, since the control just used may be gone.
    showStatus(explain(result), 'error');
    $('retry').hidden = !(first || accessLost);
    return;
  }
  $('retry').hidden = true;
  $('filters').hidden = false;

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
  const none = first && !$('stage-filter').value
    ? 'You have not sent any referrals yet.'
    : 'No referrals match.';
  $('results-count').textContent = shown === 0
    ? none
    : `Showing ${shown} referral${shown === 1 ? '' : 's'}${nextCursor ? '. More are available.' : '.'}`;

  if (append) {
    showStatus(`Showing ${shown} referrals.`, 'info', { focus: false });
  } else {
    showStatus(shown === 0 ? none : 'Your referrals loaded.', 'info', { focus: false });
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
