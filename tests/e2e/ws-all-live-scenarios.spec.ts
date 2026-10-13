import {test, expect, type APIRequestContext, type Browser, type BrowserContext, type Page} from '@playwright/test';
import {createHash} from 'node:crypto';
import {existsSync, readdirSync} from 'node:fs';

// WS-09: the final cross-workstream suite. The ten live-test scenarios of the plan (§13), in order, as
// named tests, replayed against the integrated app. Each scenario needs the workstreams that fixed it; a
// scenario whose owners have not landed on this build is skipped at runtime with "needs WS-xx merged",
// so the suite is green on any branch and runs in full once every workstream is merged.
//
// Landed detection (runtime, at test start): a workstream has landed when its migration slot
// (`db/migrations/00NN_ws-NN_*.sql`) or its own browser spec (`tests/e2e/ws-NN-*.spec.ts`) is in the tree
// under test. SCOPEFLOW_LIVE_ALL=1 forces every scenario to run (post-integration CI).
// Fictional owners and clients only (TEST data, @example.test); localhost only; no retries.
// @covers H4

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const ROOT = new URL('../../', import.meta.url);
const list = (dir: string) => { const u = new URL(dir, ROOT); return existsSync(u) ? readdirSync(u) : []; };

/** True when workstream `ws` ("WS-02") is part of the build under test. */
export function landed(ws: string) {
  if (process.env.SCOPEFLOW_LIVE_ALL === '1') return true;
  const n = ws.replace(/^WS-/i, '').padStart(2, '0');
  return list('db/migrations/').some(f => f.includes(`_ws-${n}_`)) || list('tests/e2e/').some(f => f.startsWith(`ws-${n}-`));
}
/** Skips the running test unless every named workstream has landed. */
function needs(...ws: string[]) {
  const missing = ws.filter(w => !landed(w));
  test.skip(missing.length > 0, `needs ${missing.join(', ')} merged`);
}

type Made = {project_id: string; token: string; version: number};
const scope = (over: Record<string, unknown> = {}) => ({
  title: 'TEST live scenario', client: 'TEST Kaveri Foods', deliverables: '',
  items: [{id: 'i1', title: 'Logo suite', qty: 1, unit: '', price: null, acceptance: ''}],
  client_inputs: [], exclusions: 'Printing', fee: 25000, currency: 'INR', revisions: 2, due: '', notes: '', ...over,
});
const coPayload = (title: string, fee_delta: number) => ({title, reason: '', request_quote: '', add_items: [], remove_item_ids: [], fee_delta, days_delta: 0, revisions_delta: 0});

type Owner = {context: BrowserContext; request: APIRequestContext; H: {Origin: string}; make: (s: object) => Promise<Made>; revise: (id: string, expected: number, s: object, supersede?: boolean) => Promise<Made>; co: (id: string, title: string, fee_delta: number, baseline?: number) => Promise<number>; pay: (id: string, amount: number, baseline?: number) => Promise<void>};

/** A fresh fictional owner with its own session (API only). */
async function owner(browser: Browser, baseURL: string, tag: string): Promise<Owner> {
  const context = await browser.newContext();
  const request = context.request, H = {Origin: baseURL};
  const email = `wsall-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const up = await request.post('/api/auth/sign-up/email', {headers: H, data: {name: 'TEST Live Owner', email, password: 'Fictional-password-123'}});
  expect(up.ok(), await up.text()).toBe(true);
  return {
    context, request, H,
    make: async s => { const r = await request.post('/api/scopes', {headers: H, data: s}); expect(r.status(), await r.text()).toBe(201); return (await r.json()).scope; },
    revise: async (id, expected, s, supersede = false) => { const r = await request.post('/api/scopes/' + id, {headers: H, data: {expected_version: expected, content: s, ...(supersede ? {supersede_agreement: true} : {})}}); expect(r.status(), await r.text()).toBe(201); return (await r.json()).scope; },
    co: async (id, title, fee_delta, baseline = 1) => { const r = await request.post(`/api/scopes/${id}/ledger`, {headers: H, data: {kind: 'change_order', baseline_version: baseline, payload: coPayload(title, fee_delta), request_id: crypto.randomUUID()}}); expect(r.ok(), await r.text()).toBe(true); return (await r.json()).seq; },
    pay: async (id, amount, baseline = 1) => { const r = await request.post(`/api/scopes/${id}/ledger`, {headers: H, data: {kind: 'payment_received', baseline_version: baseline, payload: {amount, method: 'upi', received: new Date().toISOString().slice(0, 10)}, request_id: crypto.randomUUID()}}); expect(r.ok(), await r.text()).toBe(true); },
  };
}
/** Approves a version through the client API, exactly as the review page does. */
async function approve(request: APIRequestContext, baseURL: string, v: Made) {
  const {scope: shown} = await (await request.get('/api/review/' + v.token)).json();
  const r = await request.post('/api/review/' + v.token, {headers: {Origin: baseURL}, data: {decision: 'approved', signer: 'TEST Client', comment: '', version: v.version, acknowledged: true, content_sha256: sha(JSON.stringify(shown.content))}});
  expect(r.ok(), await r.text()).toBe(true);
}
/** A signed-out client browser that can only reach localhost. */
async function clientPage(browser: Browser): Promise<{context: BrowserContext; page: Page}> {
  const context = await browser.newContext();
  await context.route('**/*', route => (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(route.request().url()) ? route.continue() : route.abort('blockedbyclient')));
  return {context, page: await context.newPage()};
}
const agreementNow = (page: Page, row: string) => page.locator(`[data-testid=agreement-now] [data-row="${row}"]`);
/** Text drawn on PDF pages (Tj strings), so wrapped lines still match. */
const pdfText = (bytes: Buffer) => [...bytes.toString('latin1').matchAll(/\((?:[^()\\]|\\[()\\]|\\[0-7]{3})*\) Tj/g)].map(m => m[0].slice(1, -4).replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))).replace(/\\([()\\])/g, '$1')).join(' ');
async function businessProfile(o: Owner) {
  const empty = (await (await o.request.get('/api/profile')).json()).profile;
  const r = await o.request.put('/api/profile', {headers: o.H, data: {...empty, business_name: 'TEST Ada Studio', business_address: '12 MG Road, Chennai', tax_id: '33ABCDE1234F1Z7', payment_details: 'UPI ada@okbank', invoice_prefix: 'INV-', default_currency: 'INR'}});
  expect(r.ok(), await r.text()).toBe(true); // integration: 74 uses a checksum-valid GSTIN (WS-08 LT-17)
}
const invoice = (o: Owner, id: string, data: Record<string, unknown>) => o.request.post(`/api/scopes/${id}/invoices`, {headers: o.H, data: {request_id: 'live-' + crypto.randomUUID().slice(0, 8), ...data}});

test.describe.configure({mode: 'serial'});

// Runs on every branch: the suite's own wiring and the WS-09 H4 copy in the workspace.
test('wiring: workspace quote ₹25,000 + 18% GST; H4 revoke dialog says a decided client keeps their copy', async ({page, browser, baseURL}) => {
  const o = await owner(browser, baseURL!, 'wiring');
  const v = await o.make(scope({tax_label: 'GST', tax_pct: 18}));
  const ov = (await (await o.request.get('/api/overview')).json()).projects.find((p: {project_id: string}) => p.project_id === v.project_id);
  expect(ov.quoted_total).toBe(29500);
  await approve(o.request, baseURL!, v);
  // The owner's browser shares the API session's cookies.
  await page.context().addCookies(await o.context.cookies());
  await page.goto('/?project=' + v.project_id);
  await expect(page.locator('#step-approval .tag.status-approved')).toBeVisible();
  await page.getByRole('button', {name: 'Revoke review link', exact: true}).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Revoke review access?');
  await expect(dialog).toContainText('Your client keeps their copy');
  await expect(dialog).toContainText('read-only');
  await dialog.getByRole('button', {name: 'Cancel'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await o.context.close();
});

test('1: ₹25,000 + 18% GST is ₹29,500.00 on workspace, client page and statement', async ({browser, baseURL}) => {
  needs('WS-01', 'WS-07');
  const o = await owner(browser, baseURL!, 's1');
  const v = await o.make(scope({tax_label: 'GST', tax_pct: 18}));
  await approve(o.request, baseURL!, v);
  const ov = (await (await o.request.get('/api/overview')).json()).projects.find((p: {project_id: string}) => p.project_id === v.project_id);
  expect(ov.agreed_total).toBe(29500);
  const {context, page} = await clientPage(browser);
  await page.goto('/review/' + v.token);
  await expect(agreementNow(page, 'total')).toHaveText('₹29,500.00');
  const st = await o.request.get(`/api/scopes/${v.project_id}/statement`);
  expect(st.status()).toBe(200);
  expect(pdfText(await st.body())).toMatch(/29,500\.00/);
  await context.close(); await o.context.close();
});

test('2: CO-1 +₹7,500.50 approved, CO-2 +₹1,000 declined → ₹38,350.59; CO-2 cannot be re-decided', async ({browser, baseURL}) => {
  needs('WS-05', 'WS-03', 'WS-07');
  const o = await owner(browser, baseURL!, 's2');
  const v = await o.make(scope({tax_label: 'GST', tax_pct: 18}));
  await approve(o.request, baseURL!, v);
  await o.co(v.project_id, 'TEST Landing page', 7500.5);
  const seq2 = await o.co(v.project_id, 'TEST Extra banner', 1000);
  const {context, page} = await clientPage(browser);
  await page.goto('/review/' + v.token);
  const co1 = page.locator('#co-1');
  await co1.getByLabel('Your name').fill('TEST Client');
  await co1.getByRole('checkbox').check();
  await co1.getByRole('button', {name: 'Approve change'}).click();
  await expect(page.getByTestId('co-decided-1')).toContainText('Approved');
  const co2 = page.locator('#co-2.change-order');
  await co2.getByLabel('Your name').fill('TEST Client');
  await co2.getByLabel(/Comment/).fill('Not this month'); // integration: a decline needs a reason (WS-05 CoCard and WS-07 card alike); this suite first ran with all WSs merged
  await co2.getByRole('button', {name: 'Decline'}).click();
  await expect(page.getByTestId('co-decided-2')).toContainText('Declined');
  await expect(agreementNow(page, 'fee')).toHaveText('₹32,500.50');
  await expect(agreementNow(page, 'tax-gst')).toHaveText('₹5,850.09');
  await expect(agreementNow(page, 'total')).toHaveText('₹38,350.59');
  const ov = (await (await o.request.get('/api/overview')).json()).projects.find((p: {project_id: string}) => p.project_id === v.project_id);
  expect(ov.agreed_fee).toBe(32500.5);
  expect(ov.agreed_total).toBe(38350.59);
  const st = pdfText(await (await o.request.get(`/api/scopes/${v.project_id}/statement`)).body());
  expect(st).toMatch(/38,350\.(59|60)/);
  const again = await context.request.post(`/api/review/${v.token}/change-order`, {headers: o.H, data: {seq: seq2, decision: 'approved', signer: 'TEST Client', comment: '', acknowledged: true}});
  expect(again.ok()).toBe(false);
  await context.close(); await o.context.close();
});

test('3: three ₹1,000 invoices on a ₹1,000 fee → INV-0001 201, then 409 exceeds_uninvoiced twice', async ({browser, baseURL}) => {
  needs('WS-03');
  const o = await owner(browser, baseURL!, 's3');
  await businessProfile(o);
  const v = await o.make(scope({fee: 1000}));
  await approve(o.request, baseURL!, v);
  const first = await invoice(o, v.project_id, {amount: 1000});
  expect(first.status(), await first.text()).toBe(201);
  expect((await first.json()).invoice.number).toBe('INV-0001');
  for (let i = 0; i < 2; i++) {
    const r = await invoice(o, v.project_id, {amount: 1000});
    expect(r.status()).toBe(409);
    expect((await r.json()).code).toBe('exceeds_uninvoiced');
  }
  await o.context.close();
});

test('4: supersede keeps payments: ₹3,000 on v1 still counts after v2; deposit covered', async ({browser, baseURL}) => {
  needs('WS-04', 'WS-05');
  const o = await owner(browser, baseURL!, 's4');
  const v1 = await o.make(scope({fee: 10000, deposit_pct: 30}));
  await approve(o.request, baseURL!, v1);
  await o.pay(v1.project_id, 3000, 1);
  const v2 = await o.revise(v1.project_id, 1, scope({fee: 12000, deposit_pct: 25}), true);
  await approve(o.request, baseURL!, v2);
  const ov = (await (await o.request.get('/api/overview')).json()).projects.find((p: {project_id: string}) => p.project_id === v1.project_id);
  expect(ov.paid).toBe(3000);
  expect(ov.balance).toBe(9000);
  // Deposit (25% of ₹12,000 = ₹3,000) is covered by the v1 payment: the client is never asked again.
  const dep = await o.request.post(`/api/review/${v2.token}/deposit`, {headers: o.H, data: {}});
  expect((await dep.json()).code).toBe('already_paid');
  await o.context.close();
});

test('5: draft leak: previous is null for an unsent v1; no internal note in JSON', async ({browser, baseURL}) => {
  needs('WS-02');
  const o = await owner(browser, baseURL!, 's5');
  const v1 = await o.make(scope({fee: 5000, notes: 'TEST internal: floor price 3,500'}));
  const v2 = await o.revise(v1.project_id, 1, scope({fee: 4000}));
  const r = await o.request.get('/api/review/' + v2.token);
  expect(r.status()).toBe(200);
  const body = await r.json();
  expect(body.previous).toBeNull();
  expect(JSON.stringify(body)).not.toContain('floor price');
  expect((await (await o.request.get(`/api/review/${v2.token}?compare=1`)).json()).previous).toBeNull();
  await o.context.close();
});

test('6: cosign role: the client link cannot cosign (403); finance has its own link that asks for its code', async ({browser, baseURL}) => {
  needs('WS-02');
  const o = await owner(browser, baseURL!, 's6');
  const v = await o.make(scope());
  const patched = await o.request.patch('/api/scopes/' + v.project_id, {headers: o.H, data: {cosigners: [{id: 'finance', role: 'Finance approver', email: 'finance@example.test'}]}});
  expect(patched.ok(), await patched.text()).toBe(true);
  await approve(o.request, baseURL!, v);
  const {scope: shown} = await (await o.request.get('/api/review/' + v.token)).json();
  const viaClient = await o.request.post(`/api/review/${v.token}/cosign`, {headers: o.H, data: {cosigner_id: 'finance', signer: 'TEST Client', acknowledged: true, content_sha256: sha(JSON.stringify(shown.content))}});
  expect(viaClient.status()).toBe(403);
  const project = await (await o.request.get('/api/scopes/' + v.project_id)).json();
  const link = project.cosign_links.find((l: {cosigner_id: string}) => l.cosigner_id === 'finance');
  expect(link?.cosign_path).toMatch(/^\/cosign\//);
  const ct = link.cosign_path.split('/').pop();
  const noCode = await o.request.post('/api/cosign/' + ct, {headers: o.H, data: {signer: 'TEST Finance', acknowledged: true, content_sha256: sha(JSON.stringify(shown.content))}});
  expect(noCode.status()).toBe(403);
  await o.context.close();
});

test('7: revoke / delete keeps the client record: read-only 200, closed banner, invoice PDF 200', async ({browser, baseURL}) => {
  needs('WS-02', 'WS-08', 'WS-03');
  const o = await owner(browser, baseURL!, 's7');
  await businessProfile(o);
  const v = await o.make(scope({fee: 1000}));
  await approve(o.request, baseURL!, v);
  const inv = await invoice(o, v.project_id, {amount: 500});
  expect(inv.status(), await inv.text()).toBe(201);
  const seq = (await inv.json()).invoice.seq;
  const coSeq = await o.co(v.project_id, 'TEST extra', 100);
  expect((await (await o.request.post(`/api/scopes/${v.project_id}/review-link`, {headers: o.H, data: {version: 1, action: 'revoke'}})).json()).readonly).toBe(true);
  const {context, page} = await clientPage(browser);
  const view = await context.request.get('/api/review/' + v.token);
  expect(view.status()).toBe(200);
  expect((await view.json()).readonly).toBe(true);
  const dec = await context.request.post(`/api/review/${v.token}/change-order`, {headers: o.H, data: {seq: coSeq, decision: 'approved', signer: 'TEST Client', comment: ''}});
  expect(dec.status()).toBe(403);
  expect((await dec.json()).code).toBe('link_readonly');
  expect((await context.request.get(`/api/review/${v.token}/invoices/${seq}`)).status()).toBe(200);
  // The owner deletes their account: the client's link shows the closed banner and still serves the invoice.
  const del = await o.request.delete('/api/account', {headers: o.H, data: {confirmation: 'DELETE'}});
  expect(del.ok(), await del.text()).toBe(true);
  await page.goto('/review/' + v.token);
  await expect(page.getByTestId('readonly-banner')).toContainText('The creator closed their Scopeflow account');
  expect((await context.request.get(`/api/review/${v.token}/invoices/${seq}`)).status()).toBe(200);
  await context.close(); await o.context.close();
});

test('8: XFF spoof: a changing spoofed X-Forwarded-For still gets 429 after the limit', async ({browser, baseURL}) => {
  needs('WS-10');
  const o = await owner(browser, baseURL!, 's8');
  const v = await o.make(scope());
  const real = `198.51.100.${Math.floor(Math.random() * 200) + 20}`;
  const statuses: number[] = [];
  for (let i = 0; i < 330; i += 30)
    statuses.push(...await Promise.all(Array.from({length: Math.min(30, 330 - i)}, (_, j) => fetch(baseURL + '/api/review/' + v.token, {headers: {'X-Forwarded-For': `10.${(i + j) % 250}.${j}.7, ${real}`}}).then(r => r.status))));
  expect(statuses.filter(s => s === 429).length).toBeGreaterThanOrEqual(30);
  await o.context.close();
});

test('9: ₹100 GST split: taxable 84.75, CGST 7.63 = SGST 7.63, round off −0.01', async ({browser, baseURL}) => {
  needs('WS-01', 'WS-03');
  const o = await owner(browser, baseURL!, 's9');
  await businessProfile(o);
  const v = await o.make(scope({fee: 100, tax_label: 'GST', tax_pct: 18}));
  await approve(o.request, baseURL!, v);
  const inv = await invoice(o, v.project_id, {amount: 100, includes_tax: true});
  expect(inv.status(), await inv.text()).toBe(201);
  const pdf = await o.request.get(`/api/scopes/${v.project_id}/invoices/${(await inv.json()).invoice.seq}`);
  expect(pdf.status()).toBe(200);
  const text = pdfText(await pdf.body());
  for (const s of ['84.75', 'CGST (9%)', 'SGST (9%)', '7.63', 'Round off', '0.01']) expect(text).toContain(s);
  await o.context.close();
});

test('10: JPY deposit: ¥1,000 @ 33.333% → deposit ¥333; paying ¥333 covers it, no ¥0.33 residue', async ({browser, baseURL}) => {
  needs('WS-01', 'WS-04');
  const o = await owner(browser, baseURL!, 's10');
  const v = await o.make(scope({fee: 1000, currency: 'JPY', deposit_pct: 33.333}));
  // integration: /api/overview reports deposit_due only once the scope is approved (unchanged WS-01 behaviour)
  await approve(o.request, baseURL!, v);
  const ov0 = (await (await o.request.get('/api/overview')).json()).projects.find((p: {project_id: string}) => p.project_id === v.project_id);
  expect(ov0.deposit_due).toBe(333);
  await o.pay(v.project_id, 333);
  const ov = (await (await o.request.get('/api/overview')).json()).projects.find((p: {project_id: string}) => p.project_id === v.project_id);
  expect(ov.balance).toBe(667);
  const dep = await o.request.post(`/api/review/${v.token}/deposit`, {headers: o.H, data: {}});
  expect((await dep.json()).code).toBe('already_paid');
  await o.context.close();
});
