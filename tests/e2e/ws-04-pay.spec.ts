import {test, expect, type Page, type APIRequestContext} from '@playwright/test';
import {createHash, randomUUID} from 'node:crypto';
import {localSql} from '../support/local.mjs';

// WS-04 in a real browser against the production build (CI: `next start` on :5173, the Stripe double
// from tests/support/tsa-service.mjs at STRIPE_API_URL). The client pays the freelancer DIRECTLY: a UPI
// QR for the exact amount and an "I've paid" claim the owner confirms (LT-02, SF-02); a UPI-only
// freelancer offers no card checkout (C3); a supersede keeps money already paid (C4); and the Stripe
// return works in a fresh tab with no session storage (L5). Fictional TEST data; no retries.
// The PayBlock is shown on /pay/<token> (WS-04's page); WS-07 mounts the same slot on the review page.

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
async function signUp(page: Page, baseURL: string, label: string) {
  const H = {Origin: baseURL};
  const user = {name: 'TEST WS-04 ' + label, email: `ws04-e2e-${label}-${randomUUID()}@example.test`, password: 'Fictional-password-123'};
  const up = await page.request.post('/api/auth/sign-up/email', {headers: H, data: user});
  expect([200, 400, 422]).toContain(up.status());
  const inn = await page.request.post('/api/auth/sign-in/email', {headers: H, data: {email: user.email, password: user.password}});
  expect(inn.status()).toBe(200);
}
async function approveToken(request: APIRequestContext, baseURL: string, token: string) {
  const {scope: shown} = await (await request.get('/api/review/' + token)).json();
  const ok = await request.post('/api/review/' + token, {headers: {Origin: baseURL}, data: {decision: 'approved', signer: 'TEST Client', comment: '', version: shown.version, acknowledged: true, content_sha256: sha(JSON.stringify(shown.content))}});
  expect(ok.status()).toBe(200);
}
async function approvedProject(page: Page, baseURL: string, scope: Record<string, unknown>) {
  const created = await page.request.post('/api/scopes', {headers: {Origin: baseURL}, data: {client: 'TEST Client', deliverables: 'Logo design suite', exclusions: '', revisions: 2, due: '', notes: '', currency: 'INR', ...scope}});
  expect(created.status()).toBe(201);
  const {project_id, token} = (await created.json()).scope;
  await approveToken(page.request, baseURL, token);
  return {project_id: project_id as string, token: token as string};
}

// @covers LT-02 SF-02 C3
test('ws-04: UPI-only freelancer: QR for ₹29,500.00, no card checkout; "I\'ve paid" → owner confirms → deposit covered', async ({page, browser, baseURL}) => {
  await signUp(page, baseURL!, 'upi');
  const H = {Origin: baseURL!};
  expect((await page.request.post('/api/payment-accounts', {headers: H, data: {kind: 'upi', vpa: 'asha.design@okhdfcbank', payee_name: 'Asha Design'}})).status()).toBe(201);
  const title = 'TEST WS-04 UPI ' + Date.now();
  const p = await approvedProject(page, baseURL!, {title, fee: 25000, tax_pct: 18, tax_label: 'GST', deposit_pct: 100});

  const client = await browser.newContext();
  const cpage = await client.newPage();
  await cpage.goto('/pay/' + p.token);
  const block = cpage.getByTestId('pay-block');
  await expect(block.getByTestId('pay-to')).toHaveText(/^Pay ₹29,500\.00 to Asha Design$/);
  const qr = block.getByTestId('upi-qr');
  await expect(qr).toBeVisible();
  const uri = await qr.getAttribute('data-upi');
  const q = new URLSearchParams(uri!.replace(/^upi:\/\/pay\?/, ''));
  expect([q.get('pa'), q.get('pn'), q.get('am'), q.get('cu')]).toEqual(['asha.design@okhdfcbank', 'Asha Design', '29500.00', 'INR']);
  expect(q.get('tn')!.length).toBeLessThanOrEqual(80);
  expect(q.get('tn')).toContain('Deposit');
  expect(await block.getByTestId('upi-intent').getAttribute('href')).toBe(uri);
  // C3: no online card checkout without the freelancer's own account.
  await expect(block.getByTestId('pay-online')).toHaveCount(0);

  await block.getByLabel('Reference (UTR)').fill('4123 5678 9012');
  await block.getByLabel('Your name').fill('TEST Client');
  await block.getByTestId('claim-submit').click();
  await expect(block.getByTestId('claim-pending')).toContainText('••••••••9012');
  await expect(block.getByTestId('pay-deposit-state')).toHaveText(/Deposit due: ₹29,500\.00/);

  // The owner sees the claim and confirms it.
  await page.goto('/payments');
  const claim = page.getByTestId('claim').filter({hasText: title});
  await expect(claim).toContainText('412356789012');
  await claim.getByTestId('claim-confirm').click();
  await expect(page.getByText('Payment confirmed and recorded.')).toBeVisible();
  await expect(page.getByTestId('claim').filter({hasText: title})).toHaveCount(0);

  await cpage.reload();
  await expect(cpage.getByTestId('pay-deposit-state')).toHaveText(/Deposit covered \(₹29,500\.00\)/);
  await cpage.goto('/review/' + p.token);
  await expect(cpage.getByText(/Deposit received: ₹29,500\.00/)).toBeVisible();
  await client.close();
});

// @covers C4 LT-21
test('ws-04: after a superseding v2 the client page still shows the ₹3,000 already paid', async ({page, browser, baseURL}) => {
  await signUp(page, baseURL!, 'supersede');
  const H = {Origin: baseURL!};
  const p = await approvedProject(page, baseURL!, {title: 'TEST WS-04 supersede ' + Date.now(), fee: 10000, deposit_pct: 30});
  const paid = await page.request.post(`/api/scopes/${p.project_id}/ledger`, {headers: H, data: {kind: 'payment_received', baseline_version: 1, payload: {amount: 3000, method: 'upi', received: new Date().toISOString().slice(0, 10), reference: 'TESTUTR3000', note: ''}}});
  expect(paid.status()).toBe(201);
  const s = (await (await page.request.get(`/api/scopes/${p.project_id}`)).json()).versions[0].content;
  const revised = await page.request.post(`/api/scopes/${p.project_id}`, {headers: H, data: {expected_version: 1, content: {...s, notes: 'v2: TEST new working terms'}, supersede_agreement: true}});
  expect(revised.status()).toBe(201);
  const token2 = (await revised.json()).scope.token as string;
  await approveToken(page.request, baseURL!, token2);

  const client = await browser.newContext();
  const cpage = await client.newPage();
  await cpage.goto('/pay/' + token2);
  await expect(cpage.getByTestId('pay-received')).toHaveText('Received ₹3,000.00 of ₹10,000.00');
  await expect(cpage.getByTestId('pay-deposit-state')).toHaveText(/Deposit covered/);
  await cpage.goto('/review/' + token2);
  await expect(cpage.getByText(/Deposit received: ₹3,000\.00/)).toBeVisible();
  await client.close();
});

// @covers L5 C3
test('ws-04: Stripe on the freelancer\'s own key; returning in a NEW tab lands on the review page with the payment recorded', async ({page, browser, baseURL}) => {
  await signUp(page, baseURL!, 'stripe');
  const H = {Origin: baseURL!};
  const acct = await page.request.post('/api/payment-accounts', {headers: H, data: {kind: 'stripe_keys', secret_key: process.env.STRIPE_SECRET_KEY, webhook_secret: process.env.STRIPE_WEBHOOK_SECRET, currencies: ['EUR']}});
  expect(acct.status()).toBe(201);
  const p = await approvedProject(page, baseURL!, {title: 'TEST WS-04 Stripe ' + Date.now(), currency: 'EUR', fee: 1000, deposit_pct: 30});

  // The client starts checkout from the PayBlock; the Stripe-hosted page is stubbed (it is not on localhost).
  const client = await browser.newContext();
  const cpage = await client.newPage();
  await cpage.route('https://checkout.stripe.test/**', route => route.fulfill({status: 200, contentType: 'text/html', body: '<title>Stripe Checkout (test)</title><p>TEST checkout</p>'}));
  await cpage.goto('/pay/' + p.token);
  await cpage.getByTestId('pay-online').click();
  await cpage.waitForURL(/checkout\.stripe\.test\/c\/cs_test_/);
  const sessionId = cpage.url().split('/').pop()!;
  await client.close();
  // The client pays on Stripe (the double), then Stripe opens the success URL in a fresh tab.
  const stripe = process.env.STRIPE_API_URL!;
  expect((await fetch(`${stripe}/_pay/${sessionId}`, {method: 'POST'})).ok).toBe(true);
  const ref = (localSql(`SELECT return_ref FROM scopeflow.payments WHERE order_id='${sessionId}'`) as {results: {return_ref: string}[]}[])[0].results[0].return_ref;
  expect(ref).toMatch(/^[a-f0-9]{32}$/);
  const fresh = await browser.newContext();
  const tab = await fresh.newPage();
  await tab.goto(`/payment-return?status=success&ref=${ref}&session_id=${sessionId}`);
  await tab.waitForURL(new RegExp(`/review/${p.token}\\?payment=success$`));
  await expect(tab.getByText(/Deposit received: .*300[.,]00/).first()).toBeVisible();
  const ledger = await (await page.request.get(`/api/scopes/${p.project_id}/ledger`)).json();
  expect(ledger.entries.filter((e: {kind: string}) => e.kind === 'payment').map((e: {payload: {provider: string; amount: number}}) => [e.payload.provider, e.payload.amount])).toEqual([['stripe', 300]]);
  await fresh.close();
});
