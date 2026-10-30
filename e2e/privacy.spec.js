// Trello Task DD: privacy / data-leakage final regression, browser side
// (Frozen Handoff PRD 5.4, 34; Handoff MVP 6, 25; acceptance gates 8, 30;
// Current Handoff Wireframes screens 2 and 7).
//
// One referral is carried through every screen with marked SYNTHETIC
// participant data: Find a Program (describe the need, match), the
// referral details, the receiving screens (Not appropriate with an
// explanation, a correction, the outcome), Referrals I sent, the
// Reporting Center and Program Management. Along the way every request
// the page makes, every address it shows and every console message is
// recorded. Authorized screens show the participant's details on purpose;
// the test checks that the marked data is kept out of:
//   - browser storage: localStorage (only the text size may be kept),
//     sessionStorage, IndexedDB, Cache Storage, a service worker. Checked
//     at seven points DURING the journey (after matching, with the details
//     form filled in, after sending, after the Not appropriate response,
//     after the correction and outcome, on the sent referral's page, and at
//     the end), each while that sensitive page is still open,
//   - any cookie, read from the browser itself so HttpOnly cookies (which
//     page scripts cannot see) are checked too; same seven points,
//   - addresses and query strings (every request and page address, recorded
//     the whole time and checked at the end),
//   - the browser console (recorded the whole time, checked at the end).
// This runs on the e2e fixture: the synthetic dev server with one fixed
// identity, which sets no cookies at all. The Task O demo mode
// (npm run dev:demo) does set an HttpOnly session cookie holding only a
// random token; that cookie is checked in
// test/regression/privacyRegression.test.js, with server logs, reports and
// emails.

import { test, expect } from '@playwright/test';
import { ensureAffiliation } from './helpers.js';

const RUN = Date.now().toString(36);
const MARK = {
  name: `Synthetic Person PRVNAME ${RUN}`,
  email: `prv.contact.${RUN}@example.test`,
  context: `Synthetic context PRVCTX ${RUN}`,
  notes: `Synthetic note PRVNOTE ${RUN}`,
  explanation: `Synthetic explanation PRVEXPL ${RUN}`,
  describe: `Needs housing help, zip 99577, PRVDESC ${RUN}`,
};
const MARKERS = ['PRVNAME', 'prv.contact', 'PRVCTX', 'PRVNOTE', 'PRVEXPL', 'PRVDESC'];
const ZIP_WORD = /\b99577\b/;
const HOUSING = 'Housing Help Desk (sample)';

const status = (page) => page.locator('#status .status__text');

function leaks(text) {
  const value = decodeURIComponent(String(text));
  const found = MARKERS.filter((marker) => value.includes(marker));
  if (ZIP_WORD.test(value)) found.push('participant ZIP');
  return found;
}

// Browser storage and cookies right now, on the page that is open. `stage`
// names the point in the journey, so a failure says where it happened.
async function expectCleanBrowserState(page, stage) {
  const stored = await page.evaluate(async () => ({
    local: Object.fromEntries(Object.entries(localStorage)),
    session: sessionStorage.length,
    indexedDb: (await indexedDB.databases()).map((db) => db.name),
    caches: await caches.keys(),
    workers: (await navigator.serviceWorker.getRegistrations()).length,
  }));
  expect(Object.keys(stored.local).every((key) => key === 'qchConnect.textSize'), `${stage}: localStorage ${JSON.stringify(stored.local)}`).toBe(true);
  expect(leaks(JSON.stringify(stored.local)), `${stage}: localStorage`).toEqual([]);
  expect(stored, `${stage}: browser storage`).toMatchObject({ session: 0, indexedDb: [], caches: [], workers: 0 });

  // Cookies, from the browser's own cookie jar, HttpOnly ones included
  // (document.cookie cannot see those). Their contents never carry
  // participant data. And this fixed-identity fixture sets none at all;
  // that empty-jar expectation is about this fixture only, not the Task O
  // demo, which legitimately uses an HttpOnly session cookie.
  const cookies = await page.context().cookies();
  expect(cookies.flatMap((c) => leaks(`${c.name}=${c.value}`).map((what) => `${what} in cookie ${c.name}`)), `${stage}: cookies`).toEqual([]);
  expect(cookies.map((c) => `${c.name} (httpOnly: ${c.httpOnly})`), `${stage}: the fixed-identity fixture sets no cookies`).toEqual([]);
}

test('participant data stays out of addresses, browser storage, cookies and the console (Handoff PRD 34; MVP 25)', async ({ page }) => {
  test.setTimeout(90000);
  const requests = [];
  const addresses = [];
  const consoleLines = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) addresses.push(frame.url()); });
  page.on('console', (message) => consoleLines.push(message.text()));
  page.on('pageerror', (err) => consoleLines.push(`${err.name} ${err.message}`));

  // Find a Program: describe the need, review what was understood, match.
  await page.goto('/referral/');
  await ensureAffiliation(page, 1);
  await page.reload();
  await page.locator('#path-guided').click();
  await page.locator('input[name="need"]').first().waitFor({ state: 'attached' });
  await page.locator('#describe').fill(MARK.describe);
  await page.locator('#describe-go').click();
  await expect(page.locator('#understood')).toBeVisible();
  await page.locator('#find-programs').click();
  await expect(page.locator('#match-results')).toBeVisible();
  await expectCleanBrowserState(page, '1. after describing the need and matching');
  await page.getByRole('button', { name: `Choose ${HOUSING}` }).click();

  // The referral details, with every sensitive field filled.
  await expect(page.locator('#step-details')).toBeVisible();
  await page.locator('#participantName').fill(MARK.name);
  await page.locator('input[name="contactMethod"][value="EMAIL"]').check();
  await page.locator('#contactValue').fill(MARK.email);
  await page.locator('#referralContext').fill(MARK.context);
  await page.locator('#participantZip').fill('99577');
  await page.locator('#notes').fill(MARK.notes);
  // Active-form data may live in memory, never in storage (data
  // minimization, Handoff PRD 34).
  await expectCleanBrowserState(page, '2. details form filled in, before sending');
  await page.locator('#send').click();
  await expect(status(page)).toContainText('Referral received');
  await expectCleanBrowserState(page, '3. after sending');

  // Receiving: open it from the queue, mark it Not appropriate with an
  // explanation, correct the decision to Accepted, record the outcome.
  await page.goto('/receiving/');
  const item = page.locator('.queue-item').filter({ hasText: MARK.name });
  await expect(item).toHaveCount(1);
  await item.getByRole('link').click();
  await expect(page.locator('#respond-panel')).toBeVisible();
  await page.locator('#respond-na').check();
  await page.locator('#respond-reason').selectOption({ index: 1 });
  await page.locator('#respond-explanation').fill(MARK.explanation);
  page.once('dialog', (d) => d.accept());
  await page.locator('#respond-submit').click();
  await expect(status(page)).toContainText('Response sent');
  await expectCleanBrowserState(page, '4. after responding Not appropriate with an explanation');
  await page.locator('#cd-accept').check();
  page.once('dialog', (d) => d.accept());
  await page.locator('#correct-decision-submit').click();
  await expect(status(page)).toContainText('corrected');
  await page.locator('#outcome-resulted').check();
  page.once('dialog', (d) => d.accept());
  await page.locator('#outcome-submit').click();
  await expect(status(page)).toHaveText('Service outcome recorded: Resulted in service.');
  await expectCleanBrowserState(page, '5. after the decision correction and the outcome');

  // Referrals I sent: the list, then the referral's status page.
  await page.goto('/sent/');
  const sent = page.locator('.queue-item').filter({ hasText: MARK.name });
  await expect(sent).toHaveCount(1);
  await sent.getByRole('link').click();
  await expect(status(page)).toHaveText('Referral loaded.');
  await expectCleanBrowserState(page, '6. on the sent referral\'s status page');

  // Reporting Center and Program Management load their data too.
  for (const path of ['/reporting/', '/program-management/', '/program-management/organization.html', '/']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }

  // Addresses: no participant data in any request, and the page address
  // only ever carries numeric IDs.
  expect(requests.length).toBeGreaterThan(20);
  expect(requests.flatMap((url) => leaks(url).map((what) => `${what} in ${url}`))).toEqual([]);
  for (const address of addresses) {
    expect(leaks(address), address).toEqual([]);
    expect(new URL(address).search, address).toMatch(/^(\?[A-Za-z]+=\d+(&[A-Za-z]+=\d+)*)?$/);
  }

  await expectCleanBrowserState(page, '7. at the end, after Reporting and Program Management');

  // Console: nothing about the participant, on any page.
  expect(consoleLines.flatMap((line) => leaks(line).map((what) => `${what}: ${line}`))).toEqual([]);
});
