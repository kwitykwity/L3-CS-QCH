// Trello Task UU: the worker reviews and corrects interpreted information
// before matching (Frozen Handoff PRD §3.1, §4.1, §5.2; Handoff MVP §5).
//
//   PRD §5.2  Proposed information must be shown to the employee before
//             GPME matching. The employee may accept it, correct it, remove
//             it, or provide appropriate missing information.
//   PRD §4.1  The employee must be able to review and correct the
//             interpretation before matching occurs.
//
// Already covered in e2e/gpme.spec.js ("describe what the participant
// needs"): an interpreted AGE is corrected before matching, and nothing is
// matched before Find Programs. This file covers the NEEDS:
//   1. an incorrect proposed need can be removed, and is not used;
//   2. a missed need can be added, and is used;
//   3. matching does not happen until the worker confirms with Find
//      Programs: not on interpreting, and not while the answers are edited.
// Tests only. Runs against the real synthetic backend. SYNTHETIC data only.
//
// Synthetic seed (scripts/syntheticSeed.js) used here, no age or ZIP given:
//   Childcare (1)  -> Early Childhood Playgroup (sample)
//   Employment (3) -> Job Readiness Workshop, Adult Evening Classes (sample)
//   Housing (4)    -> Housing Help Desk (sample)

import { test, expect } from '@playwright/test';
import { ensureAffiliation } from './helpers.js';

const CHILDCARE = 1;
const HOUSING = 4;
const PLAYGROUP = 'Early Childhood Playgroup (sample)';
const HOUSING_DESK = 'Housing Help Desk (sample)';
const JOB_READINESS = 'Job Readiness Workshop (sample)';
const EVENING = 'Adult Evening Classes (sample)';
const DESCRIPTION = 'Needs housing help soon; mentioned a job in passing';

async function openGuided(page) {
  await page.goto('/referral/');
  await ensureAffiliation(page);
  await page.reload();
  await page.locator('#path-guided').click();
  await expect(page.locator('#guided')).toBeVisible();
  await page.locator('input[name="need"]').first().waitFor({ state: 'attached' });
}

const need = (page, name) => page.getByLabel(name, { exact: true });
const checkedNeeds = (page) => page.locator('input[name="need"]:checked')
  .evaluateAll((boxes) => boxes.map((box) => Number(box.value)).sort((a, b) => a - b));
const results = (page) => page.locator('#match-results');

function recordMatchPosts(page) {
  const posts = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/gpme/match') posts.push(request.postDataJSON());
  });
  return posts;
}

// Describe the need and wait for the proposal. Returns the interpret answer.
async function describe(page, text) {
  await page.locator('#describe').fill(text);
  const answered = page.waitForResponse((r) => r.request().method() === 'POST'
    && new URL(r.url()).pathname === '/api/gpme/interpret');
  await page.locator('#describe-go').click();
  const response = await answered;
  expect(response.status()).toBe(200);
  await expect(page.locator('#understood')).toBeVisible();
  return response.json();
}

test.describe('the worker corrects the interpreted needs before matching (Task UU)', () => {
  test('a wrong proposed need is removed and a missed need is added; matching uses exactly what the worker confirmed', async ({ page }) => {
    const matchPosts = recordMatchPosts(page);
    await openGuided(page);

    // 1. The proposal: Housing and Employment, shown for review, nothing matched.
    const proposal = await describe(page, DESCRIPTION);
    expect(proposal.status).toBe('INTERPRETED');
    expect(proposal.needs.map((n) => n.name).sort()).toEqual(['Employment (sample)', 'Housing (sample)']);
    expect(Object.keys(proposal)).not.toEqual(expect.arrayContaining(['plausible', 'possible']));
    await expect(page.locator('#understood-list')).toContainText('Need: Housing (sample)');
    await expect(page.locator('#understood-list')).toContainText('Need: Employment (sample)');
    await expect(need(page, 'Housing (sample)')).toBeChecked();
    await expect(need(page, 'Employment (sample)')).toBeChecked();
    expect(matchPosts).toHaveLength(0);
    await expect(page.locator('#match-results')).toBeHidden();

    // 2. Remove the wrong need (Employment) and add the missed one (Childcare).
    await need(page, 'Employment (sample)').uncheck();
    await need(page, 'Childcare (sample)').check();
    expect(await checkedNeeds(page)).toEqual([CHILDCARE, HOUSING]);
    // Editing the answers does not match either.
    expect(matchPosts).toHaveLength(0);
    await expect(page.locator('#match-results')).toBeHidden();

    // 3. Only the worker's confirmation (Find Programs) matches, once, on
    //    exactly the confirmed needs: Employment gone, Childcare included.
    await page.locator('#find-programs').click();
    await expect(page.locator('#match-results')).toBeVisible();
    expect(matchPosts).toHaveLength(1);
    expect(matchPosts[0]).toEqual({ needCategoryIds: [CHILDCARE, HOUSING] });

    await expect(results(page)).toContainText(HOUSING_DESK);
    await expect(results(page)).toContainText(PLAYGROUP);
    await expect(results(page)).not.toContainText(JOB_READINESS);
    await expect(results(page)).not.toContainText(EVENING);

    // Nothing was chosen or sent on the worker's behalf.
    await expect(page.locator('#step-details')).toBeHidden();
  });

  test('removing every proposed need leaves nothing to match on, and nothing is matched', async ({ page }) => {
    const matchPosts = recordMatchPosts(page);
    await openGuided(page);
    await describe(page, DESCRIPTION);
    await need(page, 'Employment (sample)').uncheck();
    await need(page, 'Housing (sample)').uncheck();
    expect(await checkedNeeds(page)).toEqual([]);

    await page.locator('#find-programs').click();
    // A need is required, so the worker is asked for one instead of matching.
    await expect(page.locator('#needs-error')).toBeVisible();
    await expect(page.locator('#needs-error')).toContainText('Choose at least one need.');
    await expect(page.locator('#match-results')).toBeHidden();
    expect(matchPosts).toHaveLength(0);
  });
});
