// Trello Task 250: Programs that may fit, in the wireframe 2 layout.
// On a wide screen each Choose button sits to the right of its Program's
// details; on a phone at XL it drops below them and nothing scrolls
// sideways. Every result looks the same: results are not ranked.
// SYNTHETIC data only.

import { test, expect } from '@playwright/test';

async function showResults(page) {
  await page.goto('/referral/');
  await page.locator('#path-guided').click();
  const needs = page.locator('#needs-options input[name="need"]');
  await expect(needs.first()).toBeVisible();
  for (const box of await needs.all()) await box.check();
  await page.locator('#find-programs').click();
  await expect(page.locator('#match-results')).toBeVisible();
  await expect(page.locator('li.match').first()).toBeVisible();
}

const layout = (page) => page.locator('li.match').evaluateAll((items) => items.map((li) => {
  const name = li.querySelector('.match__name').getBoundingClientRect();
  const button = li.querySelector(':scope > button').getBoundingClientRect();
  const info = li.querySelector('.match__info').getBoundingClientRect();
  return { besideName: button.left > name.right, below: button.top >= info.bottom - 1, buttonClass: li.querySelector(':scope > button').className };
}));

test.describe('Program results layout (Task 250)', () => {
  test('wide screen: every Choose button is on the right of the details, and all look the same', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await showResults(page);
    const items = await layout(page);
    expect(items.length).toBeGreaterThan(1);
    expect(items.every((i) => i.besideName && !i.below)).toBe(true);
    expect(new Set(items.map((i) => i.buttonClass))).toEqual(new Set(['btn btn--secondary']));
  });

  test('phone at XL: the button drops below the details and nothing scrolls sideways', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/referral/');
    await page.locator('[data-size="XL"]').click();
    await showResults(page);
    const items = await layout(page);
    expect(items.every((i) => i.below)).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
});
