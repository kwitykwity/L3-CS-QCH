// Trello Task 254: Reporting Center in the wireframe 8 layout.
// The period buttons are real radio buttons: a click or the arrow keys
// change the period, and the report shows the period the server used.
// Number cards keep one width, so a short row does not stretch. At XL on
// a phone nothing scrolls sideways. SYNTHETIC data only.

import { test, expect } from '@playwright/test';

async function open(page) {
  await page.goto('/reporting/');
  await expect(page.locator('#status')).toHaveText(/^Report loaded for /);
}

const radio = (page, name) => page.getByRole('radio', { name, exact: true });

test.describe('Reporting Center layout (Task 254)', () => {
  test('a period button sends that period, and the arrow keys move between them', async ({ page }) => {
    await open(page);
    await expect(page.locator('#ctx-period')).toHaveText(/\(MONTHLY\)$/);
    await expect(page.getByRole('group', { name: 'Period' })).toBeVisible();

    await page.getByText('Quarterly', { exact: true }).click();
    await expect(radio(page, 'Quarterly')).toBeChecked();
    await page.getByRole('button', { name: 'Show report', exact: true }).click();
    await expect(page.locator('#ctx-period')).toHaveText(/\(QUARTERLY\)$/);

    await radio(page, 'Quarterly').focus();
    await page.keyboard.press('ArrowRight');
    await expect(radio(page, 'Yearly')).toBeChecked();
    await expect(radio(page, 'Quarterly')).not.toBeChecked();
    await page.getByRole('button', { name: 'Show report', exact: true }).click();
    await expect(page.locator('#ctx-period')).toHaveText(/\(YEARLY\)$/);
  });

  test('the chosen period button looks chosen without relying on color', async ({ page }) => {
    await open(page);
    const look = (value) => page.locator(`.segmented label:has(input[value="${value}"])`).evaluate((el) => {
      const s = getComputedStyle(el);
      return { weight: s.fontWeight, border: s.borderTopWidth };
    });
    expect(await look('MONTHLY')).toEqual({ weight: '600', border: '2px' });
    expect(await look('WEEKLY')).toEqual({ weight: '400', border: '1px' });
  });

  test('wide screen: every number card is the same width, even in a short row', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page);
    const widths = await page.locator('#results .metric').evaluateAll((cards) => cards.map((c) => Math.round(c.getBoundingClientRect().width)));
    expect(widths.length).toBe(13);
    expect(new Set(widths).size).toBe(1);
  });

  test('phone at XL: the period buttons wrap and nothing scrolls sideways', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await open(page);
    await page.locator('[data-size="XL"]').click();
    const tops = await page.locator('.segmented label').evaluateAll((labels) => labels.map((l) => Math.round(l.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBeGreaterThan(1);
    // The circle grows with the text size (radio buttons do not inherit it by default).
    expect(await page.locator('#period-monthly').evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(23);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
});
