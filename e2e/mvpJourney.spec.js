// Trello Task G: the major MVP journeys working together in a real browser,
// browser -> backend -> current application store -> browser
// (Final Technical PRD 2.1 to 2.4, 6.1, 6.2, 8.1 to 8.10, 12, 13.4, 14,
// 17.2, 17.3, 17.7).
//
// The per-feature specs prove each screen on its own. This spec follows
// one piece of work across all of them, so a change in one feature that
// breaks another is caught:
//   1. A Program manager changes matching facts in Program Management, and
//      Find a Program's results change accordingly.
//   2. A worker finds a Program with Find a Program and sends a
//      GPME-assisted referral, by keyboard.
//   3. The receiving Program sees it, accepts it and records the outcome.
//   4. The Reporting Center's numbers for that Program move by exactly
//      that one referral.
// Then the Reporting Center itself: keyboard, focus, text sizes, narrow
// screen and axe in both themes (it had one browser test before Task G).
//
// Runs on the synthetic dev server (one developer identity that manages
// Programs 3 and 7, receives for Program 4, and sends from Program 1).
// Program 3's matching facts are put back afterwards. SYNTHETIC data only.

import { test, expect } from '@playwright/test';
import { ensureAffiliation, expectNoAxeViolations, focused, tabTo } from './helpers.js';

const RUN = Date.now().toString(36);
const EVENING = 'Adult Evening Classes (sample)'; // Program 3: Education, ages 18+
const HOUSING = 'Housing Help Desk (sample)';      // Program 4: Housing; receiving Program
const MATCHING_API = '/api/program-management/programs/3/matching-facts';
const EVENING_FACTS = {
  needCategoryIds: [2, 3],
  ageLimitState: 'SET', ageMin: 18, ageMax: null,
  serviceAreaState: 'NO_RESTRICTION', serviceAreaZips: [],
};

async function resetEveningFacts(request) {
  const { program } = await (await request.get(MATCHING_API)).json();
  const reset = await request.put(MATCHING_API, { data: { version: program.version, ...EVENING_FACTS } });
  expect([200, 409]).toContain(reset.status());
}

// The Reporting Center's counts for one Program this month, read from the page.
async function housingReport(page) {
  await page.goto('/reporting/');
  await expect(page.locator('#status')).toContainText('Report loaded');
  await page.locator('#scope-type').selectOption('PROGRAM');
  const option = page.locator('#scope-target option', { hasText: HOUSING });
  await expect(option).toHaveCount(1);
  await page.locator('#scope-target').selectOption({ label: await option.textContent() });
  await page.getByRole('button', { name: 'Show report', exact: true }).click();
  await expect(page.locator('#ctx-scope')).toContainText(HOUSING);
  const value = async (label) => Number(await page.locator('#counts .metric')
    .filter({ hasText: new RegExp(`^${label}`) }).locator('.metric__value').textContent());
  return {
    total: await value('Total referrals'),
    awaiting: await value('Awaiting response'),
    accepted: await value('Accepted'),
    resulted: await value('Resulted in service'),
  };
}

// Runs guided matching for the given need and age range; returns the
// names of the Programs listed (plausible and possible). When nothing
// fits, the page moves focus to its "no match" message instead.
async function findPrograms(page, need, { min, max } = {}) {
  await page.goto('/referral/');
  await ensureAffiliation(page, 1);
  await page.reload();
  await page.locator('#path-guided').click();
  await expect(page.locator('#needs-options input[name="need"]').first()).toBeVisible();
  await page.locator('#needs-options label', { hasText: need }).locator('input').check();
  if (min !== undefined) await page.locator('#ageMin').fill(String(min));
  if (max !== undefined) await page.locator('#ageMax').fill(String(max));
  await page.locator('#find-programs').click();
  await expect.poll(() => focused(page)).toMatch(/^(results-heading|match-message)$/);
  if ((await focused(page)) === 'match-message') return [];
  return page.locator('#plausible-list li, #possible-list li').allTextContents();
}

test.describe('one referral through every MVP feature', () => {
  test.beforeAll(async ({ request }) => { await resetEveningFacts(request); });
  test.afterAll(async ({ request }) => { await resetEveningFacts(request); });

  test('Program Management changes what Find a Program shows', async ({ page }) => {
    // Before: ages 18+, so an 18-30 Education search lists Adult Evening Classes.
    expect((await findPrograms(page, 'Education', { min: 18, max: 30 })).join(' ')).toContain(EVENING);

    // The manager raises the minimum age to 65 on the matching page.
    await page.goto('/program-management/matching.html?programId=3');
    await expect(page.locator('#matching-status')).toHaveText('Saved matching information loaded.');
    await page.locator('#matching-age-min').fill('65');
    await page.locator('#save-matching').click();
    await expect(page.locator('#matching-status')).toHaveText('Matching information saved.');

    // After: the same search no longer lists it; an over-65 search does.
    expect((await findPrograms(page, 'Education', { min: 18, max: 30 })).join(' ')).not.toContain(EVENING);
    expect((await findPrograms(page, 'Education', { min: 70, max: 80 })).join(' ')).toContain(EVENING);
  });

  test('find a Program, send, receive, respond, record the outcome, and see it in Reporting', async ({ page, request }) => {
    const before = await housingReport(page);
    const name = `Synthetic Journey ${RUN}`;

    // Find a Program, then send the referral by keyboard.
    const listed = await findPrograms(page, 'Housing');
    expect(listed.join(' ')).toContain(HOUSING);
    await page.getByRole('button', { name: `Choose ${HOUSING}` }).click();
    await expect(page.locator('#summary-receiving')).toContainText(HOUSING);
    await expect(page.locator('#summary-source')).toContainText(/guided|matching/i);
    await page.locator('#participantName').focus();
    await page.keyboard.type(name);
    await page.locator('#contactMethod-options input[value="NOT_AVAILABLE"]').focus();
    await page.keyboard.press('Space');
    await page.locator('#referralContext').focus();
    await page.keyboard.type('Synthetic need for the Task G journey');
    await tabTo(page, 'send');
    await page.keyboard.press('Enter');
    await expect(page.locator('#status .status__text')).toContainText('Referral received');
    const referralId = Number((await page.locator('#status .status__text').textContent()).match(/Referral ID: (\d+)/)[1]);

    // The server recorded it as GPME-assisted, from the worker's Program.
    const saved = await (await request.get(`/api/referrals/${referralId}`)).json();
    expect(saved.referral).toMatchObject({ source: 'GPME_ASSISTED', responseStatus: 'AWAITING_RESPONSE' });

    // The receiving Program finds it in its queue and opens it by keyboard.
    await page.goto('/receiving/');
    const item = page.locator('.queue-item').filter({ hasText: name });
    await expect(item).toHaveCount(1);
    await item.getByRole('link').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#status .status__text')).toHaveText('Referral loaded.');

    // Accept, then record the outcome. Each step confirms and reloads from the server.
    await page.locator('#respond-accept').check();
    page.once('dialog', (d) => d.accept());
    await page.locator('#respond-submit').click();
    await expect(page.locator('#status .status__text')).toHaveText('Response sent: Accepted. The service outcome is not recorded yet.');
    await page.locator('#outcome-resulted').check();
    page.once('dialog', (d) => d.accept());
    await page.locator('#outcome-submit').click();
    await expect(page.locator('#status .status__text')).toHaveText('Service outcome recorded: Resulted in service.');

    // Reporting moves by exactly this one referral.
    const after = await housingReport(page);
    expect(after).toEqual({
      total: before.total + 1,
      awaiting: before.awaiting,
      accepted: before.accepted + 1,
      resulted: before.resulted + 1,
    });
  });
});

test.describe('Reporting Center: keyboard, focus, text size, narrow screen, axe', () => {
  test('a report can be chosen and read by keyboard alone, with visible focus', async ({ page }) => {
    await page.goto('/reporting/');
    await expect(page.locator('#status')).toContainText('Report loaded');

    await page.keyboard.press('Tab');
    expect(await focused(page)).not.toBeNull();
    await tabTo(page, 'scope-type');
    await page.keyboard.press('ArrowDown'); // All of QCH -> One Program
    await expect(page.locator('#scope-type')).toHaveValue('PROGRAM');
    await expect(page.locator('#scope-target-group')).toBeVisible();
    await tabTo(page, 'apply');
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    expect(outline, 'the focused button shows an outline').not.toBe('none');

    // Error recovery: no Program chosen yet. The report is not changed, the
    // error says what to do, and focus goes to the Program box.
    await page.keyboard.press('Enter');
    await expect(page.locator('#error')).toHaveText('Choose a Program, or switch the scope to All of QCH.');
    expect(await focused(page)).toBe('scope-target');
    await expect(page.locator('#ctx-scope')).toHaveText('All of QCH');

    // Choose a Program with the arrow keys and show it.
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#scope-target')).not.toHaveValue('');
    await tabTo(page, 'apply');
    await page.keyboard.press('Enter');
    await expect(page.locator('#ctx-scope')).toContainText('Program');
    await expect(page.locator('#error')).toBeHidden();

    // The tables (which scroll at narrow widths) can be reached by keyboard.
    const regions = page.locator('.table-wrap[tabindex="0"]');
    await expect(regions).toHaveCount(2);
    await regions.first().focus();
    expect(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle)).not.toBe('none');
  });

  test('axe passes on the loaded report in both themes', async ({ page }) => {
    await page.goto('/reporting/');
    await expect(page.locator('#status')).toContainText('Report loaded');
    await expect(page.locator('#results')).toBeVisible();
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme });
      await expectNoAxeViolations(page, `reporting, ${colorScheme}`);
    }
  });

  test('S/M/L/XL resize the report, the choice survives a reload, and XL at phone width has no sideways page scroll', async ({ page }) => {
    await page.goto('/reporting/');
    await expect(page.locator('#status')).toContainText('Report loaded');
    const rootSize = () => page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
    for (const [size, px] of [['S', '12px'], ['M', '14px'], ['L', '18px'], ['XL', '24px']]) {
      await page.locator(`[data-size="${size}"]`).click();
      expect(await rootSize(), size).toBe(px);
      await expect(page.locator(`[data-size="${size}"]`)).toHaveAttribute('aria-pressed', 'true');
    }
    await page.reload();
    await expect(page.locator('#status')).toContainText('Report loaded');
    expect(await rootSize()).toBe('24px');

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#results')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'page scrolls sideways').toBeLessThanOrEqual(1);
    await page.locator('[data-size="M"]').click();
  });
});
