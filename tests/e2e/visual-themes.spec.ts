import {test, expect} from '@playwright/test';
import {prepare, settle} from './visual-shot';

// Appearance rail in the three themes, at a desktop width and a phone width.
// Baselines are the rail itself (stable) rather than a full marketing page.

const themes = [
  ['Light', 'b', 'light'],
  ['Dark', 'b', 'dark'],
  ['Etched', 'a', 'light'],
] as const;

test('theme rail matches the Light, Dark and Etched baselines', async ({page}) => {
  await prepare(page);
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
