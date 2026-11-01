// Trello Task 208: user-facing QCH business times show in Eastern time.
//
// Team robustness hardening, NOT a Handoff PRD requirement or compliance
// fix. Referral times on Received referrals and Referrals I sent are
// formatted in the browser (public/receiving/common.js, formatDate). Before
// this task that formatting had no time zone, so the same saved instant read
// differently on devices in different time zones. It is now pinned to
// America/New_York (with daylight saving), the same zone reporting already
// uses (src/reporting/periods.js, REPORTING_TIME_ZONE).
//
// Every test here runs in a browser whose own time zone is UTC, so it would
// fail if the device's zone leaked through. The instants straddle the
// daylight-saving change on Sunday, November 1, 2026 (2:00 a.m. EDT becomes
// 1:00 a.m. EST), so a hard-coded -4 or -5 offset would also fail.
// SYNTHETIC data only.

import { test, expect } from '@playwright/test';
import { ensureAffiliation } from './helpers.js';

test.use({ timezoneId: 'UTC' });

// Saved instant (UTC) -> what a worker must read (Eastern).
const CASES = [
  { iso: '2026-10-31T16:00:00.000Z', date: 'Oct 31, 2026', time: '12:00 PM', note: 'EDT (UTC-4), day before the change' },
  { iso: '2026-11-01T05:30:00.000Z', date: 'Nov 1, 2026', time: '1:30 AM', note: 'EDT, the first 1:30 a.m.' },
  { iso: '2026-11-01T06:30:00.000Z', date: 'Nov 1, 2026', time: '1:30 AM', note: 'EST (UTC-5), the repeated 1:30 a.m.' },
  { iso: '2026-11-01T17:00:00.000Z', date: 'Nov 1, 2026', time: '12:00 PM', note: 'EST, after the change' },
  { iso: '2026-11-02T03:30:00.000Z', date: 'Nov 1, 2026', time: '10:30 PM', note: 'EST; already Nov 2 in UTC' },
];

// Separators differ between browser versions (", " or " at ", and a
// narrow no-break space before AM/PM), so match the parts, not the glue.
const shows = ({ date, time }) => new RegExp(`${date.replace(/ /g, '\\s')}.*\\b${time.replace(' ', '\\s')}`);

test.describe('referral times show in Eastern time on a UTC device (Task 208, robustness hardening)', () => {
  test('the browser really is in UTC for these tests', async ({ page }) => {
    await page.goto('/receiving/');
    expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe('UTC');
  });

  test('formatDate shows each instant as Eastern time, across the Nov 1, 2026 daylight-saving change', async ({ page }) => {
    await page.goto('/receiving/');
    const shown = await page.evaluate(async (isos) => {
      const { formatDate } = await import('/receiving/common.js');
      return isos.map((iso) => formatDate(iso));
    }, CASES.map((c) => c.iso));
    for (const [i, c] of CASES.entries()) {
      expect(shown[i], `${c.iso} (${c.note})`).toMatch(shows(c));
    }
  });

  test('Received referrals and Referrals I sent show a saved time in Eastern time', async ({ page }) => {
    // A real referral, so the pages and their data are real; only its saved
    // time is replaced with a known instant (Nov 1, 2026, 12:00 PM EST).
    await page.goto('/referral/');
    await ensureAffiliation(page);
    const name = `Synthetic Person Eastern ${Date.now().toString(36)}`;
    const sent = await page.evaluate(async (participantName) => (await fetch('/api/referrals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submissionId: crypto.randomUUID(), receivingProgramId: 4, participantName,
        contactMethod: 'NOT_AVAILABLE', referralContext: 'Synthetic context for Task 208',
      }),
    })).json(), name);
    const id = sent.referral.referralId;
    const at = CASES[3];

    for (const list of ['received', 'sent']) {
      await page.route(`**/api/referrals/${list}*`, async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        for (const r of body.referrals) if (r.referralId === id) r.createdAt = at.iso;
        await route.fulfill({ response, json: body });
      });
    }

    for (const path of ['/receiving/', '/sent/']) {
      await page.goto(path);
      const item = page.locator('li, article, .queue-item').filter({ hasText: name }).first();
      await expect(item, path).toContainText(/Sent /);
      expect(await item.innerText(), path).toMatch(shows(at));
    }
  });
});
