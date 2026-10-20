import {test, expect, type Page} from '@playwright/test';

// Clicking Sign in must not paint the marketing hero. The same goes for the
// redirect after a successful sign-in and for sign-out.

async function watchHero(page: Page) {
  await page.addInitScript(() => {
    const paint = () => {
      const el = document.querySelector('#hero-title');
      if (!el) return;
      for (let node: Element | null = el; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return;
      }
      if (el.getClientRects().length) sessionStorage.setItem('sf-hero-seen', '1');
    };
    const start = () => {
      paint();
      new MutationObserver(paint).observe(document.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'data-auth', 'hidden']});
      requestAnimationFrame(function loop() { paint(); requestAnimationFrame(loop); });
    };
    if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
  });
}

const heroSeen = (page: Page) => page.evaluate(() => sessionStorage.getItem('sf-hero-seen') === '1');

test('Sign in from another page never paints the landing hero', async ({page}) => {
  await watchHero(page);
  await page.goto('/templates');
  await expect(page.getByRole('heading', {level: 1})).toBeVisible();
  expect(await heroSeen(page)).toBe(false);
  await page.getByRole('navigation', {name: 'Main'}).getByRole('link', {name: 'Sign in', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Welcome back'})).toBeVisible();
  await expect(page).toHaveURL(/\/auth\/sign-in/);
  expect(await heroSeen(page)).toBe(false);
});

test('signing in and signing out never paints the landing hero', async ({page}) => {
  await watchHero(page);
  const email = `flash-${Date.now()}@example.test`;
  await page.goto('/auth/sign-up?return_to=%2F');
  await page.getByLabel('Your name').fill('Flash Owner');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', {exact: true}).fill('Fictional-password-123');
  await page.getByRole('button', {name: 'Create account'}).click();
  await expect(page.getByRole('heading', {name: /Scopes & agreements/i})).toBeVisible();
  expect(await heroSeen(page)).toBe(false);

  await page.getByRole('button', {name: 'Sign out'}).click();
  await expect(page.getByRole('heading', {name: 'Welcome back'})).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Signed out.');
  expect(await heroSeen(page)).toBe(false);

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', {exact: true}).fill('Fictional-password-123');
  await page.getByRole('button', {name: 'Sign in', exact: true}).click();
  await expect(page.getByRole('heading', {name: /Scopes & agreements/i})).toBeVisible();
  expect(await heroSeen(page)).toBe(false);
});
