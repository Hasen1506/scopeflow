import {test, expect, type Page} from '@playwright/test';
import {createHash} from 'node:crypto';

// WS-09 SF-16 in a real browser: the Insights panel leads with ₹ recovered and still shows every earlier
// card, the observations and the by-client list; filters and the CSV export are there.
// Own fictional owner; localhost only; no retries.
// @covers SF-16

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const OWNER = {name: 'WS09 Insights', email: `ws09-insights-e2e-${Date.now()}@example.test`, password: 'Fictional-password-123'};
const scope = {title: 'TEST WS-09 insights', client: 'Kaveri Foods', deliverables: '', items: [{id: 'logo', title: 'Logo suite', qty: 1, unit: '', price: null, acceptance: ''}], client_inputs: [], exclusions: 'Print', fee: 10000, currency: 'INR', revisions: 2, due: '', notes: ''};

async function signUp(page: Page) {
  await page.goto('/auth/sign-up?return_to=%2F');
  await page.getByLabel('Your name').fill(OWNER.name);
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', {name: 'Create account'}).click();
  await expect(page.getByRole('button', {name: 'Sign out'})).toBeVisible();
}

test('ws-09: insights lead with ₹ recovered and keep every earlier card', async ({page, browser, baseURL}) => {
  await signUp(page);
  const H = {Origin: baseURL!};
  const made = (await (await page.request.post('/api/scopes', {headers: H, data: scope})).json()).scope;
  const client = await browser.newContext();
  const shown = (await (await client.request.get('/api/review/' + made.token)).json()).scope;
  expect((await client.request.post('/api/review/' + made.token, {headers: H, data: {decision: 'approved', signer: 'Fictional Client', comment: '', version: made.version, acknowledged: true, content_sha256: sha(JSON.stringify(shown.content))}})).ok()).toBe(true);
  const co = await (await page.request.post(`/api/scopes/${made.project_id}/ledger`, {headers: H, data: {kind: 'change_order', baseline_version: 1, payload: {title: 'Extra social kit', fee_delta: 5000}}})).json();
  expect((await client.request.post(`/api/review/${made.token}/change-order`, {headers: H, data: {seq: co.seq, decision: 'approved', signer: 'Fictional Client', comment: ''}})).ok()).toBe(true);
  await client.close();
  expect((await page.request.post(`/api/scopes/${made.project_id}/ledger`, {headers: H, data: {kind: 'payment_received', baseline_version: 1, payload: {amount: 15000, method: 'upi', received: new Date().toISOString().slice(0, 10)}}})).ok()).toBe(true);

  await page.goto('/');
  await page.getByText('All insights').click();
  const hero = page.getByRole('region', {name: 'Recovered from change orders'});
  await expect(hero).toContainText('₹ recovered');
  await expect(hero.locator('strong')).toHaveText(/₹5,000/);
  await expect(hero).toContainText('1 change order paid for');
  for (const card of ['Fees at approval', 'Captured by change orders', 'Scope creep caught', 'Goodwill absorbed', 'Revision rounds', 'Received', 'Outstanding', 'MSMED interest accrued', 'TDS certificates pending', 'Change-order approval time', 'Radar catches → change orders'])
    await expect(page.locator('.agreement-grid span', {hasText: card}).first()).toBeVisible();
  await expect(page.getByRole('heading', {name: 'By client'})).toBeVisible();
  await expect(page.getByText(/Scope creep caught: ₹5,000/)).toBeVisible();
  await expect(page.getByRole('link', {name: 'Export CSV'})).toHaveAttribute('href', '/api/insights?format=csv');
  await page.getByRole('group', {name: 'Insights filters'}).getByLabel('Period').selectOption('month');
  await expect(page.getByRole('link', {name: 'Export CSV'})).toHaveAttribute('href', '/api/insights?format=csv&period=month');
  await expect(hero.locator('strong')).toHaveText(/₹5,000/);
});
