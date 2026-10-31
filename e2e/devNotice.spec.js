// Trello Task 221 (Handoff PRD §34 environment separation): the synthetic
// dev server, which these browser tests run against, still shows the
// synthetic-data notice on the pages that carry it. That production does
// not is checked against the real production server in
// test/devNotice.test.js. SYNTHETIC data only.

import { test, expect } from '@playwright/test';

const NOTICE = 'Development build. Use synthetic data only.';

for (const pagePath of ['/', '/referral/', '/reporting/']) {
  test(`development: ${pagePath} shows the synthetic-data notice once (Task 221)`, async ({ page }) => {
    await page.goto(pagePath);
    const notice = page.locator('main').getByText(NOTICE, { exact: true });
    await expect(notice).toHaveCount(1);
    await expect(notice).toBeVisible();
  });
}
