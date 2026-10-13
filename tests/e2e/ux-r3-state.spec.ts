import {test, expect, type Page} from '@playwright/test';

// UX round 3: clicking "New scope" while the first /api/scopes is still loading keeps the owner in the
// editor; the first load only lands on Projects when the owner has not navigated or edited meanwhile.
// Own fictional owner; localhost only; no retries.

const OWNER = {name: 'UX R3 Owner', email: `ux-r3-owner-${Date.now()}@example.test`, password: 'Fictional-password-123'};
const scope = {title: 'TEST UX-R3 landing', client: 'Harbour Dental', deliverables: '', items: [{id: 'i1', title: 'Design system', qty: 1, unit: '', price: 1000, acceptance: 'Figma library'}], client_inputs: [], exclusions: 'Hosting', fee: 1000, currency: 'INR', revisions: 2, due: '2026-12-15', notes: ''};

async function signUp(page: Page) {
  await page.goto('/auth/sign-up?return_to=%2F');
  await page.getByLabel('Your name').fill(OWNER.name);
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password', {exact: true}).fill(OWNER.password);
  await page.getByRole('button', {name: 'Create account'}).click();
  await expect(page.getByRole('button', {name: 'Sign out'})).toBeVisible();
}

/** Holds the page's GET /api/scopes until release() is called. */
async function holdScopes(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  await page.route(url => url.pathname === '/api/scopes', async route => {
    if (route.request().method() === 'GET') await gate;
    await route.continue();
  });
  return release;
}

test('ux-r3: New scope during the first load is not bounced to the project list', async ({page, baseURL}) => {
  page.on('dialog', d => d.accept());
  await signUp(page);
  const made = await page.request.post('/api/scopes', {headers: {Origin: baseURL!}, data: scope});
  expect(made.ok()).toBe(true);
  const projects = page.getByRole('tab', {name: /^Projects \(1\b/});

  // Control: left alone, the first load lands on Projects.
  let release = await holdScopes(page);
  await page.goto('/');
  release();
  await expect(projects).toHaveAttribute('aria-selected', 'true');
  await page.unrouteAll();

  // The race: click New scope before /api/scopes answers, then let it answer.
  release = await holdScopes(page);
  await page.goto('/');
  await page.getByRole('button', {name: 'New scope'}).first().click();
  const loaded = page.waitForResponse(r => new URL(r.url()).pathname === '/api/scopes' && r.request().method() === 'GET');
  release();
  await loaded;
  await expect(projects).toBeVisible();
  await expect(page.getByRole('tab', {name: 'New scope'})).toHaveAttribute('aria-selected', 'true');
  await expect(projects).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByLabel('Project name')).toBeVisible();
  await page.unrouteAll();
});
