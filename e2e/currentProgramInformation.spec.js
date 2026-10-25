import { test, expect } from '@playwright/test';
import { createApp } from '../src/app.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
import { createGpmeService } from '../src/gpme/gpmeService.js';
import { syntheticSeed, DEV_USER_ID } from '../scripts/syntheticSeed.js';
import { seedSyntheticProgramInformation } from '../scripts/syntheticProgramInformation.js';

test('authorized Program edits reach the internal matching information interface and survive reload', async ({ page }) => {
  const store = createMemoryReferralStore(syntheticSeed({ programManagement: true }));
  await seedSyntheticProgramInformation(store, DEV_USER_ID);
  const gpme = createGpmeService({ store });
  const before = (await gpme.listCurrentProgramInformation(DEV_USER_ID))
    .find((program) => program.programId === 3);
  const availability = before.fields.find((field) => field.label === 'Current availability');
  expect(before.fields).toHaveLength(7);

  const app = createApp({
    affiliationStore: store, referralStore: store,
    resolveIdentity: () => ({ userId: DEV_USER_ID }), nodeEnv: 'test',
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${base}/program-management/fields.html?programId=3`);
    await expect(page.locator('#field-status')).toHaveText('Saved fields loaded.');
    const panel = page.locator('section.panel').filter({
      has: page.getByRole('heading', { name: 'Current availability', exact: true }),
    });
    const value = page.locator(`#value-${availability.fieldId}`);
    await value.fill('Synthetic update: currently full; inquiries welcome.');
    await panel.getByRole('button', { name: 'Save field value', exact: true }).click();
    await expect(page.locator('#field-status')).toHaveText('Field value saved.');

    const after = (await gpme.listCurrentProgramInformation(DEV_USER_ID))
      .find((program) => program.programId === 3);
    expect(after.fields.find((field) => field.fieldId === availability.fieldId).value)
      .toBe('Synthetic update: currently full; inquiries welcome.');
    expect(after.matchingFacts).toEqual(before.matchingFacts);

    await page.reload();
    await expect(value).toHaveValue('Synthetic update: currently full; inquiries welcome.');
    await expect(page.getByRole('heading', { name: 'Primary Program contact', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Additional locations', exact: true })).toBeVisible();
  } finally {
    await page.goto('about:blank');
    await new Promise((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()));
  }
});
