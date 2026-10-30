// Trello Task LL: no-match versus technical failure in real Chromium
// (Handoff PRD 4.2, 6.5; Handoff MVP 4.2, 7; MVP acceptance gate 10).
// SYNTHETIC data only.
//
// A legitimate no-match must show the no-match experience: a plain result
// (information tone), "change your answers" and Direct Referral, never "try
// again". A technical failure must show the recovery experience: an error
// tone, the answers kept, "try again" and Direct Referral, never the no-match
// wording. This file checks that the two are never confused, at both steps of
// Find a Program (reading the description, and matching), and that moving
// from one condition to the other leaves no stale wording or controls.
//
// e2e/gpme.spec.js already covers each condition on its own. This file adds
// the interpretation failure variants, the error/info tone, the transitions
// between conditions, focus, and an accessibility scan of both states. Only
// the failure is forced, by intercepting the one request that should fail;
// everything else runs against the real synthetic backend.
//
// Synthetic seed (scripts/syntheticSeed.js): Childcare is for ages 0 to 5, so
// Childcare for ages 40 to 45 is a legitimate "no plausible match".

import { test, expect } from '@playwright/test';
import { ensureAffiliation, expectNoAxeViolations } from './helpers.js';

const matchMessage = (page) => page.locator('#match-message .status__text');
const need = (page, name) => page.getByLabel(name, { exact: true });
const activeId = (page) => page.evaluate(() => document.activeElement?.id ?? '');

async function openGuided(page) {
  await page.goto('/referral/');
  await ensureAffiliation(page);
  await page.reload();
  await page.locator('#path-guided').click();
  await expect(page.locator('#guided')).toBeVisible();
  await page.locator('input[name="need"]').first().waitFor({ state: 'attached' });
}

async function childcareForAdults(page) {
  await need(page, 'Childcare (sample)').check();
  await page.locator('#ageMode-range').check(); // Exact age is the default (wireframe screen 2)
  await page.locator('#ageMin').fill('40');
  await page.locator('#ageMax').fill('45');
}

const findPrograms = (page) => page.locator('#find-programs').click();

function recordPosts(page, suffix) {
  const posts = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith(suffix)) posts.push(request.postDataJSON());
  });
  return posts;
}

const DESCRIPTION = 'A 25 year old who wants to finish school and find a job';

test.describe('reading the description: nothing understood is a result, a technical failure is not', () => {
  test('nothing understood is an information result and makes no matching request', async ({ page }) => {
    const matches = recordPosts(page, '/api/gpme/match');
    await openGuided(page);
    await page.locator('#describe').fill('please help');
    await page.locator('#describe-go').click();

    await expect(page.locator('#understood')).toHaveClass(/status--info/);
    await expect(page.locator('#understood')).toHaveAttribute('role', 'status');
    await expect(page.locator('#understood-message')).toContainText('Nothing was filled in');
    await expect(page.locator('#understood-message')).not.toContainText('technical problem');
    await expect(page.locator('#understood-message')).not.toContainText('Try again');
    expect(await activeId(page)).toBe('understood');
    expect(matches).toHaveLength(0);
    await expectNoAxeViolations(page, 'nothing understood');
  });

  const FAILURES = [
    ['503 from interpretation', (route) => route.fulfill({
      status: 503, contentType: 'application/json', body: JSON.stringify({ status: 'UNABLE_TO_INTERPRET' }),
    })],
    ['a dropped connection', (route) => route.abort('connectionreset')],
    ['a malformed success answer', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'INTERPRETED', needs: 'nope', notes: [] }),
    })],
  ];

  for (const [label, fail] of FAILURES) {
    test(`${label} is the recovery experience, never "nothing understood", and the worker can try again`, async ({ page }) => {
      const matches = recordPosts(page, '/api/gpme/match');
      await openGuided(page);
      await page.locator('#describe').fill(DESCRIPTION);
      await page.route('**/api/gpme/interpret', fail);
      await page.locator('#describe-go').click();

      await expect(page.locator('#understood')).toHaveClass(/status--error/);
      await expect(page.locator('#understood')).toHaveAttribute('role', 'status');
      await expect(page.locator('#understood-message')).toContainText('technical problem');
      await expect(page.locator('#understood-message')).toContainText('Try again');
      await expect(page.locator('#understood-message')).not.toContainText('Nothing was filled in');
      await expect(page.locator('#understood-message')).not.toContainText('No plausible match');
      expect(await activeId(page)).toBe('understood');

      // Nothing was invented or lost: the text is kept, no answer was filled in,
      // no matching was started, and the button works again.
      await expect(page.locator('#describe')).toHaveValue(DESCRIPTION);
      await expect(page.locator('input[name="need"]:checked')).toHaveCount(0);
      await expect(page.locator('#match-results')).toBeHidden();
      await expect(page.locator('#describe-go')).toBeEnabled();
      await expect(page.locator('#describe-go')).toHaveText('Fill in the answers below');
      expect(matches).toHaveLength(0);
      await expectNoAxeViolations(page, label);

      // Recovery: the same request now works and proposes answers, not an error.
      await page.unroute('**/api/gpme/interpret');
      await page.locator('#describe-go').click();
      await expect(page.locator('#understood')).toHaveClass(/status--info/);
      await expect(page.locator('#understood-message')).toContainText('what the application understood');
      await expect(page.locator('#understood-message')).not.toContainText('technical problem');
      expect(await page.locator('input[name="need"]:checked').count()).toBeGreaterThan(0);
    });
  }
});

test.describe('matching: the experience follows the condition, with nothing left over from the last one', () => {
  test('failure, then recovery into a real no-match, then failure again', async ({ page }) => {
    await openGuided(page);
    await childcareForAdults(page);

    // 1. Technical failure: error tone, Try again and Direct Referral, no "Change answers".
    await page.route('**/api/gpme/match', (route) => route.fulfill({
      status: 503, contentType: 'application/json', body: JSON.stringify({ status: 'UNABLE_TO_MATCH' }),
    }));
    await findPrograms(page);
    await expect(page.locator('#match-message')).toHaveClass(/status--error/);
    await expect(page.locator('#match-message')).toHaveAttribute('role', 'status');
    await expect(matchMessage(page)).toContainText('Unable to perform matching');
    await expect(matchMessage(page)).not.toContainText('No plausible match');
    await expect(page.locator('#match-retry')).toBeVisible();
    await expect(page.locator('#match-direct')).toBeVisible();
    await expect(page.locator('#match-edit')).toBeHidden();
    await expect(page.locator('#match-results')).toBeHidden();
    expect(await activeId(page)).toBe('match-message');
    await expectNoAxeViolations(page, 'matching failure');

    // 2. Matching recovers and the real answer is a legitimate no-match: the
    // failure wording and the Try again button are gone, not left behind.
    await page.unroute('**/api/gpme/match');
    await page.locator('#match-retry').click();
    await expect(page.locator('#match-message')).toHaveClass(/status--info/);
    await expect(matchMessage(page)).toContainText('No plausible match identified');
    await expect(matchMessage(page)).not.toContainText('Unable to perform matching');
    await expect(matchMessage(page)).not.toContainText('technical');
    await expect(page.locator('#match-retry')).toBeHidden();
    await expect(page.locator('#match-edit')).toBeVisible();
    await expect(page.locator('#match-direct')).toBeVisible();
    await expect(page.locator('#match-results')).toBeHidden();
    expect(await activeId(page)).toBe('match-message');
    await expectNoAxeViolations(page, 'matching no-match');

    // 3. The worker searches again with the same answers and matching is down
    // again: back to the recovery experience, no stale "Change answers".
    await page.route('**/api/gpme/match', (route) => route.abort('connectionreset'));
    await findPrograms(page);
    await expect(page.locator('#match-message')).toHaveClass(/status--error/);
    await expect(matchMessage(page)).toContainText('Unable to perform matching');
    await expect(matchMessage(page)).not.toContainText('No plausible match');
    await expect(page.locator('#match-retry')).toBeVisible();
    await expect(page.locator('#match-edit')).toBeHidden();
  });

  test('both conditions keep the answers and offer Direct Referral, which does not need matching', async ({ page }) => {
    await openGuided(page);
    await childcareForAdults(page);
    const answers = async () => ({
      needs: await page.locator('input[name="need"]:checked').evaluateAll((boxes) => boxes.map((b) => b.parentElement.textContent)),
      ageMin: await page.locator('#ageMin').inputValue(),
      ageMax: await page.locator('#ageMax').inputValue(),
    });
    const expected = { needs: ['Childcare (sample)'], ageMin: '40', ageMax: '45' };

    await findPrograms(page); // the real no-match
    await expect(matchMessage(page)).toContainText('No plausible match identified');
    expect(await answers()).toEqual(expected);
    await expect(page.locator('#match-direct')).toBeVisible();

    await page.route('**/api/gpme/match', (route) => route.fulfill({
      status: 503, contentType: 'application/json', body: JSON.stringify({ status: 'UNABLE_TO_MATCH' }),
    }));
    await findPrograms(page); // the forced failure
    await expect(matchMessage(page)).toContainText('Unable to perform matching');
    expect(await answers()).toEqual(expected);
    await expect(page.locator('#match-direct')).toBeVisible();

    // With matching still down, Direct Referral opens.
    await page.locator('#match-direct').click();
    await expect(page.locator('#direct')).toBeVisible();
  });
});
