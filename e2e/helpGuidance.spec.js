// Trello Task 225: Help and Guidance page (Current Handoff Written
// Wireframe Page 22; Handoff PRD §33 for accessibility).
//
// The page explains only existing QCH Connect behavior. Where the app
// already says something, the Help page must say the same thing, so the
// checks below compare it with the app's own wording (the New Referral
// page and public/referral/guided.js), not with a copy kept in this test.
//
// Checked here: reaching Help from the home page and the main navigation,
// by mouse and by keyboard; page structure (one h1, main landmark, current
// page marked, skip link); the topics on the task card; S/M/L/XL text size
// on the page and its own buttons; axe at M. The full XL / 320px reflow and
// two-theme axe sweep is in e2e/accessibilityFinal.spec.js ("Help and
// Guidance"). Narrow widths there stand for desktop browser zoom and
// reflow, not phone support. SYNTHETIC data only; nothing about any
// participant is on this page.

import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './helpers.js';
import { GUIDED_MESSAGES } from '../public/referral/guided.js';

const SIZES = { S: 12, M: 14, L: 18, XL: 24 };
const WORKFLOW_PAGES = ['/referral/', '/sent/', '/sent/referral.html?id=1', '/receiving/', '/receiving/referral.html?id=1'];
// The topics the task card lists, in page order.
const TOPICS = [
  'Send referrals through QCH Connect',
  'Find a Program or Direct Referral',
  'Review what QCH Connect understood',
  'Participant age',
  'Language and availability',
  'When no Program matches',
  'When something goes wrong',
  'Where a referral stands',
  'Corrections',
  'Participant information',
];

const mainNav = (page) => page.getByRole('navigation', { name: 'Main navigation' });
const section = (page, heading) => page.locator('section').filter({ has: page.getByRole('heading', { level: 2, name: heading, exact: true }) });
const helpText = async (page) => (await page.locator('main').innerText()).replace(/\s+/g, ' ');

test.describe('Help and Guidance page (Task 225)', () => {
  test('is reached from the home page and from the main navigation of every workflow page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Help and Guidance' }).click();
    await expect(page).toHaveURL(/\/help\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Help and Guidance');

    for (const path of WORKFLOW_PAGES) {
      await page.goto(path);
      await mainNav(page).getByRole('link', { name: 'Help', exact: true }).click();
      await expect(page, path).toHaveURL(/\/help\/$/);
      await expect(page.getByRole('heading', { level: 1 }), path).toHaveText('Help and Guidance');
    }
  });

  test('is reached with the keyboard only', async ({ page, browserName }) => {
    await page.goto('/sent/');
    const target = mainNav(page).getByRole('link', { name: 'Help', exact: true });
    // Safari (WebKit) skips links on plain Tab by default; Option+Tab reaches them.
    const key = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
    for (let i = 0; i < 8 && !(await target.evaluate((el) => el === document.activeElement)); i += 1) {
      await page.keyboard.press(key);
    }
    await expect(target).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/help\/$/);

    // The skip link moves keyboard focus into the content.
    await page.locator('a.skip-link').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();
  });

  test('has the shared page structure, with Help marked as the current page', async ({ page }) => {
    await page.goto('/help/');
    await expect(page).toHaveTitle('Help and Guidance · QCH Connect');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(mainNav(page).getByRole('link')).toHaveText(['New referral', 'Referrals I sent', 'Received referrals', 'Help']);
    await expect(mainNav(page).getByRole('link', { name: 'Help', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(TOPICS);
    await expectNoAxeViolations(page, 'Help and Guidance at M');
  });

  test('says what the app says: QCH Connect first, suggestions, age, no match, failures', async ({ page }) => {
    // The age note, as New Referral shows it today.
    await page.goto('/referral/');
    const ageHint = await page.locator('#ageRange-hint').textContent();
    const ageSentence = ageHint.match(/Age is used only[^.]*\./)[0];

    await page.goto('/help/');
    await expect(section(page, 'Send referrals through QCH Connect')).toContainText(GUIDED_MESSAGES.PROGRAM_INFO_REFER_FIRST);
    await expect(section(page, 'Find a Program or Direct Referral')).toContainText(GUIDED_MESSAGES.SUGGESTION_NOTE);
    await expect(section(page, 'Find a Program or Direct Referral')).toContainText('Both send the same kind of referral.');
    await expect(section(page, 'Participant age')).toHaveText(new RegExp(ageSentence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await expect(section(page, 'Review what QCH Connect understood')).toContainText('Nothing is matched until you choose Find Programs.');
    await expect(section(page, 'Language and availability')).toContainText('Language and availability never remove a Program from consideration.');
    await expect(section(page, 'When no Program matches')).toContainText('does not offer a fallback or a "closest match"');
    await expect(section(page, 'When no Program matches')).toContainText('use Direct Referral if you know a Program');
    await expect(section(page, 'When something goes wrong')).toContainText('A technical problem is not a result.');
    await expect(section(page, 'Corrections')).toContainText('The earlier value stays in the audit history.');

    // Status words are the ones the referral pages use.
    const status = section(page, 'Where a referral stands');
    for (const word of ['Awaiting response', 'Responded', 'Accepted', 'Not appropriate', 'Not recorded',
      'Resulted in service', 'Did not result in service', 'Accepted does not mean the person received service.']) {
      await expect(status).toContainText(word);
    }

    // Nothing the card rules out.
    const text = await helpText(page);
    expect(text).not.toMatch(/mobile|smartphone|@qchnyc|@/i);
  });

  test('S/M/L/XL change the page text and the size buttons, and the choice carries over from other pages', async ({ page }) => {
    await page.goto('/help/');
    const buttons = page.locator('header [data-size]');
    await expect(buttons).toHaveCount(4);
    for (const [size, px] of Object.entries(SIZES)) {
      await page.locator(`header [data-size="${size}"]`).click();
      await expect(page.locator('html')).toHaveCSS('font-size', `${px}px`);
      await expect(page.locator('h1 + p')).toHaveCSS('font-size', `${px}px`);
      for (const button of await buttons.all()) await expect(button).toHaveCSS('font-size', `${px}px`);
      const pressed = page.locator(`header [data-size="${size}"]`);
      await expect(pressed).toHaveAttribute('aria-pressed', 'true');
      await expect(pressed).toHaveCSS('text-decoration-line', 'underline');
      await expect(pressed).toHaveCSS('font-weight', '700');
      await expect(page.locator('header [data-size][aria-pressed="true"]')).toHaveCount(1);
    }

    // Chosen on another page, kept on Help.
    await page.goto('/sent/');
    await page.locator('header [data-size="L"]').click();
    await page.goto('/help/');
    await expect(page.locator('html')).toHaveCSS('font-size', '18px');
    await expect(page.locator('header [data-size="L"]')).toHaveAttribute('aria-pressed', 'true');
  });
});
