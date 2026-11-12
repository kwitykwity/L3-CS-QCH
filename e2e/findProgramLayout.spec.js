// Trello Task 249: Find a Program in the wireframe 1 layout.
// The need chips are real checkboxes, and the Direct Referral shortcut
// beside the Guided matching heading switches paths the same way as
// "I know the Program". SYNTHETIC data only.

import { test, expect } from '@playwright/test';

async function openGuided(page) {
  await page.goto('/referral/');
  await page.locator('#path-guided').click();
  await expect(page.locator('#needs-options input[name="need"]').first()).toBeVisible();
}

test.describe('Find a Program layout (Task 249)', () => {
  test('clicking anywhere on a need chip ticks its checkbox; clicking again clears it', async ({ page }) => {
    await openGuided(page);
    const chip = page.locator('#needs-options label').first();
    const box = chip.locator('input[type="checkbox"]');
    await expect(box).not.toBeChecked();
    // Click the chip's right edge, away from the box itself.
    await chip.scrollIntoViewIfNeeded();
    const r = await chip.boundingBox();
    await page.mouse.click(r.x + r.width - 4, r.y + r.height / 2);
    await expect(box).toBeChecked();
    await expect(chip).toHaveCSS('font-weight', '600');
    await chip.click();
    await expect(box).not.toBeChecked();
  });

  test('the shortcut opens Direct Referral, like "I know the Program"', async ({ page }) => {
    await openGuided(page);
    const shortcut = page.getByRole('button', { name: 'I already know the Program Direct Referral' });
    await expect(shortcut).toBeVisible();
    await shortcut.click();
    await expect(page.locator('#path-direct')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#path-guided')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#guided')).toBeHidden();
    await expect(page.locator('#direct')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Direct Referral' })).toBeFocused();
  });

  test('age and ZIP sit side by side on a wide screen and stack at XL on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openGuided(page);
    const top = (id) => page.locator(id).evaluate((el) => Math.round(el.getBoundingClientRect().top));
    expect(Math.abs((await top('#ageRange')) - (await top('.guided-details > .field--narrow')))).toBeLessThan(40);

    await page.setViewportSize({ width: 320, height: 800 });
    await page.locator('[data-size="XL"]').click();
    expect(await top('.guided-details > .field--narrow')).toBeGreaterThan(await top('#ageRange'));
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
});
