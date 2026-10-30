// Trello Task EE: Direct Referral recovery in a real browser (Final
// Technical PRD 7.2 to 7.5, 13.3). The guided path's recovery is in
// e2e/gpme.spec.js; until now Direct Referral's was only checked in the
// submission logic unit test (test/referralUi.test.js).
//
// Each failure is forced by intercepting only the POST /api/referrals
// request, so the safe status check (GET /api/referrals/submissions/:id)
// and the resend go through the real synthetic backend.
// SYNTHETIC data only.

import { test, expect } from '@playwright/test';
import { chooseDirect, ensureAffiliation } from './helpers.js';

const status = (page) => page.locator('#status .status__text');

function recordReferralPosts(page) {
  const posts = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/referrals')) posts.push(request.postDataJSON());
  });
  return posts;
}

// Direct Referral to the Housing Help Desk with the given name filled in.
async function directReferral(page, name) {
  await page.goto('/referral/');
  await ensureAffiliation(page);
  await page.reload();
  await chooseDirect(page);
  await page.locator('#program-search').fill('Housing');
  await page.locator('input[name="receivingProgram"]').first().check();
  await page.locator('#program-continue').click();
  await expect(page.locator('#step-details')).toBeVisible();
  await page.locator('#participantName').fill(name);
  await page.locator('input[name="contactMethod"][value="NOT_AVAILABLE"]').check();
  await page.locator('#referralContext').fill(`Synthetic need for ${name}`);
}

// How many referrals the server holds for this name, from the sender's list.
async function savedCount(page, name) {
  const res = await page.request.get('/api/referrals/sent');
  expect(res.status()).toBe(200);
  return (await res.json()).referrals.filter((r) => r.participantName === name).length;
}

test.describe('Direct Referral: failures never lose work or send twice (PRD 7.2 to 7.5)', () => {
  test('the request never reached the server: not confirmed, then "not received", work kept, one resend saves it once', async ({ page }) => {
    const name = 'Synthetic Person Network Drop';
    const posts = recordReferralPosts(page);
    await directReferral(page, name);

    let drop = true;
    await page.route('**/api/referrals', async (route) => {
      if (route.request().method() === 'POST' && drop) {
        drop = false;
        await route.abort('connectionreset');
        return;
      }
      await route.continue();
    });
    await page.locator('#send').click();

    // Never a false success: the safe check finds nothing, so the page says
    // so and keeps everything the worker typed.
    await expect(status(page)).toContainText('Referral was not received. Your information has been preserved. You may safely resend !');
    await expect(status(page)).not.toContainText('Referral received !');
    expect(await page.locator('#participantName').inputValue()).toBe(name);
    expect(await page.locator('#referralContext').inputValue()).toBe(`Synthetic need for ${name}`);
    await expect(page.locator('#send')).toBeEnabled();
    expect(await savedCount(page, name)).toBe(0);

    await page.locator('#send').click();
    await expect(status(page)).toContainText('Referral received !');
    expect(posts).toHaveLength(2);
    expect(posts[1].submissionId).toBe(posts[0].submissionId, 'the resend is the same logical referral');
    expect(await savedCount(page, name)).toBe(1);
  });

  test('a server error is not success: work kept, and the resend saves it exactly once', async ({ page }) => {
    const name = 'Synthetic Person Server Error';
    const posts = recordReferralPosts(page);
    await directReferral(page, name);

    let fail = true;
    await page.route('**/api/referrals', async (route) => {
      if (route.request().method() === 'POST' && fail) {
        fail = false;
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Internal Server Error' }) });
        return;
      }
      await route.continue();
    });
    await page.locator('#send').click();

    await expect(status(page)).toContainText('Your information has been preserved');
    await expect(status(page)).not.toContainText('Referral received !');
    expect(await page.locator('#participantName').inputValue()).toBe(name);
    expect(await savedCount(page, name)).toBe(0);

    await page.locator('#send').click();
    await expect(status(page)).toContainText('Referral received !');
    expect(posts.at(-1).submissionId).toBe(posts[0].submissionId);
    expect(await savedCount(page, name)).toBe(1);
  });

  test('saved but the answer was lost: "already received", the form locks, nothing is sent twice', async ({ page }) => {
    const name = 'Synthetic Person Lost Answer';
    const posts = recordReferralPosts(page);
    await directReferral(page, name);

    // The server commits the referral, but the answer never reaches the browser.
    await page.route('**/api/referrals', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fetch();
        await route.abort('connectionreset');
        return;
      }
      await route.continue();
    });
    await page.locator('#send').click();

    await expect(status(page)).toContainText('Referral already received. Do not resend !');
    await expect(page.locator('#send')).toBeDisabled();
    expect(posts).toHaveLength(1);
    expect(await savedCount(page, name)).toBe(1);
  });

  test('nothing about the participant goes into the address bar or browser storage during recovery', async ({ page }) => {
    const name = 'Synthetic Person Storage Check';
    await directReferral(page, name);
    let drop = true;
    await page.route('**/api/referrals', async (route) => {
      if (route.request().method() === 'POST' && drop) {
        drop = false;
        await route.abort('connectionreset');
        return;
      }
      await route.continue();
    });
    await page.locator('#send').click();
    await expect(status(page)).toContainText('You may safely resend !');
    expect(page.url()).not.toContain('Synthetic');
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(stored).not.toContain(name);
    expect(stored).not.toContain('Synthetic need');
  });
});
