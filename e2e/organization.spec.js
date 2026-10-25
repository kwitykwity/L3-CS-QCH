import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './helpers.js';

test('Department creation, rename and lifecycle preserve identity through reload', async ({ page, request }) => {
  await page.goto('/program-management/organization.html');
  await expect(page.locator('#org-status')).toHaveText('Saved Departments loaded.');
  await page.locator('#new-department-name').fill('Synthetic browser Department');
  await page.getByRole('button', { name: 'Create Department', exact: true }).click();
  await expect(page.locator('#org-status')).toHaveText('Department created.');

  const response = await request.get('/api/program-management/departments');
  expect(response.ok()).toBeTruthy();
  const department = (await response.json()).departments.find((row) => row.name === 'Synthetic browser Department');
  expect(department).toBeTruthy();
  const name = page.locator(`#department-name-${department.departmentId}`);
  const panel = page.locator('section.panel').filter({ has: name });

  await name.fill('Synthetic renamed browser Department');
  page.once('dialog', (dialog) => dialog.accept());
  await panel.getByRole('button', { name: 'Rename Department', exact: true }).click();
  await expect(panel.getByRole('heading')).toHaveText('Synthetic renamed browser Department');

  page.once('dialog', (dialog) => dialog.accept());
  await panel.getByRole('button', { name: 'Discontinue Department', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Reactivate Department', exact: true })).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await panel.getByRole('button', { name: 'Reactivate Department', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Discontinue Department', exact: true })).toBeVisible();

  await page.reload();
  await expect(name).toHaveValue('Synthetic renamed browser Department');
  const saved = await request.get('/api/program-management/departments');
  const current = (await saved.json()).departments.find((row) => row.departmentId === department.departmentId);
  expect(current.name).toBe('Synthetic renamed browser Department');
  expect(current.lifecycleStatus).toBe('ACTIVE');
});

test('active Programs prevent Department discontinuation; organization screen passes axe', async ({ page, request }) => {
  const response = await request.get('/api/program-management/departments');
  expect(response.ok()).toBeTruthy();
  const departments = (await response.json()).departments.filter((row) => row.activeProgramCount > 0);
  expect(departments.length).toBeGreaterThan(0);

  await page.goto('/program-management/organization.html');
  for (const department of departments) {
    const panel = page.locator('section.panel').filter({
      has: page.locator(`#department-name-${department.departmentId}`),
    });
    await expect(panel.getByRole('button', { name: 'Discontinue Department', exact: true })).toBeDisabled();
  }
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    await expectNoAxeViolations(page, `organization management, ${colorScheme}`);
  }
});

test('creates and moves a Program without granting Program management', async ({ page, request }) => {
  await page.goto('/program-management/organization-programs.html');
  await expect(page.locator('#program-org-status')).toHaveText('Saved organization loaded.');
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    await expectNoAxeViolations(page, `Program creation and moves, ${colorScheme}`);
  }

  await page.locator('#create-program-name').fill('Synthetic browser transfer');
  await page.locator('#create-program-department').selectOption('2');
  await page.locator('#create-program-site').fill('Synthetic browser site');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Create Program', exact: true }).click();
  await expect(page.locator('#program-org-status')).toContainText('Program created.');

  const listed = await request.get('/api/program-management/organization-programs');
  expect(listed.ok()).toBeTruthy();
  const program = (await listed.json()).programs.find((row) => row.name === 'Synthetic browser transfer');
  expect(program).toBeTruthy();
  expect(program.departmentId).toBe(2);

  const editAccess = await request.get(`/api/program-management/programs/${program.programId}`);
  expect(editAccess.status()).toBe(403);
  const managed = await request.get('/api/program-management/programs');
  expect((await managed.json()).programs.some((row) => row.programId === program.programId)).toBeFalsy();

  await page.locator('#move-program').selectOption(String(program.programId));
  await page.locator('#move-program-department').selectOption('1');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Move Program', exact: true }).click();
  await expect(page.locator('#program-org-status')).toContainText('Program moved.');

  await page.reload();
  await expect(page.locator(`#move-program option[value="${program.programId}"]`))
    .toContainText('Youth Services (sample)');
  const updated = await request.get('/api/program-management/organization-programs');
  const current = (await updated.json()).programs.find((row) => row.programId === program.programId);
  expect(current.departmentId).toBe(1);
  expect(current.programId).toBe(program.programId);
  expect(current.lifecycleStatus).toBe('ACTIVE');
});
