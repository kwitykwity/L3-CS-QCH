// Reporting Center: a Department with no referrals can be chosen and gives a
// zero / no data report. SYNTHETIC data only.

import { test, expect } from '@playwright/test';

const NAME = 'Synthetic zero-referral Department';

test('an existing Department with no referrals can be selected and reports zero and no data', async ({ page, request }) => {
  const created = await request.post('/api/program-management/departments', { data: { name: NAME } });
  expect(created.ok()).toBeTruthy();

  const listed = await request.get('/api/reports/departments');
  expect(listed.ok()).toBeTruthy();
  const department = (await listed.json()).departments.find((d) => d.name === NAME);
  expect(department).toBeTruthy();
  expect(department.lifecycleStatus).toBe('ACTIVE');

  await page.goto('/reporting/');
  await expect(page.locator('#status')).toContainText('Report loaded');

  await page.locator('#scope-type').selectOption('DEPARTMENT');
  await expect(page.locator('#scope-target option', { hasText: NAME })).toHaveCount(1);
  await page.locator('#scope-target').selectOption({ label: NAME });
  await page.getByRole('button', { name: 'Show report', exact: true }).click();

  await expect(page.locator('#ctx-scope')).toHaveText(`Department: ${NAME}`);
  await expect(page.locator('#error')).toBeHidden();

  await expect(page.locator('#counts .metric').filter({ hasText: 'Total referrals' }).locator('.metric__value')).toHaveText('0');
  await expect(page.locator('#counts .metric').filter({ hasText: 'Awaiting response' }).locator('.metric__value')).toHaveText('0');
  await expect(page.locator('#rates .metric').filter({ hasText: 'Acceptance rate' })).toContainText('No data');
  await expect(page.locator('#rates .metric').filter({ hasText: 'Resulted-in-service rate' })).toContainText('No data');
  await expect(page.locator('#timing .metric').filter({ hasText: 'Average time to first response' })).toContainText('N/A');
  await expect(page.locator('#timing .metric').filter({ hasText: 'Median time to recorded service' })).toContainText('N/A');
  await expect(page.locator('#departments-body')).toContainText('No referrals in this period and scope.');
});
