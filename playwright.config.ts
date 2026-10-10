import {defineConfig, devices} from '@playwright/test';

// Golden end-to-end flow against the local production build (`next start` on :5173) with
// the local auth fixture and a fresh scopeflow_test database. One worker, no retries:
// a flaky step is a bug to fix, never something to retry or quarantine.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  globalTimeout: 300_000,
  expect: {timeout: 15_000},
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: process.env.SCOPEFLOW_TEST_URL || 'http://localhost:5173',
    locale: 'en-US',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    acceptDownloads: true,
  },
  projects: [{name: 'chromium', use: {...devices['Desktop Chrome'], launchOptions: {executablePath}}}],
});
