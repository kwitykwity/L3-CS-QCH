import { test, expect } from '@playwright/test';
import { expectNoAxeViolations, tabTo } from './helpers.js';

async function open(page) {
  await page.goto('/program-management/');
  await expect(page.locator('#chooser-form')).toBeVisible();
  await page.locator('#program-select').selectOption('3');
  await page.locator('#open-program').click();
  await expect(page.locator('#editor')).toBeVisible();
  await expect(page.locator('#save')).toBeEnabled();
}

test.beforeEach(async ({ request }) => {
  const url = '/api/program-management/programs/3';
  let response = await request.get(url);
  expect(response.ok()).toBeTruthy();
  let { program } = await response.json();
  if (program.lifecycleStatus === 'DISCONTINUED') {
    response = await request.post(`${url}/reactivate`, { data: { version: program.version } });
    expect(response.ok()).toBeTruthy();
    ({ program } = await response.json());
  }
  const reset = await request.patch(url, {
    data: { version: program.version, description: null, scheduleNotes: null, costNotes: null },
  });
  expect([200, 409]).toContain(reset.status());
  if (reset.status() === 409) expect((await reset.json()).code).toBe('NO_CHANGE');
});

test('authorized chooser and keyboard save persist through reload', async ({ page }) => {
  await page.goto('/program-management/');
  await expect(page.locator('#chooser-form')).toBeVisible();
  const values = await page.locator('#program-select option').evaluateAll((items) => items.map((item) => item.value));
  expect(values).toEqual(['', '3', '7']);
  await tabTo(page, 'program-select');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#program-select')).toHaveValue('3');
  await tabTo(page, 'open-program');
  await page.keyboard.press('Enter');
  await expect(page.locator('#editor')).toBeVisible();
  await tabTo(page, 'description');
  await page.keyboard.type('Synthetic keyboard description');
  await tabTo(page, 'save');
  await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toContainText('Changes saved.');
  await page.reload();
  await page.locator('#program-select').selectOption('3');
  await page.locator('#open-program').click();
  await expect(page.locator('#description')).toHaveValue('Synthetic keyboard description');
});

test('discard cancellation preserves work; confirmation restores saved information', async ({ page }) => {
  await open(page);
  await page.locator('#description').fill('Synthetic unsaved work');
  await page.locator('#discard').click();
  await expect(page.locator('#confirm-dialog')).toBeVisible();
  await page.locator('#confirm-stay').click();
  await expect(page.locator('#description')).toHaveValue('Synthetic unsaved work');
  await page.locator('#discard').click();
  await page.locator('#confirm-proceed').click();
  await expect(page.locator('#description')).toHaveValue('');
});

test('confirmed discontinue and reactivate update referral choices', async ({ page, request }) => {
  await open(page);
  await page.locator('#lifecycle').click();
  await page.locator('#confirm-proceed').click();
  await expect(page.locator('#program-status')).toHaveText('DISCONTINUED');
  let response = await request.get('/api/programs');
  expect((await response.json()).programs.some((program) => program.programId === 3)).toBeFalsy();
  await page.locator('#lifecycle').click();
  await page.locator('#confirm-proceed').click();
  await expect(page.locator('#program-status')).toHaveText('ACTIVE');
  response = await request.get('/api/programs');
  expect((await response.json()).programs.some((program) => program.programId === 3)).toBeTruthy();
});

test('stale save preserves edits and requires loading current information', async ({ page, request }) => {
  await open(page);
  await page.locator('#description').fill('Synthetic stale work');
  const { program } = await (await request.get('/api/program-management/programs/3')).json();
  const changed = await request.patch('/api/program-management/programs/3', {
    data: { version: program.version, scheduleNotes: 'Synthetic authoritative schedule' },
  });
  expect(changed.ok()).toBeTruthy();
  await page.locator('#save').click();
  await expect(page.locator('#conflict')).toBeVisible();
  await expect(page.locator('#current-values')).toContainText('Synthetic authoritative schedule');
  await expect(page.locator('#description')).toHaveValue('Synthetic stale work');
  await expect(page.locator('#save')).toBeDisabled();
  await page.locator('#load-current').click();
  await page.locator('#confirm-proceed').click();
  await expect(page.locator('#description')).toHaveValue('');
  await expect(page.locator('#scheduleNotes')).toHaveValue('Synthetic authoritative schedule');
  await expect(page.locator('#save')).toBeEnabled();
});

test('unknown save outcome preserves edits and blocks another mutation until reload', async ({ page }) => {
  await open(page);
  await page.locator('#costNotes').fill('Synthetic unsaved cost');
  const url = '**/api/program-management/programs/3';
  await page.route(url, async (route) => {
    if (route.request().method() === 'PATCH') await route.abort();
    else await route.continue();
  });
  await page.locator('#save').click();
  await expect(page.locator('#status')).toContainText('Save outcome is not confirmed');
  await expect(page.locator('#costNotes')).toHaveValue('Synthetic unsaved cost');
  await expect(page.locator('#save')).toBeDisabled();
  await expect(page.locator('#lifecycle')).toBeDisabled();
  await page.unroute(url);
  await page.locator('#reload-program').click();
  await page.locator('#confirm-proceed').click();
  await expect(page.locator('#costNotes')).toHaveValue('');
  await expect(page.locator('#save')).toBeEnabled();
});

for (const colorScheme of ['light', 'dark']) {
  test(`management chooser and editor accessibility, ${colorScheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/program-management/');
    await expect(page.locator('#chooser-form')).toBeVisible();
    await expectNoAxeViolations(page, 'management chooser');
    await page.locator('#program-select').selectOption('3');
    await page.locator('#open-program').click();
    await expect(page.locator('#editor')).toBeVisible();
    await expectNoAxeViolations(page, 'management editor');
    await page.locator('#lifecycle').click();
    await expectNoAxeViolations(page, 'lifecycle confirmation');
    await page.locator('#confirm-stay').click();
  });
}
