import {test, expect} from '@playwright/test';

// Runs in the Pixel 7 and iPhone 13 projects (playwright.config.ts): pages WS-10 owns are usable on a
// phone. Mobile specs are named *mobile*.spec.ts; the desktop project skips them and vice versa.
// @covers M24 M22
test('connect page and consent errors fit a phone screen', async ({page}) => {
  await page.goto('/connect');
  await expect(page.getByRole('heading', {level: 1})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'API token'})).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.goto('/oauth/authorize?client_id=sfc_unknown');
  // Next's route announcer is also an alert; pick the page's own message.
  await expect(page.getByRole('alert').filter({hasText: 'not registered'})).toBeVisible();
});
