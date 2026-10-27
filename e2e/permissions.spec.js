// Trello Task Y: the Permissions screen in a real browser (PRD 3.7, 3.8,
// 13.4, 14). The synthetic dev server's developer holds
// ADMINISTER_PERMISSIONS (org-wide); Synthetic Staff A and B (users 2 and
// 3) start with no permissions. Every test cleans up after itself.
// SYNTHETIC data only.

import { test, expect } from '@playwright/test';
import { expectNoAxeViolations, focused } from './helpers.js';

const STAFF_A = 2;
const STAFF_B = 3;
const status = (page) => page.locator('#perm-status .status__text');

async function clearGrants(request, userId) {
  const { grants } = await (await request.get(`/api/permissions/users/${userId}/grants`)).json();
  for (const grant of grants.filter((g) => g.revocable)) {
    await request.post(`/api/permissions/users/${userId}/grants/${grant.grantId}/revoke`, { data: {} });
  }
}

async function openPerson(page, label) {
  await page.goto('/permissions/');
  await expect(status(page)).toHaveText('Staff list loaded. Choose a staff member.');
  await page.locator('#person-select').selectOption({ label });
  await page.locator('#show-person').click();
  await expect(page.locator('#person-heading')).toBeFocused();
}

test.describe('Permissions screen', () => {
  test.afterEach(async ({ request }) => {
    await clearGrants(request, STAFF_A);
    await clearGrants(request, STAFF_B);
  });

  test('add and remove a permission by keyboard; the list follows', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Permissions' }).click();
    await expect(status(page)).toHaveText('Staff list loaded. Choose a staff member.');

    // Keyboard only from here.
    await page.locator('#person-select').focus();
    await page.locator('#person-select').selectOption({ label: 'Synthetic Staff A (sample)' });
    await page.locator('#show-person').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#person-heading')).toHaveText('Permissions for Synthetic Staff A (sample)');
    await expect(page.locator('#no-grants')).toBeVisible();

    // A per-Program permission needs a Program; the form says so.
    await page.locator('#permission-select').selectOption({ label: 'Manage Program information' });
    await expect(page.locator('#program-field')).toBeVisible();
    await page.locator('#add-permission').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#add-error')).toHaveText('Choose the Program this permission is for.');
    await expect.poll(() => focused(page)).toBe('program-select');

    await page.locator('#program-select').selectOption({ label: 'Adult Evening Classes (sample) (Site A)' });
    await page.locator('#add-permission').focus();
    await page.keyboard.press('Enter');
    await expect(status(page)).toHaveText('Added: Manage Program information: Adult Evening Classes (sample) (Site A).');
    await expect(page.locator('#grant-list li')).toHaveCount(1);

    // An org-wide permission needs no Program.
    await page.locator('#permission-select').selectOption('MANAGE_ORGANIZATION');
    await expect(page.locator('#program-field')).toBeHidden();
    await page.locator('#add-permission').click();
    await expect(status(page)).toHaveText(/^Added: Manage the organization.*Organization-wide\.$/);
    await expect(page.locator('#grant-list li')).toHaveCount(2);

    // Remove asks first; Cancel changes nothing.
    const remove = page.getByRole('button', { name: /^Remove Manage Program information/ });
    page.once('dialog', (d) => d.dismiss());
    await remove.click();
    await expect(page.locator('#grant-list li')).toHaveCount(2);
    page.once('dialog', (d) => d.accept());
    await remove.click();
    await expect(status(page)).toHaveText('Removed: Manage Program information: Adult Evening Classes (sample) (Site A).');
    await expect(page.locator('#grant-list li')).toHaveCount(1);

    // Still true after a reload from the server.
    await page.reload();
    await openPerson(page, 'Synthetic Staff A (sample)');
    await expect(page.locator('#grant-list li')).toHaveCount(1);
    await expect(page.locator('#grant-list')).toContainText('Organization-wide');
  });

  test('your own permissions are read-only, and administrator rights are not managed here', async ({ page }) => {
    await openPerson(page, 'Synthetic Developer (sample) (you)');
    await expect(page.locator('#person-note')).toHaveText('You cannot change your own permissions. Ask another administrator.');
    await expect(page.locator('#add-form')).toBeHidden();
    await expect(page.locator('#grant-list button')).toHaveCount(0);
    await expect(page.locator('#grant-list')).toContainText('Administer permissions: Organization-wide');
    await expect(page.locator('#grant-list')).toContainText('Managed outside this screen');
    // The permission list never offers administrator rights.
    await expect(page.locator('#permission-select option', { hasText: 'Administer permissions' })).toHaveCount(0);
  });

  test('another administrator got there first: nothing is added twice and the current list is shown', async ({ page, request }) => {
    await openPerson(page, 'Synthetic Staff B (sample)');
    const elsewhere = await request.post(`/api/permissions/users/${STAFF_B}/grants`,
      { data: { permission: 'RECORD_OUTCOME', programId: 4 } });
    expect(elsewhere.status()).toBe(201);
    await page.locator('#permission-select').selectOption({ label: 'Record the service outcome' });
    await page.locator('#program-select').selectOption({ label: 'Housing Help Desk (sample) (Site C)' });
    await page.locator('#add-permission').click();
    await expect(status(page)).toHaveText(/^Nothing was added: this staff member already has that permission/);
    await expect(page.locator('#grant-list li')).toHaveCount(1);
  });

  test('passes axe in both themes, and XL text at phone width does not scroll sideways', async ({ page, request }) => {
    await request.post(`/api/permissions/users/${STAFF_A}/grants`, { data: { permission: 'VIEW_RECEIVED_REFERRAL', programId: 4 } });
    await openPerson(page, 'Synthetic Staff A (sample)');
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme });
      await expectNoAxeViolations(page, `permissions, ${colorScheme}`);
    }
    await page.setViewportSize({ width: 375, height: 800 });
    await page.locator('[data-size="XL"]').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.locator('[data-size="M"]').click();
  });
});
