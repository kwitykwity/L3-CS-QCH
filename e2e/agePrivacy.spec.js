// Task HH: age privacy in the real browser. SYNTHETIC data only.
//
// Frozen Handoff PRD 5.3, 5.4, 28; Handoff MVP 6, 15; acceptance gates 6 to 8.
//
// The employee gives an exact age, or an age range, in Find a Program. The
// age goes to matching (and, inside the `gpme` part, to the server's re-check
// at submit), then leaves no trace: not in the saved referral, not on the
// Sent or Received screens, not in the URL or browser storage.
//
// The HTTP half, which compares every kept record with and without an age,
// is test/regression/agePrivacy.test.js.
//
// Synthetic seed: Housing Help Desk (sample) has no age limit, so any age
// matches it, and the synthetic developer identity can receive for it.

import { test, expect } from '@playwright/test';
import { ensureAffiliation, expectNoAxeViolations } from './helpers.js';

const HOUSING = 'Housing Help Desk (sample)';
const EXACT_AGE = 97;
const RANGE = { min: 91, max: 99 };

const status = (page) => page.locator('#status .status__text');

async function openGuided(page) {
  await page.goto('/referral/');
  await ensureAffiliation(page);
  await page.reload();
  await page.locator('#path-guided').click();
  await expect(page.locator('#guided')).toBeVisible();
  await page.locator('input[name="need"]').first().waitFor({ state: 'attached' });
}

function recordPosts(page, pathname) {
  const posts = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === pathname) posts.push(request.postDataJSON());
  });
  return posts;
}

// Every URL the page visits, so an age never rides in a query string.
function recordUrls(page) {
  const urls = [];
  page.on('request', (request) => urls.push(request.url()));
  return urls;
}

// Age-named fields, anywhere (camelCase, so "stage" or "language" never match).
const AGE_KEY = /^ages?(Range|Min|Max|Group)?$|Ages?(Range|Min|Max|Group)?$|(^|_)age(_|$)|^dob$|[Dd]ateOfBirth|date_of_birth/;
function ageKeysIn(value, path = '$') {
  if (Array.isArray(value)) return value.flatMap((v, i) => ageKeysIn(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, v]) => [
      ...(AGE_KEY.test(key) ? [`${path}.${key}`] : []), ...ageKeysIn(v, `${path}.${key}`),
    ]);
  }
  return [];
}

// The saved referral without its own numbers (IDs, versions), so an age can
// be searched for without colliding with a referral ID.
function withoutOwnNumbers(value) {
  if (Array.isArray(value)) return value.map(withoutOwnNumbers);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key, v]) => !(typeof v === 'number' && (/Id$/.test(key) || key === 'version')))
      .map(([key, v]) => [key, withoutOwnNumbers(v)]));
  }
  return value;
}
const hasNumber = (text, n) => new RegExp(`(?<![\\d.:-])${n}(?![\\d.:-])`).test(text);

async function chooseAgeAndSend(page, { mode, name }) {
  await page.getByLabel('Housing (sample)', { exact: true }).check();
  if (mode === 'exact') {
    await page.locator('#ageMode-exact').check();
    await expect(page.locator('#ageExact')).toBeVisible();
    await expect(page.locator('#ageRange-group')).toBeHidden();
    await page.locator('#ageExact').fill(String(EXACT_AGE));
  } else {
    await expect(page.locator('#ageMode-range')).toBeChecked();
    await page.locator('#ageMin').fill(String(RANGE.min));
    await page.locator('#ageMax').fill(String(RANGE.max));
  }
  await page.locator('#find-programs').click();
  await expect(page.locator('#match-results')).toBeVisible();
  await page.getByRole('button', { name: `Choose ${HOUSING}` }).click();

  await expect(page.locator('#step-details')).toBeVisible();
  await page.locator('#participantName').fill(name);
  await page.locator('input[name="contactMethod"][value="NOT_AVAILABLE"]').check();
  await page.locator('#referralContext').fill('Synthetic need for the privacy test (no participant details)');
  await page.locator('#send').click();
  await expect(status(page)).toContainText('Referral received !');
  return Number((await status(page).textContent()).match(/Referral ID: (\d+)/)[1]);
}

for (const mode of ['exact', 'range']) {
  const ages = mode === 'exact' ? [EXACT_AGE] : [RANGE.min, RANGE.max];
  const expectedAge = mode === 'exact' ? { min: EXACT_AGE, max: EXACT_AGE } : RANGE;

  test(`${mode === 'exact' ? 'an exact age' : 'an age range'} is used for matching, then kept nowhere and shown nowhere`, async ({ page, request }) => {
    const matchPosts = recordPosts(page, '/api/gpme/match');
    const referralPosts = recordPosts(page, '/api/referrals');
    const urls = recordUrls(page);
    // The name itself must not contain the word "age".
    const name = `Synthetic Person Privacy ${mode} ${Date.now()}`;

    await openGuided(page);
    const referralId = await chooseAgeAndSend(page, { mode, name });

    // 1. The age was used: matching got it, an exact age as that one age
    //    (never widened), and the server's re-check got it inside `gpme` only.
    expect(matchPosts).toEqual([{ needCategoryIds: [4], ageRange: expectedAge }]);
    expect(referralPosts).toHaveLength(1);
    expect(referralPosts[0].gpme).toEqual({ needCategoryIds: [4], ageRange: expectedAge });
    const { gpme, ...referralFields } = referralPosts[0];
    expect(ageKeysIn(referralFields)).toEqual([]);

    // 2. Once the server has it, the age is gone from the page and the browser.
    await expect(page.locator('#ageExact')).toHaveValue('');
    await expect(page.locator('#ageMin')).toHaveValue('');
    await expect(page.locator('#ageMax')).toHaveValue('');
    await expect(page.locator('#ageMode-range')).toBeChecked();
    const stored = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie]));
    for (const n of ages) expect(hasNumber(stored, n), `age ${n} in browser storage`).toBe(false);
    for (const url of urls) {
      expect(url).not.toMatch(/age/i);
      for (const n of ages) expect(hasNumber(new URL(url).search, n), `age ${n} in ${url}`).toBe(false);
    }

    // 3. The saved referral has no age (Handoff PRD 5.4, 15, 28).
    const saved = await (await request.get(`/api/referrals/${referralId}`)).json();
    expect(saved.referral).toMatchObject({ source: 'GPME_ASSISTED' });
    expect(ageKeysIn(saved)).toEqual([]);
    const savedText = JSON.stringify(withoutOwnNumbers(saved));
    for (const n of ages) expect(hasNumber(savedText, n), `age ${n} in the saved referral`).toBe(false);

    // 4. Later views show no age: the Sent list and details, and the
    //    Received queue and details.
    const views = [
      ['/sent/', page.locator('main').filter({ hasText: name })],
      [`/sent/referral.html?id=${referralId}`, null],
      ['/receiving/', page.locator('.queue-item').filter({ hasText: name })],
      [`/receiving/referral.html?id=${referralId}`, null],
    ];
    for (const [path, ready] of views) {
      await page.goto(path);
      if (ready) await expect(ready).toHaveCount(1);
      else await expect(status(page)).toHaveText('Referral loaded.');
      const text = await page.locator('main').innerText();
      expect(text, `${path} mentions age`).not.toMatch(/\bage\b|age range|exact age/i);
      const shown = text.replace(new RegExp(`\\b${referralId}\\b`, 'g'), '');
      for (const n of ages) expect(hasNumber(shown, n), `${path} shows age ${n}`).toBe(false);
    }
  });
}

test('the age choice works by keyboard, keeps work when switching, and passes the axe scan', async ({ page }) => {
  await openGuided(page);
  await page.getByLabel('Housing (sample)', { exact: true }).check();

  // Age range is the default; switching to Exact age shows one labelled box.
  await expect(page.locator('#ageMode-range')).toBeChecked();
  await expect(page.locator('#ageExact-group')).toBeHidden();
  await page.locator('#ageMode-range').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#ageMode-exact')).toBeChecked();
  await expect(page.locator('#ageExact')).toBeVisible();
  await expect(page.getByLabel('Age', { exact: true })).toBeVisible();

  // A bad exact age is explained, and focus goes to the exact box.
  await page.locator('#ageExact').fill('130');
  await page.locator('#find-programs').click();
  await expect(page.locator('#ageRange-error')).toHaveText('Enter a whole age from 0 to 120, or leave it blank.');
  await expect(page.locator('#ageExact')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#ageExact')).toBeFocused();

  // One age is never refused for being one age.
  await page.locator('#ageExact').fill('45');
  await page.locator('#find-programs').click();
  await expect(page.locator('#match-results')).toBeVisible();
  await expect(page.locator('#ageExact')).toHaveAttribute('aria-invalid', 'false');

  // Switching modes is a change of answers: old results are cleared.
  await page.locator('#ageMode-range').check();
  await expect(page.locator('#match-results')).toBeHidden();
  await expect(page.locator('#ageRange-group')).toBeVisible();
  await expect(page.locator('#ageExact-group')).toBeHidden();

  await page.locator('#ageMode-exact').check();
  await expectNoAxeViolations(page);
});
