import {test, expect, type Page} from '@playwright/test';
import {createHash, randomUUID} from 'node:crypto';
import {coSha256} from '../../lib/ledger';

// WS-05 in a real browser against the production build: the client approves a change order on the
// review link and gets its content hash back (H17), the approved CO deliverable is listed under
// "Deliverables now" (LT-14), the owner withdraws change orders without waiting (LT-08) and a
// retainer shows its quota counter to owner and client alike (SF-05). Fictional TEST data only;
// no retries (playwright.config.ts). Setup goes through the API so each test stays short.

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

async function signUp(page: Page, baseURL: string, label: string) {
  const H = {Origin: baseURL};
  const user = {name: 'WS-05 ' + label, email: `ws05-${label}-${randomUUID()}@example.test`, password: 'Fictional-password-123'};
  const up = await page.request.post('/api/auth/sign-up/email', {headers: H, data: user});
  expect([200, 400, 422]).toContain(up.status());
  const inn = await page.request.post('/api/auth/sign-in/email', {headers: H, data: {email: user.email, password: user.password}});
  expect(inn.status()).toBe(200);
}
async function approvedProject(page: Page, baseURL: string, scope: Record<string, unknown>) {
  const H = {Origin: baseURL};
  const created = await page.request.post('/api/scopes', {headers: H, data: scope});
  expect(created.status()).toBe(201);
  const {project_id, token} = (await created.json()).scope;
  const {scope: shown} = await (await page.request.get('/api/review/' + token)).json();
  const ok = await page.request.post('/api/review/' + token, {headers: H, data: {decision: 'approved', signer: 'TEST Client', comment: '', version: 1, acknowledged: true, content_sha256: sha(JSON.stringify(shown.content))}});
  expect(ok.status()).toBe(200);
  return {project_id: project_id as string, token: token as string};
}
async function changeOrder(page: Page, baseURL: string, projectId: string, payload: Record<string, unknown>) {
  const r = await page.request.post(`/api/scopes/${projectId}/ledger`, {headers: {Origin: baseURL}, data: {kind: 'change_order', baseline_version: 1, payload: {reason: '', request_quote: '', add_items: [], remove_item_ids: [], fee_delta: 0, days_delta: 0, revisions_delta: 0, ...payload}, request_id: randomUUID()}});
  expect(r.status()).toBe(201);
  return (await r.json()).seq as number;
}
async function openProject(page: Page, title: string) {
  await page.goto('/');
  await page.getByRole('list', {name: 'Projects'}).getByRole('button', {name: title}).click();
  const ledger = page.locator('section.ledger');
  await expect(ledger.getByText('Current fee')).toBeVisible();
  return ledger;
}
const inrScope = (title: string) => ({title, client: 'TEST Client', deliverables: '', items: [{id: 'logo', title: 'Logo suite', qty: 1, unit: '', price: 25000, acceptance: ''}], client_inputs: [], exclusions: '', fee: 25000, currency: 'INR', revisions: 2, due: plusDays(today(), 60), notes: '', tax_label: 'GST', tax_pct: 18});

// @covers H17 LT-14
test('ws-05: CO-1 +₹7,500.50 approved on the client page; the receipt carries its hash; Deliverables now lists it', async ({page, browser, baseURL}) => {
  await signUp(page, baseURL!, 'co');
  const title = 'TEST WS-05 CO e2e ' + Date.now();
  const p = await approvedProject(page, baseURL!, inrScope(title));
  await changeOrder(page, baseURL!, p.project_id, {title: 'Instagram templates', add_items: [{id: 'tpl', title: 'Instagram templates', qty: 6, unit: 'templates', price: 7500.5, acceptance: ''}], fee_delta: 7500.5});
  const {scope: shown, ledger} = await (await page.request.get('/api/review/' + p.token)).json();
  const expected = await coSha256(ledger.agreement.change_orders[0], shown.content);

  const client = await browser.newContext();
  const cpage = await client.newPage();
  await cpage.goto('/review/' + p.token);
  const pending = cpage.locator('.change-order');
  await expect(pending).toContainText('CO-1');
  await expect(cpage.getByText('Verified in your browser')).toBeVisible();
  await pending.getByLabel('Your name').fill('TEST Client');
  await pending.getByRole('checkbox').check();
  const settle = cpage.waitForResponse(r => r.url().includes('/change-order') && r.request().method() === 'POST');
  await pending.getByRole('button', {name: 'Approve change'}).click();
  const res = await settle;
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({status: 'approved', seq: 1, receipt: {change_order: 'CO-1', co_sha256: expected, total_incl_tax_minor: 885059}});
  await expect(cpage.locator('.change-order')).toHaveCount(0);
  await expect(cpage.locator('.agreement-grid')).toContainText('32,500.50');
  // LT-14: the CO deliverable is now part of the agreement the client sees.
  const now = cpage.getByRole('heading', {name: 'Deliverables now'}).locator('xpath=following-sibling::ul[1]');
  await expect(now.locator('li').filter({hasText: 'Instagram templates'})).toContainText('CO-1');
  await client.close();
});

// @covers LT-08
test('ws-05: withdrawing a change order answers in under 2 s and a double click records it once', async ({page, baseURL}) => {
  page.on('dialog', d => d.accept());
  await signUp(page, baseURL!, 'withdraw');
  const title = 'TEST WS-05 withdraw e2e ' + Date.now();
  const p = await approvedProject(page, baseURL!, inrScope(title));
  await changeOrder(page, baseURL!, p.project_id, {title: 'TEST first change', fee_delta: 1000});
  const second = await changeOrder(page, baseURL!, p.project_id, {title: 'TEST second change', fee_delta: 2000});
  const ledger = await openProject(page, title);
  const row = (t: string) => ledger.locator('ol.timeline > li').filter({hasText: t}).filter({has: page.getByRole('button', {name: 'Withdraw'})});

  const posted = page.waitForResponse(r => r.url().endsWith(`/api/scopes/${p.project_id}/ledger`) && r.request().method() === 'POST');
  const t0 = Date.now();
  await row('TEST first change').getByRole('button', {name: 'Withdraw'}).click();
  expect((await posted).status()).toBe(201);
  expect(Date.now() - t0).toBeLessThan(2000);
  await expect(ledger.getByRole('status')).toContainText('CO-1 withdrawn');

  let posts = 0;
  page.on('request', r => { if (r.url().endsWith(`/api/scopes/${p.project_id}/ledger`) && r.method() === 'POST') posts++; });
  await row('TEST second change').getByRole('button', {name: 'Withdraw'}).dblclick();
  await expect(ledger.getByRole('status')).toContainText(`CO-${second} withdrawn`);
  expect(posts).toBeLessThanOrEqual(2);
  const view = await (await page.request.get(`/api/scopes/${p.project_id}/ledger`)).json();
  expect(view.entries.filter((e: {kind: string; payload: {ref_seq?: number}}) => e.kind === 'settle' && e.payload.ref_seq === second)).toHaveLength(1);
  expect(view.agreement.change_orders.map((c: {status: string}) => c.status)).toEqual(['withdrawn', 'withdrawn']);
  await expect(ledger.locator('ol.timeline').getByRole('button', {name: 'Withdraw'})).toHaveCount(0);
});

// @covers SF-05
test('ws-05: a retainer project shows 11/12 posts used to the owner; the client sees the same counter', async ({page, baseURL}) => {
  await signUp(page, baseURL!, 'retainer');
  const H = {Origin: baseURL!};
  const rate = await page.request.put('/api/rate-card', {headers: H, data: {items: [{id: 'post', title: 'Instagram post', unit: 'post', unit_price_minor: 150000, currency: 'INR', tax_pct: 18, tags: []}], multipliers: [{id: 'rush', label: 'Rush delivery', pct: 25}]}});
  expect(rate.status()).toBe(200);
  const title = 'TEST WS-05 retainer e2e ' + Date.now();
  const p = await approvedProject(page, baseURL!, {...inrScope(title), items: [{id: 'post', title: 'Instagram post', qty: 12, unit: 'posts', price: 30000, acceptance: ''}], fee: 30000, due: '', engagement: 'retainer', retainer: {period: 'monthly', quotas: [{item_id: 'post', qty: 12}], carry_over: 'none', renewal: 'manual'}});
  const used = await page.request.post(`/api/scopes/${p.project_id}/periods`, {headers: H, data: {action: 'usage', baseline_version: 1, item_id: 'post', qty: 11, date: today(), note: ''}});
  expect(used.status()).toBe(201);

  const ledger = await openProject(page, title);
  const counter = ledger.locator('.retainer-counter');
  await expect(counter).toContainText('11/12 posts used');
  const client = await (await page.request.get('/api/review/' + p.token)).json();
  const line = client.ledger.agreement.retainer.periods.at(-1).lines[0];
  expect([line.used, line.allowance]).toEqual([11, 12]);

  // Two more posts through the workspace form: one fits the quota, one is an overage CO at the rate-card price.
  const form = ledger.getByRole('form', {name: 'Log retainer usage'});
  await form.getByLabel('Quantity').fill('2');
  await form.getByRole('button', {name: 'Log usage'}).click();
  await expect(ledger.locator('.retainer-panel').getByRole('status')).toContainText(/1 over quota: CO-\d+ proposed/);
  await expect(counter).toContainText('13/12 posts used');
  const view = await (await page.request.get(`/api/scopes/${p.project_id}/ledger`)).json();
  const overage = view.agreement.change_orders.filter((c: {overage?: unknown}) => c.overage);
  expect(overage).toHaveLength(1);
  expect(overage[0]).toMatchObject({status: 'proposed', fee_delta: 1500});
});
