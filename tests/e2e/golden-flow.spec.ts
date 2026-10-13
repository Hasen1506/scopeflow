import {test, expect, type Browser, type BrowserContext, type Page} from '@playwright/test';
import {createHash, createPublicKey, verify} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {anchorHash, verifyChain, type LedgerEntry} from '../../lib/ledger';

// The golden owner → client → change-order → data-controls flow, in a real browser against
// the production build. Deterministic: the browser clock is frozen, crypto.randomUUID and
// Math.random are seeded (so deliverable ids, and therefore the signed content hash, are
// identical on every run), every non-localhost request is blocked, and mail is not
// configured, so "Send for signature" exercises the copy-link / mailto fallback.

const FROZEN = new Date('2026-10-07T09:00:00.000Z');
const OWNER = {name: 'Golden Owner', email: 'golden-owner@example.test', password: 'Fictional-password-123'};
const SNAPSHOTS = new URL('./__golden__/', import.meta.url);

async function deterministic(context: BrowserContext) {
  await context.addInitScript(() => {
    let a = 20261007;
    const rand = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    Math.random = rand;
    const hex = (n: number) => Array.from({length: n}, () => Math.floor(rand() * 16).toString(16)).join('');
    Object.defineProperty(crypto, 'randomUUID', {value: () => `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`});
  });
  // No network: only the app itself (and the auth fixture behind it) may be reached.
  await context.route('**/*', route => (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(route.request().url()) ? route.continue() : route.abort('blockedbyclient')));
}
async function newPage(browser: Browser) {
  const context = await browser.newContext();
  await deterministic(context);
  const page = await context.newPage();
  await page.clock.setFixedTime(FROZEN);
  page.on('dialog', dialog => dialog.accept());
  return {context, page};
}

/** Replaces values that legitimately differ per run (ids, times, tokens, signatures) with stable placeholders. */
function normalize(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) return value.map(v => normalize(v, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v, k)]));
  if (typeof value !== 'string') return value;
  if (key === 'context' && value.startsWith('{')) return normalize(JSON.parse(value), key);
  if (key === 'user_agent') return '<user-agent>';
  // Chain hashes commit to the project id and decision time, which differ per run.
  if (['anchor', 'hash', 'prev_hash'].includes(key) && /^[0-9a-f]{64}$/.test(value) && !/^0+$/.test(value)) return '<chain-hash>';
  if (key === 'ref' && /^req:[0-9a-f-]{36}$/.test(value)) return 'req:<request-id>';
  if (key === 'ip') return '<ip>';
  if (['project_id', 'id'].includes(key) && /^([0-9a-f-]{36}|idem_[0-9a-f]{64})$/.test(value)) return '<id>';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return '<timestamp>';
  if (/^[0-9a-f]{16}\.[A-Za-z0-9_-]{86}$/.test(value)) return '<ed25519-signature>';
  if (key === 'x') return '<public-key>';
  if (key === 'kid') return '<key-id>';
  if (key === 'token' && /^[0-9a-f]{64}$/.test(value)) return '<review-token>';
  return value;
}
function golden(name: string, value: unknown) {
  const file = new URL(name, SNAPSHOTS);
  const text = JSON.stringify(value, null, 2) + '\n';
  if (process.env.UPDATE_GOLDEN === '1' || !existsSync(file)) writeFileSync(file, text);
  expect(text, `${name} changed; rerun with UPDATE_GOLDEN=1 only if intended`).toBe(readFileSync(file, 'utf8'));
}
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

test('golden flow: owner composes and versions a scope, client signs, change order is approved, data controls work', async ({browser, baseURL}) => {
  const owner = await newPage(browser);
  const page: Page = owner.page;
  const me = await page.request.get('/api/me');
  expect(await me.json()).toEqual({signedIn: false});

  // --- Sign up, sign out, sign in -------------------------------------------------------
  await page.goto('/auth/sign-up?return_to=%2F');
  await page.getByLabel('Your name').fill(OWNER.name);
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', {name: 'Create account'}).click();
  await expect(page.getByRole('button', {name: 'Sign out'})).toBeVisible();
  await page.getByRole('button', {name: 'Sign out'}).click();
  await expect(page).toHaveURL(/\/auth\/sign-in/);
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', {name: 'Sign in'}).click();
  await expect(page.getByRole('button', {name: 'Sign out'})).toBeVisible();
  await expect(page.getByRole('tab', {name: /Projects \(0\)/})).toBeVisible();
  expect((await (await page.request.get('/api/me')).json()).mail).toBe(false); // mail stubbed: not configured

  // --- Compose a scope: add, edit and reorder deliverables, pick a date -----------------
  await page.getByRole('button', {name: 'New scope'}).click();
  await page.getByLabel('Project name').fill('Brand identity for Northwind');
  await page.getByLabel('Client', {exact: true}).fill('Northwind Studio');
  const editor = page.locator('fieldset.items').first();
  for (let n = 0; n < 3; n++) await editor.getByRole('button', {name: 'Add deliverable'}).click();
  const rows = editor.locator('.item-row');
  await expect(rows).toHaveCount(3);
  const titles = ['Logo suite', 'Brand guidelines', 'Social kit'];
  const prices = ['900', '600', '300'];
  for (let n = 0; n < 3; n++) {
    await rows.nth(n).getByLabel(`Deliverable ${n + 1}`).fill(titles[n]);
    await rows.nth(n).getByLabel('Price (USD)').fill(prices[n]);
  }
  await rows.nth(1).getByLabel('Qty').fill('12');
  await rows.nth(1).getByLabel('Unit').fill('pages');
  await rows.nth(0).getByLabel('Done when').fill('SVG, PNG and PDF in colour and mono');
  await rows.nth(2).getByLabel('Deliverable 3').fill('Social launch templates'); // edit
  await rows.nth(2).getByRole('button', {name: 'Move up'}).click(); // reorder: templates before guidelines
  await expect(rows.nth(0).getByLabel('Move up')).toBeDisabled();
  await expect(page.locator('.paper .deliverable')).toHaveText([/Logo suite/, /Social launch templates/, /Brand guidelines.*12 pages/]);
  await expect(editor.getByText('Itemised total: $1,800.00')).toBeVisible();
  await page.getByLabel('Project fee').fill('1800');
  await page.getByLabel('Revision rounds').fill('2');
  await page.getByLabel('Target delivery').fill('2026-12-15'); // native date picker
  await page.getByLabel('Outside this scope').fill('Website design, social media management, print production.');
  await page.getByLabel('Working terms').fill('Feedback is consolidated into one list per round.');
  await expect(page.locator('.paper')).toContainText('15 Dec 2026');

  // --- Save version 1 and get the review link ------------------------------------------
  const created = page.waitForResponse(r => r.url().endsWith('/api/scopes') && r.request().method() === 'POST');
  await page.getByRole('button', {name: 'Save & create review link'}).click();
  const saved = await (await created).json();
  await expect(page.getByRole('status').filter({hasText: 'Version 1 saved'})).toBeVisible();
  const projectId: string = saved.scope.project_id;
  golden('scope-v1.content.json', saved.scope.content);
  const link = await page.getByLabel('Review link').inputValue();
  expect(link).toMatch(new RegExp(`^${baseURL}/review/[0-9a-f]{64}$`));
  const reviewPath = new URL(link).pathname;

  // --- Signed-out client reviews, signs and approves ------------------------------------
  const client = await newPage(browser);
  const cpage = client.page;
  expect((await (await cpage.request.get('/api/me')).json()).signedIn).toBe(false);
  await cpage.goto(reviewPath);
  await expect(cpage.getByRole('heading', {name: 'Everything look right?'})).toBeVisible();
  await expect(cpage.locator('.paper .deliverable')).toHaveText([/Logo suite/, /Social launch templates/, /Brand guidelines/]);
  await cpage.getByLabel('Your name').fill('Ada Client');
  await cpage.getByRole('checkbox').check();
  const decision = cpage.waitForResponse(r => r.url().endsWith(reviewPath.replace('/review/', '/api/review/')) && r.request().method() === 'POST');
  await cpage.getByRole('button', {name: 'Approve this scope'}).click();
  const {receipt} = await (await decision).json();
  await expect(cpage.getByText('Your receipt', {exact: true})).toBeVisible(); // changed by WS-07: success copy also says "Keep your receipt"
  await expect(cpage.getByRole('heading', {name: 'Approved'})).toBeVisible();

  // The receipt is verifiable with nothing but the published public key.
  const contentJson = JSON.stringify(saved.scope.content);
  expect(receipt.content_sha256).toBe(sha256(contentJson));
  expect(receipt.anchor).toBe(sha256(['scopeflow-baseline-v1', projectId, 1, contentJson, 'Ada Client', receipt.decided].join('|')));
  const published: {keys: {kid: string; x: string}[]} = await (await cpage.request.get('/api/signing-key')).json();
  const [kid, sig] = String(receipt.signature).split('.');
  const jwk = published.keys.find(k => k.kid === kid)!;
  expect(jwk).toBeTruthy();
  expect(verify(null, Buffer.from('scopeflow-anchor-v1:' + receipt.anchor), createPublicKey({key: {kty: 'OKP', crv: 'Ed25519', x: jwk.x}, format: 'jwk'}), Buffer.from(sig, 'base64url'))).toBe(true);
  golden('signed-receipt.json', normalize(receipt));

  // --- Owner sees the approval and records a change order -------------------------------
  await page.getByRole('button', {name: 'Refresh decision'}).click();
  await expect(page.locator('.small-title').filter({hasText: 'Saved version 1'}).getByText('Approved')).toBeVisible();
  const ledger = page.locator('section.ledger');
  await expect(ledger.getByText('Current fee')).toBeVisible();
  await expect(ledger.locator('.agreement-grid')).toContainText('$1,800.00');
  await ledger.getByRole('button', {name: 'Change order'}).click();
  const co = page.getByRole('form', {name: 'New change order'});
  await co.getByLabel('Change order title').fill('Instagram templates');
  await co.getByLabel('Client’s request, in their words').fill('Could you also design 6 Instagram templates?');
  await co.getByLabel('Why this is a change').fill('Social media templates are outside this scope');
  await co.getByRole('button', {name: 'Add deliverable'}).click();
  await co.getByLabel('Deliverable 1').fill('Instagram templates');
  await co.getByLabel('Qty').fill('6');
  await co.getByLabel('Price (USD)').fill('400');
  await co.getByRole('button', {name: 'Use as fee change'}).click();
  await expect(co.getByLabel('Fee change (USD)')).toHaveValue('400');
  await co.getByRole('button', {name: 'Record for client review'}).click();
  await expect(ledger.getByRole('status')).toContainText('CO-1 recorded');
  await expect(ledger.locator('.agreement-grid')).toContainText('$1,800.00'); // a pending CO never changes the fee
  await expect(ledger.getByText('1 change order awaiting the client')).toBeVisible();

  // --- Client approves the change order; the fee updates --------------------------------
  await cpage.reload();
  const pending = cpage.locator('.change-order');
  await expect(pending.getByText('CHANGE ORDER CO-1 · AWAITING YOU')).toBeVisible();
  await expect(cpage.getByText('Verified · sealed by Scopeflow')).toBeVisible(); // changed by WS-07: §6.1 chip wording (was "Verified in your browser")
  await expect(pending).toContainText('fee $1,800.00 → $2,200.00');
  await pending.getByLabel('Your name').fill('Ada Client');
  await pending.getByRole('checkbox').check();
  const settle = cpage.waitForResponse(r => r.url().includes('/change-order') && r.request().method() === 'POST');
  await pending.getByRole('button', {name: 'Approve change'}).click();
  const settled = await (await settle).json();
  expect(settled).toMatchObject({status: 'approved', seq: 1, receipt: {entry_seq: 2}});
  await expect(cpage.locator('.change-order')).toHaveCount(0);
  await expect(cpage.locator('.agreement-grid')).toContainText('$2,200.00');
  await expect(cpage.getByText('Verified · sealed by Scopeflow')).toBeVisible(); // changed by WS-07: §6.1 chip wording (was "Verified in your browser")

  await ledger.getByRole('button', {name: 'Refresh ledger'}).click();
  await expect(ledger.locator('.agreement-grid')).toContainText('$2,200.00');
  await expect(ledger.locator('.agreement-grid')).toContainText('was $1,800.00');
  await expect(ledger.getByText('2 entries')).toBeVisible();

  // --- Archive / delete rules: a project with client evidence is archive-only -----------
  await expect(page.getByRole('button', {name: 'Delete project'})).toHaveCount(0);
  await expect(page.getByText('can be archived but not deleted')).toBeVisible();
  const refused = await page.request.delete(`/api/scopes/${projectId}`, {data: {confirmation: 'DELETE'}, headers: {Origin: baseURL!}});
  expect(refused.status()).toBe(409);
  expect((await refused.json()).code).toBe('has_client_evidence');
  // Regression: a closing dialog keeps its own wording. While the archive dialog's exit animation ran,
  // its copy fell through to "Restore this project?" / "Restore project", so a quick "Restore project"
  // click landed on the closing dialog and no restore dialog opened (red e2e on PRs F and G). The exit
  // animation is stretched to 2s so the closing state is observed deterministically.
  const slowClose = await page.addStyleTag({content: '[role="dialog"][data-state="closed"]{animation-duration:2s!important}'});
  await page.getByRole('button', {name: 'Archive project'}).click();
  await page.getByRole('dialog').getByRole('button', {name: 'Archive project'}).click();
  await expect(page.locator('[role="dialog"][data-state="closed"]')).toHaveCount(1);
  const closing = await page.locator('[role="dialog"][data-state="closed"]').innerText();
  expect(closing).toContain('Archive this project?');
  expect(closing).not.toContain('Restore');
  await expect(page.locator('.small-title').filter({hasText: 'Saved version 1'}).getByText('Archived')).toBeVisible();
  await page.getByRole('button', {name: 'Restore project'}).click();
  await page.getByRole('dialog').getByRole('button', {name: 'Restore project'}).click();
  await expect(page.getByRole('status').filter({hasText: 'Project restored.'})).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await slowClose.evaluate(e => (e as Element).remove());

  // --- A pending draft: send for signature (fallback), then delete it -------------------
  await page.getByRole('button', {name: 'New scope'}).click();
  await page.getByLabel('Project name').fill('Website refresh draft');
  await page.getByLabel('Client', {exact: true}).fill('Northwind Studio');
  await page.getByLabel(/^Client email/).fill('client@example.test');
  await editor.getByRole('button', {name: 'Add deliverable'}).click();
  await editor.getByLabel('Deliverable 1').fill('Homepage design');
  await page.getByLabel('Project fee').fill('1200');
  await page.getByRole('button', {name: 'Save & create review link'}).click();
  await expect(page.getByRole('status').filter({hasText: 'Version 1 saved'})).toBeVisible();
  await page.getByRole('button', {name: 'Send for signature'}).click();
  const fallback = page.locator('.send-box');
  await expect(fallback).toContainText('Send this review link to client@example.test');
  expect(await fallback.getByLabel('Review link').inputValue()).toMatch(/\/review\/[0-9a-f]{64}$/);
  const mailto = await fallback.getByRole('link', {name: 'Open in mail app'}).getAttribute('href');
  expect(mailto).toMatch(/^mailto:client%40example\.test\?|^mailto:client@example\.test\?/);
  expect(decodeURIComponent(mailto!)).toContain('/review/');
  // Regression: the review-link dialog keeps its own wording while it closes. After a revocation its
  // exit animation fell back to "Replace this review link?" / "Confirm replacement" (the same bug the
  // archive dialog had). The exit animation is stretched to 2s so the closing state is observed
  // deterministically.
  const slowLinkClose = await page.addStyleTag({content: '[role="dialog"][data-state="closed"]{animation-duration:2s!important}'});
  await page.getByRole('button', {name: 'Revoke review link', exact: true}).click();
  await expect(page.getByRole('dialog')).toContainText('Revoke review access?');
  await page.getByRole('dialog').getByRole('button', {name: 'Confirm revocation'}).click();
  await expect(page.locator('[role="dialog"][data-state="closed"]')).toHaveCount(1);
  const closingLink = await page.locator('[role="dialog"][data-state="closed"]').innerText();
  expect(closingLink).toContain('Revoke review access?');
  expect(closingLink).not.toContain('Replace');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await slowLinkClose.evaluate(e => (e as Element).remove());
  await page.getByRole('button', {name: 'Delete project'}).click();
  const confirmDelete = page.getByRole('dialog');
  await expect(confirmDelete.getByRole('button', {name: 'Delete project'})).toBeDisabled();
  await confirmDelete.getByLabel('Type DELETE to confirm').fill('DELETE');
  await confirmDelete.getByRole('button', {name: 'Delete project'}).click();
  await expect(page.getByRole('status').filter({hasText: 'Project deleted.'})).toBeVisible();
  await expect(page.getByRole('tab', {name: /Projects \(1\)/})).toBeVisible();

  // --- Export JSON of the signed project ------------------------------------------------
  await page.getByRole('tab', {name: /Projects/}).click();
  await page.getByRole('button', {name: /Brand identity for Northwind/}).click();
  await expect(page.locator('.small-title').filter({hasText: 'Saved version 1'})).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Export project JSON'}).click();
  const file = await (await download).path();
  const exported = JSON.parse(readFileSync(file, 'utf8'));
  expect(exported.project_id).toBe(projectId);
  // The exported record re-verifies offline: anchor from the signed content, then the chain.
  const v1 = exported.versions.find((v: {version: number}) => v.version === 1);
  const anchor = await anchorHash({project_id: projectId, version: 1, content: v1.content, signer: v1.signer, decided: v1.decided});
  expect(anchor).toBe(receipt.anchor);
  const entries: LedgerEntry[] = exported.ledger_entries.map((e: LedgerEntry & {payload: unknown}) => ({...e, payload_hash: sha256(JSON.stringify(e.payload))}));
  expect(await verifyChain(entries, {1: anchor})).toMatchObject({intact: true, count: 2});
  golden('export.json', normalize(exported));

  // --- Delete the account's data ---------------------------------------------------------
  await page.goto('/account');
  await expect(page.getByText('1 project · 1 saved version')).toBeVisible();
  await page.getByRole('button', {name: 'Delete all Scopeflow data'}).click();
  await page.getByRole('dialog').getByLabel('Type DELETE to confirm').fill('DELETE');
  await page.getByRole('dialog').getByRole('button', {name: 'Permanently delete my data'}).click();
  await expect(page.getByText('Your Scopeflow data has been deleted.')).toBeVisible();
  expect((await cpage.request.get('/api' + reviewPath)).status()).toBe(404);
  await cpage.reload();
  // changed by WS-07: LT-10 link-problem page instead of a raw error with a Reload button.
  await expect(cpage.getByTestId('link-problem')).toContainText('Ask the person who sent it for a new link.');

  await owner.context.close();
  await client.context.close();
});
