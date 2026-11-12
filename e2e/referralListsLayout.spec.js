// Trello Task 252: list rows with a status pill (wireframes 4 and 6).
// SYNTHETIC data only.

import { test, expect } from '@playwright/test';
import { ensureAffiliation } from './helpers.js';

const RUN = Date.now().toString(36);
const HOUSING = 4; // Housing Help Desk (sample): this developer also receives for it

async function send(page, request, name) {
  const response = await request.post('/api/referrals', {
    data: { submissionId: crypto.randomUUID(), receivingProgramId: HOUSING, participantName: name, contactMethod: 'PHONE_CALL', contactValue: '(555) 010-0150', referralContext: `Synthetic need ${name}` },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).referral.referralId;
}

test('each referral row shows its stage as a pill in words, beside the link, on both lists', async ({ page, request }) => {
  await page.goto('/sent/');
  await ensureAffiliation(page, 1);
  const waiting = `Synthetic Pill ${RUN}-1`;
  const declined = `Synthetic Pill ${RUN}-2`;
  await send(page, request, waiting);
  const id = await send(page, request, declined);
  const reasons = (await (await request.get('/api/referrals/not-appropriate-reasons')).json()).reasons;
  expect((await request.post(`/api/referrals/${id}/response`, {
    data: { decision: 'NOT_APPROPRIATE', reasonId: reasons[0].reasonId, explanation: 'Synthetic explanation' },
  })).ok()).toBeTruthy();

  for (const list of ['/sent/', '/receiving/']) {
    await page.goto(list);
    const row = (name) => page.locator('.queue-item').filter({ hasText: name });
    await expect(row(waiting)).toHaveCount(1);
    await expect(row(waiting).locator('.pill')).toHaveText('Awaiting response');
    await expect(row(waiting).locator('.pill')).toHaveClass(/pill--neutral/);
    await expect(row(declined).locator('.pill')).toHaveText('Complete');
    await expect(row(declined).locator('.pill'), 'Not appropriate is never shown as a success').toHaveClass(/pill--warning/);
    // The link is still the only link, and its name has no pill text in it.
    await expect(row(waiting).getByRole('link')).toHaveText(new RegExp(`^Referral \\d+: ${waiting}$`));
  }
});

test('phone at XL: rows and the filter fit without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  for (const list of ['/sent/', '/receiving/']) {
    await page.goto(list);
    await page.locator('[data-size="XL"]').click();
    await expect(page.locator('#filters')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), list).toBe(true);
  }
});
