// Runs the browser (Playwright) suite once per browser, each against its own
// fresh synthetic dev server, then prints a one-line result per browser.
//
//   npm run test:e2e:browsers                 all browsers below
//   npm run test:e2e:browsers -- firefox      just the ones named
//   npm run test:e2e:browsers -- webkit e2e/directReferral.spec.js   (a file filter after the names)
//
// Browsers: chromium, firefox, webkit, msedge (see playwright.config.js).
// Install the engines once: npx playwright install chromium firefox webkit
// Microsoft Edge is used from the machine (it is not downloaded).
// SYNTHETIC data only. Exits 1 if any browser had a failure.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALL = ['chromium', 'msedge', 'firefox', 'webkit'];

const args = process.argv.slice(2);
const named = args.filter((a) => ALL.includes(a));
const rest = args.filter((a) => !ALL.includes(a));
const browsers = named.length > 0 ? named : ALL;

const playwright = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
const summary = [];
for (const browser of browsers) {
  console.log(`\n===== ${browser} =====`);
  const result = spawnSync(process.execPath, [playwright, 'test', ...rest], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, E2E_BROWSER: browser },
  });
  summary.push({ browser, status: result.status });
}

console.log('\nBrowser results:');
for (const { browser, status } of summary) console.log(`  ${browser}: ${status === 0 ? 'passed' : `FAILED (exit ${status})`}`);
process.exit(summary.every((s) => s.status === 0) ? 0 : 1);
