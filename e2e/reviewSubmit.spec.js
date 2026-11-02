// Task 227: the Review step between Referral Details and the existing send
// (Written Wireframe Page 8). SYNTHETIC data only.
//
// Proves that Review shows what is about to be sent and nothing else, that
// Edit keeps every input, and that Submit referral runs the existing send:
// same request body, same Submission ID across Review, Edit and retry, and
// the "Send as a new referral" conflict path still the only way to replace it.

import { test, expect } from '@playwright/test';
import { chooseDirect, ensureAffiliation, focusStyle, focused, openReview, tabTo } from './helpers.js';

const HOUSING = 'Housing Help Desk (sample)';
const HOUSING_ID = '4';
const REQUEST_KEYS = ['contactMethod', 'contactValue', 'notes', 'participantName', 'participantZip',
  'receivingProgramId', 'referralContext', 'submissionId'];

const status = (page) => page.locator('#status .status__text');
const isReferralPost = (request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/referrals';
const unique = (label) => `Synthetic Review ${label} ${Date.now()}`;

function recordReferralPosts(page) {
  const posts = [];
  page.on('request', (request) => { if (isReferralPost(request)) posts.push(request.postDataJSON()); });
  return posts;
}

// The Review list as { term: value }.
async function reviewed(page) {
  return Object.fromEntries(await page.locator('#review-list > div').evaluateAll((rows) =>
    rows.map((row) => [row.querySelector('dt').textContent, row.querySelector('dd').textContent])));
}

async function openDetails(page) {
  await page.goto('/referral/');
  await ensureAffiliation(page, 1);
  await page.reload();
  await chooseDirect(page);
  await page.locator(`#program-options input[value="${HOUSING_ID}"]`).check();
  await page.locator('#program-continue').click();
  await expect(page.locator('#step-details')).toBeVisible();
}

async function fillAll(page, name) {
  await page.locator('#participantName').fill(name);
  await page.locator('input[name="contactMethod"][value="PHONE_TEXT"]').check();
  await page.locator('#contactValue').fill('(555) 017-0227');
  await page.locator('#referralContext').fill('Synthetic need line one\nline two');
  await page.locator('#participantZip').fill('11101');
  await page.locator('#notes').fill('Synthetic note for Task 227');
}

test.describe('Review shows what will be sent (Task 227)', () => {
  test('both Programs, name, contact, ZIP, Referral Context and Notes, as entered', async ({ page }) => {
    await openDetails(page);
    const name = unique('Fields');
    await fillAll(page, name);
    const referring = await page.locator('#affiliation-name').textContent(); // Program 1, set above
    await openReview(page);

    await expect(page.locator('#step-details')).toBeHidden();
    expect(await reviewed(page)).toEqual({
      'Receiving Program': HOUSING,
      'Referring Program': referring,
      'Participant name': name,
      'Best way to reach them': 'Phone text',
      'Phone number': '(555) 017-0227',
      'ZIP code': '11101',
      'Referral context': 'Synthetic need line one\nline two',
      Notes: 'Synthetic note for Task 227',
    });
    // Line breaks the worker typed are kept on screen.
    expect(await page.locator('#review-list dd').filter({ hasText: 'line two' }).innerText()).toBe('Synthetic need line one\nline two');
  });

  test('no ZIP or Notes rows when they are empty, and "No reliable contact" with no contact value', async ({ page }) => {
    await openDetails(page);
    await page.locator('#participantName').fill(unique('Optional'));
    await page.locator('input[name="contactMethod"][value="PHONE_CALL"]').check();
    await page.locator('#contactValue').fill('(555) 017-9999');
    await page.locator('input[name="contactMethod"][value="NOT_AVAILABLE"]').check();
    await page.locator('#referralContext').fill('Synthetic need');
    await openReview(page);

    const rows = await reviewed(page);
    expect(Object.keys(rows)).toEqual(['Receiving Program', 'Referring Program', 'Participant name', 'Best way to reach them', 'Referral context']);
    expect(rows['Best way to reach them']).toBe('No reliable contact');
    await expect(page.locator('#step-review')).not.toContainText('017-9999');
  });

  test('a guided referral: never the age, the age range or the Find a Program description', async ({ page }) => {
    const marker = 'zq-review-marker-227';
    await page.goto('/referral/');
    await ensureAffiliation(page, 1);
    await page.reload();
    await page.locator('#path-guided').click();
    await page.locator('input[name="need"]').first().waitFor({ state: 'attached' });
    await page.locator('#describe').fill(`A 93 year old who needs housing help ${marker}`);
    await page.getByLabel('Housing (sample)', { exact: true }).check();
    await page.locator('#ageMode-range').check();
    await page.locator('#ageMin').fill('92');
    await page.locator('#ageMax').fill('94');
    await page.locator('#find-programs').click();
    await page.getByRole('button', { name: `Choose ${HOUSING}` }).click();
    await page.locator('#participantName').fill(unique('Guided'));
    await page.locator('input[name="contactMethod"][value="NOT_AVAILABLE"]').check();
    await page.locator('#referralContext').fill('Synthetic need for the guided review');
    await openReview(page);

    const text = await page.locator('#step-review').innerText();
    expect(text).not.toContain(marker);
    expect(text).not.toMatch(/year old|\bage\b|age range/i);
    expect(text).not.toMatch(/(?<![\d.:-])(92|93|94)(?![\d.:-])/);
    expect((await reviewed(page))['Receiving Program']).toBe(HOUSING);
  });
});

test.describe('Edit returns to the details with everything kept (Task 227)', () => {
  test('every field is kept, focus goes to the details heading, and Review shows the change', async ({ page }) => {
    const posts = recordReferralPosts(page);
    await openDetails(page);
    const name = unique('Edit');
    await fillAll(page, name);
    await openReview(page);

    await page.locator('#review-edit').click();
    await expect(page.locator('#step-details')).toBeVisible();
    await expect(page.locator('#step-review')).toBeHidden();
    expect(await focused(page)).toBe('step-details-heading');
    // The hidden Review keeps no copy of the participant's information.
    await expect(page.locator('#review-list > div')).toHaveCount(0);

    await expect(page.locator('#participantName')).toHaveValue(name);
    await expect(page.locator('input[name="contactMethod"][value="PHONE_TEXT"]')).toBeChecked();
    await expect(page.locator('#contactValue')).toHaveValue('(555) 017-0227');
    await expect(page.locator('#referralContext')).toHaveValue('Synthetic need line one\nline two');
    await expect(page.locator('#participantZip')).toHaveValue('11101');
    await expect(page.locator('#notes')).toHaveValue('Synthetic note for Task 227');
    await expect(page.locator('#summary-receiving')).toHaveText(HOUSING);

    await page.locator('#notes').fill('Synthetic note, edited');
    await openReview(page);
    expect((await reviewed(page)).Notes).toBe('Synthetic note, edited');
    expect(posts, 'Review and Edit send nothing').toHaveLength(0);
  });

  test('Review and Edit by keyboard: tab order, visible focus, and focus back on the details heading', async ({ page }) => {
    await openDetails(page);
    await fillAll(page, unique('Keys'));
    await tabTo(page, 'review');
    await page.keyboard.press('Enter');
    expect(await focused(page)).toBe('step-review-heading');

    // Submit referral, then Edit; Send as a Direct Referral is hidden here.
    await page.keyboard.press('Tab');
    expect(await focused(page)).toBe('send');
    let style = await focusStyle(page);
    expect(style.outlineStyle).not.toBe('none');
    expect(style.outlineWidth).toBeGreaterThanOrEqual(2);
    await page.keyboard.press('Tab');
    expect(await focused(page)).toBe('review-edit');
    style = await focusStyle(page);
    expect(style.outlineStyle).not.toBe('none');
    expect(style.outlineWidth).toBeGreaterThanOrEqual(2);
    await page.keyboard.press('Shift+Tab');
    expect(await focused(page)).toBe('send');

    await tabTo(page, 'review-edit');
    await page.keyboard.press('Enter');
    expect(await focused(page)).toBe('step-details-heading');
    await expect(page.locator('#participantName')).toHaveValue(/Synthetic Review Keys/);
  });

  test('S/M/L/XL reach the Review list and buttons', async ({ page }) => {
    await openDetails(page);
    await fillAll(page, unique('Sizes'));
    await openReview(page);
    const sizeOf = (selector) => page.locator(selector).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    for (const [size, px] of [['S', 12], ['M', 14], ['L', 18], ['XL', 24]]) {
      await page.locator(`.text-size__btn[data-size="${size}"]`).click();
      expect(await sizeOf('#review-list dd')).toBe(px);
      expect(await sizeOf('#send')).toBe(px);
      expect(await sizeOf('#review-edit')).toBe(px);
    }
    await page.locator('.text-size__btn[data-size="M"]').click();
  });
});

test.describe('Submit referral uses the existing send (Task 227)', () => {
  test('one POST with the same body as before, and the details as reviewed', async ({ page }) => {
    const posts = recordReferralPosts(page);
    await openDetails(page);
    const name = unique('Submit');
    await fillAll(page, name);
    await openReview(page);
    await page.locator('#send').click();
    await expect(status(page)).toContainText('Referral received !');

    expect(posts).toHaveLength(1);
    expect(Object.keys(posts[0]).sort()).toEqual(REQUEST_KEYS);
    expect(posts[0]).toMatchObject({
      receivingProgramId: Number(HOUSING_ID), participantName: name, contactMethod: 'PHONE_TEXT',
      contactValue: '(555) 017-0227', participantZip: '11101', referralContext: 'Synthetic need line one\nline two',
      notes: 'Synthetic note for Task 227',
    });
  });

  test('after success: as before Review, the emptied details stay on screen, locked; Review is hidden and cleared', async ({ page }) => {
    await openDetails(page);
    await fillAll(page, unique('After'));
    await openReview(page);
    await page.locator('#send').click();
    await expect(status(page)).toContainText('Referral received !');

    await expect(page.locator('#status')).toBeFocused();
    await expect(page.locator('#step-review')).toBeHidden();
    await expect(page.locator('#review-list > div')).toHaveCount(0);
    await expect(page.locator('#step-details')).toBeVisible();
    await expect(page.locator('#step-program')).toBeHidden();
    await expect(page.locator('#participantName')).toHaveValue('');
    await expect(page.locator('#referral-fields')).toHaveJSProperty('disabled', true);
    for (const id of ['send', 'review', 'review-edit', 'change-program', 'cancel']) {
      await expect(page.locator(`#${id}`), id).toBeDisabled();
    }
    await expect(page.locator('#summary-receiving')).toHaveText(HOUSING);
    await expect(page.locator('#confirmation')).toBeVisible();
    await expect(page.locator('#start-new')).toBeVisible();
  });

  test('the Submission ID is the same across Review, Edit, a failed send and the resend', async ({ page, request }) => {
    const posts = recordReferralPosts(page);
    await openDetails(page);
    const name = unique('SameId');
    await fillAll(page, name);
    await openReview(page);
    await page.locator('#review-edit').click();
    await openReview(page);

    let failed = false;
    await page.route('**/api/referrals', async (route) => {
      if (!isReferralPost(route.request()) || failed) return route.continue();
      failed = true;
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"code":"SERVICE_UNAVAILABLE"}' });
    });
    await page.locator('#send').click();
    await expect(status(page)).toHaveText('Referral was not received. Your information has been preserved. You may safely resend !');
    await expect(page.locator('#step-review')).toBeVisible();

    // Not received, so editing is allowed again; it is still the same referral.
    await page.locator('#review-edit').click();
    await page.locator('#notes').fill('Synthetic note, changed after the failed send');
    await openReview(page);
    await page.locator('#send').click();
    await expect(status(page)).toContainText('Referral received !');

    expect(posts).toHaveLength(2);
    expect(posts[1].submissionId, 'the resend is the same logical referral').toBe(posts[0].submissionId);
    expect(posts[1].notes).toBe('Synthetic note, changed after the failed send');
    const sent = await (await request.get('/api/referrals/sent')).json();
    expect(sent.referrals.filter((r) => r.participantName === name)).toHaveLength(1);
  });

  test('a server-rejected field returns to the details with focus on that field', async ({ page }) => {
    await openDetails(page);
    await fillAll(page, unique('Invalid'));
    await openReview(page);
    await page.route('**/api/referrals', (route) => (isReferralPost(route.request())
      ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'INVALID_REQUEST', fields: ['notes'] }) })
      : route.continue()));
    await page.locator('#send').click();
    await expect(status(page)).toHaveText('Some information needs attention. Nothing was sent.');
    await expect(page.locator('#step-review')).toBeHidden();
    await expect(page.locator('#step-details')).toBeVisible();
    await expect(page.locator('#notes')).toBeFocused();
    await expect(page.locator('#notes')).toHaveAttribute('aria-invalid', 'true');
  });

  test('after a Submission ID conflict, Edit keeps "Send as a new referral", the only way to a new ID', async ({ page }) => {
    const posts = recordReferralPosts(page);
    await openDetails(page);
    await fillAll(page, unique('Conflict'));
    await openReview(page);

    let conflict = true;
    await page.route('**/api/referrals', async (route) => {
      if (!isReferralPost(route.request()) || !conflict) return route.continue();
      conflict = false;
      return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'SUBMISSION_ID_CONFLICT' }) });
    });
    await page.route('**/api/referrals/submissions/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'NOT_RECEIVED' }) }));
    await page.locator('#send').click();
    await expect(status(page)).toContainText('No earlier referral from you was found with this Submission ID.');
    await expect(page.locator('#new-submission')).toBeVisible();
    await expect(page.locator('#send')).toBeDisabled();

    // Edit and Review again do not replace the ID or hide the explicit choice.
    await page.locator('#review-edit').click();
    await openReview(page);
    await expect(page.locator('#new-submission')).toBeVisible();
    await expect(page.locator('#send')).toBeDisabled();
    expect(posts).toHaveLength(1);

    await page.locator('#new-submission').click();
    await expect(status(page)).toHaveText('Ready to send as a new referral. Review the information, then choose Send referral.');
    await page.unroute('**/api/referrals/submissions/**');
    await page.locator('#send').click();
    await expect(status(page)).toContainText('Referral received !');
    expect(posts).toHaveLength(2);
    expect(posts[1].submissionId, 'replaced only by "Send as a new referral"').not.toBe(posts[0].submissionId);
  });
});
