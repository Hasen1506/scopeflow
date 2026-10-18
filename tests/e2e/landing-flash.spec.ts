import {test, expect} from '@playwright/test';

// A returning owner must not see the marketing page while the session is still loading.
// The hint is written before navigation (auth form and the header). Unsigned visitors still see the landing page.

test('no landing flash when the session hint is set, and the landing page returns once signed out', async ({page}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', {name: /clear agreement/i})).toBeVisible();

  await page.route('**/api/me', async route => {
    await new Promise(resolve => setTimeout(resolve, 4000));
    await route.continue();
  });
  await page.addInitScript(() => localStorage.setItem('scopeflow:signed-in', '1'));
  await page.goto('/');
  await expect(page.locator('.landing')).toHaveCount(0);
  await expect(page.getByRole('heading', {name: /Scopes & agreements/i})).toBeVisible();
  await page.unroute('**/api/me');
  await page.evaluate(() => localStorage.removeItem('scopeflow:signed-in'));
  await page.reload();
  await expect(page.getByRole('heading', {name: /clear agreement/i})).toBeVisible();
});
