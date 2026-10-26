// Guided Matching browser journey in real Chromium (Final Technical PRD 2.1,
// 2.2, 5.3, 5.5, 7.4, 8.1 to 8.10, 14.3, 17.2, 17.7). SYNTHETIC data only.
//
// Covers: matching, explanations, selection, submission, no plausible match,
// technical failure, preserved answers, retry, and the Direct Referral
// fallback. Matching and submission run against the real synthetic backend;
// only the failure cases are forced, by intercepting the one request that
// should fail, so every other step still goes through the real code.
//
// Synthetic seed (scripts/syntheticSeed.js) used here:
//   Education + Employment, ages 19 to 30
//     -> plausible: Adult Evening Classes (sample)
//     -> possible:  Job Readiness Workshop (sample)   (age limit not on file)
//   Childcare, ages 40 to 45 -> no plausible match (Childcare is for ages 0 to 5)

import { test, expect } from '@playwright/test';
import { ensureAffiliation, expectNoAxeViolations, focused, tabTo } from './helpers.js';

const EVENING = 'Adult Evening Classes (sample)';
const JOB_READINESS = 'Job Readiness Workshop (sample)';
const HOUSING = 'Housing Help Desk (sample)';

const status = (page) => page.locator('#status .status__text');
const matchMessage = (page) => page.locator('#match-message .status__text');

// Opens the New Referral page with an affiliation set and the guided path chosen.
async function openGuided(page) {
  await page.goto('/referral/');
  await ensureAffiliation(page);
  await page.reload();
  await page.locator('#path-guided').click();
  await expect(page.locator('#guided')).toBeVisible();
  await page.locator('input[name="need"]').first().waitFor({ state: 'attached' });
}

const need = (page, name) => page.getByLabel(name, { exact: true });

async function answerEducationEmployment(page) {
  await need(page, 'Education (sample)').check();
  await need(page, 'Employment (sample)').check();
  await page.locator('#ageMin').fill('19');
  await page.locator('#ageMax').fill('30');
}

async function findPrograms(page) {
  await page.locator('#find-programs').click();
}

// The details form that follows choosing a Program.
async function fillReferral(page, name = 'Synthetic Person Guided') {
  await expect(page.locator('#step-details')).toBeVisible();
  await page.locator('#participantName').fill(name);
  await page.locator('input[name="contactMethod"][value="NOT_AVAILABLE"]').check();
  await page.locator('#referralContext').fill('Synthetic need for the guided matching test');
}

// Records every POST /api/referrals body the page sends.
function recordReferralPosts(page) {
  const posts = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/referrals')) posts.push(request.postDataJSON());
  });
  return posts;
}

function recordMatchPosts(page) {
  const posts = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/gpme/match')) posts.push(request.postDataJSON());
  });
  return posts;
}

const answersStillThere = async (page) => ({
  needs: await page.locator('input[name="need"]:checked').evaluateAll((boxes) => boxes.map((b) => b.parentElement.textContent)),
  ageMin: await page.locator('#ageMin').inputValue(),
  ageMax: await page.locator('#ageMax').inputValue(),
});

test.describe('matching, explanations and selection (PRD 8.1, 8.4, 8.6)', () => {
  test('answers -> plausible and possible Programs, each explained, in groups that do not rank', async ({ page }) => {
    const matches = recordMatchPosts(page);
    await openGuided(page);
    // Neither path is preselected when the page opens (PRD 2.1): the guided
    // panel only opened because the worker chose it.
    await expect(page.locator('#path-guided')).toHaveAttribute('aria-pressed', 'true');

    await answerEducationEmployment(page);
    await findPrograms(page);

    await expect(page.locator('#match-results')).toBeVisible();
    expect(await focused(page)).toBe('results-heading');
    expect(matches).toEqual([{ needCategoryIds: [2, 3], ageRange: { min: 19, max: 30 } }]);

    const plausible = page.locator('#plausible-list > li');
    const possible = page.locator('#possible-list > li');
    await expect(plausible).toHaveCount(1);
    await expect(plausible.first().locator('.match__name')).toHaveText(EVENING);
    await expect(possible).toHaveCount(1);
    await expect(possible.first().locator('.match__name')).toHaveText(JOB_READINESS);

    // Every result explains itself from the factors actually used (PRD 8.6).
    for (const item of [plausible.first(), possible.first()]) {
      const reasons = item.locator('.match__why > li');
      expect(await reasons.count()).toBeGreaterThan(0);
      for (const text of await reasons.allTextContents()) expect(text.trim().length).toBeGreaterThan(0);
    }
    // The page says these are suggestions and the order is not a ranking, and
    // shows no scores, percentages or "best match" (PRD 8.1, 8.6).
    await expect(page.locator('#suggestion-note')).toContainText('not an eligibility decision');
    await expect(page.locator('#order-note')).toContainText('does not rank');
    const resultsText = await page.locator('#match-results').innerText();
    expect(resultsText).not.toMatch(/best match|top match|\d+\s?%|confidence|score|guarantee|eligible for/i);
    // The page only describes matching; nothing was sent as a referral (PRD 2.1).
    await expect(page.locator('#step-details')).toBeHidden();
  });

  test('changing an answer clears the old results, so a referral never carries answers that were not matched', async ({ page }) => {
    await openGuided(page);
    await answerEducationEmployment(page);
    await findPrograms(page);
    await expect(page.locator('#match-results')).toBeVisible();

    await page.locator('#ageMax').fill('31');
    await expect(page.locator('#match-results')).toBeHidden();
    await expect(matchMessage(page)).toContainText('earlier results were cleared');
  });

  // The synthetic seed has no Program without need categories, so the two
  // "not checked" cases below take the real match response and set
  // notCheckedForNeedCount, which is how the backend reports such Programs
  // (src/gpme/matchPrograms.js). Everything else in the response is real.
  async function reportNotChecked(page, count, overrides = {}) {
    await page.route('**/api/gpme/match', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({ response, json: { ...body, notCheckedForNeedCount: count, ...overrides } });
    });
  }

  test('a Program with no need categories on file is described as not checked, never as unsuitable (PRD 8.10)', async ({ page }) => {
    await reportNotChecked(page, 2);
    await openGuided(page);
    await answerEducationEmployment(page);
    await findPrograms(page);

    await expect(page.locator('#match-results')).toBeVisible();
    const note = page.locator('#not-checked-note');
    await expect(note).toBeVisible();
    await expect(note).toContainText('2 Programs have no need categories on file, so matching could not check them.');
    await expect(note).toContainText('use Direct Referral');
    await expect(note).not.toContainText(/not (eligible|suitable)|excluded|rejected|unsuitable/i);
    // They are not listed in either group: the real results are unchanged.
    await expect(page.locator('#plausible-list > li')).toHaveCount(1);
    await expect(page.locator('#possible-list > li')).toHaveCount(1);
  });

  test('with no plausible match, Programs with no need categories are still described as not checked', async ({ page }) => {
    await reportNotChecked(page, 1, { status: 'NO_PLAUSIBLE_MATCH', plausible: [], possible: [] });
    await openGuided(page);
    await answerEducationEmployment(page);
    await findPrograms(page);

    await expect(page.locator('#match-results')).toBeHidden();
    await expect(matchMessage(page)).toContainText('No plausible match');
    await expect(matchMessage(page)).toContainText('1 Program has no need categories on file, so matching could not check it.');
  });

  test('the not-checked note is hidden when every Program has need categories', async ({ page }) => {
    await openGuided(page);
    await need(page, 'Employment (sample)').check();
    await findPrograms(page);
    await expect(page.locator('#match-results')).toBeVisible();
    // Nothing in the synthetic seed lacks categories, so the wording must not appear.
    await expect(page.locator('#not-checked-note')).toBeHidden();
  });

  test('input is validated before any search: first problem gets focus, answers are kept, no request is sent', async ({ page }) => {
    const matches = recordMatchPosts(page);
    await openGuided(page);

    await findPrograms(page);
    await expect(page.locator('#needs-error')).toHaveText('Choose at least one need.');
    expect(await page.evaluate(() => document.activeElement.getAttribute('name'))).toBe('need');
    // The error is text with an icon word, not color alone (PRD 14.3).
    expect(await page.locator('#needs-error').evaluate((el) => getComputedStyle(el, '::before').content)).toContain('Error');

    await need(page, 'Housing (sample)').check();
    await page.locator('#ageMin').fill('20');
    await findPrograms(page);
    await expect(page.locator('#ageRange-error')).toBeVisible();
    expect(await focused(page)).toBe('ageMin');
    expect((await answersStillThere(page)).needs).toEqual(['Housing (sample)']);
    expect(matches).toHaveLength(0);
  });
});

test.describe('selection and submission (PRD 2.1, 2.2, 7.1 to 7.4)', () => {
  test('choose a plausible Program -> details -> "Referral received !", sent as the same referral as Direct plus the matching answers', async ({ page }) => {
    const referrals = recordReferralPosts(page);
    await openGuided(page);
    await answerEducationEmployment(page);
    await findPrograms(page);
    await expect(page.locator('#match-results')).toBeVisible();

    // Matching never sends anything by itself; the worker chooses (PRD 2.1).
    expect(referrals).toHaveLength(0);
    await page.getByRole('button', { name: `Choose ${EVENING}` }).click();

    await expect(page.locator('#step-details')).toBeVisible();
    expect(await focused(page)).toBe('step-details-heading');
    await expect(page.locator('#summary-receiving')).toContainText(EVENING);
    await expect(page.locator('#summary-source')).toContainText('Guided matching');
    expect(referrals).toHaveLength(0);

    await fillReferral(page);
    await page.locator('#send').click();
    await expect(status(page)).toContainText('Referral received !');
    await expect(status(page)).toContainText('Referral ID:');

    expect(referrals).toHaveLength(1);
    const [body] = referrals;
    expect(body.receivingProgramId).not.toBeUndefined();
    // Only the three approved matching inputs ride along (PRD 8.2); the
    // browser cannot choose the source or an evaluation (PRD 10.3).
    expect(body.gpme).toEqual({ needCategoryIds: [2, 3], ageRange: { min: 19, max: 30 } });
    expect(body).not.toHaveProperty('source');
    expect(body).not.toHaveProperty('referringProgramId');
    expect(typeof body.submissionId).toBe('string');

    // Participant and matching answers are gone from the page once the server has them.
    expect(await page.locator('#participantName').inputValue()).toBe('');
    expect(await page.locator('input[name="need"]:checked').count()).toBe(0);
    await expect(page.locator('#match-results')).toBeHidden();
  });

  test('a possible match can be chosen too, and the worker is told the Program decides', async ({ page }) => {
    const referrals = recordReferralPosts(page);
    await openGuided(page);
    await answerEducationEmployment(page);
    await findPrograms(page);

    await page.getByRole('button', { name: `Choose ${JOB_READINESS}` }).click();
    await expect(page.locator('#summary-receiving')).toContainText(JOB_READINESS);
    await expect(page.locator('#summary-source')).toContainText('receiving Program still makes the decision');
    await fillReferral(page, 'Synthetic Person Possible');
    await page.locator('#send').click();
    await expect(status(page)).toContainText('Referral received !');
    expect(referrals[0].gpme).toBeTruthy();
  });

  test('"Change Program" returns to the results with the answers intact', async ({ page }) => {
    await openGuided(page);
    await answerEducationEmployment(page);
    await findPrograms(page);
    await page.getByRole('button', { name: `Choose ${EVENING}` }).click();
    await expect(page.locator('#step-details')).toBeVisible();

    await page.locator('#change-program').click();
    await expect(page.locator('#step-program')).toBeVisible();
    expect((await answersStillThere(page)).needs).toEqual(['Education (sample)', 'Employment (sample)']);
  });

  test('sensitive information never reaches the URL, localStorage, sessionStorage or the console (PRD 5.5)', async ({ page }) => {
    const consoleLines = [];
    page.on('console', (message) => consoleLines.push(message.text()));
    await openGuided(page);
    await answerEducationEmployment(page);
    await page.locator('#matchZip').fill('99901');
    await findPrograms(page);
    await page.getByRole('button', { name: `Choose ${EVENING}` }).click();
    await fillReferral(page, 'Synthetic Person Privacy');

    const check = async () => {
      expect(page.url()).not.toMatch(/\?|Privacy|99901/);
      const stored = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));
      expect(stored.local.filter((key) => key !== 'qchConnect.textSize')).toEqual([]);
      expect(stored.session).toEqual([]);
    };
    await check();
    await page.locator('#send').click();
    await expect(status(page)).toContainText('Referral received !');
    await check();
    expect(consoleLines.join('\n')).not.toMatch(/Privacy|99901|Synthetic/);
  });
});

test.describe('no plausible match is a result, not a failure (PRD 8.5)', () => {
  test('says so plainly, keeps the answers, offers Change answers and Direct Referral, never Try again', async ({ page }) => {
    await openGuided(page);
    await need(page, 'Childcare (sample)').check();
    await page.locator('#ageMin').fill('40');
    await page.locator('#ageMax').fill('45');
    await findPrograms(page);

    await expect(matchMessage(page)).toContainText('No plausible match identified');
    await expect(matchMessage(page)).toContainText('does not mean QCH has no appropriate Program');
    await expect(matchMessage(page)).not.toContainText('Unable to perform matching');
    await expect(page.locator('#match-results')).toBeHidden();
    await expect(page.locator('#match-retry')).toBeHidden();
    await expect(page.locator('#match-edit')).toBeVisible();
    await expect(page.locator('#match-direct')).toBeVisible();
    expect(await answersStillThere(page)).toEqual({ needs: ['Childcare (sample)'], ageMin: '40', ageMax: '45' });

    // "Change answers" puts the worker back on the first question.
    await page.locator('#match-edit').click();
    expect(await page.evaluate(() => document.activeElement.getAttribute('name'))).toBe('need');
  });
});

test.describe('technical failure keeps the answers and offers retry or Direct Referral (PRD 8.5, 8.8)', () => {
  test('503 from matching -> "Unable to perform matching", answers preserved, Try again works once matching recovers', async ({ page }) => {
    await openGuided(page);
    await answerEducationEmployment(page);
    await page.locator('#matchZip').fill('99901');

    await page.route('**/api/gpme/match', (route) => route.fulfill({
      status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'UNABLE_TO_MATCH' }),
    }));
    await findPrograms(page);

    await expect(matchMessage(page)).toContainText('Unable to perform matching');
    await expect(matchMessage(page)).toContainText('technical problem, not a result');
    await expect(matchMessage(page)).not.toContainText('No plausible match');
    await expect(page.locator('#match-results')).toBeHidden();
    await expect(page.locator('#match-retry')).toBeVisible();
    await expect(page.locator('#match-direct')).toBeVisible();
    expect(await page.locator('#find-programs').isEnabled()).toBe(true);
    expect(await answersStillThere(page)).toEqual({ needs: ['Education (sample)', 'Employment (sample)'], ageMin: '19', ageMax: '30' });
    expect(await page.locator('#matchZip').inputValue()).toBe('99901');

    // Still failing: Try again shows the same state and still keeps the answers.
    await page.locator('#match-retry').click();
    await expect(matchMessage(page)).toContainText('Unable to perform matching');
    expect((await answersStillThere(page)).ageMin).toBe('19');

    // Matching recovers: Try again now gives results without re-entering anything.
    await page.unroute('**/api/gpme/match');
    await page.locator('#match-retry').click();
    await expect(page.locator('#match-results')).toBeVisible();
    await expect(page.locator('#plausible-list .match__name')).toHaveText([EVENING]);
    await expect(page.locator('#match-retry')).toBeHidden();
  });

  test('a dropped connection is a technical failure too, never "no plausible match"', async ({ page }) => {
    await openGuided(page);
    await answerEducationEmployment(page);
    await page.route('**/api/gpme/match', (route) => route.abort('connectionreset'));
    await findPrograms(page);

    await expect(matchMessage(page)).toContainText('Unable to perform matching');
    await expect(matchMessage(page)).not.toContainText('No plausible match');
    await expect(page.locator('#match-retry')).toBeVisible();
    expect((await answersStillThere(page)).needs).toHaveLength(2);
  });

  test('a malformed answer is treated as a technical failure, not as a result', async ({ page }) => {
    await openGuided(page);
    await answerEducationEmployment(page);
    await page.route('**/api/gpme/match', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'RESULTS', plausible: [{ nonsense: true }], possible: [] }),
    }));
    await findPrograms(page);
    await expect(matchMessage(page)).toContainText('Unable to perform matching');
    await expect(page.locator('#match-results')).toBeHidden();
  });

  test('need categories that cannot load: retry loads them, and Direct Referral is offered meanwhile', async ({ page }) => {
    await page.goto('/referral/');
    await ensureAffiliation(page);
    await page.reload();
    await page.route('**/api/gpme/need-categories', (route) => route.fulfill({
      status: 503, contentType: 'application/json', body: '{}',
    }));
    await page.locator('#path-guided').click();

    await expect(matchMessage(page)).toContainText('Need categories could not be loaded');
    await expect(page.locator('#match-direct')).toBeVisible();
    await page.unroute('**/api/gpme/need-categories');
    await page.locator('#match-retry').click();
    await page.locator('input[name="need"]').first().waitFor({ state: 'attached' });
    expect(await page.locator('input[name="need"]').count()).toBeGreaterThanOrEqual(5);
    await expect(page.locator('#match-message')).toBeHidden();
  });
});

test.describe('Direct Referral fallback (PRD 2.1, 8.8)', () => {
  test('after a matching failure, "Use Direct Referral" completes a referral that is not marked GPME-assisted', async ({ page }) => {
    const referrals = recordReferralPosts(page);
    await openGuided(page);
    await answerEducationEmployment(page);
    await page.route('**/api/gpme/match', (route) => route.fulfill({
      status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'UNABLE_TO_MATCH' }),
    }));
    await findPrograms(page);
    await expect(matchMessage(page)).toContainText('Unable to perform matching');

    // Matching stays down for the whole fallback: Direct Referral does not need it.
    await page.locator('#match-direct').click();
    await expect(page.locator('#direct')).toBeVisible();
    await expect(page.locator('#guided')).toBeHidden();
    expect(await focused(page)).toBe('direct-heading');

    await page.locator('#program-search').fill('Housing');
    await page.getByLabel(HOUSING, { exact: false }).first().check();
    await page.locator('#program-continue').click();
    await expect(page.locator('#summary-receiving')).toContainText(HOUSING);
    await expect(page.locator('#summary-source')).not.toContainText('Guided matching');
    await fillReferral(page, 'Synthetic Person Fallback');
    await page.locator('#send').click();

    await expect(status(page)).toContainText('Referral received !');
    expect(referrals).toHaveLength(1);
    expect(referrals[0]).not.toHaveProperty('gpme');
  });

  test('Direct Referral works from the start with matching entirely unavailable', async ({ page }) => {
    const referrals = recordReferralPosts(page);
    await page.route('**/api/gpme/**', (route) => route.abort('connectionreset'));
    await page.goto('/referral/');
    await ensureAffiliation(page);
    await page.reload();

    await page.locator('#path-direct').click();
    await page.locator('#program-options input').first().check();
    await page.locator('#program-continue').click();
    await fillReferral(page, 'Synthetic Person Independent');
    await page.locator('#send').click();
    await expect(status(page)).toContainText('Referral received !');
    expect(referrals[0]).not.toHaveProperty('gpme');
  });

  test('switching paths never carries a Program choice or matching answers across', async ({ page }) => {
    const referrals = recordReferralPosts(page);
    await openGuided(page);
    await answerEducationEmployment(page);
    await findPrograms(page);
    await page.getByRole('button', { name: `Choose ${EVENING}` }).click();
    await page.locator('#change-program').click();

    await page.locator('#path-direct').click();
    // No Program is preselected from the guided choice.
    expect(await page.locator('input[name="receivingProgram"]:checked').count()).toBe(0);
    await page.locator('#program-continue').click();
    await expect(page.locator('#program-error')).toBeVisible();
    await page.locator('input[name="receivingProgram"]').first().check();
    await page.locator('#program-continue').click();
    await fillReferral(page, 'Synthetic Person Switched');
    await page.locator('#send').click();
    await expect(status(page)).toContainText('Referral received !');
    expect(referrals[0]).not.toHaveProperty('gpme');
  });
});

test.describe('preserved work and recovery after choosing a matched Program (PRD 7.4, 7.5, 8.8)', () => {
  test('matching cannot be re-checked at send: nothing saved, details kept, resend works, or send the same Program as Direct', async ({ page }) => {
    const referrals = recordReferralPosts(page);
    await openGuided(page);
    await answerEducationEmployment(page);
    await findPrograms(page);
    await page.getByRole('button', { name: `Choose ${EVENING}` }).click();
    await fillReferral(page, 'Synthetic Person Recovery');

    let fail = true;
    await page.route('**/api/referrals', async (route) => {
      if (route.request().method() === 'POST' && fail) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'GPME_UNAVAILABLE' }) });
        return;
      }
      await route.continue();
    });
    await page.locator('#send').click();

    await expect(status(page)).toContainText('Matching could not be confirmed, so the referral was not saved');
    await expect(status(page)).toContainText('Your information has been preserved');
    expect(await page.locator('#participantName').inputValue()).toBe('Synthetic Person Recovery');
    expect(await page.locator('#referralContext').inputValue()).toContain('guided matching test');
    await expect(page.locator('#send-direct')).toBeVisible();
    await expect(page.locator('#send')).toBeEnabled();

    // Option 1: send again once matching is back; it is the same logical referral.
    fail = false;
    await page.locator('#send').click();
    await expect(status(page)).toContainText('Referral received !');
    expect(referrals).toHaveLength(2);
    expect(referrals[1].submissionId).toBe(referrals[0].submissionId);
    expect(referrals[1].gpme).toBeTruthy();
  });

  test('"send as Direct Referral" after a failed re-check sends the same Program with no matching part', async ({ page }) => {
    const referrals = recordReferralPosts(page);
    await openGuided(page);
    await answerEducationEmployment(page);
    await findPrograms(page);
    await page.getByRole('button', { name: `Choose ${EVENING}` }).click();
    await fillReferral(page, 'Synthetic Person Direct Send');

    let fail = true;
    await page.route('**/api/referrals', async (route) => {
      if (route.request().method() === 'POST' && fail) {
        fail = false;
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'GPME_UNAVAILABLE' }) });
        return;
      }
      await route.continue();
    });
    await page.locator('#send').click();
    await expect(page.locator('#send-direct')).toBeVisible();
    await page.locator('#send-direct').click();

    await expect(status(page)).toContainText('Referral received !');
    expect(referrals).toHaveLength(2);
    expect(referrals[1].receivingProgramId).toBe(referrals[0].receivingProgramId);
    expect(referrals[0]).toHaveProperty('gpme');
    expect(referrals[1]).not.toHaveProperty('gpme');
  });

  test('results changed since the search: nothing saved, fresh results for the same answers, details kept, same Submission ID', async ({ page }) => {
    const referrals = recordReferralPosts(page);
    await openGuided(page);
    await answerEducationEmployment(page);
    await findPrograms(page);
    await page.getByRole('button', { name: `Choose ${EVENING}` }).click();
    await fillReferral(page, 'Synthetic Person Changed');

    let changed = true;
    await page.route('**/api/referrals', async (route) => {
      if (route.request().method() === 'POST' && changed) {
        changed = false;
        await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'GPME_RESULT_CHANGED' }) });
        return;
      }
      await route.continue();
    });
    await page.locator('#send').click();

    // Back on the guided step with current results; the worker re-chooses.
    await expect(page.locator('#step-program')).toBeVisible();
    await expect(page.locator('#match-results')).toBeVisible();
    await expect(status(page)).toContainText('matching results changed after your search');
    await expect(status(page)).toContainText('Your information has been preserved');
    expect((await answersStillThere(page)).ageMin).toBe('19');
    expect(await page.locator('#participantName').inputValue()).toBe('Synthetic Person Changed');

    await page.getByRole('button', { name: `Choose ${EVENING}` }).click();
    await page.locator('#send').click();
    await expect(status(page)).toContainText('Referral received !');
    expect(referrals).toHaveLength(2);
    expect(referrals[1].submissionId).toBe(referrals[0].submissionId);
  });

  test('a lost confirmation is never an invitation to resend blindly (PRD 7.4)', async ({ page }) => {
    const referrals = recordReferralPosts(page);
    await openGuided(page);
    await answerEducationEmployment(page);
    await findPrograms(page);
    await page.getByRole('button', { name: `Choose ${EVENING}` }).click();
    await fillReferral(page, 'Synthetic Person Lost');

    // The server commits the referral, but the answer never reaches the browser.
    await page.route('**/api/referrals', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fetch();
        await route.abort('connectionreset');
        return;
      }
      await route.continue();
    });
    await page.locator('#send').click();

    // The page never offers a blind resend: it locks the form and asks the
    // server with the same Submission ID. The server has the referral, so the
    // answer is "already received" and nothing is sent a second time.
    await expect(status(page)).toContainText('Referral already received. Do not resend !');
    await expect(page.locator('#send')).toBeDisabled();
    expect(referrals).toHaveLength(1);
  });
});

test.describe('keyboard and accessibility of the guided journey (PRD 14.2, 14.3, 17.7)', () => {
  test('the whole guided journey by keyboard, with Enter never submitting from a text field', async ({ page }) => {
    const matches = recordMatchPosts(page);
    const referrals = recordReferralPosts(page);
    await openGuided(page);

    // Space ticks Education, Tab moves to the next need, Space ticks Employment.
    await page.locator('input[name="need"]').nth(1).focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await expect(need(page, 'Education (sample)')).toBeChecked();
    await expect(need(page, 'Employment (sample)')).toBeChecked();
    await tabTo(page, 'ageMin');
    await page.keyboard.type('19');
    await page.keyboard.press('Enter');
    expect(matches, 'Enter in a text field started a search').toHaveLength(0);
    await tabTo(page, 'ageMax');
    await page.keyboard.type('30');
    await tabTo(page, 'find-programs');
    await page.keyboard.press('Enter');
    await expect(page.locator('#match-results')).toBeVisible();
    expect(matches).toHaveLength(1);

    // Choose with the keyboard; focus moves to the details step.
    // Tab from Find Programs reaches the Choose button without the mouse.
    let reached = false;
    for (let i = 0; i < 40 && !reached; i += 1) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate((label) => document.activeElement.textContent === label, `Choose ${EVENING}`);
    }
    expect(reached, 'Choose button not reachable by keyboard').toBe(true);
    await page.keyboard.press('Enter');
    expect(await focused(page)).toBe('step-details-heading');

    await page.locator('#participantName').focus();
    await page.keyboard.type('Synthetic Person Keys');
    await page.keyboard.press('Enter');
    expect(referrals, 'Enter in a text field sent the referral').toHaveLength(0);
    await page.locator('input[name="contactMethod"][value="NOT_AVAILABLE"]').focus();
    await page.keyboard.press('Space');
    await tabTo(page, 'referralContext');
    await page.keyboard.type('Synthetic need');
    await tabTo(page, 'send');
    await page.keyboard.press('Enter');
    await expect(status(page)).toContainText('Referral received !');
    expect(referrals).toHaveLength(1);
  });

  test('every guided state passes the axe WCAG 2.2 AA scan, in light and dark', async ({ page }) => {
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme });
      await openGuided(page);
      await expectNoAxeViolations(page, `guided form (${colorScheme})`);

      await page.locator('#find-programs').click();
      await expect(page.locator('#needs-error')).toBeVisible();
      await expectNoAxeViolations(page, `guided form with errors (${colorScheme})`);

      await answerEducationEmployment(page);
      await findPrograms(page);
      await expect(page.locator('#match-results')).toBeVisible();
      await expectNoAxeViolations(page, `results (${colorScheme})`);

      await page.locator('#ageMin').fill('40');
      await page.locator('#ageMax').fill('45');
      await page.locator('input[name="need"]').evaluateAll((boxes) => boxes.forEach((b) => { b.checked = false; }));
      await need(page, 'Childcare (sample)').check();
      await findPrograms(page);
      await expect(matchMessage(page)).toContainText('No plausible match identified');
      await expectNoAxeViolations(page, `no plausible match (${colorScheme})`);

      await page.route('**/api/gpme/match', (route) => route.fulfill({
        status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'UNABLE_TO_MATCH' }),
      }));
      await page.locator('#ageMax').fill('44');
      await findPrograms(page);
      await expect(matchMessage(page)).toContainText('Unable to perform matching');
      await expectNoAxeViolations(page, `technical failure (${colorScheme})`);
      await page.unroute('**/api/gpme/match');
    }
  });

  test('text size XL keeps guided answers and results, and nothing scrolls sideways at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await openGuided(page);
    await answerEducationEmployment(page);
    await findPrograms(page);
    await expect(page.locator('#match-results')).toBeVisible();

    await page.locator('.text-size__btn[data-size="XL"]').click();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('24px');
    expect(await page.locator('.match__name').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBe(24);
    expect((await answersStillThere(page)).ageMin).toBe('19');
    await expect(page.locator('#match-results')).toBeVisible();
    // Everything the guided journey adds (the form and the results) fits the
    // phone width at XL.
    const overflowing = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      return [...document.querySelectorAll('#guided *')]
        .filter((el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().right > width + 1)
        .map((el) => `${el.tagName.toLowerCase()}#${el.id}.${el.className}`);
    });
    expect(overflowing).toEqual([]);
    await page.locator('.text-size__btn[data-size="M"]').click();
  });

  // KNOWN DEFECT (pre-existing; also fails with PR #32's CSS), found by this
  // suite and not fixed here (test-only task). Follow-up:
  // https://github.com/kwitykwity/L3-CS-QCH/issues/46
  // At XL on a 375px screen the "How do you want to choose the Program?"
  // group on the entry screen (.path-btn, #path-label) is 16px wider than
  // the screen, so the page scrolls sideways. directReferral.spec.js misses
  // it because it only measures after the entry screen is hidden. Remove
  // `fixme` once the entry screen reflows.
  test.fixme('XL at phone width: the entry screen itself does not scroll sideways', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/referral/');
    await page.locator('.text-size__btn[data-size="XL"]').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.locator('.text-size__btn[data-size="M"]').click();
  });
});

// Describe-the-need step (Task D): the description only PROPOSES answers;
// the worker corrects them; matching uses the confirmed answers alone.
test.describe('describe what the participant needs', () => {
  test('proposes answers, lets the worker correct them, then matches on the confirmed answers only', async ({ page }) => {
    await openGuided(page);
    const matchPosts = recordMatchPosts(page);
    const interpretPosts = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/gpme/interpret')) interpretPosts.push(request.postDataJSON());
    });

    await page.locator('#describe').fill('A 25 year old who wants to finish school and find a job');
    await page.locator('#describe-go').click();

    await expect(page.locator('#understood')).toBeVisible();
    await expect(page.locator('#understood-list')).toContainText('Need: Education (sample)');
    await expect(page.locator('#understood-list')).toContainText('Need: Employment (sample)');
    await expect(page.locator('#understood-list')).toContainText('Age: 25');
    await expect(need(page, 'Education (sample)')).toBeChecked();
    await expect(need(page, 'Employment (sample)')).toBeChecked();
    await expect(page.locator('#ageMin')).toHaveValue('25');
    // Nothing is matched until the worker chooses Find Programs.
    expect(matchPosts).toHaveLength(0);
    await expect(page.locator('#match-results')).toBeHidden();

    // The worker corrects the proposal: the age becomes a range.
    await page.locator('#ageMin').fill('19');
    await page.locator('#ageMax').fill('30');
    await findPrograms(page);

    await expect(page.locator('#match-results')).toBeVisible();
    await expect(page.locator('#plausible-list')).toContainText(EVENING);
    expect(interpretPosts).toEqual([{ text: 'A 25 year old who wants to finish school and find a job' }]);
    // The match request carries only the three approved criteria, never the text.
    expect(matchPosts).toEqual([{ needCategoryIds: [2, 3], ageRange: { min: 19, max: 30 } }]);
    // The worker still has to choose a Program: nothing was selected or sent.
    await expect(page.locator('#step-details')).toBeHidden();
  });

  test('the description never rides along with the referral, or with matching (PRD 5.3, 8.2)', async ({ page }) => {
    // A marker that cannot occur anywhere else, so any copy of the text is found.
    const marker = 'zq-marker-7431';
    const description = `A 25 year old who wants to finish school and find a job ${marker}`;
    const posts = [];
    page.on('request', (request) => {
      if (request.method() === 'POST') posts.push({ url: new URL(request.url()).pathname, raw: request.postData() ?? '' });
    });
    await openGuided(page);
    await page.locator('#describe').fill(description);
    await page.locator('#describe-go').click();
    await expect(page.locator('#understood')).toBeVisible();
    await findPrograms(page);
    await expect(page.locator('#match-results')).toBeVisible();
    await page.getByRole('button', { name: `Choose ${EVENING}` }).click();
    await fillReferral(page);
    await page.locator('#send').click();
    await expect(status(page)).toContainText('Referral received !');

    // The text went to exactly one place: the interpret request.
    const carrying = posts.filter((post) => post.raw.includes(marker));
    expect(carrying.map((post) => post.url)).toEqual(['/api/gpme/interpret']);
    // The real referral request: sent, free of the text, and carrying only
    // the three approved matching inputs under `gpme`.
    const referrals = posts.filter((post) => post.url === '/api/referrals');
    expect(referrals).toHaveLength(1);
    const body = JSON.parse(referrals[0].raw);
    expect(JSON.stringify(body)).not.toContain(marker);
    expect(Object.keys(body.gpme).sort()).toEqual(['ageRange', 'needCategoryIds']);
    expect(Object.keys(body)).not.toEqual(expect.arrayContaining(['description', 'text']));
    // And nothing kept it in the page's storage or address.
    const kept = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }) + location.href);
    expect(kept).not.toContain(marker);
  });

  test('says so when nothing is understood, and leaves the answers to the worker', async ({ page }) => {
    await openGuided(page);
    await page.locator('#describe').fill('please help');
    await page.locator('#describe-go').click();
    await expect(page.locator('#understood-message')).toContainText('Nothing was filled in');
    await expect(page.locator('input[name="need"]:checked')).toHaveCount(0);
    await expect(page.locator('#match-direct, #path-direct')).not.toHaveCount(0);
  });

  test('a technical failure keeps the text and keeps the manual answers available', async ({ page }) => {
    await openGuided(page);
    await page.route('**/api/gpme/interpret', (route) => route.fulfill({
      status: 503, contentType: 'application/json', body: JSON.stringify({ status: 'UNABLE_TO_INTERPRET' }),
    }));
    await page.locator('#describe').fill('needs a job');
    await page.locator('#describe-go').click();
    await expect(page.locator('#understood-message')).toContainText('technical problem');
    await expect(page.locator('#describe')).toHaveValue('needs a job');
    await need(page, 'Employment (sample)').check();
    await expect(need(page, 'Employment (sample)')).toBeChecked();
  });

  test('the describe step has no accessibility violations', async ({ page }) => {
    await openGuided(page);
    await page.locator('#describe').fill('A 25 year old who needs a job');
    await page.locator('#describe-go').click();
    await expect(page.locator('#understood')).toBeVisible();
    await expectNoAxeViolations(page);
  });
});
