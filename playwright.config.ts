import {defineConfig, devices} from '@playwright/test';

// Golden end-to-end flow against the local production build (`next start` on :5173) with
// the local auth fixture and a fresh scopeflow_test database. One worker, no retries:
// a flaky step is a bug to fix, never something to retry or quarantine.
//
// WS-10: desktop Chromium runs every spec except *mobile*.spec.ts; the Pixel 7 and iPhone 13
// projects (Chromium with each device's viewport, touch and user agent: CI installs Chromium only)
// run the *mobile*.spec.ts specs.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
const mobile = /.*mobile.*\.spec\.ts$/;
// Page and theme-rail screenshots run only inside the pinned Playwright image
// (npm run test:visual). The host browser draws the same webfonts differently,
// so those specs are not part of the ordinary suite.
const visual = /visual-.*\.spec\.ts$/;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  globalTimeout: 600_000,
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
  projects: [
    {name: 'chromium', testIgnore: process.env.SCOPEFLOW_VISUAL_DOCKER ? mobile : [mobile, visual], use: {...devices['Desktop Chrome'], launchOptions: {executablePath}}},
    {name: 'pixel-7', testMatch: mobile, use: {...devices['Pixel 7'], launchOptions: {executablePath}}},
    {name: 'iphone-13', testMatch: mobile, use: {...devices['iPhone 13'], browserName: 'chromium', defaultBrowserType: 'chromium', launchOptions: {executablePath}}},
  ],
});
