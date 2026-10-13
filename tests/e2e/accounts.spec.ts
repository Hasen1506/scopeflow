import {test, expect, type Page} from '@playwright/test';

// Unsaved drafts are kept with the account (/api/unsaved-draft), not in the browser: they never show up for
// another account or on the signed-out home page (the landing page, not the editor), they survive
// signing out, and they follow the owner to another browser.
const stamp = Date.now();
const A = {name: 'Account Alpha', email: `alpha-${stamp}@example.test`, password: 'Fictional-password-123'};
const B = {name: 'Account Beta', email: `beta-${stamp}@example.test`, password: 'Fictional-password-123'};
const SECRET = 'Alpha confidential rebrand';

async function signUp(page: Page, who: typeof A) {
  await page.goto('/auth/sign-up?return_to=%2F');
  await page.getByLabel('Your name').fill(who.name);
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password', {exact: true}).fill(who.password);
  await page.getByRole('button', {name: 'Create account'}).click();
  await expect(page.getByRole('tab', {name: /Projects \(0\)/})).toBeVisible();
  // Wait for the workspace to finish loading: a click on New scope before then is undone when the project list lands.
  await expect(page.getByText('No saved scopes yet')).toBeVisible();
}
async function signInAs(page: Page, who: typeof A) {
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password', {exact: true}).fill(who.password);
  await page.getByRole('button', {name: 'Sign in'}).click();
  await expect(page.getByRole('tab', {name: /Projects \(0\)/})).toBeVisible();
}
const storedDrafts = (page: Page) => page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter(k => k.startsWith('scopeflow:draft')));
const keptTitle = async (page: Page) => (await (await page.request.get('/api/unsaved-draft')).json()).draft?.title ?? null;
const signOut = async (page: Page) => { await page.getByRole('button', {name: 'Sign out'}).click(); await expect(page).toHaveURL(/\/auth\/sign-in/); };

test('accounts: drafts stay with the account that typed them, across sign-out and browsers; the signed-out home is the landing page', async ({page, browser}) => {
  page.on('dialog', d => d.accept());

  // Signed out: the landing page with the feature list, no editor.
  await page.goto('/');
  await expect(page.getByRole('heading', {name: /clear agreement/})).toBeVisible();
  await expect(page.getByRole('heading', {name: /Everything a scope needs/})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Scope-creep radar'})).toBeVisible();
  await expect(page.getByLabel('Project name')).toHaveCount(0);

  // Account A types an unsaved draft: it is kept with the account, nothing in the browser.
  await signUp(page, A);
  await page.getByRole('button', {name: 'New scope'}).click();
  await page.getByLabel('Project name').fill(SECRET);
  await expect.poll(() => keptTitle(page)).toBe(SECRET);
  await expect(page.getByRole('status').filter({hasText: 'Draft kept with your account'})).toBeVisible();
  expect(await storedDrafts(page)).toEqual([]);
  await page.reload();
  await expect(page.locator('.unsaved-card')).toContainText(SECRET);

  // Signing out leaves nothing in the browser; the signed-out home shows none of it.
  await signOut(page);
  expect(await storedDrafts(page)).toEqual([]);
  await page.goto('/');
  await expect(page.getByRole('heading', {name: /Everything a scope needs/})).toBeVisible();
  await expect(page.getByText(SECRET)).toHaveCount(0);

  // Account B on the same browser starts clean.
  await signUp(page, B);
  await expect(page.getByText(SECRET)).toHaveCount(0);
  await expect(page.locator('.unsaved-card')).toHaveCount(0);
  expect(await keptTitle(page)).toBeNull();
  await page.getByRole('button', {name: 'Account'}).click();
  await expect(page.getByRole('menu')).toContainText(B.email);
  await page.keyboard.press('Escape');

  // B types a draft, then signs in as A without signing out: A gets A's own draft back, none of B's.
  await page.getByRole('button', {name: 'New scope'}).click();
  await page.getByLabel('Project name').fill('Beta private draft');
  await expect.poll(() => keptTitle(page)).toBe('Beta private draft');
  await page.goto('/auth/sign-in');
  await expect(page.getByRole('status')).toContainText(`You are signed in as ${B.email}`);
  await signInAs(page, A);
  await expect(page.locator('.unsaved-card')).toContainText(SECRET);
  await expect(page.getByText('Beta private draft')).toHaveCount(0);
  await page.getByRole('button', {name: 'Account'}).click();
  await expect(page.getByRole('menu')).toContainText(A.email);
  await page.keyboard.press('Escape');

  // Typing and signing out at once still keeps the last words (saved before the session ends).
  await page.locator('.unsaved-card').getByRole('button', {name: 'Continue draft'}).click();
  await page.getByLabel('Project name').fill(SECRET + ' final');
  await signOut(page);
  await signInAs(page, A);
  await expect(page.locator('.unsaved-card')).toContainText(SECRET + ' final');

  // Another browser (a second device) signed in as A gets the same draft.
  const other = await browser.newContext();
  const device = await other.newPage();
  await device.goto('/auth/sign-in?return_to=%2F');
  await signInAs(device, A);
  await expect(device.locator('.unsaved-card')).toContainText(SECRET + ' final');
  await other.close();

  // Trying the editor signed out keeps the draft in this tab only.
  await signOut(page);
  await page.goto('/');
  await page.getByRole('button', {name: 'Try the editor', exact: true}).click();
  await expect(page.locator('.try-banner')).toContainText('Trying Scopeflow without an account');
  await page.getByLabel('Project name').fill('Visitor sketch');
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('scopeflow:draft')).length)).toBe(1);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('scopeflow:draft')))).toEqual([]);
});
