import {test, expect, type Page} from '@playwright/test';

// WS-09 L9 / LT-18 / SF-21 in a real browser: switch theme A <-> B and dark mode from the header; the
// choice survives a reload and follows the account to a browser with nothing stored; the client page
// follows the visitor's prefers-color-scheme whatever this browser stored. Own fictional owner; localhost only.
// @covers L9 LT-18 SF-21

const OWNER = {name: 'WS09 Theme', email: `ws09-theme-${Date.now()}@example.test`, password: 'Fictional-password-123'};
const scope = {title: 'TEST WS-09 theme scope', client: 'Nilgiri Tea', deliverables: '', items: [{id: 'i1', title: 'Label design', qty: 1, unit: '', price: 1000, acceptance: 'Print-ready files'}], client_inputs: [], exclusions: 'Printing', fee: 1000, currency: 'INR', revisions: 2, due: '2026-12-15', notes: ''};

async function signUp(page: Page) {
  await page.goto('/auth/sign-up?return_to=%2F');
  await page.getByLabel('Your name').fill(OWNER.name);
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', {name: 'Create account'}).click();
  await expect(page.getByRole('button', {name: 'Sign out'})).toBeVisible();
}
const html = (page: Page) => page.locator('html');
const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test('ws-09: theme A/B and dark mode switch, persist per account; client page follows the system', async ({page, browser, baseURL}) => {
  await signUp(page);
  // Default: theme B light, exactly the original palette.
  await expect(html(page)).toHaveAttribute('data-theme', 'b');
  await expect(html(page)).toHaveAttribute('data-scheme', 'light');
  expect(await bodyBg(page)).toBe('rgb(244, 238, 225)');

  const switcher = page.getByRole('group', {name: 'Theme'});
  await switcher.getByRole('button', {name: /Theme A/}).click();
  await expect(html(page)).toHaveAttribute('data-theme', 'a');
  await expect(switcher.getByRole('button', {name: /Theme A/})).toHaveAttribute('aria-pressed', 'true');
  expect(await bodyBg(page)).toBe('rgb(31, 63, 168)');
  await switcher.getByLabel('Colour mode').selectOption('dark');
  await expect(html(page)).toHaveAttribute('data-scheme', 'dark');
  expect(await bodyBg(page)).toBe('rgb(15, 29, 85)');
  await expect.poll(async () => (await (await page.request.get('/api/theme')).json())).toMatchObject({signedIn: true, theme: 'a', mode: 'dark'});

  // Reload keeps it (no flash: the attributes are set before first paint).
  await page.reload();
  await expect(html(page)).toHaveAttribute('data-theme', 'a');
  await expect(html(page)).toHaveAttribute('data-scheme', 'dark');

  // A browser with nothing stored gets the account's choice once signed in.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(html(page)).toHaveAttribute('data-theme', 'a', {timeout: 10_000});
  await expect(html(page)).toHaveAttribute('data-mode', 'dark');

  // Back to B, dark: B's own dark palette.
  await switcher.getByRole('button', {name: /Theme B/}).click();
  await expect(html(page)).toHaveAttribute('data-theme', 'b');
  expect(await bodyBg(page)).toBe('rgb(17, 21, 42)');
  // System mode follows the emulated scheme.
  await switcher.getByLabel('Colour mode').selectOption('system');
  await page.emulateMedia({colorScheme: 'light'});
  await expect(html(page)).toHaveAttribute('data-scheme', 'light');
  await page.emulateMedia({colorScheme: 'dark'});
  await expect(html(page)).toHaveAttribute('data-scheme', 'dark');

  // Invalid preferences are refused with field messages.
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
