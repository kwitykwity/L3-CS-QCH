// Trello Task 251: Send referral (wireframe 3) and Direct Referral (1b).
// On a wide screen "What happens next" sits beside the form; on a phone at
// XL it drops below and nothing scrolls sideways. The chosen Direct
// Referral Program is highlighted and bold. SYNTHETIC data only.

import { test, expect } from '@playwright/test';

async function openDetails(page) {
  await page.locator('#path-direct').click();
  const first = page.locator('#program-options input').first();
  await expect(first).toBeVisible();
  await first.check();
  await expect(page.locator('#program-options li').first()).toHaveCSS('font-weight', /^(400|normal)$/);
  await expect(page.locator('#program-options li label').first()).toHaveCSS('font-weight', '600');
  await page.locator('#program-continue').click();
  await expect(page.locator('#step-details')).toBeVisible();
}

const box = (page, sel) => page.locator(sel).evaluate((el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });

test.describe('Send referral layout (Task 251)', () => {
  test('wide screen: What happens next sits to the right of the form', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/referral/');
    await openDetails(page);
    const form = await box(page, '#referral-form');
    const aside = await box(page, '.side-note');
    expect(aside.left).toBeGreaterThan(form.right);
    await expect(page.getByRole('complementary', { name: 'What happens next' })).toBeVisible();
  });

  test('phone at XL: it drops below the form and nothing scrolls sideways', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/referral/');
    await page.locator('[data-size="XL"]').click();
    await openDetails(page);
    const form = await box(page, '#referral-form');
    const aside = await box(page, '.side-note');
    expect(aside.top).toBeGreaterThanOrEqual(form.bottom);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
});
