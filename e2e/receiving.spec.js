// Task A: receiving-side screens in a real browser (Final Technical PRD
// 2.3, 3.3, 3.6, 3.7, 6.1, 6.2, 6.4, 6.5, 9.4, 13.4, 14).
//
// The synthetic dev server's one developer receives referrals for sample
// Program 4 (scripts/syntheticSeed.js, receiving: true). Each test makes
// its own referrals with a per-run name, so tests do not depend on each
// other or on the order spec files run in. SYNTHETIC data only.

import { test, expect } from '@playwright/test';
import { ensureAffiliation, expectNoAxeViolations, focused } from './helpers.js';

const RUN = Date.now().toString(36);
const RECEIVING = 4;      // Housing Help Desk (sample): the developer receives here
const NOT_RECEIVING = 5;  // Job Readiness Workshop (sample): the developer does not
let n = 0;

async function makeReferral(page, request, receivingProgramId = RECEIVING) {
  await page.goto('/receiving/');
  await ensureAffiliation(page, 1);
  n += 1;
  const name = `Synthetic Receiver ${RUN}-${n}`;
  const response = await request.post('/api/referrals', {
    data: {
      submissionId: crypto.randomUUID(), receivingProgramId, participantName: name,
      contactMethod: 'PHONE_CALL', contactValue: '(555) 010-0199', referralContext: `Synthetic need ${RUN}-${n}`,
    },
  });
  expect(response.status()).toBe(201);
  return { id: (await response.json()).referral.referralId, name };
}

async function saved(request, id) {
  const response = await request.get(`/api/referrals/${id}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).referral;
}

async function open(page, id) {
  await page.goto(`/receiving/referral.html?id=${id}`);
  await expect(page.locator('#status .status__text')).toHaveText(/Referral loaded\.|not available/);
}

const status = (page) => page.locator('#status .status__text');
const step = (page, which) => page.locator(`#${which}-value`);

// Records requests that would change a referral, to prove nothing was sent.
function watchChanges(page) {
  const sent = [];
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/api/referrals/')) sent.push(new URL(r.url()).pathname); });
  return sent;
}

test.describe('received referrals list', () => {
  test('shows only referrals for Programs I receive for, with the three steps kept separate', async ({ page, request }) => {
    const mine = await makeReferral(page, request);
    const notMine = await makeReferral(page, request, NOT_RECEIVING);
    await page.goto('/receiving/');
    await expect(page.locator('#results')).toBeVisible();

    const item = page.locator('.queue-item').filter({ hasText: mine.name });
    await expect(item).toHaveCount(1);
    await expect(page.locator('.queue-item').filter({ hasText: notMine.name })).toHaveCount(0);
    await expect(item.locator('dt')).toHaveText(['Response', 'Decision', 'Service outcome']);
    await expect(item.locator('dd')).toHaveText(['Awaiting response', 'No decision yet', 'Not recorded (no decision yet)']);

    // Filter by stage: an Awaiting referral is not "Complete".
    await page.locator('#stage-filter').selectOption('COMPLETE');
    await page.locator('#show').click();
    await expect(page.locator('#results-heading')).toBeFocused();
    await expect(page.locator('.queue-item').filter({ hasText: mine.name })).toHaveCount(0);
    await page.locator('#stage-filter').selectOption('AWAITING_RESPONSE');
    await page.locator('#show').click();
    await expect(page.locator('.queue-item').filter({ hasText: mine.name })).toHaveCount(1);

    // Nothing about the participant goes into the address.
    await item.getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/receiving/referral\\.html\\?id=${mine.id}$`));
  });
});

test.describe('accept path', () => {
  test('accept, record the outcome, then correct it, keyboard only; Accepted never reads as served', async ({ page, request }) => {
    const { id } = await makeReferral(page, request);
    await open(page, id);
    await expect(page.locator('#outcome-panel')).toBeHidden();

    // Choose Accept and send, without the mouse.
    await page.locator('#respond-accept').focus();
    await page.keyboard.press('Space');
    await page.locator('#respond-submit').focus();
    page.once('dialog', (d) => d.accept());
    await page.keyboard.press('Enter');
    await expect(status(page)).toHaveText('Response sent: Accepted. The service outcome is not recorded yet.');
    expect(await focused(page)).toBe('status');
    await expect(step(page, 'decision')).toHaveText('Accepted');
    await expect(step(page, 'outcome')).toHaveText('Not recorded');
    await expect(page.locator('#outcome-note')).toContainText('Accepted is not the same as served.');
    expect(await saved(request, id)).toMatchObject({ decision: 'ACCEPTED', serviceOutcome: 'NOT_RECORDED' });

    // Record the outcome.
    await expect(page.locator('#respond-panel')).toBeHidden();
    await page.locator('#outcome-resulted').check();
    page.once('dialog', (d) => d.accept());
    await page.locator('#outcome-submit').click();
    await expect(status(page)).toHaveText('Service outcome recorded: Resulted in service.');
    await expect(step(page, 'outcome')).toContainText('Resulted in service (recorded');
    expect((await saved(request, id)).serviceOutcome).toBe('RESULTED_IN_SERVICE');

    // Correct it; the form starts from the saved value.
    await expect(page.locator('#outcome-panel')).toBeHidden();
    await expect(page.locator('#co-resulted')).toBeChecked();
    await page.locator('#co-not-resulted').check();
    page.once('dialog', (d) => d.accept());
    await page.locator('#correct-outcome-submit').click();
    await expect(status(page)).toHaveText('Service outcome corrected to: Did not result in service.');
    expect((await saved(request, id)).serviceOutcome).toBe('DID_NOT_RESULT_IN_SERVICE');

    // Saving the same value again changes nothing.
    page.once('dialog', (d) => d.accept());
    await page.locator('#correct-outcome-submit').click();
    await expect(status(page)).toHaveText('That is already the saved value. Nothing was changed.');
  });

  test('a decision cannot become Not appropriate while an outcome is recorded', async ({ page, request }) => {
    const { id } = await makeReferral(page, request);
    await request.post(`/api/referrals/${id}/response`, { data: { decision: 'ACCEPTED' } });
    await request.post(`/api/referrals/${id}/outcome`, { data: { outcome: 'RESULTED_IN_SERVICE' } });
    await open(page, id);
    await page.locator('#cd-na').check();
    await page.locator('#cd-reason').selectOption({ index: 1 });
    page.once('dialog', (d) => d.accept());
    await page.locator('#correct-decision-submit').click();
    await expect(status(page)).toContainText('Correct the outcome to "not recorded" before changing the decision');
    expect(await saved(request, id)).toMatchObject({ decision: 'ACCEPTED', serviceOutcome: 'RESULTED_IN_SERVICE' });
  });
});

test.describe('Not appropriate path', () => {
  test('needs a reason; has no outcome; correcting to Accepted makes the outcome possible', async ({ page, request }) => {
    const { id } = await makeReferral(page, request);
    const sent = watchChanges(page);
    await open(page, id);

    // Nothing chosen: focus goes to the first choice.
    await page.locator('#respond-submit').click();
    await expect(page.locator('#respond-decision-error')).toHaveText('Choose a decision.');
    expect(await focused(page)).toBe('respond-accept');
    // Not appropriate without a reason: focus goes to the reason.
    await page.locator('#respond-na').check();
    await expect(page.locator('#respond-reason')).toHaveAttribute('aria-required', 'true');
    await page.locator('#respond-submit').click();
    await expect(page.locator('#respond-reason-error')).toHaveText('Choose a reason.');
    expect(await focused(page)).toBe('respond-reason');
    expect(sent, 'nothing is sent while the form is incomplete').toEqual([]);

    await page.locator('#respond-reason').selectOption({ label: 'Program currently unavailable' });
    await page.locator('#respond-explanation').fill('Synthetic explanation');
    page.once('dialog', (d) => d.accept());
    await page.locator('#respond-submit').click();
    await expect(status(page)).toHaveText('Response sent: Not appropriate.');
    await expect(step(page, 'decision')).toHaveText('Not appropriate');
    await expect(page.locator('#reason-value')).toHaveText('Reason: Program currently unavailable');
    await expect(page.locator('#explanation-value')).toHaveText('Explanation: Synthetic explanation');
    await expect(step(page, 'outcome')).toHaveText('Not applicable (the decision is Not appropriate)');
    await expect(page.locator('#outcome-panel')).toBeHidden();
    await expect(page.locator('#correct-outcome-panel')).toBeHidden();

    // Correct the decision to Accepted; now an outcome can be recorded.
    await page.locator('#cd-accept').check();
    page.once('dialog', (d) => d.accept());
    await page.locator('#correct-decision-submit').click();
    await expect(status(page)).toHaveText('Decision corrected to: Accepted.');
    await expect(page.locator('#outcome-panel')).toBeVisible();
    expect(await saved(request, id)).toMatchObject({ decision: 'ACCEPTED', notAppropriateReason: null });
  });
});

test.describe('changes that cannot be confirmed', () => {
  test('stale page: shows what is saved now, keeps my choice, locks actions until I load the latest', async ({ page, request }) => {
    const { id } = await makeReferral(page, request);
    await request.post(`/api/referrals/${id}/response`, { data: { decision: 'ACCEPTED' } });
    await request.post(`/api/referrals/${id}/outcome`, { data: { outcome: 'RESULTED_IN_SERVICE' } });
    await open(page, id);
    await page.locator('#co-not-recorded').check();

    // Someone else corrects it first.
    const current = await saved(request, id);
    const elsewhere = await request.post(`/api/referrals/${id}/outcome/correction`, {
      data: { outcome: 'DID_NOT_RESULT_IN_SERVICE', version: current.version },
    });
    expect(elsewhere.ok()).toBeTruthy();

    page.once('dialog', (d) => d.accept());
    await page.locator('#correct-outcome-submit').click();
    await expect(page.locator('#conflict')).toBeVisible();
    await expect(page.locator('#conflict-heading')).toBeFocused();
    await expect(page.locator('#conflict-current dd')).toHaveText(['Responded', 'Accepted', 'Did not result in service']);
    await expect(page.locator('#co-not-recorded'), 'my choice stays on screen').toBeChecked();
    await expect(page.locator('#correct-outcome-submit')).toBeDisabled();
    await expect(page.locator('#correct-decision-submit')).toBeDisabled();
    expect((await saved(request, id)).serviceOutcome).toBe('DID_NOT_RESULT_IN_SERVICE');

    await page.locator('#load-latest').click();
    await expect(status(page)).toHaveText('Latest information loaded. Review it, then choose again.');
    await expect(page.locator('#conflict')).toBeHidden();
    await expect(page.locator('#co-not-resulted')).toBeChecked();
    await expect(page.locator('#correct-outcome-submit')).toBeEnabled();
  });

  test('someone else responded first: nothing is sent twice, and I review the latest', async ({ page, request }) => {
    const { id } = await makeReferral(page, request);
    await open(page, id);
    await request.post(`/api/referrals/${id}/response`, { data: { decision: 'ACCEPTED' } });
    await page.locator('#respond-na').check();
    await page.locator('#respond-reason').selectOption({ index: 1 });
    page.once('dialog', (d) => d.accept());
    await page.locator('#respond-submit').click();
    await expect(page.locator('#conflict-message')).toContainText('already has a response');
    await expect(page.locator('#respond-submit')).toBeDisabled();
    expect((await saved(request, id)).decision).toBe('ACCEPTED');
  });

  test('lost connection: the outcome is unconfirmed and nothing is sent again until I reload', async ({ page, request }) => {
    const { id } = await makeReferral(page, request);
    await request.post(`/api/referrals/${id}/response`, { data: { decision: 'ACCEPTED' } });
    await open(page, id);
    const url = `**/api/referrals/${id}/outcome`;
    await page.route(url, (route) => route.abort());
    await page.locator('#outcome-not-resulted').check();
    page.once('dialog', (d) => d.accept());
    await page.locator('#outcome-submit').click();
    await expect(page.locator('#conflict-message')).toContainText('could not confirm whether your change was saved');
    await expect(status(page)).toHaveText(/could not confirm whether your change was saved\. It may have been saved\./);
    await expect(status(page), 'an unknown outcome is never called "not saved"').not.toContainText('not saved');
    await expect(page.locator('#outcome-submit')).toBeDisabled();
    await page.unroute(url);
    await page.locator('#load-latest').click();
    await expect(page.locator('#outcome-submit')).toBeEnabled();
    expect((await saved(request, id)).serviceOutcome).toBe('NOT_RECORDED');
  });

  test('saved on the server but the answer was lost: says it may have saved, locks, and the latest shows it', async ({ page, request }) => {
    const { id } = await makeReferral(page, request);
    await open(page, id);
    const url = `**/api/referrals/${id}/response`;
    // The request reaches the server and commits; the browser never hears back.
    await page.route(url, async (route) => { await route.fetch(); await route.abort(); });
    await page.locator('#respond-accept').check();
    page.once('dialog', (d) => d.accept());
    await page.locator('#respond-submit').click();
    await expect(page.locator('#conflict')).toBeVisible();
    await expect(status(page)).toHaveText(/It may have been saved\./);
    await expect(status(page)).not.toContainText('not saved');
    await expect(page.locator('#respond-submit')).toBeDisabled();
    expect((await saved(request, id)).decision, 'the change really was saved').toBe('ACCEPTED');
    await page.unroute(url);

    await page.locator('#load-latest').click();
    await expect(step(page, 'decision')).toHaveText('Accepted');
    await expect(page.locator('#respond-panel')).toBeHidden();
    await expect(page.locator('#outcome-submit')).toBeEnabled();
  });

  test('cancelling a confirmation sends nothing', async ({ page, request }) => {
    const { id } = await makeReferral(page, request);
    const sent = watchChanges(page);
    await open(page, id);
    await page.locator('#respond-accept').check();
    page.once('dialog', (d) => d.dismiss());
    await page.locator('#respond-submit').click();
    expect(sent).toEqual([]);
    expect((await saved(request, id)).responseStatus).toBe('AWAITING_RESPONSE');
  });
});

// Shared recovery path: every change goes through handle(). When the
// server confirms a change but the reload right after it fails, every
// action stays locked and the success message stays, until an explicit
// reload succeeds.
test.describe('saved, but the reload after it fails', () => {
  const ALL_SUBMITS = ['#respond-submit', '#outcome-submit', '#correct-outcome-submit', '#correct-decision-submit'];

  async function notAppropriateReason(request) {
    const response = await request.get('/api/referrals/not-appropriate-reasons');
    expect(response.ok()).toBeTruthy();
    return (await response.json()).reasons[0].reasonId;
  }

  const CASES = [
    {
      name: 'first response (Accept)',
      setup: async () => {},
      choose: (page) => page.locator('#respond-accept').check(),
      submit: '#respond-submit',
      done: 'Response sent: Accepted. The service outcome is not recorded yet.',
      saved: { decision: 'ACCEPTED' },
      afterReload: { decision: 'Accepted', enabled: '#outcome-submit', hidden: '#respond-panel' },
    },
    {
      name: 'record the service outcome',
      setup: async (request, id) => {
        await request.post(`/api/referrals/${id}/response`, { data: { decision: 'ACCEPTED' } });
      },
      choose: (page) => page.locator('#outcome-resulted').check(),
      submit: '#outcome-submit',
      done: 'Service outcome recorded: Resulted in service.',
      saved: { serviceOutcome: 'RESULTED_IN_SERVICE' },
      afterReload: { decision: 'Accepted', enabled: '#correct-outcome-submit', hidden: '#outcome-panel' },
    },
    {
      name: 'correct the service outcome',
      setup: async (request, id) => {
        await request.post(`/api/referrals/${id}/response`, { data: { decision: 'ACCEPTED' } });
        await request.post(`/api/referrals/${id}/outcome`, { data: { outcome: 'RESULTED_IN_SERVICE' } });
      },
      choose: (page) => page.locator('#co-not-resulted').check(),
      submit: '#correct-outcome-submit',
      done: 'Service outcome corrected to: Did not result in service.',
      saved: { serviceOutcome: 'DID_NOT_RESULT_IN_SERVICE' },
      afterReload: { decision: 'Accepted', enabled: '#correct-outcome-submit', hidden: '#outcome-panel' },
    },
    {
      name: 'correct the decision',
      setup: async (request, id) => {
        const reasonId = await notAppropriateReason(request);
        await request.post(`/api/referrals/${id}/response`, { data: { decision: 'NOT_APPROPRIATE', reasonId } });
      },
      choose: (page) => page.locator('#cd-accept').check(),
      submit: '#correct-decision-submit',
      done: 'Decision corrected to: Accepted.',
      saved: { decision: 'ACCEPTED' },
      afterReload: { decision: 'Accepted', enabled: '#outcome-submit', hidden: '#respond-panel' },
    },
  ];

  for (const c of CASES) {
    test(`${c.name}: actions stay locked until an explicit reload succeeds`, async ({ page, request }) => {
      const { id } = await makeReferral(page, request);
      await c.setup(request, id);
      await open(page, id);

      // From now on, loading this referral fails (the change itself still works).
      const getUrl = `**/api/referrals/${id}`;
      await page.route(getUrl, (route) => (route.request().method() === 'GET' ? route.abort() : route.fallback()));

      await c.choose(page);
      page.once('dialog', (d) => d.accept());
      await page.locator(c.submit).click();

      // Confirmed success stays on screen, and nothing can be sent.
      await expect(status(page)).toContainText(c.done);
      await expect(status(page)).toContainText('every action is locked');
      for (const sel of ALL_SUBMITS) await expect(page.locator(sel), `${sel} is locked`).toBeDisabled();
      expect(await page.locator('form button[type="submit"]:enabled').count()).toBe(0);
      await expect(page.locator('#reload')).toBeVisible();
      await expect(page.locator('#reload')).toBeEnabled();
      expect(await saved(request, id)).toMatchObject(c.saved);

      // A reload that fails again keeps the success message and the lock.
      await page.locator('#reload').click();
      await expect(status(page)).toContainText(c.done);
      await expect(status(page)).toContainText('still could not load');
      for (const sel of ALL_SUBMITS) await expect(page.locator(sel)).toBeDisabled();

      // Only an explicit, successful reload unlocks, showing the saved state.
      await page.unroute(getUrl);
      await page.locator('#reload').click();
      await expect(status(page)).toHaveText(`${c.done} Referral reloaded.`);
      await expect(step(page, 'decision')).toHaveText(c.afterReload.decision);
      await expect(page.locator(c.afterReload.hidden)).toBeHidden();
      await expect(page.locator(c.afterReload.enabled)).toBeEnabled();
    });
  }
});

test.describe('who may act', () => {
  test('a referral I only sent is read-only here, and the server refuses changes anyway', async ({ page, request }) => {
    const { id } = await makeReferral(page, request, NOT_RECEIVING);
    await open(page, id);
    await expect(page.locator('#readonly-note')).toContainText('You sent this referral.');
    for (const panel of ['respond', 'outcome', 'correct-outcome', 'correct-decision']) {
      await expect(page.locator(`#${panel}-panel`)).toBeHidden();
    }
    // Skipping the screen does not help: the server checks every action.
    const response = await page.evaluate(async (refId) => {
      const r = await fetch(`/api/referrals/${refId}/response`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'ACCEPTED' }),
      });
      return r.status;
    }, id);
    expect(response).toBe(403);
    expect((await saved(request, id)).responseStatus).toBe('AWAITING_RESPONSE');
  });

  test('an unknown referral reveals nothing', async ({ page }) => {
    await page.goto('/receiving/referral.html?id=999999');
    await expect(status(page)).toHaveText('This referral is not available. It may not exist, or you may not have access to it.');
    await expect(page.locator('#info')).toBeHidden();
    await page.goto('/receiving/referral.html?id=abc');
    await expect(status(page)).toHaveText('This referral is not available. It may not exist, or you may not have access to it.');
  });
});

test.describe('accessibility', () => {
  for (const colorScheme of ['light', 'dark']) {
    test(`list and every referral state pass axe (${colorScheme})`, async ({ page, request }) => {
      await page.emulateMedia({ colorScheme });
      const { id } = await makeReferral(page, request);
      await page.goto('/receiving/');
      await expect(page.locator('#results')).toBeVisible();
      await expectNoAxeViolations(page, 'received list');

      await open(page, id);
      await expectNoAxeViolations(page, 'awaiting response');
      await page.locator('#respond-na').check();
      await page.locator('#respond-submit').click();
      await expect(page.locator('#respond-reason-error')).toBeVisible();
      await expectNoAxeViolations(page, 'response with errors');

      await request.post(`/api/referrals/${id}/response`, { data: { decision: 'ACCEPTED' } });
      await open(page, id);
      await expectNoAxeViolations(page, 'accepted, outcome not recorded');

      // Someone else records the outcome first: the review panel appears.
      await page.locator('#outcome-resulted').check();
      await request.post(`/api/referrals/${id}/outcome`, { data: { outcome: 'RESULTED_IN_SERVICE' } });
      page.once('dialog', (d) => d.accept());
      await page.locator('#outcome-submit').click();
      await expect(page.locator('#conflict')).toBeVisible();
      await expectNoAxeViolations(page, 'review before you continue');

      await page.locator('#load-latest').click();
      await expect(page.locator('#correct-outcome-panel')).toBeVisible();
      await expectNoAxeViolations(page, 'outcome recorded, corrections available');
    });
  }

  for (const [label, path] of [['list', '/receiving/'], ['referral', null]]) {
    test(`XL text at phone width does not scroll sideways (${label})`, async ({ page, request }) => {
      const target = path ?? `/receiving/referral.html?id=${(await makeReferral(page, request)).id}`;
      await page.setViewportSize({ width: 375, height: 800 });
      await page.goto(target);
      await page.locator('[data-size="XL"]').click();
      await expect(status(page)).not.toHaveText(/^Loading/);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('24px');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, 'pixels of sideways scroll').toBeLessThanOrEqual(0);
      await page.locator('[data-size="M"]').click();
    });
  }
});
