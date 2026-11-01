// Trello Task 223: "No reliable contact" on the referral detail pages.
// Verification coverage only; the behavior was already confirmed by hand.
//
// A Direct Referral sent with the contact method "No reliable contact"
// (NOT_AVAILABLE) is opened on both detail pages:
//   /sent/referral.html?id=N       (the person who sent it)
//   /receiving/referral.html?id=N  (the receiving Program)
// On each, the "How to reach them" row reads exactly "No reliable contact",
// no phone number or email address is shown, and the valid no-contact
// state is not treated as an error.
//
// The synthetic dev server's developer sends from sample Program 1 and
// receives for Housing Help Desk (sample Program 4), so one person can
// open both pages. SYNTHETIC data only. Tests only.

import { test, expect } from '@playwright/test';
import { chooseDirect, ensureAffiliation } from './helpers.js';

const RUN = Date.now().toString(36);
const NO_CONTACT = 'No reliable contact';
// Typed first and then abandoned for "No reliable contact": it must not
// show up anywhere afterwards.
const ABANDONED_PHONE = '(555) 013-0223';
const PHONE_OR_EMAIL = /@|\d{3}\D{0,2}\d{3}\D?\d{4}|\bPhone\b|\bEmail\b/i;

const status = (page) => page.locator('#status .status__text');

// The value next to a term in the referral's information list.
const infoValue = (page, term) => page.locator('#info-list > div')
  .filter({ has: page.locator('dt', { hasText: new RegExp(`^${term}$`) }) })
  .locator('dd');

function watchForErrors(page) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    // The browser asks for /favicon.ico on its own; the app has none. Not
    // part of the referral, so not counted.
    if (new URL(msg.location().url || 'about:blank').pathname === '/favicon.ico') return;
    errors.push(`console: ${msg.text()} @ ${msg.location().url}`);
  });
  return errors;
}

async function sendWithNoContact(page) {
  await page.goto('/referral/');
  await ensureAffiliation(page, 1);
  await page.reload();
  await chooseDirect(page);
  await page.locator('#program-options label', { hasText: 'Housing Help Desk' }).locator('input').check();
  await page.locator('#program-continue').click();
  await expect(page.locator('#step-details')).toBeVisible();

  const name = `Synthetic No Contact ${RUN}`;
  await page.locator('#participantName').fill(name);
  // A worker starts with a phone number, then learns there is no reliable contact.
  await page.locator('#contactMethod-options input[value="PHONE_CALL"]').check();
  await page.locator('#contactValue').fill(ABANDONED_PHONE);
  await page.locator('#contactMethod-options label', { hasText: NO_CONTACT }).locator('input').check();
  await expect(page.locator('#contactValue-field')).toBeHidden();
  await page.locator('#referralContext').fill('Synthetic need for Task 223');

  const created = page.waitForResponse((r) => r.request().method() === 'POST'
    && new URL(r.url()).pathname === '/api/referrals');
  await page.locator('#send').click();
  const response = await created;
  expect(response.status()).toBe(201);
  // What the page sent: no reliable contact, and not the abandoned number.
  const sent = response.request().postDataJSON();
  expect(sent.contactMethod).toBe('NOT_AVAILABLE');
  expect(JSON.stringify(sent)).not.toContain(ABANDONED_PHONE);
  const { referral } = await response.json();
  await expect(status(page)).toContainText(`Referral received ! Referral ID: ${referral.referralId}.`);
  return { id: referral.referralId, name };
}

async function expectNoContactShown(page, name) {
  await expect(status(page)).toHaveText('Referral loaded.');
  await expect(page.locator('#info-list')).toContainText(name);

  // 4. The row reads exactly "No reliable contact".
  await expect(infoValue(page, 'How to reach them')).toHaveText(NO_CONTACT);

  // 5. No phone number or email address anywhere in the referral's information.
  const info = await page.locator('#info-list').innerText();
  expect(info).not.toContain(ABANDONED_PHONE);
  expect(info.replace(name, '')).not.toMatch(PHONE_OR_EMAIL);
  await expect(page.locator('main')).not.toContainText(ABANDONED_PHONE);

  // 6. A valid state, not an error.
  await expect(page.locator('#status')).toHaveClass(/status--info/);
  await expect(page.locator('.status--error')).toHaveCount(0);
  await expect(page.locator('.field__error:visible')).toHaveCount(0);
  await expect(page.locator('#info')).toBeVisible();
}

test.describe('"No reliable contact" on the referral detail pages (Task 223)', () => {
  test('a Direct Referral with no reliable contact reads "No reliable contact" on both detail pages, with no phone or email and no error', async ({ page }) => {
    const errors = watchForErrors(page);
    const { id, name } = await sendWithNoContact(page);

    // 2. The sender's view.
    await page.goto(`/sent/referral.html?id=${id}`);
    await expectNoContactShown(page, name);

    // 3. The receiving Program's view.
    await page.goto(`/receiving/referral.html?id=${id}`);
    await expectNoContactShown(page, name);

    expect(errors).toEqual([]);
  });
});
