import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './helpers.js';

const api = '/api/program-management/programs/3/matching-facts';
const url = '/program-management/matching.html?programId=3';
const initial = {
  needCategoryIds: [2, 3],
  ageLimitState: 'SET', ageMin: 18, ageMax: null,
  serviceAreaState: 'NO_RESTRICTION', serviceAreaZips: [],
};

test.beforeEach(async ({ request }) => {
  const read = await request.get(api);
  expect(read.ok()).toBeTruthy();
  const { program } = await read.json();
  const reset = await request.put(api, { data: { version: program.version, ...initial } });
  expect([200, 409]).toContain(reset.status());
  if (reset.status() === 409) expect((await reset.json()).code).toBe('NO_CHANGE');
});

test('matching edits persist; unknown and no restriction stay distinct; both themes pass axe', async ({ page, request }) => {
  await page.goto(url);
  await expect(page.locator('#matching-status')).toHaveText('Saved matching information loaded.');
  await page.locator('#matching-age-min').fill('21');
  await page.locator('#service-area-state').selectOption('SET');
  await page.locator('#matching-zips').fill('99901\n99902');
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    await expectNoAxeViolations(page, `matching maintenance, ${colorScheme}`);
  }
  await page.locator('#save-matching').click();
  await expect(page.locator('#matching-status')).toHaveText('Matching information saved.');
  await page.reload();
  await expect(page.locator('#matching-age-min')).toHaveValue('21');
  await expect(page.locator('#matching-zips')).toHaveValue('99901\n99902');

  await page.locator('#age-limit-state').selectOption('NOT_ON_FILE');
  await page.locator('#service-area-state').selectOption('NO_RESTRICTION');
  await page.locator('#save-matching').click();
  await expect(page.locator('#matching-status')).toHaveText('Matching information saved.');
  const { facts } = await (await request.get(api)).json();
  expect(facts.ageLimitState).toBe('NOT_ON_FILE');
  expect(facts.ageMin).toBeNull();
  expect(facts.ageMax).toBeNull();
  expect(facts.serviceAreaState).toBe('NO_RESTRICTION');
  expect(facts.serviceAreaZips).toEqual([]);
});

test('stale matching edits require explicit review before saving retained work', async ({ page, request }) => {
  await page.goto(url);
  await page.locator('#matching-age-min').fill('25');
  const { program, facts } = await (await request.get(api)).json();
  const changed = await request.put(api, {
    data: { version: program.version, ...facts, ageMin: 30 },
  });
  expect(changed.ok()).toBeTruthy();

  await page.locator('#save-matching').click();
  await expect(page.locator('#matching-conflict')).toBeVisible();
  await expect(page.locator('#matching-current')).toContainText('30');
  await expect(page.locator('#matching-age-min')).toHaveValue('25');
  await expect(page.locator('#save-matching')).toBeDisabled();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#review-matching').click();
  await expect(page.locator('#matching-age-min')).toHaveValue('25');
  await expect(page.locator('#save-matching')).toBeEnabled();
  expect((await (await request.get(api)).json()).facts.ageMin).toBe(30);

  await page.locator('#save-matching').click();
  await expect(page.locator('#matching-status')).toHaveText('Matching information saved.');
  expect((await (await request.get(api)).json()).facts.ageMin).toBe(25);
});

test('uncertain matching save preserves work and blocks resubmission until reload', async ({ page }) => {
  await page.goto(url);
  await page.locator('#matching-age-min').fill('24');
  const pattern = '**/api/program-management/programs/3/matching-facts';
  await page.route(pattern, (route) =>
    route.request().method() === 'PUT' ? route.abort() : route.continue());
  await page.locator('#save-matching').click();
  await expect(page.locator('#matching-status')).toContainText('Save outcome is not confirmed.');
  await expect(page.locator('#matching-age-min')).toHaveValue('24');
  await expect(page.locator('#save-matching')).toBeDisabled();
  await page.unroute(pattern);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#reload-matching').click();
  await expect(page.locator('#matching-age-min')).toHaveValue('18');
  await expect(page.locator('#save-matching')).toBeEnabled();
});

test('invalid age ranges and ZIPs focus the offending input without submitting', async ({ page }) => {
  await page.goto(url);
  await expect(page.locator('#matching-status')).toHaveText('Saved matching information loaded.');
  let writes = 0;
  page.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().endsWith(api)) writes += 1;
  });
  await page.locator('#matching-age-min').fill('50');
  await page.locator('#matching-age-max').fill('20');
  await page.locator('#save-matching').click();
  await expect(page.locator('#matching-age-min')).toBeFocused();
  await expect(page.locator('#matching-age-min')).toHaveValue('50');

  await page.locator('#matching-age-min').fill('18');
  await page.locator('#matching-age-max').fill('');
  await page.locator('#service-area-state').selectOption('SET');
  await page.locator('#matching-zips').fill('invalid');
  await page.locator('#save-matching').click();
  await expect(page.locator('#matching-zips')).toBeFocused();
  await expect(page.locator('#matching-zips')).toHaveValue('invalid');
  expect(writes).toBe(0);
});
