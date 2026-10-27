// One referral, seen by the person who sent it (Trello Task L).
//
//   GET /api/referrals/:id   referral + viewerAccess (creator or authorized receiver; else 404)
//
// - Read-only. Seeing a referral you created gives no receiving-side
//   permission (PRD 3.6, 3.7): this page has no actions at all. If the
//   same person also receives for that Program, the server says so
//   (viewerAccess.asReceiver) and the page only links to the receiving
//   screen, where every action is checked again.
// - Shows what the server returns, with no lifecycle states of its own
//   (PRD 6.1, 6.2): Response, Decision and Service outcome stay separate,
//   and Accepted never reads as "served".
// - Nothing is stored in the browser or written to the console (PRD 5.5).

import { CONTACT_METHODS } from '/referral/validation.js';
import {
  call, decisionText, formatDate, outcomeText, responseText, setupTextSize, showStatus, summaryRow,
} from '/receiving/common.js';

const $ = (id) => document.getElementById(id);
const referralId = Number(new URLSearchParams(window.location.search).get('id'));
const NOT_AVAILABLE = 'This referral is not available. It may not exist, or you may not have access to it.';
const contactLabel = (value) => CONTACT_METHODS.find((m) => m.value === value)?.label ?? 'Unknown';
const SOURCE_LABELS = { DIRECT: 'Direct Referral', GPME_ASSISTED: 'Guided matching (Find a Program)' };

setupTextSize();

// Removes everything an earlier load showed: the participant's name in the
// heading and title, the three steps, what was sent, and the link to the
// receiving screen. Used whenever access is lost or the referral is not
// available, so nothing stays on screen that the server no longer allows
// (review on #49).
function clearReferral({ keepReload = false } = {}) {
  $('referral-heading').textContent = 'Referral status';
  document.title = 'Referral status · QCH Connect';
  for (const id of ['response-value', 'decision-value', 'reason-value', 'explanation-value', 'outcome-value', 'outcome-note']) {
    $(id).textContent = '';
  }
  for (const id of ['awaiting-note', 'reason-value', 'explanation-value', 'outcome-note', 'receiver-link', 'progress', 'info']) {
    $(id).hidden = true;
  }
  $('receiver-href').setAttribute('href', '#');
  $('info-list').replaceChildren();
  $('reload').hidden = !keepReload;
}

function render(referral, access) {
  $('referral-heading').textContent = `Referral ${referral.referralId}: ${referral.participantName}`;
  document.title = `Referral ${referral.referralId} status · QCH Connect`;

  $('awaiting-note').hidden = referral.responseStatus !== 'AWAITING_RESPONSE';
  $('response-value').textContent = referral.firstRespondedAt
    ? `${responseText(referral)} (${formatDate(referral.firstRespondedAt)})`
    : responseText(referral);
  $('decision-value').textContent = decisionText(referral);
  const reason = referral.decision === 'NOT_APPROPRIATE' ? referral.notAppropriateReason?.label : null;
  $('reason-value').textContent = reason ? `Reason: ${reason}` : '';
  $('reason-value').hidden = !reason;
  const explanation = referral.decision === 'NOT_APPROPRIATE' ? referral.notAppropriateExplanation : null;
  $('explanation-value').textContent = explanation ? `Explanation: ${explanation}` : '';
  $('explanation-value').hidden = !explanation;

  $('outcome-value').textContent = referral.outcomeRecordedAt && referral.serviceOutcome !== 'NOT_RECORDED'
    ? `${outcomeText(referral)} (recorded ${formatDate(referral.outcomeRecordedAt)})`
    : outcomeText(referral);
  let note = '';
  if (referral.decision === 'ACCEPTED' && referral.serviceOutcome === 'NOT_RECORDED') {
    note = 'Accepted is not the same as served. The receiving Program records the outcome once they know.';
  } else if (referral.decision === 'NOT_APPROPRIATE') {
    note = 'A Not appropriate referral has no service outcome. It is not sent anywhere else automatically.';
  }
  $('outcome-note').textContent = note;
  $('outcome-note').hidden = !note;

  $('receiver-link').hidden = access.asReceiver !== true;
  $('receiver-href').href = `/receiving/referral.html?id=${encodeURIComponent(referral.referralId)}`;

  $('info-list').replaceChildren(
    summaryRow('Sent to', referral.receivingProgram?.name ?? 'Unknown Program'),
    summaryRow('Sent from', referral.referringProgram?.name ?? 'Unknown Program'),
    summaryRow('Sent', formatDate(referral.createdAt)),
    summaryRow('How the Program was chosen', SOURCE_LABELS[referral.source] ?? 'Unknown'),
    summaryRow('Participant', referral.participantName),
    summaryRow('How to reach them', referral.contactMethod === 'NOT_AVAILABLE'
      ? contactLabel(referral.contactMethod)
      : `${contactLabel(referral.contactMethod)}: ${referral.contactValue ?? ''}`),
    ...(referral.participantZip ? [summaryRow('ZIP code', referral.participantZip)] : []),
    summaryRow('What they need', referral.referralContext ?? ''),
    ...(referral.notes ? [summaryRow('Notes', referral.notes)] : []),
  );
  for (const dd of $('info-list').querySelectorAll('dd')) dd.classList.add('need');

  $('progress').hidden = false;
  $('info').hidden = false;
  $('reload').hidden = false;
}

async function load() {
  if (!Number.isSafeInteger(referralId) || referralId <= 0) {
    clearReferral();
    showStatus(NOT_AVAILABLE, 'error');
    return false;
  }
  $('reload').disabled = true;
  const result = await call('GET', `/api/referrals/${encodeURIComponent(referralId)}`);
  $('reload').disabled = false;
  if (result.status === 200 && result.body?.referral?.referralId === referralId && result.body.viewerAccess) {
    render(result.body.referral, result.body.viewerAccess);
    return true;
  }
  if (result.status === 404) {
    clearReferral();
    showStatus(NOT_AVAILABLE, 'error');
  } else if (result.status === 401) {
    // Reload stays, so the person can try again after signing in.
    clearReferral({ keepReload: true });
    showStatus('Sign in again to see this referral.', 'error');
  } else if (result.status === 403) {
    clearReferral({ keepReload: true });
    showStatus('You do not have access to this referral right now. Ask an administrator if you think this is wrong.', 'error');
  } else {
    // A network or server failure says nothing about access, so what was
    // already shown stays, with a message that it could not be refreshed.
    $('reload').hidden = false;
    showStatus('The referral could not be loaded. Check your connection and try again.', 'error');
  }
  return false;
}

$('reload').addEventListener('click', async () => {
  if (await load()) showStatus('Referral reloaded.', 'info');
});

(async () => {
  showStatus('Loading referral…', 'info', { focus: false });
  if (await load()) showStatus('Referral loaded.', 'info', { focus: false });
})();
