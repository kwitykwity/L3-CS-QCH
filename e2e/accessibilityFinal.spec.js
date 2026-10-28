// Trello Task BB: final accessibility verification across every screen on
// main (Final Technical PRD 14.1 to 14.5; team target WCAG 2.2 AA).
//
// The per-screen specs test each workflow in depth. This file sweeps every
// screen the same way, so a screen that is not someone's focus still gets
// checked:
//   - S/M/L/XL are exactly 12/14/18/24px, and at XL nothing scrolls
//     sideways at 375px or 320px (the WCAG reflow width),
//   - the text size reaches every form control (inputs, dropdowns, boxes,
//     buttons), not only the words around them,
//   - axe finds nothing at XL on a 320px screen, in both themes.
// The three defects Task BB found and fixed each fail here if they return:
// the New Referral path buttons (issue #46), the sent and received list
// items at 320px, and number boxes that ignored the text size.
// SYNTHETIC data only.

import { test, expect } from '@playwright/test';
import { ensureAffiliation, expectNoAxeViolations } from './helpers.js';

const SIZES = { S: 12, M: 14, L: 18, XL: 24 };

// Every screen, in the state a worker sees it. `id` is a referral to the
// sample Program the developer receives for.
function screens(id) {
  return [
    ['New Referral, choose how', '/referral/'],
    ['Find a Program', '/referral/', (p) => p.locator('#path-guided').click()],
    ['Direct Referral', '/referral/', (p) => p.locator('#path-direct').click()],
    ['Referral details', '/referral/', async (p) => {
      await p.locator('#path-direct').click();
      await p.locator('#program-options input').first().check();
      await p.locator('#program-continue').click();
      await expect(p.locator('#step-details')).toBeVisible();
    }],
    ['Received referrals', '/receiving/'],
    ['Received referral', `/receiving/referral.html?id=${id}`],
    ['Referrals I sent', '/sent/'],
    ['Sent referral', `/sent/referral.html?id=${id}`],
    ['Reporting Center', '/reporting/'],
    ['Program Management', '/program-management/'],
    ['Program fields', '/program-management/fields.html?programId=3'],
    ['Program matching', '/program-management/matching.html?programId=3'],
    ['Departments', '/program-management/organization.html'],
    ['Create and move Programs', '/program-management/organization-programs.html'],
    ['Reuse a field', '/program-management/reuse-field.html?programId=3'],
  ];
}

async function referralId(page, request) {
  await page.goto('/sent/');
  await ensureAffiliation(page, 1);
  const res = await request.post('/api/referrals', {
    data: {
      submissionId: crypto.randomUUID(), receivingProgramId: 4,
      participantName: 'Synthetic Person With A Long Name For Wrapping Checks',
      contactMethod: 'EMAIL', contactValue: 'a.long.synthetic.address.for.wrapping@example.test',
      referralContext: 'Synthetic need for Task BB',
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).referral.referralId;
}

async function open(page, path, act) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  if (act) await act(page);
}

// What sticks out past the right edge, ignoring the skip link (off screen
// until focused) and data tables (they scroll inside their own region).
function overflow(page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const out = [];
    for (const el of document.querySelectorAll('main *, header *')) {
      if (el.closest('.skip-link, table')) continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.right > width + 0.5) out.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`);
    }
    return { scroll: document.documentElement.scrollWidth - width, out: out.slice(0, 5) };
  });
}

test.afterEach(async ({ page }) => {
  await page.evaluate(() => { try { localStorage.removeItem('qchConnect.textSize'); } catch { /* ignore */ } }).catch(() => {});
});

test('every screen: S/M/L/XL are exact, and XL does not scroll sideways at 375px or 320px', async ({ page, request }) => {
  test.setTimeout(120000);
  const id = await referralId(page, request);
  for (const width of [375, 320]) {
    await page.setViewportSize({ width, height: 800 });
    for (const [name, path, act] of screens(id)) {
      await open(page, path, act);
      for (const [size, px] of Object.entries(SIZES)) {
        await page.locator(`[data-size="${size}"]`).click();
        expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), `${name} at ${size}`).toBe(`${px}px`);
      }
      // XL is the last size clicked.
      expect(await overflow(page), `${name}, XL at ${width}px`).toEqual({ scroll: 0, out: [] });
    }
  }
});

test('every screen: the text size reaches every form control, not just the labels', async ({ page, request }) => {
  test.setTimeout(120000);
  const id = await referralId(page, request);
  const controlSizes = () => page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll('main input:not([type=radio]):not([type=checkbox]), main select, main textarea, main button')]
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el, i) => [el.id || `${el.tagName.toLowerCase()} ${i}`, parseFloat(getComputedStyle(el).fontSize)]),
  ));
  for (const [name, path, act] of screens(id)) {
    await open(page, path, act);
    await page.locator('[data-size="S"]').click();
    const small = await controlSizes();
    await page.locator('[data-size="XL"]').click();
    const large = await controlSizes();
    expect(Object.keys(small).length, `${name} has controls`).toBeGreaterThan(0);
    const stuck = Object.keys(small).filter((key) => !(large[key] > small[key]));
    expect(stuck, `${name}: controls that ignore the text size`).toEqual([]);
  }
  // The defect Task BB fixed: the matching age range boxes.
  await open(page, '/program-management/matching.html?programId=3');
  await page.locator('[data-size="XL"]').click();
  for (const box of ['#matching-age-min', '#matching-age-max']) {
    expect(await page.locator(box).evaluate((el) => getComputedStyle(el).fontSize), box).toBe('24px');
  }
});

for (const colorScheme of ['light', 'dark']) {
  test(`every screen passes axe at XL on a 320px screen (${colorScheme})`, async ({ page, request }) => {
    test.setTimeout(120000);
    const id = await referralId(page, request);
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 320, height: 800 });
    await page.evaluate(() => localStorage.setItem('qchConnect.textSize', 'XL'));
    for (const [name, path, act] of screens(id)) {
      await open(page, path, act);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), name).toBe('24px');
      await expectNoAxeViolations(page, `${name}, XL, 320px, ${colorScheme}`);
    }
  });
}
