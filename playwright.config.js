// Browser tests for card 17: keyboard workflows, focus, labels, errors,
// text size and an automatic accessibility scan (axe), run against the
// real app with SYNTHETIC data (Final Technical PRD 14, 17.7).
//
//   npx playwright install chromium   (once per machine)
//   npm run test:e2e                  (Chromium)
//   npm run test:e2e:browsers         (every browser in docs/browser-verification.md)
//
// Separate from `npm test` on purpose: it needs a browser and starts its
// own synthetic dev server. See docs/regression-coverage.md.

import { defineConfig, devices } from '@playwright/test';

const PORT = 3217;

// One browser per run (Task: additional-browser verification). Every run
// starts its own fresh synthetic server, and the specs assume the starting
// state, so browsers must not share one server. Pick with E2E_BROWSER, or
// run all of them in turn with: npm run test:e2e:browsers
//   chromium (default) | firefox | webkit | msedge
const BROWSERS = {
  chromium: devices['Desktop Chrome'],
  firefox: devices['Desktop Firefox'],
  webkit: devices['Desktop Safari'],
  msedge: { ...devices['Desktop Edge'], channel: 'msedge' },
};
const browser = process.env.E2E_BROWSER ?? 'chromium';
if (!(browser in BROWSERS)) throw new Error(`E2E_BROWSER must be one of: ${Object.keys(BROWSERS).join(', ')}`);

export default defineConfig({
  testDir: './e2e',
  // One synthetic server, one developer identity: run one test at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    // Optional: point at an already-installed Chromium.
    launchOptions: process.env.CHROMIUM_PATH && browser === 'chromium' ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  projects: [{ name: browser, use: BROWSERS[browser] }],
  webServer: {
    command: 'node scripts/dev-synthetic-server.js',
    url: `http://127.0.0.1:${PORT}/health`,
    // Always a fresh server, so every run starts from the same synthetic data.
    reuseExistingServer: false,
    env: { NODE_ENV: 'development', PORT: String(PORT), DOTENV_CONFIG_PATH: '/nonexistent' },
    timeout: 20000,
  },
});
