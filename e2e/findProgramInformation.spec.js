// Task X: current Program information in Find a Program, in real Chromium
// (Handoff MVP §9, §10, §11, §32 gates 13, 16, 17).
// A Program Manager marks a Program as full; a case manager still finds that
// Program, sees its availability and primary contact, and still chooses it
// in QCH Connect to refer. Every result, in each of the three information
// states (populated, empty, failed to load), shows the QCH Connect-first
// contact guidance, and choosing the Program still selects that Program.
// SYNTHETIC data only.
import { test, expect } from '@playwright/test';
import { createApp } from '../src/app.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
import { syntheticSeed, DEV_USER_ID } from '../scripts/syntheticSeed.js';
import { seedSyntheticProgramInformation } from '../scripts/syntheticProgramInformation.js';
import { ensureAffiliation, expectNoAxeViolations } from './helpers.js';

const EVENING = 'Adult Evening Classes (sample)';      // Program 3: information on file
const JOB_READINESS = 'Job Readiness Workshop (sample)'; // no additional information
const FULL = 'Synthetic update: currently full; wait list open.';
const REFER_FIRST = 'Send referrals through QCH Connect. Call or email the Program contact only if you cannot find what you need here.';
const NONE = 'No additional Program information is on file.';
const FAILED = 'Current Program information could not be loaded.';

// A private app over the synthetic seed with Program 3's information.
async function startServer() {
  const store = createMemoryReferralStore(syntheticSeed({ programManagement: true }));
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

// Education + Employment, ages 19 to 30: Evening Classes and Job Readiness.
async function search(page, base) {
  await page.goto(`${base}/referral/`);
  await ensureAffiliation(page);
  await page.reload();
  await page.locator('#path-guided').click();
  await page.getByLabel('Education (sample)', { exact: true }).check();
  await page.getByLabel('Employment (sample)', { exact: true }).check();
  await page.locator('#ageMin').fill('19');
  await page.locator('#ageMax').fill('30');
  await page.locator('#find-programs').click();
  await expect(page.locator('#match-results')).toBeVisible();
}

const card = (page, name) => page.locator('li.match').filter({ hasText: name });

// Choosing a Program still selects exactly that Program for the referral.
async function chooseAndCheck(page, name) {
  await card(page, name).getByRole('button', { name: `Choose ${name}` }).click();
  await expect(page.locator('#step-details')).toBeVisible();
  await expect(page.locator('#summary-receiving')).toHaveText(name);
}

test('a full, wait-listed Program still appears with its availability and primary contact', async ({ page }) => {
  const { server, base } = await startServer();
  try {
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
    const urlBefore = `${base}/referral/`;
    await search(page, base);

    const evening = card(page, EVENING);
    await expect(evening).toBeVisible();
    const info = evening.locator('dl.match__info-list');
    await expect(info).toContainText('Current availability');
    await expect(info).toContainText(FULL);
    await expect(info).toContainText('Primary Program contact');
    await expect(info).toContainText('program-demo@example.invalid');
    await expect(evening.locator('.match__refer-first')).toHaveText(REFER_FIRST);
    await expect(evening.getByRole('button', { name: `Choose ${EVENING}` })).toBeVisible();

    await expectNoAxeViolations(page, 'results with Program information');
    expect(page.url()).toBe(urlBefore);
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(stored).not.toContain('currently full');
    expect(stored).not.toContain('program-demo');

    // Choosing the Program in QCH Connect is still the referral path.
    await chooseAndCheck(page, EVENING);
  } finally {
    await stopServer(page, server);
  }
});

test.describe('every information state shows the QCH Connect-first guidance and keeps Program selection (MVP §11)', () => {
  test('populated: the fields are listed, the guidance follows, and choosing selects that Program', async ({ page }) => {
    const { server, base } = await startServer();
    try {
      await search(page, base);
      const evening = card(page, EVENING);
      await expect(evening.locator('dl.match__info-list')).toBeVisible();
      await expect(evening.locator('.match__info-note').filter({ hasText: NONE })).toHaveCount(0);
      await expect(evening.locator('.match__refer-first')).toHaveText(REFER_FIRST);
      await chooseAndCheck(page, EVENING);
    } finally {
      await stopServer(page, server);
    }
  });

  test('empty: neutral "no additional information", the guidance, and choosing selects that Program', async ({ page }) => {
    const { server, base } = await startServer();
    try {
      await search(page, base);
      const job = card(page, JOB_READINESS);
      await expect(job.locator('dl.match__info-list')).toHaveCount(0);
      await expect(job).toContainText(NONE);
      await expect(job).not.toContainText('Confirm with the Program');
      await expect(job).not.toContainText('No current availability');
      await expect(job.locator('.match__refer-first')).toHaveText(REFER_FIRST);
      await chooseAndCheck(page, JOB_READINESS);
    } finally {
      await stopServer(page, server);
    }
  });

  test('failed to load: says so, the guidance, the same Programs, and choosing selects that Program', async ({ page }) => {
    const { server, base } = await startServer();
    try {
      // The server answers as it does when Program information cannot be
      // read: every result is still there, with programInformation null.
      await page.route('**/api/gpme/match', async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        for (const item of [...body.plausible, ...body.possible]) item.programInformation = null;
        await route.fulfill({ response, json: body });
      });
      await search(page, base);
      for (const name of [EVENING, JOB_READINESS]) {
        const result = card(page, name);
        await expect(result).toBeVisible();
        await expect(result.locator('dl.match__info-list')).toHaveCount(0);
        await expect(result).toContainText(FAILED);
        await expect(result).not.toContainText('Confirm with the Program');
        await expect(result.locator('.match__refer-first')).toHaveText(REFER_FIRST);
      }
      await expectNoAxeViolations(page, 'results with Program information unavailable');
      await chooseAndCheck(page, JOB_READINESS);
    } finally {
      await stopServer(page, server);
    }
  });
});
