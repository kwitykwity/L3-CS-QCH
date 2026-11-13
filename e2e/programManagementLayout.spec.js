// Trello Task 255: Program Management in the wireframe 9 look.
// The Program's status and each field's status are pills that keep their
// words. The common fields sit side by side on a wide screen and stack on a
// phone at XL with nothing scrolling sideways. SYNTHETIC data only.

import { test, expect } from '@playwright/test';

const RUN = Date.now().toString(36);

async function openProgram(page) {
  await page.goto('/program-management/');
  await expect(page.locator('#program-select option[value="3"]')).toHaveCount(1);
  await page.locator('#program-select').selectOption('3');
  await page.locator('#open-program').click();
  await expect(page.locator('#editor')).toBeVisible();
}

const tops = (page, ids) => page.evaluate((list) => list.map((id) => Math.round(document.getElementById(id).getBoundingClientRect().top)), ids);

test.describe('Program Management layout (Task 255)', () => {
  test('the Program status is a pill with its word', async ({ page }) => {
    await openProgram(page);
    const pill = page.locator('#program-status .pill');
    await expect(pill).toHaveCount(1);
    await expect(page.locator('#program-status')).toHaveText(/^(ACTIVE|DISCONTINUED|RETIRED)$/);
    const word = await pill.textContent();
    await expect(pill).toHaveClass(word === 'ACTIVE' ? /pill--success/ : /pill--neutral/);
  });

  test('wide screen: two notes fields share a row; phone at XL: they stack and nothing scrolls sideways', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openProgram(page);
    const [eligibility, schedule] = await tops(page, ['eligibilityNotes', 'scheduleNotes']);
    expect(eligibility).toBe(schedule);

    await page.setViewportSize({ width: 320, height: 800 });
    await page.locator('[data-size="XL"]').click();
    const [e2, s2] = await tops(page, ['eligibilityNotes', 'scheduleNotes']);
    expect(s2).toBeGreaterThan(e2);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });

  test('each field card shows its status pill beside its name', async ({ page, request }) => {
    const label = `Synthetic Layout ${RUN}`;
    const created = await request.post('/api/program-management/programs/3/fields', { data: { label, dataType: 'TEXT' } });
    expect(created.status()).toBe(201);
    const field = (await created.json()).field;
    const current = (await (await request.get('/api/program-management/programs/3/fields')).json()).fields.find((f) => f.fieldId === field.fieldId);
    expect((await request.post(`/api/program-management/fields/${field.fieldId}/discontinue`, { data: { version: current.version } })).ok()).toBeTruthy();

    await page.goto('/program-management/fields.html?programId=3');
    await expect(page.locator('#field-status')).toContainText('Saved fields loaded.');
    const card = page.locator('#field-list section.panel').filter({ has: page.getByRole('heading', { name: label, exact: true }) });
    await expect(card.locator('.field-card__head .pill')).toHaveText('DISCONTINUED');
    await expect(card.locator('.field-card__head .pill')).toHaveClass(/pill--neutral/);
    await expect(card.getByRole('button', { name: 'Reactivate field', exact: true })).toBeVisible();
  });
});
