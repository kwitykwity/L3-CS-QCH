// Trello Task RR: main navigation on New Referral.
//
// New Referral (/referral/) had no main navigation, so a Referring Worker
// landing there (for example after demo sign-in or Switch person) had no
// link to Referrals I sent (found in Task V and the Task R rehearsal). It
// now has the same accessible navigation as the other workflow pages.
// SYNTHETIC data only.

import { test, expect } from '@playwright/test';

const NAV = [
  { name: 'New referral', href: '/referral/' },
  { name: 'Referrals I sent', href: '/sent/' },
  { name: 'Received referrals', href: '/receiving/' },
  { name: 'Help', href: '/help/' },  // Task 225
];

const mainNav = (page) => page.getByRole('navigation', { name: 'Main navigation' });

test.describe('New Referral main navigation (Task RR)', () => {
  test('has the same links as the other workflow pages, with New referral marked as the current page', async ({ page }) => {
    await page.goto('/referral/');
    const links = mainNav(page).getByRole('link');
    await expect(links).toHaveCount(NAV.length);
    for (const [i, { name, href }] of NAV.entries()) {
      await expect(links.nth(i)).toHaveText(name);
      await expect(links.nth(i)).toHaveAttribute('href', href);
    }
    await expect(mainNav(page).getByRole('link', { name: 'New referral' })).toHaveAttribute('aria-current', 'page');

    // Same links, in the same order, as Referrals I sent.
    const here = await links.evaluateAll((as) => as.map((a) => [a.textContent.trim(), a.getAttribute('href')]));
    await page.goto('/sent/');
    const there = await mainNav(page).getByRole('link').evaluateAll((as) => as.map((a) => [a.textContent.trim(), a.getAttribute('href')]));
    expect(here).toEqual(there);
  });

  test('Referrals I sent can be reached from /referral/ by clicking the link', async ({ page }) => {
    await page.goto('/referral/');
    await mainNav(page).getByRole('link', { name: 'Referrals I sent' }).click();
    await expect(page).toHaveURL(/\/sent\/$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Referrals I sent' })).toBeVisible();
  });

  test('Referrals I sent can be reached from /referral/ with the keyboard only', async ({ page, browserName }) => {
    await page.goto('/referral/');
    const target = mainNav(page).getByRole('link', { name: 'Referrals I sent' });
    // Tab from the top of the page until the link has focus. Safari (WebKit)
    // skips links on plain Tab by default; Option+Tab reaches them there.
    const key = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
    for (let i = 0; i < 6 && !(await target.evaluate((el) => el === document.activeElement)); i += 1) {
      await page.keyboard.press(key);
    }
    await expect(target).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/sent\/$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Referrals I sent' })).toBeVisible();
  });
});
