// Card: screen-reader verification (Final Technical PRD 14.3, 14.4, 17.7).
//
// What a screen reader is TOLD, checked in Chromium through the same
// accessibility tree VoiceOver and NVDA read: each control's role, name,
// required and invalid state, description (hint or error), dialog names
// and modality, where focus goes, and every live-region announcement in
// the order it happens.
//
// This supplements, and does not replace, listening with a real screen
// reader (PRD 17.7). The manual run, with the reader and browser used,
// is recorded in docs/screen-reader-check.md. SYNTHETIC data only.

import { test, expect } from '@playwright/test';
import { chooseDirect, ensureAffiliation, focused } from './helpers.js';

// Records every change to a live region (role=status, role=alert,
// aria-live) as { region, text }, in order: what a screen reader would be
// handed to announce. Installed before the page's own scripts run.
async function recordAnnouncements(page) {
  await page.addInitScript(() => {
    window.announcements = [];
    const last = new Map();
    const regionOf = (node) => (node.nodeType === 1 ? node : node.parentElement)
      ?.closest('[aria-live], [role="status"], [role="alert"]');
    const note = (region) => {
      if (!region || region.hidden || region.closest('[hidden]')) return;
      const text = region.textContent.replace(/\s+/g, ' ').trim();
      if (!text || last.get(region) === text) return;
      last.set(region, text);
      window.announcements.push({ region: region.id || region.className, text });
    };
    new MutationObserver((records) => {
      for (const r of records) {
        note(regionOf(r.target));
        if (r.type === 'attributes' && r.target.nodeType === 1 && r.target.matches('[aria-live], [role="status"], [role="alert"]')) note(r.target);
      }
    }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
  });
}
const announced = (page) => page.evaluate(() => window.announcements.map((a) => a.text));

async function openDirectForm(page) {
  await page.goto('/referral/');
  await ensureAffiliation(page);
  await page.reload();
  await chooseDirect(page);
  await page.locator('#program-options input').first().check();
  await page.locator('#program-continue').click();
  await expect(page.locator('#step-details')).toBeVisible();
}

test.describe('New Referral page: what a screen reader is told', () => {
  test('landmarks, one page title heading, a heading outline, and a working skip link (PRD 14.4)', async ({ page }) => {
    await page.goto('/referral/');
    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('New Referral');
    await expect(page.getByRole('heading', { level: 2, name: 'Your Program affiliation' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: '1. Which Program should receive this referral?' })).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    // The text size control is a named group; the current size is "pressed".
    const sizes = page.getByRole('group', { name: 'Text size' });
    await expect(sizes.getByRole('button', { name: 'M', pressed: true })).toHaveCount(1);
    await expect(sizes.getByRole('button', { pressed: false })).toHaveCount(3);
  });

  test('the two paths are toggle buttons whose state is announced, and choosing one moves focus to it', async ({ page }) => {
    await page.goto('/referral/');
    const group = page.getByRole('group', { name: 'How do you want to choose the Program?' });
    await expect(group.getByRole('button', { name: /^Help me find a Program/, pressed: false })).toBeVisible();
    await expect(group.getByRole('button', { name: /^I know the Program/, pressed: false })).toBeVisible();
    await group.getByRole('button', { name: /^I know the Program/ }).focus();
    await page.keyboard.press('Enter');
    // Pressed, and the name is still just the words: the decorative check
    // mark is not read out.
    await expect(group.getByRole('button', { name: /^I know the Program/, pressed: true })).toBeVisible();
    await expect(group.getByRole('button', { pressed: true })).toHaveAccessibleName(/^I know the Program/);
    await expect(page.getByRole('heading', { name: 'Direct Referral' })).toBeFocused();
  });

  test('every field has its name, required state and hint; the radio choices are a named group (PRD 14.3, 14.4)', async ({ page }) => {
    await openDirectForm(page);
    await expect(page.getByRole('heading', { name: '2. Referral details' })).toBeFocused();
    await expect(page.getByText('Fields marked * are required.')).toBeVisible();

    const name = page.getByRole('textbox', { name: 'Participant name' });
    await expect(name).toHaveAttribute('aria-required', 'true');
    const need = page.getByRole('textbox', { name: 'What do they need?' });
    await expect(need).toHaveAttribute('aria-required', 'true');
    await expect(need).toHaveAccessibleDescription('Visible to you and to staff authorized for the receiving Program.');
    await expect(page.getByRole('textbox', { name: 'ZIP code (optional)' })).not.toHaveAttribute('aria-required', 'true');
    await expect(page.getByRole('textbox', { name: 'Notes (optional)' }))
      .toHaveAccessibleDescription('Visible to you and to staff authorized for the receiving Program.');

    const contact = page.getByRole('group', { name: 'Best way to reach them' });
    for (const label of ['Phone call', 'Phone text', 'Email', 'No reliable contact']) {
      await expect(contact.getByRole('radio', { name: label })).toBeVisible();
    }
    // Choosing Email relabels the contact box, so the reader hears the right field.
    await contact.getByRole('radio', { name: 'Email' }).check();
    await expect(page.getByRole('textbox', { name: 'Email address' })).toHaveAttribute('aria-required', 'true');
    await contact.getByRole('radio', { name: 'Phone call' }).check();
    await expect(page.getByRole('textbox', { name: 'Phone number' })).toHaveAttribute('aria-required', 'true');
  });

  test('errors: the summary is announced, each invalid field says so and why, focus goes to the first (PRD 14.3)', async ({ page }) => {
    await recordAnnouncements(page);
    await openDirectForm(page);
    await page.getByRole('button', { name: 'Send referral' }).click();

    // The tone word ("Attention:") is visual only (aria-hidden); the message
    // itself says what happened.
    expect(await announced(page)).toContain('Some information needs attention. Nothing was sent.');
    const name = page.getByRole('textbox', { name: 'Participant name' });
    await expect(name).toBeFocused();
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(name).toHaveAccessibleDescription(/Enter the participant's name\./);
    const need = page.getByRole('textbox', { name: 'What do they need?' });
    await expect(need).toHaveAttribute('aria-invalid', 'true');
    await expect(need).toHaveAccessibleDescription(/Describe what the participant needs\./);
    // The error is words, not colour alone: the description says "Error".
    await expect(name).toHaveAccessibleDescription(/Error/);
    await expect(page.getByRole('group', { name: 'Best way to reach them' }))
      .toHaveAccessibleDescription(/Choose the best way to reach the participant\./);

    // Fixing a field clears its error state for the reader too.
    await name.fill('Synthetic Person Reader');
    await expect(name).not.toHaveAttribute('aria-invalid', 'true');
    await expect(name).toHaveAccessibleDescription('');
  });

  test('a send is announced in order: "Sending referral ..." then "Referral received !" with the ID (PRD 7.1, 7.4)', async ({ page }) => {
    await recordAnnouncements(page);
    await openDirectForm(page);
    await page.getByRole('textbox', { name: 'Participant name' }).fill('Synthetic Person Reader');
    await page.getByRole('radio', { name: 'No reliable contact' }).check();
    await page.getByRole('textbox', { name: 'What do they need?' }).fill('Synthetic need');
    await page.getByRole('button', { name: 'Send referral' }).click();
    await expect(page.locator('#status .status__text')).toContainText('Referral received !');

    const texts = await announced(page);
    const sending = texts.findIndex((t) => t.includes('Sending referral ...'));
    const received = texts.findIndex((t) => /Referral received ! Referral ID: \d+\./.test(t));
    expect(sending, JSON.stringify(texts)).toBeGreaterThanOrEqual(0);
    expect(received, JSON.stringify(texts)).toBeGreaterThan(sending);
    // Focus moves to the confirmation, so it is read even if the
    // announcement was missed.
    await expect(page.getByRole('status').filter({ hasText: 'Referral received !' })).toBeFocused();
  });

  test('the discard dialog: named, described, modal, starts on the safe choice, Escape keeps work, focus returns (PRD 7.6)', async ({ page }) => {
    await openDirectForm(page);
    await page.getByRole('textbox', { name: 'Participant name' }).fill('Synthetic Person Reader');
    const cancel = page.getByRole('button', { name: 'Cancel' });
    await cancel.click();

    const dialog = page.getByRole('dialog', { name: 'Discard this referral ?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleDescription('The information you entered has not been sent. If you leave, it will be cleared.');
    await expect(dialog.getByRole('button', { name: 'Keep editing' })).toBeFocused();
    // Modal: Tab never reaches the page behind the dialog. (After the last
    // button the browser may move focus to its own toolbar; that is allowed.)
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => document.activeElement === document.body
        || document.getElementById('discard-dialog').contains(document.activeElement));
      expect(inside, await focused(page)).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(cancel).toBeFocused();
    await expect(page.getByRole('textbox', { name: 'Participant name' })).toHaveValue('Synthetic Person Reader');

    // "Keep editing" also returns to Cancel; nothing is lost.
    await cancel.click();
    await dialog.getByRole('button', { name: 'Keep editing' }).click();
    await expect(cancel).toBeFocused();
    await expect(page.getByRole('textbox', { name: 'Participant name' })).toHaveValue('Synthetic Person Reader');
  });

  test('guided matching: named need group, results announced by heading focus, no match and failure announced', async ({ page }) => {
    await recordAnnouncements(page);
    await page.goto('/referral/');
    await page.getByRole('button', { name: /^Help me find a Program/ }).click();
    await expect(page.getByRole('heading', { name: 'Guided matching' })).toBeFocused();
    const needs = page.getByRole('group', { name: 'What does the participant need?' });
    await expect(needs).toHaveAccessibleDescription(/Choose all that apply\./);
    await expect(page.getByRole('textbox', { name: 'From' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'to' })).toBeVisible();

    // Nothing chosen: the error is announced and focus goes to the first need.
    await page.getByRole('button', { name: 'Find Programs' }).click();
    await expect(needs).toHaveAccessibleDescription(/Choose at least one need\./);
    await expect(needs.getByRole('checkbox').first()).toBeFocused();

    // Results: focus moves to the results heading so the reader starts there.
    await needs.getByRole('checkbox', { name: 'Employment (sample)' }).check();
    await page.getByRole('button', { name: 'Find Programs' }).click();
    await expect(page.getByRole('heading', { name: 'Programs that may fit' })).toBeFocused();
    await expect(page.getByRole('button', { name: /^Choose / }).first()).toBeVisible();

    // A technical failure is announced, distinct from "no plausible match".
    await page.route('**/api/gpme/match', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"status":"UNABLE_TO_MATCH"}' }));
    await page.getByRole('button', { name: 'Find Programs' }).click();
    await expect(page.locator('#match-message')).toBeFocused();
    expect((await announced(page)).some((t) => t.startsWith('Unable to perform matching right now.'))).toBe(true);
  });
});

test.describe('Program Management: what a screen reader is told', () => {
  test.beforeEach(async ({ request }) => {
    // Program 3 back to ACTIVE with no saved edits, whatever earlier tests did.
    const url = '/api/program-management/programs/3';
    let { program } = await (await request.get(url)).json();
    if (program.lifecycleStatus === 'DISCONTINUED') {
      ({ program } = await (await request.post(`${url}/reactivate`, { data: { version: program.version } })).json());
    }
    await request.patch(url, { data: { version: program.version, description: null, scheduleNotes: null, costNotes: null } });
  });

  async function openProgram(page) {
    await page.goto('/program-management/');
    const program = page.getByRole('combobox', { name: 'Program' });
    await expect(program).toHaveAttribute('aria-required', 'true');
    await program.selectOption('3');
    await page.locator('#open-program').click();
    await expect(page.locator('#editor')).toBeVisible();
  }

  test('choosing nothing is announced; opening a Program moves focus to its name; fields are labelled', async ({ page }) => {
    await recordAnnouncements(page);
    await page.goto('/program-management/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Program Management');
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    await page.locator('#open-program').click();
    expect((await announced(page)).some((t) => t.includes('Choose a Program first.'))).toBe(true);

    await openProgram(page);
    const heading = page.locator('#editor-heading');
    await expect(heading).toBeFocused();
    await expect(heading).toHaveText(/.+/);
    for (const label of ['Site', 'Description', 'Eligibility notes', 'Schedule notes', 'Cost notes']) {
      await expect(page.getByRole('textbox', { name: label })).toBeVisible();
    }
  });

  test('a save is announced: "Saving…" then "Changes saved."', async ({ page }) => {
    await recordAnnouncements(page);
    await openProgram(page);
    await page.getByRole('textbox', { name: 'Description' }).fill('Synthetic description for the reader check');
    await page.locator('#save').click();
    await expect(page.locator('#status')).toContainText('Changes saved.');
    const texts = await announced(page);
    const saving = texts.findIndex((t) => t.includes('Saving…'));
    const saved = texts.findIndex((t) => t.includes('Changes saved.'));
    expect(saving, JSON.stringify(texts)).toBeGreaterThanOrEqual(0);
    expect(saved, JSON.stringify(texts)).toBeGreaterThan(saving);
  });

  test('the confirm dialog: named, described, starts on "Keep editing", Escape cancels, focus returns', async ({ page }) => {
    await openProgram(page);
    const lifecycle = page.locator('#lifecycle');
    await lifecycle.click();
    const dialog = page.getByRole('dialog', { name: 'Confirm action' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleDescription(/.+/);
    await expect(dialog.getByRole('button', { name: 'Keep editing' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(lifecycle).toBeFocused();
    await expect(page.locator('#program-status')).toHaveText('ACTIVE');
  });
});

test('the page text a screen reader starts from: every page has one h1 and a main landmark', async ({ page }) => {
  for (const path of [
    '/', '/referral/', '/program-management/', '/program-management/organization.html',
    '/program-management/organization-programs.html',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 }), path).toHaveCount(1);
    await expect(page.getByRole('main'), path).toHaveCount(1);
  }
});
