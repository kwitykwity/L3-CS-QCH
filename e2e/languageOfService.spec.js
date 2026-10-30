// Trello Task W: language of service in a real browser (Kyle Butler, QCH,
// Oct 26, 2026). A Program manager keeps a Program's languages on the
// matching page, and Find a Program shows them to staff. None on file is
// shown as "not on file", and a Program is never hidden because of its
// languages.
//
// Synthetic dev server: Program 3 (Adult Evening Classes) starts with
// English, Spanish and Chinese; Program 5 (Job Readiness Workshop) has none
// on file. Program 3 is put back afterwards. SYNTHETIC data only.

import { test, expect } from '@playwright/test';
import { ensureAffiliation, expectNoAxeViolations, focused } from './helpers.js';

const API = '/api/program-management/programs/3/matching-facts';
const PAGE = '/program-management/matching.html?programId=3';
const EVENING = 'Adult Evening Classes (sample)';
const JOBS = 'Job Readiness Workshop (sample)';
const SEEDED = {
  needCategoryIds: [2, 3],
  ageLimitState: 'SET', ageMin: 18, ageMax: null,
  serviceAreaState: 'NO_RESTRICTION', serviceAreaZips: [],
  languageIds: [1, 2, 3],
};

async function resetProgram3(request) {
  const { program } = await (await request.get(API)).json();
  const reset = await request.put(API, { data: { version: program.version, ...SEEDED } });
  expect([200, 409]).toContain(reset.status());
}

// Guided matching for one need and an age range; returns the result items.
async function findPrograms(page, need, min, max) {
  await page.goto('/referral/');
  await ensureAffiliation(page, 1);
  await page.reload();
  await page.locator('#path-guided').click();
  await expect(page.locator('#needs-options input[name="need"]').first()).toBeVisible();
  await page.locator('#needs-options label', { hasText: need }).locator('input').check();
  await page.locator('#ageMode-range').check(); // Exact age is the default (wireframe screen 2)
  await page.locator('#ageMin').fill(String(min));
  await page.locator('#ageMax').fill(String(max));
  await page.locator('#find-programs').click();
  await expect.poll(() => focused(page)).toBe('results-heading');
  return page.locator('#plausible-list li.match, #possible-list li.match');
}

test.describe('language of service', () => {
  test.beforeEach(async ({ request }) => { await resetProgram3(request); });
  test.afterAll(async ({ request }) => { await resetProgram3(request); });

  test('Find a Program shows known languages, and "not on file" when none are saved', async ({ page }) => {
    const results = await findPrograms(page, 'Employment', 20, 25);
    await expect(results.filter({ hasText: EVENING }).locator('.match__languages'))
      .toHaveText('Languages of service: Chinese, English, Spanish');
    await expect(results.filter({ hasText: JOBS }).locator('.match__languages'))
      .toHaveText('Languages of service: not on file');
    for (const list of ['#plausible-list', '#possible-list']) {
      await expect(page.locator(list)).not.toContainText(/english only/i);
    }
  });

  test('a manager changes languages by keyboard; Find a Program follows; the Program is never hidden', async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.locator('#matching-status')).toHaveText('Saved matching information loaded.');
    const group = page.getByRole('group', { name: 'Languages of service' });
    await expect(group.getByRole('checkbox')).toHaveCount(3);
    await expect(group.getByRole('checkbox', { name: 'Chinese' })).toBeChecked();

    // Keyboard only: clear every language, then save.
    for (const name of ['English', 'Spanish', 'Chinese']) {
      await group.getByRole('checkbox', { name }).focus();
      await page.keyboard.press('Space');
    }
    await page.locator('#save-matching').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#matching-status')).toHaveText('Matching information saved.');
    await page.reload();
    await expect(page.locator('#matching-status')).toHaveText('Saved matching information loaded.');
    await expect(group.getByRole('checkbox', { checked: true })).toHaveCount(0);

    // Still listed, now "not on file".
    let results = await findPrograms(page, 'Employment', 20, 25);
    await expect(results.filter({ hasText: EVENING }).locator('.match__languages'))
      .toHaveText('Languages of service: not on file');

    // One language back: shown by name.
    await page.goto(PAGE);
    await expect(page.locator('#matching-status')).toHaveText('Saved matching information loaded.');
    await group.getByRole('checkbox', { name: 'Spanish' }).check();
    await page.locator('#save-matching').click();
    await expect(page.locator('#matching-status')).toHaveText('Matching information saved.');
    results = await findPrograms(page, 'Employment', 20, 25);
    await expect(results.filter({ hasText: EVENING }).locator('.match__languages'))
      .toHaveText('Languages of service: Spanish');
  });

  test('the matching page passes axe with the language checklist, in both themes', async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.locator('#matching-status')).toHaveText('Saved matching information loaded.');
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme });
      await expectNoAxeViolations(page, `matching with languages, ${colorScheme}`);
    }
  });

  test('XL text at phone width: the language checklist and results do not scroll sideways', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(PAGE);
    await expect(page.locator('#matching-status')).toHaveText('Saved matching information loaded.');
    await page.locator('[data-size="XL"]').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.locator('[data-size="M"]').click();
  });
});
