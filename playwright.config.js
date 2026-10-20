// Browser tests for card 17: keyboard workflows, focus, labels, errors,
// text size and an automatic accessibility scan (axe), run against the
// real app with SYNTHETIC data (Final Technical PRD 14, 17.7).
//
//   npx playwright install chromium   (once per machine)
//   npm run test:e2e
//
// Separate from `npm test` on purpose: it needs a browser and starts its
// own synthetic dev server. See docs/regression-coverage.md.

import { defineConfig, devices } from '@playwright/test';

const PORT = 3217;

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
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/dev-synthetic-server.js',
    url: `http://127.0.0.1:${PORT}/health`,
    // Always a fresh server, so every run starts from the same synthetic data.
    reuseExistingServer: false,
    env: { NODE_ENV: 'development', PORT: String(PORT), DOTENV_CONFIG_PATH: '/nonexistent' },
    timeout: 20000,
  },
});
