// Task X: current Program information in Find a Program, in real Chromium.
// A Program Manager marks a Program as full; a case manager still finds that
// Program, sees its availability and primary contact, and still chooses it
// in QCH Connect to refer. SYNTHETIC data only.
import { test, expect } from '@playwright/test';
import { createApp } from '../src/app.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
import { syntheticSeed, DEV_USER_ID } from '../scripts/syntheticSeed.js';
import { seedSyntheticProgramInformation } from '../scripts/syntheticProgramInformation.js';
import { ensureAffiliation, expectNoAxeViolations } from './helpers.js';

const EVENING = 'Adult Evening Classes (sample)';
const JOB_READINESS = 'Job Readiness Workshop (sample)';
const FULL = 'Synthetic update: currently full; wait list open.';

test('a full, wait-listed Program still appears with its availability and primary contact', async ({ page }) => {
  const store = createMemoryReferralStore(syntheticSeed({ programManagement: true }));
  await seedSyntheticProgramInformation(store, DEV_USER_ID); // Program 3: Adult Evening Classes
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

    // Program Manager marks the Program as full.
    await page.goto(`${base}/program-management/fields.html?programId=3`);
    await expect(page.locator('#field-status')).toHaveText('Saved fields loaded.');
    const panel = page.locator('section.panel').filter({
      has: page.getByRole('heading', { name: 'Current availability', exact: true }),
    });
    await panel.getByRole('textbox').first().fill(FULL);
    await panel.getByRole('button', { name: 'Save field value', exact: true }).click();
    await expect(page.locator('#field-status')).toHaveText('Field value saved.');

    // Case manager searches.
    await page.goto(`${base}/referral/`);
    await ensureAffiliation(page);
    await page.reload();
    await page.locator('#path-guided').click();
    await page.getByLabel('Education (sample)', { exact: true }).check();
    await page.getByLabel('Employment (sample)', { exact: true }).check();
    await page.locator('#ageMin').fill('19');
    await page.locator('#ageMax').fill('30');
    const urlBefore = page.url();
    await page.locator('#find-programs').click();
    await expect(page.locator('#match-results')).toBeVisible();

    const evening = page.locator('li.match').filter({ hasText: EVENING });
    await expect(evening).toBeVisible();
    const info = evening.locator('dl.match__info-list');
    await expect(info).toContainText('Current availability');
    await expect(info).toContainText(FULL);
    await expect(info).toContainText('Primary Program contact');
    await expect(info).toContainText('program-demo@example.invalid');
    await expect(evening).toContainText('Send the referral through QCH Connect first.');
    await expect(evening.getByRole('button', { name: `Choose ${EVENING}` })).toBeVisible();

    // A Program with nothing on file says so; it is never shown as available.
    const job = page.locator('li.match').filter({ hasText: JOB_READINESS });
    await expect(job).toContainText('No current availability or contact information on file.');

    await expectNoAxeViolations(page, 'results with Program information');
    expect(page.url()).toBe(urlBefore);
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(stored).not.toContain('currently full');
    expect(stored).not.toContain('program-demo');

    // Choosing the Program in QCH Connect is still the referral path.
    await evening.getByRole('button', { name: `Choose ${EVENING}` }).click();
    await expect(page.locator('#referral-form')).toBeVisible();
  } finally {
    await page.goto('about:blank');
    await new Promise((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()));
  }
});
