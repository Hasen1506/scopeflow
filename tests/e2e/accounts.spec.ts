import {test, expect, type Page} from '@playwright/test';

// Two accounts on one browser: nothing typed by one account may show up for the next one or on the
// signed-out home page, which is the landing page (features), not the editor.
const stamp = Date.now();
const A = {name: 'Account Alpha', email: `alpha-${stamp}@example.test`, password: 'Fictional-password-123'};
const B = {name: 'Account Beta', email: `beta-${stamp}@example.test`, password: 'Fictional-password-123'};
const SECRET = 'Alpha confidential rebrand';

async function signUp(page: Page, who: typeof A) {
  await page.goto('/auth/sign-up?return_to=%2F');
  await page.getByLabel('Your name').fill(who.name);
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', {name: 'Create account'}).click();
  await expect(page.getByRole('tab', {name: /Projects \(0\)/})).toBeVisible();
}
const storedDrafts = (page: Page) => page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter(k => k.startsWith('scopeflow:draft')));

test('accounts: drafts stay with the account that typed them; the signed-out home is the landing page', async ({page}) => {
  page.on('dialog', d => d.accept());

  // Signed out: the landing page with the feature list, no editor.
  await page.goto('/');
  await expect(page.getByRole('heading', {name: /clear agreement/})).toBeVisible();
  await expect(page.getByRole('heading', {name: /Everything a scope needs/})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Scope-creep radar'})).toBeVisible();
  await expect(page.getByLabel('Project name')).toHaveCount(0);

  // Account A types an unsaved draft; a reload restores it for A.
  await signUp(page, A);
  await page.getByRole('button', {name: 'New scope'}).click();
  await page.getByLabel('Project name').fill(SECRET);
  await expect.poll(() => storedDrafts(page)).toHaveLength(1);
  await page.reload();
  await expect(page.locator('.unsaved-card')).toContainText(SECRET); // restored for A, as an unsaved card on the Projects home

  // Signing out forgets it; the signed-out home shows none of it.
  await page.getByRole('button', {name: 'Sign out'}).click();
  await expect(page).toHaveURL(/\/auth\/sign-in/);
  expect(await storedDrafts(page)).toEqual([]);
  await page.goto('/');
  await expect(page.getByRole('heading', {name: /Everything a scope needs/})).toBeVisible();
  await expect(page.getByText(SECRET)).toHaveCount(0);

  // Account B on the same browser starts clean.
  await signUp(page, B);
  await expect(page.getByText(SECRET)).toHaveCount(0);
  await expect(page.locator('.unsaved-card')).toHaveCount(0);
  await page.getByRole('button', {name: 'Account'}).click();
  await expect(page.getByRole('menu')).toContainText(B.email);
  await page.keyboard.press('Escape');

  // B types a draft, then signs in as A without signing out: B is signed out first and A sees none of B's draft.
  await page.getByRole('button', {name: 'New scope'}).click();
  await page.getByLabel('Project name').fill('Beta private draft');
  await expect.poll(() => storedDrafts(page)).toHaveLength(1);
  await page.goto('/auth/sign-in');
  await expect(page.getByRole('status')).toContainText(`You are signed in as ${B.email}`);
  await page.getByLabel('Email').fill(A.email);
  await page.getByLabel('Password').fill(A.password);
  await page.getByRole('button', {name: 'Sign in'}).click();
  await expect(page.getByRole('tab', {name: /Projects \(0\)/})).toBeVisible();
  await expect(page.getByText('Beta private draft')).toHaveCount(0);
  await expect(page.getByText(SECRET)).toHaveCount(0);
  await page.getByRole('button', {name: 'Account'}).click();
  await expect(page.getByRole('menu')).toContainText(A.email);
  await page.keyboard.press('Escape');

  // Trying the editor signed out keeps the draft in this tab only.
  await page.getByRole('button', {name: 'Sign out'}).click();
  await expect(page).toHaveURL(/\/auth\/sign-in/);
  await page.goto('/');
  await page.getByRole('button', {name: 'Try the editor', exact: true}).click();
  await expect(page.locator('.try-banner')).toContainText('Trying Scopeflow without an account');
  await page.getByLabel('Project name').fill('Visitor sketch');
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('scopeflow:draft')).length)).toBe(1);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('scopeflow:draft')))).toEqual([]);
});
