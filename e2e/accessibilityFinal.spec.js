// Trello Task BB: final accessibility verification across every screen on
// main (Final Technical PRD 14.1 to 14.5; team target WCAG 2.2 AA).
//
// The per-screen specs test each workflow in depth. This file sweeps every
// screen the same way, so a screen that is not someone's focus still gets
// checked:
//   - S/M/L/XL are exactly 12/14/18/24px, and at XL nothing scrolls
//     sideways at 375px or 320px (the WCAG reflow width),
//   - the text size reaches every form control (inputs, dropdowns, boxes,
//     buttons), including controls the page builds from data,
//   - axe finds nothing at XL on a 320px screen, in both themes.
//
// Every screen is checked in a POPULATED state: before any check, the test
// waits for that screen's own "loaded" content (a loaded message, the
// expected items, the seeded fields), never only for the network to go
// quiet, which also happens on an error screen. Seeded first: a referral
// to the sample Program the developer receives for, one Program field of
// each of the six types on Program 3 (so the field screen builds a text,
// number, date, yes/no, single-choice and multi-choice control), and a
// field on Program 7 that Program 3 can reuse.
//
// The three defects Task BB found and fixed each fail here if they return:
// the New Referral path buttons (issue #46), the sent and received list
// items at 320px, and number boxes that ignored the text size.
//
// Not swept here:
//   - The Permissions screen is PENDING PR #63 (not on main). Add it to
//     screens() when #63 merges; until then it is not verified by this file.
//   - The start page ("/") has no S/M/L/XL control (it has no form and is
//     the temporary start page, docs/architecture.md), so it is checked for
//     reflow and axe at its own size only.
// SYNTHETIC data only.

import { test, expect } from '@playwright/test';
import { ensureAffiliation, expectNoAxeViolations } from './helpers.js';

const SIZES = { S: 12, M: 14, L: 18, XL: 24 };
const RUN = Date.now().toString(36);
const FIELD_TYPES = ['TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SINGLE_SELECT', 'MULTI_SELECT'];

const status = (page, id = 'status') => page.locator(`#${id} .status__text, #${id}`).first();

// What every check needs: a referral, six Program 3 fields, a reusable field.
let seeds = 0;
async function seed(page, request) {
  seeds += 1;
  const tag = `${RUN}-${seeds}`;
  await page.goto('/sent/');
  await ensureAffiliation(page, 1);
  const res = await request.post('/api/referrals', {
    data: {
      submissionId: crypto.randomUUID(), receivingProgramId: 4,
      participantName: `Synthetic Person With A Long Name For Wrapping Checks ${tag}`,
      contactMethod: 'EMAIL', contactValue: 'a.long.synthetic.address.for.wrapping@example.test',
      referralContext: 'Synthetic need for Task BB',
    },
  });
  expect(res.status()).toBe(201);
  const fields = [];
  for (const dataType of FIELD_TYPES) {
    const body = { label: `Synthetic BB ${dataType} ${tag}`, dataType };
    if (dataType.includes('SELECT')) body.options = ['First choice', 'Second choice'];
    const made = await request.post('/api/program-management/programs/3/fields', { data: body });
    expect(made.status(), dataType).toBe(201);
    fields.push((await made.json()).field);
  }
  const reusable = await request.post('/api/program-management/programs/7/fields', {
    data: { label: `Synthetic BB reusable ${tag}`, dataType: 'TEXT' },
  });
  expect(reusable.status()).toBe(201);
  return { id: (await res.json()).referral.referralId, fields };
}

// Every screen, in a populated state. `act` gets it there; `ready` proves
// the expected content loaded before anything is measured.
function screens({ id, fields }) {
  return [
    ['Start page', '/', null, async (p) => {
      await expect(p.locator('#status-text')).toHaveText('ok');
      await expect(p.getByRole('link', { name: 'New referral' })).toBeVisible();
    }],
    ['New Referral, choose how', '/referral/', null, async (p) => {
      await expect(p.locator('#program-count')).toHaveText(/^\d+ Programs shown\.$/);
      await expect(p.locator('#path-guided')).toBeVisible();
    }],
    ['Find a Program, questions', '/referral/', (p) => p.locator('#path-guided').click(), async (p) => {
      await expect(p.locator('input[name="need"]')).not.toHaveCount(0);
      await expect(p.locator('#describe')).toBeVisible();
    }],
    ['Find a Program, results', '/referral/', async (p) => {
      await p.locator('#path-guided').click();
      await p.getByLabel('Housing (sample)', { exact: true }).check();
      await p.locator('#find-programs').click();
    }, async (p) => {
      await expect(p.locator('#match-results')).toBeVisible();
      await expect(p.locator('#plausible-list > li, #possible-list > li')).not.toHaveCount(0);
      await expect(p.getByRole('button', { name: 'Choose Housing Help Desk (sample)' })).toBeVisible();
    }],
    ['Direct Referral', '/referral/', (p) => p.locator('#path-direct').click(), async (p) => {
      await expect(p.locator('#program-options input')).not.toHaveCount(0);
    }],
    ['Referral details', '/referral/', async (p) => {
      await p.locator('#path-direct').click();
      await p.locator('#program-options input').first().check();
      await p.locator('#program-continue').click();
    }, async (p) => {
      await expect(p.locator('#step-details')).toBeVisible();
      await expect(p.locator('#participantName')).toBeVisible();
    }],
    ['Received referrals', '/receiving/', null, async (p) => {
      await expect(status(p)).toHaveText('Referrals loaded.');
      await expect(p.locator('.queue-item')).not.toHaveCount(0);
    }],
    ['Received referral', `/receiving/referral.html?id=${id}`, null, async (p) => {
      await expect(status(p)).toHaveText('Referral loaded.');
      await expect(p.locator('#respond-panel')).toBeVisible();
    }],
    ['Referrals I sent', '/sent/', null, async (p) => {
      await expect(status(p)).toHaveText('Your referrals loaded.');
      await expect(p.locator('.queue-item')).not.toHaveCount(0);
    }],
    ['Sent referral', `/sent/referral.html?id=${id}`, null, async (p) => {
      await expect(status(p)).toHaveText('Referral loaded.');
    }],
    ['Reporting Center', '/reporting/', null, async (p) => {
      await expect(status(p)).toHaveText(/^Report loaded for /);
    }],
    ['Program Management', '/program-management/', null, async (p) => {
      await expect(p.locator('#program-select option')).not.toHaveCount(1);
    }],
    ['Program fields (six seeded types)', '/program-management/fields.html?programId=3', null, async (p) => {
      await expect(p.locator('#field-status')).toContainText('Saved fields loaded.');
      for (const field of fields) {
        await expect(p.getByRole('heading', { name: field.label, exact: true }), field.dataType).toBeVisible();
      }
    }],
    ['Program matching (with languages)', '/program-management/matching.html?programId=3', null, async (p) => {
      await expect(p.locator('#matching-status')).toContainText('Saved matching information loaded.');
      await expect(p.locator('#matching-language-options input[type="checkbox"]')).not.toHaveCount(0);
    }],
    ['Departments', '/program-management/organization.html', null, async (p) => {
      await expect(p.locator('#org-status')).toContainText('Saved Departments loaded.');
    }],
    ['Create and move Programs', '/program-management/organization-programs.html', null, async (p) => {
      await expect(p.locator('#program-org-status')).toContainText('Saved organization loaded.');
    }],
    ['Reuse a field (with a field to reuse)', '/program-management/reuse-field.html?programId=3', null, async (p) => {
      await expect(p.locator('#reuse-status')).toContainText('Available fields loaded.');
      await expect(p.locator('#reuse-field option')).not.toHaveCount(1);
    }],
  ];
}

async function open(page, [, path, act, ready]) {
  await page.goto(path);
  if (act) await act(page);
  await ready(page);
}

const hasSizeControl = (page) => page.locator('[data-size="XL"]').count();

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

test('every screen, populated: S/M/L/XL are exact, and XL does not scroll sideways at 375px or 320px', async ({ page, request }) => {
  test.setTimeout(180000);
  const data = await seed(page, request);
  for (const width of [375, 320]) {
    await page.setViewportSize({ width, height: 800 });
    for (const screen of screens(data)) {
      const [name] = screen;
      await open(page, screen);
      if (await hasSizeControl(page)) {
        for (const [size, px] of Object.entries(SIZES)) {
          await page.locator(`[data-size="${size}"]`).click();
          expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), `${name} at ${size}`).toBe(`${px}px`);
        }
        // XL is the last size clicked.
      }
      expect(await overflow(page), `${name} at ${width}px`).toEqual({ scroll: 0, out: [] });
    }
  }
});

test('every screen, populated: the text size reaches every form control, including ones built from data', async ({ page, request }) => {
  test.setTimeout(180000);
  const data = await seed(page, request);
  const controlSizes = () => page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll('main input:not([type=radio]):not([type=checkbox]), main select, main textarea, main button')]
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el, i) => [el.id || `${el.tagName.toLowerCase()} ${i}`, parseFloat(getComputedStyle(el).fontSize)]),
  ));
  for (const screen of screens(data)) {
    const [name] = screen;
    await open(page, screen);
    if (!(await hasSizeControl(page))) continue; // the start page: no controls, no size control
    await page.locator('[data-size="S"]').click();
    const small = await controlSizes();
    await page.locator('[data-size="XL"]').click();
    const large = await controlSizes();
    expect(Object.keys(small).length, `${name} has controls`).toBeGreaterThan(0);
    const stuck = Object.keys(small).filter((key) => !(large[key] > small[key]));
    expect(stuck, `${name}: controls that ignore the text size`).toEqual([]);
  }
  // The seeded fields' own value controls, one per type, at XL.
  await open(page, screens(data).find(([name]) => name.startsWith('Program fields')));
  await page.locator('[data-size="XL"]').click();
  for (const field of data.fields) {
    // A multi-choice field is a group of checkboxes; check its option labels.
    const control = field.dataType === 'MULTI_SELECT'
      ? page.locator(`label[for^="value-${field.fieldId}-"]`).first()
      : page.locator(`#value-${field.fieldId}`);
    expect(await control.evaluate((el) => getComputedStyle(el).fontSize), field.dataType).toBe('24px');
  }
  // The defect Task BB fixed: the matching age range boxes.
  await open(page, screens(data).find(([name]) => name.startsWith('Program matching')));
  await page.locator('[data-size="XL"]').click();
  for (const box of ['#matching-age-min', '#matching-age-max']) {
    expect(await page.locator(box).evaluate((el) => getComputedStyle(el).fontSize), box).toBe('24px');
  }
});

for (const colorScheme of ['light', 'dark']) {
  test(`every screen, populated, passes axe at XL on a 320px screen (${colorScheme})`, async ({ page, request }) => {
    test.setTimeout(180000);
    const data = await seed(page, request);
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 320, height: 800 });
    await page.evaluate(() => localStorage.setItem('qchConnect.textSize', 'XL'));
    for (const screen of screens(data)) {
      const [name] = screen;
      await open(page, screen);
      if (await hasSizeControl(page)) {
        expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), name).toBe('24px');
      }
      await expectNoAxeViolations(page, `${name}, XL, 320px, ${colorScheme}`);
    }
  });
}
