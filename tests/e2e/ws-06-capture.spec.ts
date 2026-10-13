import {test, expect, type Page, type APIRequestContext} from '@playwright/test';
import {createHash, randomUUID} from 'node:crypto';

// WS-06 in a real browser against the production build (CI: `next start` on :5173 with no mail
// provider, so client emails are recorded in the outbox in local dev mode and never sent). Covers the
// "tell the client" view on /share?project=… (H18: "Client emailed · Share on WhatsApp" after a change
// order; LT-03/SF-01: "Share on WhatsApp" next to "Copy link" with the right wa.me href) and the PWA
// share target (SF-03: a shared message -> project picker -> radar verdict -> change order prefilled
// with a price from the rate card or, before WS-05's rate card exists, the owner's price history).
// WS-09 mounts the same WhatsAppShare slot in the workspace Approval step. Fictional TEST data only.

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
async function signUp(page: Page, baseURL: string, label: string) {
  const H = {Origin: baseURL};
  const user = {name: 'TEST WS-06 ' + label, email: `ws06-e2e-${label}-${randomUUID()}@example.test`, password: 'Fictional-password-123'};
  const up = await page.request.post('/api/auth/sign-up/email', {headers: H, data: user});
  expect([200, 400, 422]).toContain(up.status());
  expect((await page.request.post('/api/auth/sign-in/email', {headers: H, data: {email: user.email, password: user.password}})).status()).toBe(200);
}
async function approveToken(request: APIRequestContext, baseURL: string, token: string) {
  const {scope: shown} = await (await request.get('/api/review/' + token)).json();
  const ok = await request.post('/api/review/' + token, {headers: {Origin: baseURL}, data: {decision: 'approved', signer: 'TEST Client', comment: '', version: shown.version, acknowledged: true, content_sha256: sha(JSON.stringify(shown.content))}});
  expect(ok.status()).toBe(200);
}
async function project(page: Page, baseURL: string, scope: Record<string, unknown>, settings: Record<string, unknown> = {}) {
  const H = {Origin: baseURL};
  const created = await page.request.post('/api/scopes', {headers: H, data: {client: 'TEST Client', deliverables: '', exclusions: 'Video production', revisions: 2, due: '', notes: '', currency: 'INR', fee: 1000, ...scope}});
  expect(created.status()).toBe(201);
  const {project_id, token} = (await created.json()).scope;
  // Contact details are set before the client approves (WS-02 locks them afterwards).
  if (Object.keys(settings).length) expect((await page.request.patch('/api/scopes/' + project_id, {headers: H, data: settings})).status()).toBe(200);
  await approveToken(page.request, baseURL, token);
  return {project_id: project_id as string, token: token as string};
}

// @covers H18 SF-13 LT-03 SF-01
test('ws-06: after proposing a change order the project shows "Client emailed · Share on WhatsApp"; Copy link sits next to a correct wa.me link', async ({page, baseURL}) => {
  await signUp(page, baseURL!, 'notice');
  const H = {Origin: baseURL!};
  const title = 'TEST WS-06 notice ' + Date.now();
  const p = await project(page, baseURL!, {title, items: [{id: 'logo', title: 'Logo suite', qty: 1, unit: '', price: 1000, acceptance: ''}], tax_pct: 18, tax_label: 'GST'}, {client_email: `client-${randomUUID().slice(0, 8)}@acme.example`, client_phone: '+919876543210'});
  const co = await page.request.post(`/api/scopes/${p.project_id}/ledger`, {headers: H, data: {kind: 'change_order', baseline_version: 1, payload: {title: 'Extra reel', reason: '', request_quote: '', add_items: [], remove_item_ids: [], fee_delta: 400, days_delta: 0, revisions_delta: 0}, request_id: randomUUID()}});
  expect(co.status()).toBe(201);

  await page.goto('/share?project=' + encodeURIComponent(p.project_id));
  await expect(page.getByRole('heading', {name: `Tell your client: ${title}`})).toBeVisible();
  // LT-03: "Share on WhatsApp" next to "Copy link", opening the client's chat with the review link.
  const group = page.getByRole('group', {name: 'Review link'});
  await expect(group.getByRole('button', {name: 'Copy link'})).toBeVisible();
  const share = group.getByTestId('whatsapp-share');
  await expect(share).toHaveText('Share on WhatsApp');
  const href = (await share.getAttribute('href'))!;
  expect(href.startsWith('https://wa.me/919876543210?text=')).toBe(true);
  const text = decodeURIComponent(href.split('?text=')[1]);
  expect(text).toContain(`${baseURL}/review/${p.token}`);
  expect(text).toContain(title);
  expect(await share.getAttribute('target')).toBe('_blank');
  // The owner can edit the message before sharing.
  await group.getByRole('button', {name: 'Edit message'}).click();
  await group.getByLabel('Message to send from your WhatsApp').fill('Hi! Please review: ' + `${baseURL}/review/${p.token}`);
  expect(decodeURIComponent((await share.getAttribute('href'))!.split('?text=')[1])).toBe('Hi! Please review: ' + `${baseURL}/review/${p.token}`);

  // H18: the change order notice went to the client's email (outbox) and can be shared on WhatsApp.
  const row = page.locator('li', {hasText: 'Extra reel'});
  const notice = row.getByTestId('client-notice');
  await expect(notice).toContainText('Client emailed');
  await expect(notice.getByTestId('whatsapp-share')).toHaveText('Share on WhatsApp');
  const coText = decodeURIComponent((await notice.getByTestId('whatsapp-share').getAttribute('href'))!.split('?text=')[1]);
  expect(coText).toMatch(/change order CO-\d+ "Extra reel"/);
  expect(coText).toContain('472');
  await expect(row).toContainText('₹472.00');
});

// @covers SF-03
test('ws-06: a message shared to Scopeflow -> project picker -> radar verdict -> change order prefilled with its price', async ({page, baseURL}) => {
  await signUp(page, baseURL!, 'share');
  const H = {Origin: baseURL!};
  // The price: the rate card (WS-05) when it exists, otherwise the owner's own price history.
  const card = await page.request.put('/api/rate-card', {headers: H, data: {items: [{id: 'reel', title: 'Instagram reel', unit: 'reel', unit_price_minor: 450000, currency: 'INR', tax_pct: 18, tags: []}], multipliers: []}});
  const fromCard = card.status() === 200;
  const stamp = Date.now();
  const target = 'TEST WS-06 brand ' + stamp;
  await project(page, baseURL!, {title: target, items: [{id: 'logo', title: 'Logo suite', qty: 1, unit: '', price: 1000, acceptance: ''}], tax_pct: 18, tax_label: 'GST'});
  await project(page, baseURL!, {title: 'TEST WS-06 social ' + stamp, items: [{id: 'r', title: 'Instagram reel', qty: 1, unit: 'reel', price: 5000, acceptance: ''}], fee: 5000});

  // What Android's share sheet posts to the manifest's share_target (multipart, same origin).
  const shared = await page.request.post('/api/share', {headers: H, multipart: {title: '', text: 'can you also add a reel?', url: ''}, maxRedirects: 0});
  expect(shared.status()).toBe(303);
  const location = shared.headers()['location'];
  expect(location).toMatch(/\/share\?capture=[0-9a-f-]{36}$/);

  await page.goto(location);
  await expect(page.getByRole('heading', {name: 'Check a client’s message'})).toBeVisible();
  await expect(page.locator('blockquote')).toHaveText('can you also add a reel?');
  await expect(page.getByRole('heading', {name: 'Which project is this about?'})).toBeVisible();
  await page.getByRole('button', {name: `Check against ${target}`}).click();
  await expect(page.getByText('Not covered: this needs a change order')).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Draft change order'})).toBeVisible();
  const price = page.getByTestId('co-unit-price').first();
  await expect(price).toHaveValue(fromCard ? '4500' : '5000');
  await expect(page.getByText(fromCard ? 'From your rate card: Instagram reel' : 'From your earlier scope: Instagram reel')).toBeVisible();
  await expect(page.getByTestId('co-total')).toContainText('GST 18%');

  await page.getByRole('button', {name: 'Propose change order'}).click();
  await expect(page.getByRole('heading', {name: /^Change order CO-\d+ proposed$/})).toBeVisible();
  const back = page.getByTestId('whatsapp-share');
  await expect(back).toHaveText('Back to WhatsApp');
  expect((await back.getAttribute('href'))!.startsWith('https://wa.me/?text=')).toBe(true);
  expect(decodeURIComponent((await back.getAttribute('href'))!.split('?text=')[1])).toContain('/review/');
});
