import {test, expect, type Page} from '@playwright/test';
import {createHash} from 'node:crypto';

// The restructured workspace: Projects home (status cards, summary strip, next step) → one project page
// (Scope → Approval → Changes → Payment) and the Account menu. Asserts the tap counts the redesign promises.
// Runs after the golden flow with its own owner; no retries (playwright.config.ts).

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const OWNER = {name: 'Navigation Owner', email: `nav-owner-${Date.now()}@example.test`, password: 'Fictional-password-123'};
const scope = (title: string, client: string, fee: number) => ({title, client, deliverables: '', items: [{id: 'i1', title: 'Design system', qty: 1, unit: '', price: fee, acceptance: 'Figma library'}], client_inputs: [], exclusions: 'Hosting', fee, currency: 'USD', revisions: 2, due: '2026-12-15', notes: '', tax_label: 'GST', tax_pct: 18, deposit_pct: 25});

async function seed(page: Page, baseURL: string) {
  const H = {Origin: baseURL};
  const make = async (s: object) => (await (await page.request.post('/api/scopes', {headers: H, data: s})).json()).scope;
  const approve = async (v: {token: string; version: number}) => {
    const {scope: shown} = await (await page.request.get('/api/review/' + v.token)).json();
    const r = await page.request.post('/api/review/' + v.token, {headers: H, data: {decision: 'approved', signer: 'Nav Client', comment: '', version: v.version, acknowledged: true, content_sha256: sha(JSON.stringify(shown.content))}});
    expect(r.ok()).toBe(true);
  };
  await make(scope('Pending website', 'Harbour Dental', 1000));
  const approved = await make(scope('Approved packaging', 'Kaveri Foods', 2000));
  await approve(approved);
  const changing = await make(scope('Changing onboarding', 'Northwind Labs', 3000));
  await approve(changing);
  const co = await page.request.post(`/api/scopes/${changing.project_id}/ledger`, {headers: H, data: {kind: 'change_order', baseline_version: 1, payload: {title: 'Two extra screens', reason: '', request_quote: '', add_items: [], remove_item_ids: [], fee_delta: 500, days_delta: 0, revisions_delta: 0}, request_id: crypto.randomUUID()}});
  expect(co.ok()).toBe(true);
}

test('navigation: Projects home, one-tap next steps, the project page and the Account menu', async ({page, context, baseURL}) => {
  page.on('dialog', d => d.accept());
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {origin: baseURL});
  await page.goto('/auth/sign-up?return_to=%2F');
  await page.getByLabel('Your name').fill(OWNER.name);
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password', {exact: true}).fill(OWNER.password);
  await page.getByRole('button', {name: 'Create account'}).click();

  // Signed-in owners land on the Projects home; with nothing saved, the next step is the first scope.
  const home = page.getByRole('tab', {name: /Projects \(0\)/});
  await expect(home).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('complementary', {name: 'Next step'})).toContainText('Start with your first scope');
  await expect(page.getByRole('tab')).toHaveCount(2); // was Scope editor / Projects / Insights

  // Account menu holds the account pages (were top-level nav links).
  await page.getByRole('button', {name: 'Account'}).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveText([/Data controls/, /Templates/, /Connect/, /Plans/]);
  await menu.getByRole('menuitem', {name: /Plans/}).click();
  await expect(page).toHaveURL(/\/plans$/);
  await expect(page.getByRole('complementary', {name: 'Next step'})).toBeVisible();
  await page.getByRole('navigation', {name: 'Main'}).getByRole('link', {name: 'Projects'}).click();
  await expect(page).toHaveURL(/\/$/);

  // Status cards, priority order and the summary strip.
  await seed(page, baseURL!);
  await page.reload();
  await expect(page.getByRole('tab', {name: /Projects \(3\)/})).toHaveAttribute('aria-selected', 'true');
  const cards = page.getByRole('list', {name: 'Projects'}).getByRole('listitem').filter({has: page.locator('.pc-title')});
  await expect(cards).toHaveCount(3);
  await expect(cards.locator('.stage-chip')).toHaveText(['Change pending', 'Awaiting approval', 'Approved']);
  await expect(page.locator('.summary-strip > div').filter({hasText: 'Change orders pending'}).locator('strong')).toHaveText('1');
  await expect(cards.nth(0)).toContainText('1 change order pending · +$500.00');
  await expect(page.getByRole('complementary', {name: 'Next step'})).toContainText('Change order awaiting Northwind Labs');

  // One tap: copy a pending project's review link straight from its card.
  await cards.filter({hasText: 'Pending website'}).getByRole('button', {name: 'Copy review link'}).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/review\/[0-9a-f]{64}$/);

  // One tap: record a change order from an approved project's card opens the project with the form ready.
  await cards.filter({hasText: 'Approved packaging'}).getByRole('button', {name: 'Record change order'}).click();
  await expect(page.getByRole('tab', {name: 'Approved packaging'})).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('form', {name: 'New change order'})).toBeVisible();
  const tracker = page.getByRole('list', {name: 'Project stages'});
  await expect(tracker.getByRole('link')).toHaveText([/Scope/, /Approval/, /Changes/, /Payment/]);
  await expect(tracker.locator('[aria-current=step]')).toContainText('Payment');
  await expect(page.locator('#step-payment')).toContainText('Deposit on signature (25%)');
  await page.getByRole('button', {name: 'Cancel'}).click();

  // Keyboard: P = Projects home, / = search, N = new scope, 1–4 = jump to a step.
  await page.locator('body').click({position: {x: 2, y: 2}});
  await page.keyboard.press('p');
  await expect(page.getByRole('tab', {name: /Projects \(3\)/})).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('/');
  await expect(page.getByLabel('Search projects')).toBeFocused();
  await page.getByLabel('Search projects').fill('onboarding');
  await expect(cards).toHaveCount(1);
  await cards.first().getByRole('button', {name: 'Changing onboarding'}).click();
  await expect(tracker.locator('[aria-current=step]')).toContainText('Changes');
  await expect(page.getByRole('complementary', {name: 'Next step'}).getByRole('button', {name: 'Copy review link'})).toBeVisible();
  await page.locator('body').click({position: {x: 2, y: 2}});
  await page.keyboard.press('2');
  await expect(page.locator('#step-approval')).toBeInViewport();
  await page.keyboard.press('n');
  await expect(page.getByRole('tab', {name: 'New scope'})).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Project name')).toHaveValue('');

  // Insights moved into the home: a summary strip plus the full breakdown one tap away.
  await page.getByRole('tab', {name: /Projects/}).click();
  await page.getByLabel('Search projects').fill('');
  await page.getByText('All insights').click();
  await expect(page.getByText(/Across 2 approved agreements/)).toBeVisible();
});
