// Trello Task 226: Referral Confirmation (Current Handoff Written Wireframe
// Page 11; Handoff PRD §20, §21).
//
// After a successful Direct Referral send, the page shows, from the
// server's confirmation and the Program names it already has:
//   Referral ID, Receiving Program, Referring Program, the time it was sent
//   (Eastern time, as on the other referral pages since Task 208), the
//   notification note, a View referral link to /sent/referral.html?id=N and
//   a link to Referrals I sent.
// The locked status text, and the "not confirmed", "already received" and
// safe-resend behavior, are covered unchanged in e2e/doubleSubmit.spec.js.
// SYNTHETIC data only.

import { test, expect } from '@playwright/test';
import { chooseDirect, ensureAffiliation } from './helpers.js';

const RUN = Date.now().toString(36);
let n = 0;
const RECEIVING = 'Housing Help Desk (sample)';
const REFERRING = 'Early Childhood Playgroup (sample)'; // sample Program 1, the developer's affiliation
const NOTE = 'QCH Connect notifies the receiving Program that a new referral is waiting. '
  + 'If that notification cannot be sent, your referral is still saved, and the notification can be retried.';

const status = (page) => page.locator('#status .status__text');
const confirmation = (page) => page.getByRole('region', { name: 'Referral confirmation' });
const row = (page, term) => confirmation(page).locator('dl > div')
  .filter({ has: page.locator('dt', { hasText: new RegExp(`^${term}$`) }) }).locator('dd');
const eastern = (iso) => new Date(iso).toLocaleString('en-US', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York',
});

async function sendDirect(page) {
  await page.goto('/referral/');
  await ensureAffiliation(page, 1);
  await page.reload();
  await chooseDirect(page);
  await page.locator('#program-options label', { hasText: 'Housing Help Desk' }).locator('input').check();
  await page.locator('#program-continue').click();
  n += 1;
  const name = `Synthetic Confirmation ${RUN}-${n}`;
  await page.locator('#participantName').fill(name);
  await page.locator('#contactMethod-options input[value="NOT_AVAILABLE"]').check();
  await page.locator('#referralContext').fill('Synthetic need for Task 226');
  await expect(confirmation(page)).toBeHidden();

  const created = page.waitForResponse((r) => r.request().method() === 'POST'
    && new URL(r.url()).pathname === '/api/referrals');
  await page.locator('#send').click();
  const response = await created;
  expect(response.status()).toBe(201);
  const { status: outcome, referral } = await response.json();
  expect(outcome).toBe('RECEIVED');
  return { referral, name };
}

test.describe('Referral confirmation after a successful send (Task 226)', () => {
  test('shows the Referral ID, both Programs, when it was sent, the notification note and the two links', async ({ page }) => {
    const { referral, name } = await sendDirect(page);
    const id = referral.referralId;

    // The locked success message is unchanged.
    await expect(status(page)).toHaveText(`Referral received ! Referral ID: ${id}.`);

    const panel = confirmation(page);
    await expect(panel).toBeVisible();
    await expect(row(page, 'Referral ID')).toHaveText(String(id));
    await expect(row(page, 'Receiving Program')).toHaveText(RECEIVING);
    await expect(row(page, 'Referring Program')).toHaveText(REFERRING);
    await expect(row(page, 'Sent')).toHaveText(eastern(referral.createdAt));
    await expect(panel).toContainText(NOTE);
    await expect(panel.getByRole('link', { name: 'View referral' })).toHaveAttribute('href', `/sent/referral.html?id=${id}`);
    await expect(panel.getByRole('link', { name: 'Referrals I sent' })).toHaveAttribute('href', '/sent/');

    // No participant information in the confirmation.
    await expect(panel).not.toContainText(name);
    await expect(panel).not.toContainText('Synthetic need for Task 226');

    // View referral opens this referral.
    await panel.getByRole('link', { name: 'View referral' }).click();
    await expect(page).toHaveURL(new RegExp(`/sent/referral\\.html\\?id=${id}$`));
    await expect(status(page)).toHaveText('Referral loaded.');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(`Referral ${id}`);
    await expect(page.locator('#info-list')).toContainText(name);
    await expect(page.locator('#info-list')).toContainText(RECEIVING);

    // A fresh New Referral page shows no confirmation until the next send.
    await page.goto('/referral/');
    await expect(confirmation(page)).toBeHidden();
  });

  test('Referrals I sent link opens the list with the new referral; Start a new referral hides the confirmation', async ({ page }) => {
    await sendDirect(page);
    await expect(confirmation(page)).toBeVisible();

    await page.locator('#start-new').click();
    await expect(confirmation(page)).toBeHidden();

    const again = await sendDirect(page);
    await confirmation(page).getByRole('link', { name: 'Referrals I sent' }).click();
    await expect(page).toHaveURL(/\/sent\/$/);
    await expect(status(page)).toHaveText('Your referrals loaded.');
    await expect(page.locator('.queue-item').filter({ hasText: again.name })).toHaveCount(1);
  });
});
