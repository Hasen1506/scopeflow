import {test, expect, type Page} from '@playwright/test';

// Three appearances (Light, Dark, Etched) in the side rail. The choice survives a reload and follows
// the account to a browser with nothing stored. The client page follows the visitor's prefers-color-scheme
// whatever this browser stored. Own fictional owner; localhost only.
// @covers L9 LT-18 SF-21

const OWNER = {name: 'WS09 Theme', email: `ws09-theme-${Date.now()}@example.test`, password: 'Fictional-password-123'};
const scope = {title: 'TEST WS-09 theme scope', client: 'Nilgiri Tea', deliverables: '', items: [{id: 'i1', title: 'Label design', qty: 1, unit: '', price: 1000, acceptance: 'Print-ready files'}], client_inputs: [], exclusions: 'Printing', fee: 1000, currency: 'INR', revisions: 2, due: '2026-12-15', notes: ''};

async function signUp(page: Page) {
  await page.goto('/auth/sign-up?return_to=%2F');
  await page.getByLabel('Your name').fill(OWNER.name);
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password', {exact: true}).fill(OWNER.password);
  await page.getByRole('button', {name: 'Create account'}).click();
  await expect(page.getByRole('button', {name: 'Sign out'})).toBeVisible();
}
const html = (page: Page) => page.locator('html');
const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test('ws-09: Light, Dark and Etched switch, persist per account; client page follows the system', async ({page, browser, baseURL}) => {
  await signUp(page);
  await expect(html(page)).toHaveAttribute('data-theme', 'a');
  await expect(html(page)).toHaveAttribute('data-mode', 'light');
  await expect(html(page)).toHaveAttribute('data-scheme', 'light');
  expect(await bodyBg(page)).toBe('rgb(31, 63, 168)');

  const switcher = page.getByRole('group', {name: 'Theme'});
  await expect(switcher.getByRole('button', {name: 'Etched'})).toHaveAttribute('aria-pressed', 'true');
  await switcher.getByRole('button', {name: 'Etched'}).click();
  await expect(html(page)).toHaveAttribute('data-theme', 'a');
  await expect(html(page)).toHaveAttribute('data-mode', 'light');
  await expect(switcher.getByRole('button', {name: 'Etched'})).toHaveAttribute('aria-pressed', 'true');
  expect(await bodyBg(page)).toBe('rgb(31, 63, 168)');

  await switcher.getByRole('button', {name: 'Dark'}).click();
  await expect(html(page)).toHaveAttribute('data-theme', 'b');
  await expect(html(page)).toHaveAttribute('data-scheme', 'dark');
  expect(await bodyBg(page)).toBe('rgb(17, 21, 42)');
  await expect.poll(async () => (await (await page.request.get('/api/theme')).json())).toMatchObject({signedIn: true, theme: 'b', mode: 'dark'});

  await page.reload();
  await expect(html(page)).toHaveAttribute('data-theme', 'b');
  await expect(html(page)).toHaveAttribute('data-scheme', 'dark');

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(html(page)).toHaveAttribute('data-theme', 'b', {timeout: 10_000});
  await expect(html(page)).toHaveAttribute('data-mode', 'dark');

  await switcher.getByRole('button', {name: 'Light'}).click();
  await expect(html(page)).toHaveAttribute('data-theme', 'b');
  await expect(html(page)).toHaveAttribute('data-scheme', 'light');
  expect(await bodyBg(page)).toBe('rgb(244, 238, 225)');

  const refused = await page.request.put('/api/theme', {headers: {Origin: baseURL!}, data: {theme: 'c', mode: 'dim'}});
  expect(refused.status()).toBe(400);

  // Client page: follows prefers-color-scheme even if this browser stored a dark choice.
  const made = (await (await page.request.post('/api/scopes', {headers: {Origin: baseURL!}, data: scope})).json()).scope;
  for (const colorScheme of ['dark', 'light'] as const) {
    const client = await browser.newContext({colorScheme});
    await client.addInitScript(() => { try { localStorage.setItem('scopeflow:mode', 'dark'); localStorage.setItem('scopeflow:theme', 'b'); } catch { /* none */ } });
    const cpage = await client.newPage();
    await cpage.goto('/review/' + made.token);
    await expect(cpage.locator('html')).toHaveAttribute('data-mode', 'system');
    await expect(cpage.locator('html')).toHaveAttribute('data-scheme', colorScheme);
    await client.close();
  }
});
