import {test, expect, type Page} from '@playwright/test';

async function settle(page: Page) {
  await page.waitForFunction(() => document.documentElement.classList.contains('fonts-ready'));
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.waitForTimeout(150);
}

// Appearance rail in the three themes, at a desktop width and a phone width.
// Baselines are the rail itself (stable) rather than a full marketing page.

const themes = [
  ['Light', 'b', 'light'],
  ['Dark', 'b', 'dark'],
  ['Etched', 'a', 'light'],
] as const;

test('theme rail matches the Light, Dark and Etched baselines', async ({page}) => {
  await page.goto('/');
  for (const width of [1280, 390]) {
    await page.setViewportSize({width, height: width === 390 ? 844 : 900});
    for (const [name, theme, scheme] of themes) {
      await page.getByRole('button', {name}).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('html')).toHaveAttribute('data-scheme', scheme);
      await settle(page);
      await expect(page.locator('.side-rail')).toHaveScreenshot(`rail-${name.toLowerCase()}-${width}.png`, {animations: 'disabled'});
    }
  }
});
