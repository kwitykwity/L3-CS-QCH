// Trello Task 220: Permissions page text size controls (Handoff PRD §33).
//
// On /permissions/ the S, M, L and XL buttons changed the page text but
// stayed about 13.33px themselves, and the pressed size was not shown the
// way it is on the other pages: the buttons lacked class="text-size__btn".
// This checks, on the Permissions page, that:
//   1. each button follows the selected 12 / 14 / 18 / 24px text size;
//   2. the pressed button looks different from the others (not by color
//      alone), and only the pressed one does;
//   3. they look exactly like the working controls on /sent/ (the same
//      text-size__btn design), and are the same size as the Reporting
//      Center's at every text size (that page uses its own button design).
// Tests only. SYNTHETIC data only.

import { test, expect } from '@playwright/test';

const SIZES = { S: 12, M: 14, L: 18, XL: 24 };
const buttons = (page) => page.locator('header [data-size]');

// What a person sees of one button.
const looks = (locator) => locator.evaluate((el) => {
  const s = getComputedStyle(el);
  return {
    fontSize: s.fontSize,
    fontWeight: s.fontWeight,
    textDecorationLine: s.textDecorationLine,
    backgroundColor: s.backgroundColor,
    color: s.color,
    borderColor: s.borderTopColor,
  };
});

async function choose(page, size) {
  await page.locator(`header [data-size="${size}"]`).click();
  await expect(page.locator('html')).toHaveCSS('font-size', `${SIZES[size]}px`);
  await expect(page.locator(`header [data-size="${size}"]`)).toHaveAttribute('aria-pressed', 'true');
}

// Pressed and not-pressed looks for each size, on one page.
async function looksBySize(page) {
  const result = {};
  for (const size of Object.keys(SIZES)) {
    await choose(page, size);
    result[size] = {
      pressed: await looks(page.locator(`header [data-size="${size}"]`)),
      others: await Promise.all(Object.keys(SIZES).filter((s) => s !== size)
        .map((s) => looks(page.locator(`header [data-size="${s}"]`)))),
    };
  }
  return result;
}

test.describe('Permissions page text size controls (Task 220)', () => {
  test('each S/M/L/XL button follows the selected 12/14/18/24px text size', async ({ page }) => {
    await page.goto('/permissions/');
    await expect(buttons(page)).toHaveCount(4);
    for (const [size, px] of Object.entries(SIZES)) {
      await choose(page, size);
      for (const button of await buttons(page).all()) {
        await expect(button).toHaveCSS('font-size', `${px}px`);
      }
    }
  });

  test('the pressed size is visually distinguishable, not by color alone', async ({ page }) => {
    await page.goto('/permissions/');
    const bySize = await looksBySize(page);
    for (const [size, { pressed, others }] of Object.entries(bySize)) {
      expect(others, `size ${size}`).toHaveLength(3);
      expect(pressed.fontWeight, `size ${size}`).toBe('700');
      expect(pressed.textDecorationLine, `size ${size}`).toBe('underline');
      for (const other of others) {
        expect(other.textDecorationLine, `size ${size}`).toBe('none');
        expect(other.fontWeight, `size ${size}`).not.toBe('700');
        expect(other.backgroundColor, `size ${size}`).not.toBe(pressed.backgroundColor);
      }
    }
  });

  test('the buttons look the same as on /sent/ at every size', async ({ page }) => {
    await page.goto('/permissions/');
    const permissions = await looksBySize(page);
    await page.goto('/sent/');
    const sent = await looksBySize(page);
    expect(permissions).toEqual(sent);
  });

  test('the buttons are the same size as on /reporting/ at every size', async ({ page }) => {
    const sizesOn = async (path) => {
      await page.goto(path);
      const bySize = await looksBySize(page);
      return Object.fromEntries(Object.entries(bySize).map(([size, { pressed, others }]) => [size, [pressed, ...others].map((l) => l.fontSize)]));
    };
    const permissions = await sizesOn('/permissions/');
    expect(permissions).toEqual(await sizesOn('/reporting/'));
    for (const [size, px] of Object.entries(SIZES)) expect(permissions[size]).toEqual(Array(4).fill(`${px}px`));
  });
});
