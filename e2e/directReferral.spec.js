// Card 17: Direct Referral in a real browser, keyboard only, plus axe
// (Final Technical PRD 14.1 to 14.5, 17.7; the manual runs A and C in
// docs/regression-coverage.md, automated). SYNTHETIC data only.

import { test, expect } from '@playwright/test';
import { ensureAffiliation, expectNoAxeViolations, focusStyle, focused, tabTo } from './helpers.js';

const status = (page) => page.locator('#status .status__text');

test.describe('Direct Referral, keyboard only (PRD 14.2, 14.3)', () => {
  test('first use to "Referral received !" without the mouse', async ({ page }) => {
    const posts = [];
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/referrals')) posts.push(r); });
    await page.goto('/referral/');
    await page.locator('#program-options input').first().waitFor({ state: 'attached' });

    // Skip link is the first stop and moves past the header.
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement.className)).toBe('skip-link');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement.classList.contains('text-size__btn'))).toBe(false);

    // Affiliation: the dropdown works with the arrow keys; nothing is preselected.
    if (await page.locator('#affiliation-form').isVisible()) {
      await tabTo(page, 'affiliation-select');
      expect(await page.locator('#affiliation-select').inputValue()).toBe('');
      await page.keyboard.press('ArrowDown');
      await tabTo(page, 'affiliation-save');
      await page.keyboard.press('Enter');
      await expect(page.locator('#affiliation-view')).toBeVisible();
    }

    // Program: arrow keys choose within the radio group; Enter in the search box does nothing.
    await tabTo(page, 'program-search');
    await page.keyboard.type('Housing');
    await page.keyboard.press('Enter');
    await expect(page.locator('#step-details')).toBeHidden();
    await tabTo(page, 'receivingProgram');
    await page.keyboard.press('Space');
    await tabTo(page, 'program-continue');
    await page.keyboard.press('Enter');
    await expect(page.locator('#step-details')).toBeVisible();
    expect(await focused(page)).toBe('step-details-heading');
    // Count real form submissions, however they are triggered.
    await page.evaluate(() => {
      window.submits = 0;
      document.getElementById('referral-form').addEventListener('submit', () => { window.submits += 1; }, true);
    });
    const submits = () => page.evaluate(() => window.submits);

    // Sending an empty form: nothing is sent, focus goes to the first invalid field.
    await tabTo(page, 'send');
    await page.keyboard.press('Enter');
    await expect(status(page)).toHaveText('Some information needs attention. Nothing was sent.');
    expect(await focused(page)).toBe('participantName');
    await expect(page.locator('#participantName-error')).toBeVisible();
    // Errors are text with an icon word, not color alone.
    expect(await page.locator('#participantName-error').evaluate((el) => getComputedStyle(el, '::before').content)).toContain('Error');
    expect(posts).toHaveLength(0);
    expect(await submits()).toBe(1);

    // Enter in a one-line field never submits.
    await page.keyboard.type('Synthetic Person Keyboard');
    await page.keyboard.press('Enter');
    expect(await submits(), 'Enter in a text field submitted the form').toBe(1);
    expect(posts).toHaveLength(0);

    // Contact method: Space picks the focused radio.
    await tabTo(page, 'contactMethod');
    await page.keyboard.press('Space');
    await tabTo(page, 'contactValue');
    await page.keyboard.type('(555) 017-0017');

    // Enter in the need makes a new line, not a submission.
    await tabTo(page, 'referralContext');
    await page.keyboard.type('Synthetic need line one');
    await page.keyboard.press('Enter');
    await page.keyboard.type('line two');
    expect(await page.locator('#referralContext').inputValue()).toBe('Synthetic need line one\nline two');
    await tabTo(page, 'contactValue', { back: true });
    await page.keyboard.press('Enter');
    expect(await submits(), 'Enter in the phone field submitted the form').toBe(1);
    expect(posts).toHaveLength(0);

    // Send deliberately.
    await tabTo(page, 'send');
    await page.keyboard.press('Enter');
    await expect(status(page)).toContainText('Referral received !');
    expect(posts).toHaveLength(1);
    // The form is cleared once the server has the referral.
    expect(await page.locator('#participantName').inputValue()).toBe('');
  });

  test('every tab stop has a visible outline, and Shift+Tab walks back in the same order', async ({ page }) => {
    await page.goto('/referral/');
    await page.locator('#program-options input').first().waitFor({ state: 'attached' });
    await ensureAffiliation(page);
    await page.reload();
    await page.locator('#program-options input').first().waitFor({ state: 'attached' });
    await page.locator('#program-options input').first().check();
    await page.locator('#program-continue').click();
    await page.locator('#step-details-heading').focus();

    const forward = [];
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press('Tab');
      const stop = await page.evaluate(() => {
        const el = document.activeElement;
        return el === document.body ? null : `${el.tagName.toLowerCase()}#${el.id || el.name || el.dataset.size || el.className}`;
      });
      if (!stop || forward.includes(stop)) break;
      const style = await focusStyle(page);
      expect(style.outlineStyle, `${stop} outline`).not.toBe('none');
      expect(style.outlineWidth, `${stop} outline width`).toBeGreaterThanOrEqual(2);
      forward.push(stop);
    }
    expect(forward.length).toBeGreaterThanOrEqual(8);
    expect(forward.slice(0, 3)).toEqual(['button#change-program', 'input#participantName', 'input#contactMethod']);
    expect(forward.at(-1)).toBe('button#cancel');

    // Focus is now just past the last stop; walk back over every stop.
    const backward = [];
    for (let i = 0; i < forward.length; i += 1) {
      await page.keyboard.press('Shift+Tab');
      backward.push(await page.evaluate(() => {
        const el = document.activeElement;
        return `${el.tagName.toLowerCase()}#${el.id || el.name || el.dataset.size || el.className}`;
      }));
    }
    expect(backward).toEqual([...forward].reverse());
  });

  test('undo works while typing, before anything is sent (PRD 14.2)', async ({ page }) => {
    await page.goto('/referral/');
    await ensureAffiliation(page);
    await page.reload();
    await page.locator('#program-options input').first().check();
    await page.locator('#program-continue').click();
    await page.locator('#participantName').focus();
    await page.keyboard.type('Synthetic');
    await page.keyboard.press('ControlOrMeta+z');
    expect(await page.locator('#participantName').inputValue()).toBe('');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    expect(await page.locator('#participantName').inputValue()).toBe('Synthetic');
  });
});

test.describe('text size S / M / L / XL (PRD 14.5)', () => {
  test('every size applies to labels, typed text, errors and buttons, keeps typed work, and survives a reload', async ({ page }) => {
    await page.goto('/referral/');
    await ensureAffiliation(page);
    await page.reload();
    await page.locator('#program-options input').first().check();
    await page.locator('#program-continue').click();
    await page.locator('#participantName').fill('Synthetic typed work');
    await page.locator('#send').click(); // shows field errors
    await expect(page.locator('#referralContext-error')).toBeVisible();

    const sizeOf = (selector) => page.locator(selector).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    for (const [size, px] of [['S', 12], ['M', 14], ['L', 18], ['XL', 24]]) {
      await page.locator(`.text-size__btn[data-size="${size}"]`).focus();
      await page.keyboard.press('Enter');
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(`${px}px`);
      expect(await sizeOf('label[for="participantName"]')).toBe(px);
      expect(await sizeOf('#participantName')).toBe(px);
      expect(await sizeOf('#referralContext-error')).toBe(px);
      expect(await sizeOf('#send')).toBe(px);
      await expect(page.locator(`.text-size__btn[data-size="${size}"]`)).toHaveAttribute('aria-pressed', 'true');
      expect(await page.locator('#participantName').inputValue(), 'typed work kept').toBe('Synthetic typed work');
    }

    await page.reload();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('24px');
    // Only the size preference is stored (PRD 5.5).
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['qchConnect.textSize']);
    await page.locator('.text-size__btn[data-size="M"]').click();
  });

  test('XL at phone width: nothing scrolls sideways', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/referral/');
    await page.locator('.text-size__btn[data-size="XL"]').click();
    await ensureAffiliation(page);
    await page.reload();
    await page.locator('#program-options input').first().check();
    await page.locator('#program-continue').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.locator('.text-size__btn[data-size="M"]').click();
  });
});

test.describe('automatic accessibility scan, WCAG 2.2 AA rules (axe)', () => {
  for (const colorScheme of ['light', 'dark']) {
    test(`Direct Referral page in every state (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto('/referral/');
      await page.locator('#program-options input').first().waitFor({ state: 'attached' });
      await expectNoAxeViolations(page, 'program step');

      await ensureAffiliation(page);
      await page.reload();
      await page.locator('#program-options input').first().check();
      await page.locator('#program-continue').click();
      await expectNoAxeViolations(page, 'empty form');

      await page.locator('#send').click();
      await expect(page.locator('#participantName-error')).toBeVisible();
      await expectNoAxeViolations(page, 'form with errors');

      await page.locator('.text-size__btn[data-size="XL"]').click();
      await expectNoAxeViolations(page, 'form with errors at XL');
      await page.locator('.text-size__btn[data-size="M"]').click();

      await page.locator('#participantName').fill('Synthetic Person Axe');
      await page.locator('input[name="contactMethod"][value="NOT_AVAILABLE"]').check();
      await page.locator('#referralContext').fill('Synthetic need');
      await page.locator('#send').click();
      await expect(status(page)).toContainText('Referral received !');
      await expectNoAxeViolations(page, 'received');
    });

    test(`start page (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto('/');
      await expect(page.locator('#status-text')).not.toHaveText('checking…');
      await expectNoAxeViolations(page, 'start page');
    });
  }
});
