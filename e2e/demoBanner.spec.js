// Task 241 / issue #102: demo-mode layout, not the synthetic developer mode
// used by the rest of the suite. Narrow viewports supplement actual browser
// zoom verification; they do not establish a manual 400% Edge-zoom pass.
import { test as base, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';

const test = base.extend({
  demoURL: [async ({}, use) => {
    const reservation = createServer();
    await new Promise((resolve, reject) => {
      reservation.once('error', reject);
      reservation.listen(0, '127.0.0.1', resolve);
    });
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const child = spawn(process.execPath, ['scripts/dev-demo-server.js'], {
      env: { ...process.env, NODE_ENV: 'development', PORT: String(port), DOTENV_CONFIG_PATH: '/nonexistent' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Demo server startup timed out: ${output}`)), 15000);
        const failed = (error) => { clearTimeout(timer); reject(error); };
        child.once('error', failed);
        child.once('exit', (code) => failed(new Error(`Demo server exited ${code}: ${output}`)));
        child.stderr.on('data', (data) => { output += data; });
        child.stdout.on('data', (data) => {
          output += data;
          if (output.includes(`http://127.0.0.1:${port}/demo/`)) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      await use(`http://127.0.0.1:${port}`);
    } finally {
      if (child.exitCode === null) {
        const exited = new Promise((resolve) => child.once('exit', resolve));
        child.kill();
        await exited;
      }
    }
  }, { scope: 'worker' }],
});

async function signIn(page, demoURL) {
  await page.goto(`${demoURL}/demo/`);
  await page.getByRole('button', { name: /Referring Worker/ }).click();
  await expect(page.locator('.demo-bar')).toContainText('Signed in as Referring Worker');
}

async function expectUnobscured(locator, { scroll = true } = {}) {
  if (scroll) await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  await expect.poll(() => locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const fragments = [...element.getClientRects()]
      .map(r => ({
        left: Math.max(0, r.left), right: Math.min(innerWidth, r.right),
        top: Math.max(0, r.top), bottom: Math.min(innerHeight, r.bottom),
      }))
      .filter(r => r.right > r.left && r.bottom > r.top);
    const hit = fragments.length > 0 && fragments.every(r => {
      const target = document.elementFromPoint(
        (r.left + r.right) / 2, (r.top + r.bottom) / 2);
      return target === element || element.contains(target);
    });
    const bar = document.querySelector('.demo-bar');
    const banner = bar?.getBoundingClientRect();
    const overlap = bar && !bar.contains(element) && !element.classList.contains('skip-link') && banner.bottom > Math.max(0, box.top)
      && banner.top < Math.min(innerHeight, box.bottom)
      && banner.right > box.left && banner.left < box.right;
    return !overlap && hit;
  }), { message: 'The visible target must receive hit testing instead of being covered by the demo banner' }).toBe(true);
}

for (const path of ['/sent/', '/reporting/', '/help/']) {
  test(`demo banner leaves ${path} heading and text-size controls reachable after scrolling and reflow`, async ({ page, demoURL }) => {
    await signIn(page, demoURL);
    if (path === '/sent/') {
      // Populate the actual list so scrolling can bring content under the bar.
      for (let i = 0; i < 3; i += 1) {
        const response = await page.request.post(`${demoURL}/api/referrals`, { data: {
          submissionId: randomUUID(), receivingProgramId: 4,
          participantName: 'Synthetic Banner Check', contactMethod: 'NOT_AVAILABLE',
          referralContext: 'Synthetic layout regression',
        } });
        expect(response.status()).toBe(201);
      }
    }
    await page.goto(`${demoURL}${path}`);
    await expect(page.locator('.demo-bar')).toContainText('Referring Worker');
    // Resize after the banner has loaded: covers stale one-time height offsets.
    await page.locator('button[data-size="XL"]').click();
    await page.setViewportSize({ width: 320, height: 256 });
    await page.locator('main').evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await expectUnobscured(page.getByRole('heading', { level: 1 }), { scroll: false });
    for (const size of ['S', 'M', 'L', 'XL']) {
      const control = page.locator(`button[data-size="${size}"]`);
      await control.focus();
      await expectUnobscured(control);
      await page.keyboard.press('Enter');
      await expect(control).toHaveAttribute('aria-pressed', 'true');
    }
    await expectUnobscured(page.locator('.demo-bar a'));
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.locator('.demo-bar a').click();
    await expect(page).toHaveURL(`${demoURL}/demo/`);
    await page.getByRole('button', { name: /Housing Help Desk Staff/ }).click();
    await expect(page.locator('.demo-bar')).toContainText('Signed in as Housing Help Desk Staff');
  });
}

test('Help skip link exposes its target in demo mode at S text', async ({ page, demoURL }) => {
  await signIn(page, demoURL);
  await page.goto(`${demoURL}/help/`);
  await expect(page.locator('.demo-bar')).toBeVisible();
  await page.getByRole('button', { name: 'S', exact: true }).click();
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await skip.focus();
  await expectUnobscured(skip);
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await expectUnobscured(page.getByRole('heading', { name: 'Help and Guidance', exact: true }));
});
