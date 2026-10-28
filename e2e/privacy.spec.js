// Trello Task DD: privacy / data-leakage final regression, browser side
// (Final Technical PRD 5.3, 5.4, 5.5).
//
// One referral is carried through every screen with marked SYNTHETIC
// participant data: Find a Program (describe the need, match), the
// referral details, the receiving screens (Not appropriate with an
// explanation, a correction, the outcome), Referrals I sent, the
// Reporting Center and Program Management. Along the way every request
// the page makes, every address it shows and every console message is
// recorded. At the end the test checks that no marker reached:
//   - an address or query string (requests and page addresses),
//   - localStorage (only the text size may be kept), sessionStorage,
//     IndexedDB, Cache Storage, a service worker, or a cookie,
//   - the browser console.
// Server logs, reports and emails are checked in
// test/regression/privacyRegression.test.js.

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

test('participant data never reaches an address, browser storage or the console (PRD 5.5)', async ({ page }) => {
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
  await page.getByRole('button', { name: `Choose ${HOUSING}` }).click();

  // The referral details, with every sensitive field filled.
  await expect(page.locator('#step-details')).toBeVisible();
  await page.locator('#participantName').fill(MARK.name);
  await page.locator('input[name="contactMethod"][value="EMAIL"]').check();
  await page.locator('#contactValue').fill(MARK.email);
  await page.locator('#referralContext').fill(MARK.context);
  await page.locator('#participantZip').fill('99577');
  await page.locator('#notes').fill(MARK.notes);
  await page.locator('#send').click();
  await expect(status(page)).toContainText('Referral received');

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
  await page.locator('#cd-accept').check();
  page.once('dialog', (d) => d.accept());
  await page.locator('#correct-decision-submit').click();
  await expect(status(page)).toContainText('corrected');
  await page.locator('#outcome-resulted').check();
  page.once('dialog', (d) => d.accept());
  await page.locator('#outcome-submit').click();
  await expect(status(page)).toHaveText('Service outcome recorded: Resulted in service.');

  // Referrals I sent: the list, then the referral's status page.
  await page.goto('/sent/');
  const sent = page.locator('.queue-item').filter({ hasText: MARK.name });
  await expect(sent).toHaveCount(1);
  await sent.getByRole('link').click();
  await expect(status(page)).toHaveText('Referral loaded.');

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

  // Browser storage: only the text size, and nothing else anywhere.
  const stored = await page.evaluate(async () => ({
    local: Object.fromEntries(Object.entries(localStorage)),
    session: sessionStorage.length,
    indexedDb: (await indexedDB.databases()).map((db) => db.name),
    caches: await caches.keys(),
    workers: (await navigator.serviceWorker.getRegistrations()).length,
    cookie: document.cookie,
  }));
  expect(Object.keys(stored.local).every((key) => key === 'qchConnect.textSize'), JSON.stringify(stored.local)).toBe(true);
  expect(leaks(JSON.stringify(stored.local))).toEqual([]);
  expect(stored).toMatchObject({ session: 0, indexedDb: [], caches: [], workers: 0, cookie: '' });

  // Console: nothing about the participant, on any page.
  expect(consoleLines.flatMap((line) => leaks(line).map((what) => `${what}: ${line}`))).toEqual([]);
});
