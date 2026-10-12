import {test, expect, type Page, type APIRequestContext} from '@playwright/test';
import {createHash} from 'node:crypto';

// WS-03 in the browser: the invoice panel shows what is left to invoice and it decreases after each
// invoice (C2); TDS chosen on an invoice shows the expected TDS and the net receivable (H19); an
// approved change order is listed with its tax (M7); an overdue invoice of a micro enterprise shows
// the MSMED s.16 interest estimate (SF-07); the public calculator works signed out. Setup goes
// through the API with the browser's own session; assertions are on what the owner sees.
// @covers C2 H19 M7 SF-07

const stamp = Date.now();
const owner = {name: 'TEST WS-03 Owner', email: `ws03-e2e-${stamp}@example.test`, password: 'Fictional-password-123'};
const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);

async function api(request: APIRequestContext, method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, data?: unknown) {
  const r = await request.fetch(path, {method, data, headers: {Origin: new URL(test.info().project.use.baseURL ?? 'http://localhost:5173').origin}});
  const body = await r.json().catch(() => null);
  expect(r.status(), `${method} ${path}: ${JSON.stringify(body)}`).toBeLessThan(300);
  return body;
}
async function approve(request: APIRequestContext, token: string) {
  const {scope} = await api(request, 'GET', `/api/review/${token}`);
  const content_sha256 = createHash('sha256').update(JSON.stringify(scope.content)).digest('hex');
  await api(request, 'POST', `/api/review/${token}`, {decision: 'approved', signer: 'Meera', comment: '', version: 1, acknowledged: true, content_sha256});
}
async function openProject(page: Page, title: string) {
  await page.goto('/');
  await page.getByRole('list', {name: 'Projects'}).getByRole('button', {name: title}).click();
}

test('ws-03: cap, TDS, change-order tax and MSMED interest in the invoice panel', async ({page}) => {
  await page.goto('/auth/sign-up?return_to=%2F');
  await page.getByLabel('Your name').fill(owner.name);
  await page.getByLabel('Email').fill(owner.email);
  await page.getByLabel('Password').fill(owner.password);
  await page.getByRole('button', {name: 'Create account'}).click();
  await expect(page.getByRole('button', {name: 'Sign out'})).toBeVisible();
  const rq = page.request;

  const profile = (await api(rq, 'GET', '/api/profile')).profile;
  await api(rq, 'PUT', '/api/profile', {...profile, business_name: 'TEST Ada Studio', business_address: '12 MG Road, Chennai', tax_id: '33ABCDE1234F1Z5', gst_state: '33', sac_code: '998314'});
  const title = `TEST WS-03 panel ${stamp}`;
  const created = await api(rq, 'POST', '/api/scopes', {title, client: 'Kaveri Foods', deliverables: 'Packaging design', exclusions: '', fee: 100000, currency: 'INR', revisions: 2, due: '', notes: '', tax_label: 'GST', tax_pct: 18});
  const {project_id, token} = created.scope;
  await approve(rq, token);

  // C2: ₹1,18,000 agreed; nothing invoiced yet.
  await openProject(page, title);
  const left = page.getByTestId('invoiceable');
  await expect(left).toContainText('Up to ₹1,18,000.00 still to invoice');

  // An invoice of ₹50,000 (taxable value) with TDS 2% technical, issued from the API; the panel shows it.
  await api(rq, 'POST', `/api/scopes/${project_id}/invoices`, {amount: 50000, tds: {section_2025: '393(1) Sl.6(iii)-technical', rate_pct: 2}});
  await openProject(page, title); // a reload returns to the project list
  await expect(left).toContainText('Up to ₹59,000.00 still to invoice');
  await expect(page.getByTestId('tds-line')).toContainText('TDS expected ₹1,000.00');
  await expect(page.getByTestId('tds-line')).toContainText('net receivable ₹58,000.00');

  // M7: an approved change order of +₹7,500.50 is offered with its tax.
  const co = await api(rq, 'POST', `/api/scopes/${project_id}/ledger`, {kind: 'change_order', baseline_version: 1, payload: {title: 'Odd paisa', fee_delta: 7500.50}});
  await api(rq, 'POST', `/api/review/${token}/change-order`, {seq: co.seq, decision: 'approved', signer: 'Meera', comment: ''});
  const inv = await api(rq, 'GET', `/api/scopes/${project_id}/invoices`);
  // This seller is GST-registered in Tamil Nadu and the place of supply is the same state, so the CO is
  // taxed per head (CGST + SGST): ₹1,350.10 / ₹8,850.60, plan §9.3. The single-head figure
  // (+ GST ₹1,350.09 = ₹8,850.59) is checked in tests/ws-03-invoicing.mjs and the property suite.
  expect(inv.change_orders.find((c: {seq: number}) => c.seq === co.seq).display).toBe('+₹7,500.50 + CGST + SGST ₹1,350.10 = ₹8,850.60');

  // SF-07: micro enterprise, accepted 40 days ago with 15 days to pay: the open invoice is overdue under MSMED.
  await api(rq, 'PUT', `/api/scopes/${project_id}/invoices/terms`, {msme_profile: {udyam_number: 'UDYAM-TN-02-0012345', registered_on: '2026-01-01', category: 'micro'}});
  await api(rq, 'POST', `/api/scopes/${project_id}/acceptance`, {delivered_on: daysAgo(41), accepted_on: daysAgo(40), evidence: 'Client email'});
  await openProject(page, title); // a reload returns to the project list
  await expect(page.getByTestId('msmed-interest').first()).toContainText(/Interest under MSMED s\.16: ₹[\d,]+\.\d\d \(estimate — confirm with your CA\)/);
});

test('ws-03: the public MSMED interest calculator works signed out', async ({page}) => {
  await page.goto('/msme-interest');
  await expect(page.getByTestId('msme-interest-total')).toContainText('Interest under MSMED s.16: ₹');
  await expect(page.getByText('Estimate — confirm with your CA.').first()).toBeVisible();
});
