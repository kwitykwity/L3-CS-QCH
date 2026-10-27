// Trello Task L: Referrals I sent, and each referral's status, for the
// person who created it (Final Technical PRD 2.3, 3.3, 3.4, 3.6, 3.7, 5.5,
// 6.1, 6.2, 6.5, 10.5, 14).
//
// The synthetic dev server's one developer sends from sample Program 1 and
// receives for sample Program 4 only. So a referral to Job Readiness
// Workshop (Program 5) is one this person sent but cannot act on, and a
// referral to Housing Help Desk (Program 4) lets the test play the
// receiving Program through the API. SYNTHETIC data only.

import { test, expect } from '@playwright/test';
import { chooseDirect, ensureAffiliation, expectNoAxeViolations, focused } from './helpers.js';

const RUN = Date.now().toString(36);
const JOBS = 5;      // Job Readiness Workshop (sample): not received by the developer
const HOUSING = 4;   // Housing Help Desk (sample): received by the developer
const CONTACT = '(555) 010-0144';
let n = 0;

const status = (page) => page.locator('#status .status__text');

async function sendByApi(page, request, receivingProgramId, extra = {}) {
  await page.goto('/sent/');
  await ensureAffiliation(page, 1);
  n += 1;
  const name = `Synthetic Sender ${RUN}-${n}`;
  const response = await request.post('/api/referrals', {
    data: {
      submissionId: crypto.randomUUID(), receivingProgramId, participantName: name,
      contactMethod: 'PHONE_CALL', contactValue: CONTACT, referralContext: `Synthetic need ${RUN}-${n}`,
      notes: `Synthetic note ${RUN}-${n}`, ...extra,
    },
  });
  expect(response.status()).toBe(201);
  return { id: (await response.json()).referral.referralId, name };
}

async function openFromList(page, name) {
  await page.goto('/sent/');
  await expect(status(page)).toHaveText(/Your referrals loaded\.|not sent any/);
  const item = page.locator('.queue-item').filter({ hasText: name });
  await expect(item).toHaveCount(1);
  await item.getByRole('link').focus();
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText('Referral loaded.');
}

test.describe('Referrals I sent', () => {
  test('a referral sent from the New Referral page shows as awaiting response, read-only, with no contact details in the list', async ({ page }) => {
    await page.goto('/referral/');
    await ensureAffiliation(page, 1);
    await page.reload();
    await chooseDirect(page);
    await page.locator('#program-options label', { hasText: 'Job Readiness Workshop' }).locator('input').check();
    await page.locator('#program-continue').click();
    n += 1;
    const name = `Synthetic Sender ${RUN}-${n}`;
    await page.locator('#participantName').fill(name);
    await page.locator('#contactMethod-options input[value="PHONE_CALL"]').check();
    await page.locator('#contactValue').fill(CONTACT);
    await page.locator('#referralContext').fill('Synthetic need for Task L');
    await page.locator('#send').click();
    await expect(status(page)).toContainText('Referral received');

    // Find it later from the home page.
    await page.goto('/');
    await page.getByRole('link', { name: 'Referrals I sent' }).click();
    await expect(page).toHaveURL(/\/sent\/$/);
    await expect(status(page)).toHaveText('Your referrals loaded.');
    const item = page.locator('.queue-item').filter({ hasText: name });
    await expect(item).toHaveCount(1);
    await expect(item.locator('.awaiting')).toHaveText(/^Awaiting response from Job Readiness Workshop \(sample\)\./);
    await expect(item.locator('dd')).toHaveText(['Awaiting response', 'No decision yet', 'Not recorded (no decision yet)']);
    await expect(page.locator('#referral-list')).not.toContainText(CONTACT);

    // Open it by keyboard: read-only, no receiving actions, nothing about the participant in the URL.
    await item.getByRole('link').focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/sent\/referral\.html\?id=\d+$/);
    await expect(status(page)).toHaveText('Referral loaded.');
    await expect(page.locator('#awaiting-note')).toBeVisible();
    await expect(page.locator('#decision-value')).toHaveText('No decision yet');
    await expect(page.locator('#outcome-value')).toHaveText('Not recorded (no decision yet)');
    await expect(page.locator('#info-list')).toContainText('Job Readiness Workshop (sample)');
    await expect(page.locator('#info-list')).toContainText('Direct Referral');
    await expect(page.locator('form, input, select, textarea')).toHaveCount(0);
    await expect(page.locator('main button')).toHaveText(['Reload this referral']);
    await expect(page.locator('#receiver-link'), 'not a receiver for Program 5').toBeHidden();
  });

  test('after the receiving Program accepts and records the outcome, the sender sees each step', async ({ page, request }) => {
    const { id, name } = await sendByApi(page, request, HOUSING);
    await openFromList(page, name);
    await expect(page.locator('#awaiting-note')).toBeVisible();

    // The receiving Program acts (this developer also receives for Program 4).
    expect((await request.post(`/api/referrals/${id}/response`, { data: { decision: 'ACCEPTED' } })).ok()).toBeTruthy();
    await page.locator('#reload').click();
    await expect(status(page)).toHaveText('Referral reloaded.');
    await expect(page.locator('#awaiting-note')).toBeHidden();
    await expect(page.locator('#response-value')).toContainText('Responded');
    await expect(page.locator('#decision-value')).toHaveText('Accepted');
    await expect(page.locator('#outcome-value')).toHaveText('Not recorded');
    await expect(page.locator('#outcome-note')).toContainText('Accepted is not the same as served.');

    expect((await request.post(`/api/referrals/${id}/outcome`, { data: { outcome: 'RESULTED_IN_SERVICE' } })).ok()).toBeTruthy();
    await page.locator('#reload').click();
    await expect(page.locator('#outcome-value')).toContainText('Resulted in service (recorded');
    await expect(page.locator('#outcome-note')).toBeHidden();

    // This person also receives for Program 4, so the page links there; it has no actions itself.
    await expect(page.locator('#receiver-href')).toHaveAttribute('href', `/receiving/referral.html?id=${id}`);
    await expect(page.locator('form, input, select, textarea')).toHaveCount(0);

    // The list shows it under Complete, not Awaiting response.
    await page.goto('/sent/');
    await expect(status(page)).toHaveText('Your referrals loaded.');
    await page.locator('#stage-filter').selectOption('AWAITING_RESPONSE');
    await page.locator('#show').click();
    await expect(page.locator('#results-heading')).toBeFocused();
    await expect(page.locator('.queue-item').filter({ hasText: name })).toHaveCount(0);
    await page.locator('#stage-filter').selectOption('COMPLETE');
    await page.locator('#show').click();
    const item = page.locator('.queue-item').filter({ hasText: name });
    await expect(item.locator('dd')).toHaveText(['Responded', 'Accepted', 'Resulted in service']);
  });

  test('Not appropriate: the sender sees the reason and explanation, no outcome, and no automatic rerouting', async ({ page, request }) => {
    const { id, name } = await sendByApi(page, request, HOUSING);
    const reasons = (await (await request.get('/api/referrals/not-appropriate-reasons')).json()).reasons;
    const explanation = `Synthetic explanation ${RUN}`;
    expect((await request.post(`/api/referrals/${id}/response`, {
      data: { decision: 'NOT_APPROPRIATE', reasonId: reasons[0].reasonId, explanation },
    })).ok()).toBeTruthy();

    await page.goto('/sent/');
    await expect(status(page)).toHaveText('Your referrals loaded.');
    const item = page.locator('.queue-item').filter({ hasText: name });
    await expect(item.locator('dd').nth(1)).toHaveText(`Not appropriate: ${reasons[0].label}`);
    await expect(page.locator('#referral-list'), 'the list never shows the explanation').not.toContainText(explanation);

    await openFromList(page, name);
    await expect(page.locator('#decision-value')).toHaveText('Not appropriate');
    await expect(page.locator('#reason-value')).toHaveText(`Reason: ${reasons[0].label}`);
    await expect(page.locator('#explanation-value')).toHaveText(`Explanation: ${explanation}`);
    await expect(page.locator('#outcome-value')).toHaveText('Not applicable (the decision is Not appropriate)');
    await expect(page.locator('#outcome-note')).toContainText('It is not sent anywhere else automatically.');
    await expect(page.locator('#info-list')).toContainText('Housing Help Desk (sample)');
  });

  // Review on #49: losing access after a good load must not leave the
  // earlier referral on screen. The refresh is answered with 401 or 403
  // (page.route), the way an expired sign-in or a deactivated account
  // would answer it.
  for (const [code, message] of [
    [401, 'Sign in again to see this referral.'],
    [403, 'You do not have access to this referral right now. Ask an administrator if you think this is wrong.'],
  ]) {
    test(`status page: a ${code} on reload removes the participant, the steps and the receiving link`, async ({ page, request }) => {
      const sent = await sendByApi(page, request, HOUSING);
      await page.goto(`/sent/referral.html?id=${sent.id}`);
      await expect(status(page)).toHaveText('Referral loaded.');
      await expect(page.locator('#referral-heading')).toContainText(sent.name);
      await expect(page.locator('#receiver-link')).toBeVisible();

      await page.route(`**/api/referrals/${sent.id}`, (route) => route.fulfill({ status: code, json: { code: code === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN' } }));
      await page.getByRole('button', { name: 'Reload this referral' }).click();

      await expect(status(page)).toHaveText(message);
      await expect(page.locator('#status')).toBeFocused();
      await expect(page.locator('#referral-heading')).toHaveText('Referral status');
      await expect(page).toHaveTitle('Referral status · QCH Connect');
      for (const text of [sent.name, CONTACT, 'Synthetic need', 'Synthetic note']) {
        await expect(page.locator('main')).not.toContainText(text);
      }
      for (const id of ['progress', 'info', 'receiver-link']) await expect(page.locator(`#${id}`)).toBeHidden();
      await expect(page.locator('#info-list > *')).toHaveCount(0);
      await expect(page.locator('a[href*="/receiving/referral.html"]')).toHaveCount(0);

      // Access comes back: Reload shows the referral again.
      await page.unroute(`**/api/referrals/${sent.id}`);
      await page.getByRole('button', { name: 'Reload this referral' }).click();
      await expect(status(page)).toHaveText('Referral reloaded.');
      await expect(page.locator('#referral-heading')).toContainText(sent.name);
      await expect(page.locator('#receiver-link')).toBeVisible();
    });

    test(`list: a ${code} on refresh removes every earlier referral row`, async ({ page, request }) => {
      const sent = await sendByApi(page, request, HOUSING);
      await page.goto('/sent/');
      await expect(status(page)).toHaveText(/Your referrals loaded\./);
      await expect(page.locator('.queue-item').filter({ hasText: sent.name })).toHaveCount(1);

      const sentList = /\/api\/referrals\/sent(\?|$)/;
      await page.route(sentList, (route) => route.fulfill({ status: code, json: { code: code === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN' } }));
      await page.getByRole('button', { name: 'Show referrals' }).click();

      await expect(status(page)).toHaveText(code === 401
        ? 'Sign in again to see the referrals you sent.'
        : 'Your account cannot see referrals right now. Ask an administrator.');
      await expect(page.locator('#status')).toBeFocused();
      await expect(page.locator('.queue-item')).toHaveCount(0);
      await expect(page.locator('main')).not.toContainText(sent.name);
      await expect(page.locator('#results')).toBeHidden();
      await expect(page.locator('#filters')).toBeHidden();
      await expect(page.locator('#load-more')).toBeHidden();
      await expect(page.locator('a[href*="referral.html"]')).toHaveCount(0);

      // Access comes back: "Try loading again" brings the list back.
      await page.unroute(sentList);
      await page.getByRole('button', { name: 'Try loading again' }).click();
      await expect(status(page)).toHaveText(/Your referrals loaded\./);
      await expect(page.locator('.queue-item').filter({ hasText: sent.name })).toHaveCount(1);
    });
  }

  test('an unknown or malformed ID reveals nothing', async ({ page }) => {
    for (const id of ['987654', 'abc', '0', '-1']) {
      await page.goto(`/sent/referral.html?id=${id}`);
      await expect(status(page)).toHaveText('This referral is not available. It may not exist, or you may not have access to it.');
      await expect(page.locator('#progress')).toBeHidden();
      await expect(page.locator('#info')).toBeHidden();
    }
  });
});

test.describe('Referrals I sent: accessibility', () => {
  test('list and status pages pass axe in both themes, and keyboard focus is visible', async ({ page, request }) => {
    const { name } = await sendByApi(page, request, HOUSING);
    await page.goto('/sent/');
    await expect(status(page)).toHaveText('Your referrals loaded.');
    await page.keyboard.press('Tab');
    expect(await focused(page)).not.toBeNull();
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme });
      await expectNoAxeViolations(page, `sent list, ${colorScheme}`);
    }
    await openFromList(page, name);
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme });
      await expectNoAxeViolations(page, `sent status, ${colorScheme}`);
    }
    await page.locator('#reload').focus();
    expect(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle)).not.toBe('none');
  });

  for (const [label, path] of [['list', '/sent/'], ['status', null]]) {
    test(`XL text at phone width does not scroll sideways (${label})`, async ({ page, request }) => {
      const { id } = await sendByApi(page, request, HOUSING);
      await page.goto(path ?? `/sent/referral.html?id=${id}`);
      await expect(status(page)).toHaveText(/loaded\./);
      await page.locator('[data-size="XL"]').click();
      await page.setViewportSize({ width: 390, height: 844 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await page.locator('[data-size="M"]').click();
    });
  }
});
