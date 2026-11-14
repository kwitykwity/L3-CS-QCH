// Trello Task 253: the referral detail page in the wireframe 7 and 7b layout.
// On a wide screen the referral sits on the left and the action box on the
// right; at XL text or on a phone they stack, details first. The heading
// carries the stage pill in words. The sender's view has no action box.
// SYNTHETIC data only.

import { test, expect } from '@playwright/test';
import { ensureAffiliation } from './helpers.js';

const RUN = Date.now().toString(36);
const HOUSING = 4; // Housing Help Desk (sample): this developer also receives for it

async function send(page, request, name) {
  await page.goto('/sent/');
  await ensureAffiliation(page, 1);
  const response = await request.post('/api/referrals', {
    data: { submissionId: crypto.randomUUID(), receivingProgramId: HOUSING, participantName: name, contactMethod: 'PHONE_CALL', contactValue: '(555) 010-0151', referralContext: `Synthetic need ${name}` },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).referral.referralId;
}

const box = (page, id) => page.locator(`#${id}`).evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
});

async function openReceived(page, id) {
  await page.goto(`/receiving/referral.html?id=${id}`);
  await expect(page.locator('#info')).toBeVisible();
}

test.describe('Referral detail layout (Task 253)', () => {
  test('wide screen: the response box is on the right of the details, and comes after them in Tab order', async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const id = await send(page, request, `Synthetic Detail ${RUN}-1`);
    await openReceived(page, id);
    await expect(page.locator('#stage-line .pill')).toHaveText('Awaiting response');
    await expect(page.locator('#respond-panel')).toBeVisible();
    const info = await box(page, 'info');
    const respond = await box(page, 'respond-panel');
    expect(respond.left).toBeGreaterThan(info.right);
    expect(Math.abs(respond.top - info.top)).toBeLessThan(2);
    // Details first in the document, so keyboard and screen reader users meet them before the form.
    expect(await page.evaluate(() => Boolean(
      document.getElementById('progress').compareDocumentPosition(document.getElementById('respond-panel')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ))).toBe(true);
    await expect(page.locator('#info-list')).toContainText('Sent by');
  });

  test('XL text on a wide screen stacks the action box under the details', async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const id = await send(page, request, `Synthetic Detail ${RUN}-2`);
    await openReceived(page, id);
    await page.locator('[data-size="XL"]').click();
    const progress = await box(page, 'progress');
    const respond = await box(page, 'respond-panel');
    expect(respond.top).toBeGreaterThanOrEqual(progress.bottom - 1);
  });

  test('after accepting, the pill and the outcome box follow; Accepted is not shown as service', async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const id = await send(page, request, `Synthetic Detail ${RUN}-3`);
    expect((await request.post(`/api/referrals/${id}/response`, { data: { decision: 'ACCEPTED' } })).ok()).toBeTruthy();
    await openReceived(page, id);
    await expect(page.locator('#stage-line .pill')).toHaveText('Accepted, service outcome not recorded');
    await expect(page.locator('#stage-line .pill')).toHaveClass(/pill--info/);
    await expect(page.locator('#outcome-panel')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record outcome', exact: true })).toBeVisible();
    expect((await box(page, 'outcome-panel')).left).toBeGreaterThan((await box(page, 'info')).right);
  });

  test('the sender sees the same pill and no action box', async ({ page, request }) => {
    const id = await send(page, request, `Synthetic Detail ${RUN}-4`);
    await page.goto(`/sent/referral.html?id=${id}`);
    await expect(page.locator('#info')).toBeVisible();
    await expect(page.locator('#stage-line .pill')).toHaveText('Awaiting response');
    await expect(page.locator('#respond-panel, #outcome-panel, .detail-actions')).toHaveCount(0);
  });

  test('phone at XL: one column and nothing scrolls sideways', async ({ page, request }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const id = await send(page, request, `Synthetic Detail ${RUN}-5`);
    await openReceived(page, id);
    await page.locator('[data-size="XL"]').click();
    expect((await box(page, 'respond-panel')).top).toBeGreaterThanOrEqual((await box(page, 'progress')).bottom - 1);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
});
