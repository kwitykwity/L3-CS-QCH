// Task MM: double-submit, lost answers and interrupted sends, in a real
// browser. SYNTHETIC data only.
//
// Frozen Handoff PRD 20; Handoff MVP 20; acceptance gate 25:
//   - retrying the same logical submission never creates a duplicate
//   - a failed request never leads the employee to create one unknowingly
//   - the employee's work is preserved wherever recovery is possible
//
// The screen sends one Submission ID per referral. While a send is in
// progress or its outcome is unknown, it will not send again; it asks the
// server whether that Submission ID arrived (the safe check) and only then
// says "already received" or "not received, safe to resend".
//
// Faults are injected by intercepting only the one request under test,
// so every other step runs against the real synthetic backend. The lost
// answer on the Find a Program path is covered in e2e/gpme.spec.js; this
// file covers Direct Referral, which had no browser test for it. The
// server-side burst is test/regression/idempotency.test.js.
//
// Synthetic seed: Housing Help Desk (sample) is Program 4.

import { test, expect } from '@playwright/test';
import { chooseDirect, ensureAffiliation } from './helpers.js';

const HOUSING_ID = '4';
const RECEIVED = 'Referral received !';
const NOT_CONFIRMED = 'Referral not confirmed !';
const ALREADY = 'Referral already received. Do not resend !';
const NOT_RECEIVED = 'Referral was not received. Your information has been preserved. You may safely resend !';

const status = (page) => page.locator('#status .status__text');
const isReferralPost = (request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/referrals';

function recordReferralPosts(page) {
  const posts = [];
  page.on('request', (request) => { if (isReferralPost(request)) posts.push(request.postDataJSON()); });
  return posts;
}

// Opens Direct Referral to Housing Help Desk with the details filled in.
async function directDetails(page, name) {
  await page.goto('/referral/');
  await ensureAffiliation(page);
  await page.reload();
  await chooseDirect(page);
  await page.locator(`#program-options input[value="${HOUSING_ID}"]`).check();
  await page.locator('#program-continue').click();
  await expect(page.locator('#step-details')).toBeVisible();
  await page.locator('#participantName').fill(name);
  await page.locator('input[name="contactMethod"][value="NOT_AVAILABLE"]').check();
  await page.locator('#referralContext').fill('Synthetic need for the double-submit test');
}

// How many referrals the server holds for this synthetic person.
async function savedFor(request, name) {
  const sent = await (await request.get('/api/referrals/sent')).json();
  return sent.referrals.filter((r) => r.participantName === name).length;
}

const unique = (label) => `Synthetic Person ${label} ${Date.now()}`;

test.describe('one referral, however many times Send is pressed (Handoff PRD 20)', () => {
  test('clicking Send again, pressing Enter and re-submitting while it is sending send nothing more', async ({ page, request }) => {
    const posts = recordReferralPosts(page);
    const name = unique('Impatient');
    await directDetails(page, name);

    // Hold the answer so the page stays in "Sending referral ...".
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    await page.route('**/api/referrals', async (route) => {
      if (!isReferralPost(route.request())) return route.continue();
      await held;
      return route.continue();
    });

    await page.locator('#send').click();
    await expect(status(page)).toHaveText('Sending referral ...');
    await expect(page.locator('#send')).toBeDisabled();
    // Everything an impatient person (or a stuck mouse) might do.
    await page.locator('#send').click({ force: true, clickCount: 3 });
    await page.locator('#send').focus();
    await page.keyboard.press('Enter');
    await page.evaluate(() => {
      const form = document.getElementById('referral-form');
      form.requestSubmit();
      form.requestSubmit();
    });
    release();

    await expect(status(page)).toContainText(RECEIVED);
    expect(posts, 'only one send left the browser').toHaveLength(1);
    expect(await savedFor(request, name)).toBe(1);
    await expect(page.locator('#send')).toBeDisabled();
  });

  test('a fast double-click on Send sends once', async ({ page, request }) => {
    const posts = recordReferralPosts(page);
    const name = unique('DoubleClick');
    await directDetails(page, name);
    await page.locator('#send').dblclick();
    await expect(status(page)).toContainText(RECEIVED);
    expect(posts).toHaveLength(1);
    expect(await savedFor(request, name)).toBe(1);
  });
});

test.describe('interrupted sends recover without duplicates (Handoff PRD 20)', () => {
  test('saved, but the answer was lost: "already received", never a second referral', async ({ page, request }) => {
    const posts = recordReferralPosts(page);
    const name = unique('LostAnswer');
    await directDetails(page, name);
    await page.route('**/api/referrals', async (route) => {
      if (!isReferralPost(route.request())) return route.continue();
      await route.fetch();                       // the server saves it...
      return route.abort('connectionreset');     // ...but the browser never hears back
    });

    await page.locator('#send').click();
    await expect(status(page)).toContainText(ALREADY);
    await expect(page.locator('#send')).toBeDisabled();
    expect(posts).toHaveLength(1);
    expect(await savedFor(request, name)).toBe(1);
  });

  for (const [label, fault] of [
    ['the send never reached the server', (route) => route.abort('internetdisconnected')],
    ['the server failed before saving (503)', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"code":"SERVICE_UNAVAILABLE"}' })],
  ]) {
    test(`${label}: "not received", work kept, resend with the same Submission ID saves one`, async ({ page, request }) => {
      const posts = recordReferralPosts(page);
      const name = unique('Resend');
      await directDetails(page, name);
      let failed = false;
      await page.route('**/api/referrals', async (route) => {
        if (!isReferralPost(route.request()) || failed) return route.continue();
        failed = true;
        return fault(route);
      });

      await page.locator('#send').click();
      // The page checked with the server and learned nothing was saved.
      await expect(status(page)).toHaveText(NOT_RECEIVED);
      expect(await savedFor(request, name)).toBe(0);
      // The work is all still there, and Send is offered again.
      await expect(page.locator('#participantName')).toHaveValue(name);
      await expect(page.locator('#referralContext')).toHaveValue('Synthetic need for the double-submit test');
      await expect(page.locator('input[name="contactMethod"][value="NOT_AVAILABLE"]')).toBeChecked();
      await expect(page.locator('#send')).toBeEnabled();

      await page.locator('#send').click();
      await expect(status(page)).toContainText(RECEIVED);
      expect(posts).toHaveLength(2);
      expect(posts[1].submissionId, 'the resend is the same logical submission').toBe(posts[0].submissionId);
      expect(await savedFor(request, name)).toBe(1);
    });
  }

  test('when even the check cannot reach the server, nothing is resent until it can', async ({ page, request }) => {
    const posts = recordReferralPosts(page);
    const name = unique('CheckDown');
    await directDetails(page, name);
    await page.route('**/api/referrals', async (route) => {
      if (!isReferralPost(route.request())) return route.continue();
      await route.fetch();
      return route.abort('connectionreset');
    });
    await page.route('**/api/referrals/submissions/**', (route) => route.abort('internetdisconnected'));

    await page.locator('#send').click();
    await expect(status(page)).toContainText(NOT_CONFIRMED);
    await expect(page.locator('#check-again')).toBeVisible();
    await expect(page.locator('#send')).toBeDisabled();
    await expect(page.locator('#participantName')).toHaveValue(name);

    // The connection comes back; checking again finds the saved referral.
    await page.unroute('**/api/referrals/submissions/**');
    await page.locator('#check-again').click();
    await expect(status(page)).toContainText(ALREADY);
    expect(posts).toHaveLength(1);
    expect(await savedFor(request, name)).toBe(1);
  });
});

test('a new referral after a successful one gets its own Submission ID and is saved too', async ({ page, request }) => {
  const posts = recordReferralPosts(page);
  const first = unique('First');
  const second = unique('Second');
  await directDetails(page, first);
  await page.locator('#send').click();
  await expect(status(page)).toContainText(RECEIVED);

  await page.locator('#start-new').click();
  await chooseDirect(page);
  await page.locator(`#program-options input[value="${HOUSING_ID}"]`).check();
  await page.locator('#program-continue').click();
  await page.locator('#participantName').fill(second);
  await page.locator('input[name="contactMethod"][value="NOT_AVAILABLE"]').check();
  await page.locator('#referralContext').fill('Synthetic need for the double-submit test');
  await page.locator('#send').click();
  await expect(status(page)).toContainText(RECEIVED);

  expect(posts).toHaveLength(2);
  expect(posts[1].submissionId).not.toBe(posts[0].submissionId);
  expect([await savedFor(request, first), await savedFor(request, second)]).toEqual([1, 1]);
});
