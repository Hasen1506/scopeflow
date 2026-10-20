import {test, expect, type Page} from '@playwright/test';

// Etched is the default. An explicit Light or Dark choice stays in the cookie, on <html>,
// and on the switcher across rapid clicks, navigation and reload.
// @covers L9 LT-18 SF-21

const html = (page: Page) => page.locator('html');
const BG = {etched: 'rgb(31, 63, 168)', light: 'rgb(244, 238, 225)', dark: 'rgb(17, 21, 42)'};
const THEME = {etched: 'a', light: 'b', dark: 'b'};
const SCHEME = {etched: 'light', light: 'light', dark: 'dark'};

async function expectAppearance(page: Page, name: 'etched' | 'light' | 'dark') {
  await expect(html(page)).toHaveAttribute('data-theme', THEME[name]);
  await expect(html(page)).toHaveAttribute('data-scheme', SCHEME[name]);
  await expect(page.getByRole('group', {name: 'Theme'}).getByRole('button', {name: name === 'etched' ? 'Etched' : name === 'dark' ? 'Dark' : 'Light'})).toHaveAttribute('aria-pressed', 'true');
  const colors = await page.evaluate(() => {
    const cs = getComputedStyle(document.body);
    const button = getComputedStyle(document.querySelector('a.primary, button.primary') ?? document.body);
    const rail = getComputedStyle(document.querySelector('.side-rail') ?? document.body);
    return {bg: cs.backgroundColor, ink: cs.color, button: button.backgroundColor, rail: rail.backgroundColor};
  });
  expect(colors.bg).toBe(BG[name]);
  expect(colors.ink).not.toBe(colors.bg);
  expect(colors.button).not.toBe('');
  expect(colors.rail).not.toBe('');
  const stored = await page.evaluate(() => document.documentElement.dataset.theme + '|' + document.documentElement.dataset.scheme + '|' + (document.cookie.match(/(?:^|; )sf-appearance=([^;]*)/)?.[1] ?? ''));
  if (name === 'etched' && stored.endsWith('|')) return;
  expect(stored.endsWith(name)).toBe(true);
}

test('default is Etched, and Light and Dark survive rapid switches, navigation and reload', async ({page}) => {
  await page.goto('/');
  await expectAppearance(page, 'etched');

  const order = ['Light', 'Dark', 'Etched', 'Dark', 'Light', 'Etched', 'Light', 'Dark', 'Etched'] as const;
  for (const name of order) {
    await page.getByRole('button', {name, exact: true}).click();
    await expectAppearance(page, name === 'Etched' ? 'etched' : name === 'Dark' ? 'dark' : 'light');
  }

  await page.getByRole('link', {name: 'Templates'}).click();
  await expect(page).toHaveURL(/\/templates/);
  await expectAppearance(page, 'etched');
  await page.getByRole('link', {name: 'Projects'}).click();
  await expectAppearance(page, 'etched');

  await page.getByRole('button', {name: 'Dark', exact: true}).click();
  await page.reload();
  await expectAppearance(page, 'dark');
  await page.getByRole('link', {name: 'Templates'}).click();
  await expectAppearance(page, 'dark');

  await page.getByRole('button', {name: 'Light', exact: true}).click();
  await page.reload();
  await expectAppearance(page, 'light');
});
