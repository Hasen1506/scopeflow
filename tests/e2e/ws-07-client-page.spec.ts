import {test, expect, type APIRequestContext, type Browser, type Page} from '@playwright/test';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';

// WS-07: the client review page. Every scenario is seeded through the real API by a fictional owner
// (TEST data, localhost only), then exercised in a signed-out browser, as a client would.
// Deterministic: frozen browser clock, every non-localhost request blocked, no retries.
// @covers LT-01 LT-10 LT-13 LT-15 SF-09 SF-23 M7 M32 H4 H10 L12

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const FROZEN = new Date('2026-10-07T14:30:00+05:30');
const GOLDEN = new URL('../golden/ws-07-client-copy.golden.txt', import.meta.url);
type Made = {project_id: string; token: string; version: number};

const scope = (over: Record<string, unknown> = {}) => ({
  title: 'TEST Brand refresh', client: 'TEST Kaveri Foods', deliverables: '',
  items: [{id: 'i1', title: 'Logo suite', qty: 1, unit: '', price: null, acceptance: 'Three concepts'}, {id: 'i2', title: 'Brand guidelines', qty: 1, unit: '', price: null, acceptance: ''}],
  client_inputs: [], exclusions: 'Printing', fee: 25000, currency: 'INR', revisions: 2, due: '', notes: 'Weekly check-ins', tax_label: 'GST', tax_pct: 18, ...over,
});

async function ownerApi(browser: Browser, baseURL: string) {
  const context = await browser.newContext();
  const request = context.request;
  const H = {Origin: baseURL};
  const email = `ws07-owner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const up = await request.post('/api/auth/sign-up/email', {headers: H, data: {name: 'TEST WS-07 Owner', email, password: 'Fictional-password-123'}});
  expect(up.ok(), await up.text()).toBe(true);
  const make = async (s: object): Promise<Made> => { const r = await request.post('/api/scopes', {headers: H, data: s}); expect(r.status(), await r.text()).toBe(201); return (await r.json()).scope; };
  const revise = async (projectId: string, expected: number, s: object): Promise<Made> => { const r = await request.post('/api/scopes/' + projectId, {headers: H, data: {expected_version: expected, content: s}}); expect(r.status(), await r.text()).toBe(201); return (await r.json()).scope; };
  const co = async (projectId: string, payload: Record<string, unknown>) => {
    const r = await request.post(`/api/scopes/${projectId}/ledger`, {headers: H, data: {kind: 'change_order', baseline_version: 1, payload: {reason: '', request_quote: '', add_items: [], remove_item_ids: [], days_delta: 0, revisions_delta: 0, ...payload}, request_id: crypto.randomUUID()}});
    expect(r.ok(), await r.text()).toBe(true);
  };
  return {context, request, make, revise, co};
}
/** Approves a version through the client API, exactly as the page does. */
async function approveApi(request: APIRequestContext, baseURL: string, v: Made) {
  const {scope: shown} = await (await request.get('/api/review/' + v.token)).json();
  const r = await request.post('/api/review/' + v.token, {headers: {Origin: baseURL}, data: {decision: 'approved', signer: 'TEST Client', comment: '', version: v.version, acknowledged: true, content_sha256: sha(JSON.stringify(shown.content))}});
  expect(r.ok(), await r.text()).toBe(true);
}
async function clientPage(browser: Browser, opts: {locale?: string} = {}) {
  const context = await browser.newContext(opts.locale ? {locale: opts.locale} : {});
  await context.route('**/*', route => (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(route.request().url()) ? route.continue() : route.abort('blockedbyclient')));
  const page = await context.newPage();
  await page.clock.setFixedTime(FROZEN);
  return {context, page};
}
const now = (page: Page, row: string) => page.locator(`[data-testid=agreement-now] [data-row="${row}"]`);

// @covers LT-01 M7 SF-23
test('LT-01: after CO-1 +₹7,500.50 approved and CO-2 +₹1,000 declined the client sees fee ₹32,500.50, GST ₹5,850.09, total ₹38,350.59', async ({browser, baseURL}) => {
  const owner = await ownerApi(browser, baseURL!);
  const v = await owner.make(scope());
  await approveApi(owner.request, baseURL!, v);
  await owner.co(v.project_id, {title: 'TEST Landing page', fee_delta: 7500.5});
  await owner.co(v.project_id, {title: 'TEST Extra banner', fee_delta: 1000});

  const {context, page} = await clientPage(browser);
  await page.goto('/review/' + v.token);
  await expect(page.getByText('Verified · sealed by Scopeflow')).toBeVisible();
  // Before any change order is decided: the agreement is the approved ₹25,000 + 18%.
  await expect(now(page, 'total')).toHaveText('₹29,500.00');
  const co1 = page.locator('#co-1');
  // M7 / SF-23: the card states the change's price with tax and what it does to the total.
  await expect(co1.getByTestId('co-impact')).toContainText('+₹7,500.50 + GST ₹1,350.09 = ₹8,850.59');
  await expect(co1.getByTestId('co-impact')).toContainText('Agreement total ₹29,500.00 → ₹38,350.59');
  await co1.getByLabel('Your name').fill('TEST Client');
  await co1.getByRole('checkbox').check();
  await co1.getByRole('button', {name: 'Approve change'}).click();
  await expect(page.getByTestId('co-decided-1')).toContainText('Approved');
  const co2 = page.locator('#co-2.change-order');
  await co2.getByLabel('Your name').fill('TEST Client');
  await co2.getByLabel(/Comment/).fill('Not this month');
  await co2.getByRole('button', {name: 'Decline'}).click();
  await expect(page.getByTestId('co-decided-2')).toContainText('Declined');

  await expect(now(page, 'fee')).toHaveText('₹32,500.50');
  await expect(now(page, 'tax-gst')).toHaveText('₹5,850.09');
  await expect(now(page, 'total')).toHaveText('₹38,350.59');
  await expect(now(page, 'paid')).toHaveText('₹0.00');
  await expect(now(page, 'balance')).toHaveText('₹38,350.59');
  await expect(page.getByTestId('agreement-now')).toContainText('Fee (with 1 approved change order)');
  await expect(page.getByTestId('agreement-now')).toContainText('GST (18%)');
  // The frozen v1 card is relabelled; CO-2 can't be re-decided (no decision form left).
  await expect(page.getByText('AS FIRST APPROVED · VERSION 1')).toBeVisible();
  await expect(page.locator('.paper .scope-stats')).toContainText('Fee as first approved');
  await expect(page.locator('.change-order')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Approve change'})).toHaveCount(0);
  await context.close(); await owner.context.close();
});

// @covers SF-23
test('SF-23: approving shows a calm success state with the next step: pay the deposit', async ({browser, baseURL}) => {
  const owner = await ownerApi(browser, baseURL!);
  const v = await owner.make(scope({deposit_pct: 30}));
  const {context, page} = await clientPage(browser);
  await page.goto('/review/' + v.token);
  await page.getByLabel('Your name').fill('TEST Client');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', {name: 'Approve this scope'}).click();
  const success = page.getByTestId('approval-success');
  await expect(success.getByRole('heading', {name: 'Approved. Thank you.'})).toBeVisible();
  await expect(success.getByRole('heading', {name: 'Approved. Thank you.'})).toBeFocused();
  const next = page.getByTestId('next-step');
  await expect(next).toContainText('Next step');
  const pay = next.getByRole('link', {name: 'Pay the deposit of ₹8,850.00'});
  await expect(pay).toHaveAttribute('href', '#pay-deposit');
  await pay.click();
  await expect(page.locator('#pay-deposit')).toBeInViewport();
  await expect(page.locator('#pay-deposit')).toContainText('₹8,850.00');
  // No confetti: nothing animates in, nothing is added beyond the one next step.
  await expect(page.locator('canvas')).toHaveCount(0);
  await context.close(); await owner.context.close();
});

// @covers LT-10
test('LT-10: an unknown link explains itself, offers "Ask the sender" and Home, and has no Reload button', async ({browser}) => {
  const {context, page} = await clientPage(browser);
  for (const path of ['/review/' + 'ab'.repeat(32), '/review/not-a-real-link']) {
    await page.goto(path);
    const problem = page.getByTestId('link-problem');
    await expect(problem.getByRole('heading', {name: 'This link isn’t working'})).toBeVisible();
    await expect(problem).toContainText('Ask the person who sent it for a new link.');
    const ask = problem.getByRole('link', {name: 'Ask the sender'});
    await expect(ask).toHaveAttribute('href', /^mailto:\?subject=New%20review%20link/);
    await expect(problem.getByRole('link', {name: 'Go to the Scopeflow home page'})).toHaveAttribute('href', '/');
    await expect(page.getByRole('button', {name: /reload|try again/i})).toHaveCount(0);
    await expect(page.getByText(/Reload review/)).toHaveCount(0);
  }
  await problem404Home(page);
  await context.close();
});
async function problem404Home(page: Page) {
  await page.getByTestId('link-problem').getByRole('link', {name: 'Go to the Scopeflow home page'}).click();
  await expect(page).toHaveURL(/\/$/);
}

// @covers LT-13
test('LT-13: the client page shows no BETA badge and no jargon; copy snapshot', async ({browser, baseURL}) => {
  const owner = await ownerApi(browser, baseURL!);
  const v = await owner.make(scope());
  const {context, page} = await clientPage(browser);
  await page.goto('/review/' + v.token);
  await expect(page.getByRole('heading', {name: 'Everything look right?'})).toBeVisible();
  await expect(page.getByTestId('data-notice')).toBeVisible();
  const text = await page.evaluate(() => document.body.innerText);
  expect(text).not.toMatch(/beta/i);
  expect(text).not.toMatch(/fingerprint/i);
  expect(text).not.toMatch(/digital signature/i);
  // No creator navigation on the client page.
  await expect(page.getByRole('button', {name: 'Account'})).toHaveCount(0);
  // Copy snapshot of the client chrome (the scope content is fixed TEST data, no dates on a pending page).
  const copy = (await page.locator('main').innerText()).replace(/V\.\d\d/g, 'V.NN').trim() + '\n';
  // A missing snapshot is written locally (first run) but fails in CI, so CI can never pass without a committed golden.
  if (!existsSync(GOLDEN) && process.env.CI && process.env.UPDATE_GOLDEN !== '1') throw new Error(`missing ${GOLDEN.pathname}: run this test locally once (or with UPDATE_GOLDEN=1) and commit the file.`);
  if (process.env.UPDATE_GOLDEN === '1' || !existsSync(GOLDEN)) writeFileSync(GOLDEN, copy);
  expect(copy, `client copy changed; rerun with UPDATE_GOLDEN=1 only if intended GOLDEN_B64=${Buffer.from(copy).toString('base64')}`) /* integration: TEMP golden capture, removed once the golden is committed */.toBe(readFileSync(GOLDEN, 'utf8'));
  await context.close(); await owner.context.close();
});

// @covers LT-15
test('LT-15: en and em dashes in a comment are stored and shown unchanged', async ({browser, baseURL}) => {
  const owner = await ownerApi(browser, baseURL!);
  const v = await owner.make(scope());
  const {context, page} = await clientPage(browser);
  await page.goto('/review/' + v.token);
  const typed = 'a – b — c';
  await page.getByLabel('Your name').fill('TEST Client');
  await page.getByLabel(/Comments or requested changes/).pressSequentially(typed);
  await expect(page.getByLabel(/Comments or requested changes/)).toHaveValue(typed);
  await page.getByRole('checkbox').check();
  const saved = page.waitForResponse(r => r.url().endsWith('/api/review/' + v.token) && r.request().method() === 'POST');
  await page.getByRole('button', {name: 'Request changes'}).click();
  expect(JSON.parse((await saved).request().postData()!).comment).toBe(typed);
  await expect(page.getByTestId('decision-comment-shown')).toHaveText(typed);
  const stored = await (await owner.request.get('/api/review/' + v.token)).json();
  expect(stored.scope.comment).toBe(typed);
  await context.close(); await owner.context.close();
});

// @covers SF-09
test('SF-09: ?lang=ta shows Tamil chrome, the approve flow works, and the scope content is unchanged', async ({browser, baseURL}) => {
  const owner = await ownerApi(browser, baseURL!);
  const v = await owner.make(scope({deposit_pct: 30}));
  const {context, page} = await clientPage(browser);
  await page.goto('/review/' + v.token + '?lang=ta');
  await expect(page.locator('main')).toHaveAttribute('lang', 'ta');
  await expect(page.getByRole('heading', {name: 'எல்லாம் சரியாக உள்ளதா?'})).toBeVisible();
  await expect(page.locator('.paper')).toContainText('நாங்கள் உருவாக்குவது');
  // Content exactly as written: title, client, deliverables, acceptance, exclusions, notes, amounts.
  await expect(page.locator('.paper h2')).toHaveText('TEST Brand refresh');
  await expect(page.locator('.paper')).toContainText('TEST Kaveri Foods');
  await expect(page.locator('.paper .deliverable')).toHaveText([/Logo suite.*Three concepts/, /Brand guidelines/]);
  await expect(page.locator('.paper')).toContainText('Printing');
  await expect(page.locator('.paper')).toContainText('Weekly check-ins');
  await expect(page.locator('.paper')).toContainText('₹25,000.00');
  await expect(page.getByLabel('மொழி')).toHaveValue('ta');
  await page.getByLabel('உங்கள் பெயர்').fill('TEST வாடிக்கையாளர்');
  await page.getByRole('checkbox').check();
  const decided = page.waitForResponse(r => r.url().endsWith('/api/review/' + v.token) && r.request().method() === 'POST');
  await page.getByRole('button', {name: 'இந்த வேலை வரம்புக்கு ஒப்புதல் அளி'}).click();
  expect((await decided).status()).toBe(200);
  await expect(page.getByRole('heading', {name: 'ஒப்புதல் அளிக்கப்பட்டது. நன்றி.'})).toBeVisible();
  await expect(page.getByTestId('next-step')).toContainText('₹8,850.00 முன்பணம் செலுத்துங்கள்');
  // The approved content hash matches what the owner saved: nothing was translated into the record.
  const stored = await (await owner.request.get('/api/review/' + v.token)).json();
  expect(stored.scope.status).toBe('approved');
  expect(stored.scope.content.title).toBe('TEST Brand refresh');
  expect(stored.scope.signer).toBe('TEST வாடிக்கையாளர்');
  // The picker switches to Hindi and remembers it on this device.
  await page.getByLabel('மொழி').selectOption('hi');
  await expect(page.locator('main')).toHaveAttribute('lang', 'hi');
  await expect(page).toHaveURL(/lang=hi/);
  await page.goto('/review/' + v.token);
  await expect(page.getByRole('heading', {name: 'स्वीकृत'})).toBeVisible();
  await context.close(); await owner.context.close();
});

// @covers SF-09
test('SF-09: Accept-Language picks Hindi for a hi-IN browser; English stays the default', async ({browser, baseURL}) => {
  const owner = await ownerApi(browser, baseURL!);
  const v = await owner.make(scope());
  const hi = await clientPage(browser, {locale: 'hi-IN'});
  await hi.page.goto('/review/' + v.token);
  await expect(hi.page.getByRole('heading', {name: 'क्या सब कुछ सही है?'})).toBeVisible();
  await expect(hi.page.getByRole('button', {name: 'यह स्कोप स्वीकृत करें'})).toBeVisible();
  await hi.context.close();
  const en = await clientPage(browser);
  await en.page.goto('/review/' + v.token);
  await expect(en.page.getByRole('heading', {name: 'Everything look right?'})).toBeVisible();
  await en.context.close(); await owner.context.close();
});

// @covers H4 H10
test('H4/H10 UI: a read-only link (revoked after approval, or closed account) shows the record and downloads but no action', async ({browser, baseURL}) => {
  const owner = await ownerApi(browser, baseURL!);
  const v = await owner.make(scope({deposit_pct: 30}));
  await approveApi(owner.request, baseURL!, v);
  await owner.co(v.project_id, {title: 'TEST Landing page', fee_delta: 7500.5});
  for (const marker of [{readonly: true, readonly_reason: 'revoked'}, {readonly: true, readonly_reason: 'account_closed', kept_until: '2034-03-31T00:00:00.000Z'}]) {
    const {context, page} = await clientPage(browser);
    // The API marker comes from WS-02 (revoke) and WS-08 (account closure); here it is added to the real response.
    await page.route('**/api/review/' + v.token, async route => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      await route.fulfill({response, json: {...(await response.json()), ...marker}});
    });
    await page.goto('/review/' + v.token);
    const banner = page.getByTestId('readonly-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(marker.readonly_reason === 'revoked' ? 'This link is closed for new changes' : 'The creator closed their Scopeflow account');
    if (marker.readonly_reason === 'account_closed') await expect(banner).toContainText('kept for you until');
    // The record and the receipt stay; no action that would write anything.
    await expect(page.getByTestId('agreement-now')).toBeVisible();
    await expect(page.getByRole('link', {name: 'Download PDF receipt'})).toBeVisible();
    await expect(page.locator('#co-1')).toContainText('TEST Landing page');
    for (const name of ['Approve change', 'Decline', 'Approve this scope', 'Request changes', /^Pay /]) await expect(page.getByRole('button', {name})).toHaveCount(0);
    await expect(page.getByTestId('next-step')).toHaveCount(0);
    await context.close();
  }
  await owner.context.close();
});

// @covers L12
test('L12 UI: deciding a just-replaced version keeps the typed comment and shows the newer-version banner', async ({browser, baseURL}) => {
  const owner = await ownerApi(browser, baseURL!);
  const v1 = await owner.make(scope());
  const {context, page} = await clientPage(browser);
  await page.goto('/review/' + v1.token);
  await page.getByLabel('Your name').fill('TEST Client');
  await page.getByLabel(/Comments or requested changes/).fill('Please add a TEST favicon');
  await page.getByRole('checkbox').check();
  await owner.revise(v1.project_id, 1, scope({fee: 26000}));
  const refused = page.waitForResponse(r => r.url().endsWith('/api/review/' + v1.token) && r.request().method() === 'POST');
  await page.getByRole('button', {name: 'Request changes'}).click();
  expect((await refused).status()).toBe(409);
  const banner = page.getByTestId('newer-banner');
  await expect(banner).toContainText('A newer version of this scope exists');
  await expect(banner).toContainText('Version 2 was shared after this one');
  await expect(banner).toContainText('Your comment is kept below');
  await expect(page.locator('#decision-comment')).toHaveValue('Please add a TEST favicon');
  // The comment survives a reload on this device.
  await page.reload();
  await expect(page.getByTestId('newer-banner')).toBeVisible();
  await expect(page.locator('#decision-comment')).toHaveValue('Please add a TEST favicon');
  await context.close(); await owner.context.close();
});

// @covers M32
test('M32 notice: the client page says what it records and for how many days', async ({browser, baseURL}) => {
  const owner = await ownerApi(browser, baseURL!);
  const v = await owner.make(scope());
  const {context, page} = await clientPage(browser);
  // integration: with WS-08 merged the notice endpoint always serves a retention period, so the honest
  // no-period line is checked with that endpoint unavailable, and the real WS-08 wiring right after.
  await page.route('**/api/account/notice/' + v.token, route => route.fulfill({status: 404, json: {error: 'not found'}}));
  await page.goto('/review/' + v.token);
  const notice = page.getByTestId('data-notice');
  await expect(notice).toContainText('we record your name, the time, your IP address and your browser');
  await expect(notice).toContainText('kept while the creator keeps this project');
  await expect(notice.getByRole('link', {name: 'Privacy notice'})).toHaveAttribute('href', '/privacy#client-data');
  // With WS-08's retention served by the notice endpoint (retention_days), the notice names the days, once.
  await page.unroute('**/api/account/notice/' + v.token);
  await page.reload();
  await expect(page.getByTestId('data-notice')).toContainText(/kept for \d+ days, then removed/);
  await expect(page.getByTestId('data-notice-server')).toHaveCount(0);
  // A retention period in the review payload itself wins.
  await page.route('**/api/review/' + v.token, async route => { const response = await route.fetch(); await route.fulfill({response, json: {...(await response.json()), retention_days: 180}}); });
  await page.reload();
  await expect(page.getByTestId('data-notice')).toContainText('kept for 180 days, then removed');
  await page.goto('/privacy#client-data');
  await expect(page.locator('#client-data')).toBeVisible();
  await context.close(); await owner.context.close();
});
