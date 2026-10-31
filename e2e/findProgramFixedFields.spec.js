// Task 204: Program Description, Schedule and Eligibility notes in Find a
// Program results, in real Chromium (Handoff PRD 8, 9; Handoff MVP 10).
// Cost notes is not named in those sections, so it must never appear.
// Matching must be unchanged. SYNTHETIC data only.
import { test, expect } from '@playwright/test';
import { createApp } from '../src/app.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
import { syntheticSeed, DEV_USER_ID } from '../scripts/syntheticSeed.js';
import { seedSyntheticProgramInformation } from '../scripts/syntheticProgramInformation.js';
import { ensureAffiliation, expectNoAxeViolations } from './helpers.js';

const EVENING = 'Adult Evening Classes (sample)';       // Program 3
const JOB_READINESS = 'Job Readiness Workshop (sample)'; // no fixed fields set
const DESC = 'Synthetic description: evening classes for adults.';
const SCHED = 'Synthetic schedule: Mondays and Wednesdays, 6 to 8 pm.';
const ELIG = 'Synthetic eligibility note: adult learners.';
const COST = 'Synthetic cost note: free of charge.';
const ELIG_LABEL = 'Eligibility notes (information only, not an eligibility decision)';
const NONE = 'No additional Program information is on file.';

async function startServer({ withFixedFields }) {
  const seed = syntheticSeed({ programManagement: true });
  if (withFixedFields) {
    const program = seed.programs.find((p) => p.programId === 3);
    Object.assign(program, {
      description: DESC, scheduleNotes: SCHED, eligibilityNotes: ELIG, costNotes: COST,
    });
  }
  const store = createMemoryReferralStore(seed);
  await seedSyntheticProgramInformation(store, DEV_USER_ID);
  const app = createApp({
    affiliationStore: store, referralStore: store,
    resolveIdentity: () => ({ userId: DEV_USER_ID }), nodeEnv: 'test',
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function stopServer(page, server) {
  await page.goto('about:blank');
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
}

async function search(page, base) {
  await page.goto(`${base}/referral/`);
  await ensureAffiliation(page);
  await page.reload();
  await page.locator('#path-guided').click();
  await page.getByLabel('Education (sample)', { exact: true }).check();
  await page.getByLabel('Employment (sample)', { exact: true }).check();
  await page.locator('#ageMode-range').check();
  await page.locator('#ageMin').fill('19');
  await page.locator('#ageMax').fill('30');
  await page.locator('#find-programs').click();
  await expect(page.locator('#match-results')).toBeVisible();
}

const card = (page, name) => page.locator('li.match').filter({ hasText: name });

// The Programs in the order shown, read from each Choose button.
const resultOrder = (page) => page.locator('li.match button').evaluateAll(
  (buttons) => buttons.map((b) => b.getAttribute('aria-label') || b.textContent.trim()),
);

test('Description, Schedule and Eligibility notes appear, labeled; Cost notes never does', async ({ page }) => {
  const { server, base } = await startServer({ withFixedFields: true });
  try {
    await search(page, base);
    const info = card(page, EVENING).locator('dl.match__info-list');
    await expect(info).toContainText('Program Description');
    await expect(info).toContainText(DESC);
    await expect(info).toContainText('Schedule');
    await expect(info).toContainText(SCHED);
    await expect(info).toContainText(ELIG_LABEL);
    await expect(info).toContainText(ELIG);

    // Cost notes is not named in Handoff PRD 8, 9 or MVP 10: never shown.
    await expect(page.locator('#match-results')).not.toContainText(COST);
    await expect(page.locator('#match-results')).not.toContainText('Cost');

    // A Program with none of these set keeps the neutral empty state.
    await expect(card(page, JOB_READINESS)).toContainText(NONE);

    await expectNoAxeViolations(page, 'results with fixed Program fields');
  } finally {
    await stopServer(page, server);
  }
});

test('showing the fields does not change which Programs are found or their order', async ({ page }) => {
  const without = await startServer({ withFixedFields: false });
  let before;
  try {
    await search(page, without.base);
    before = await resultOrder(page);
  } finally {
    await stopServer(page, without.server);
  }

  const withFields = await startServer({ withFixedFields: true });
  try {
    await search(page, withFields.base);
    const after = await resultOrder(page);
    expect(before.length).toBeGreaterThan(0);
    expect(after).toEqual(before);
  } finally {
    await stopServer(page, withFields.server);
  }
});
