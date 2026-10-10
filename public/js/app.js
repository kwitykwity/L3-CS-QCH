'use strict';

// Foundation check only: confirms the static frontend can reach the backend.
// No participant or referral data is handled here, and nothing is stored in
// the browser (PRD 5.5).
(function () {
  var statusEl = document.getElementById('status');

  fetch('/health', { headers: { Accept: 'application/json' } })
    .then(function (response) {
      if (!response.ok) {
        throw new Error('unavailable');
      }
      return response.json();
    })
    .then(function (body) {
      statusEl.textContent = body.status === 'ok' ? 'Server is available.' : 'Server status is unknown.';
    })
    .catch(function () {
      statusEl.textContent = 'Server is not reachable.';
    });
})();
