import {test, expect, type Browser} from '@playwright/test';
import {createHash} from 'node:crypto';

// Account wording, the clause it pre-fills, review-link expiry and revoke, and the owner email
// queued when a client decides. Runs against the CI database.

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const scope = (title: string) => ({
  title, client: 'Flow Client', deliverables: '',
  items: [{id: 'i1', title: 'Logo suite', qty: 1, unit: '', price: 500, acceptance: 'SVG'}],
  client_inputs: [], exclusions: '', fee: 500, currency: 'USD', revisions: 1, due: '2026-12-15', notes: '',
});

async function owner(browser: Browser, baseURL: string) {
  const context = await browser.newContext();
  const request = context.request;
  const H = {Origin: baseURL};
  const email = `owner-flow-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
  const up = await request.post('/api/auth/sign-up/email', {headers: H, data: {name: 'Flow Owner', email, password: 'Fictional-password-123'}});
  expect(up.ok(), await up.text()).toBe(true);
  expect((await request.get('/api/me')).ok()).toBe(true);
  return {context, request, H, email};
}

test('saved default exclusions show up on the next new scope', async ({browser, baseURL}) => {
  const o = await owner(browser, baseURL!);
  const page = await o.context.newPage();
  await page.goto('/account');
  const clause = 'Printing, hosting, and stock photos.';
  await page.getByLabel(/Default “Outside this scope” text/i).fill(clause);
  await page.getByRole('button', {name: 'Save settings'}).click();
  await expect(page.getByText(/Settings saved/)).toBeVisible();
  await page.goto('/');
  await expect(page.getByText('No saved scopes yet')).toBeVisible();
  await page.getByRole('button', {name: 'New scope'}).click();
  await expect(page.getByLabel('Outside this scope')).toHaveValue(clause);
  await o.context.close();
});

test('a pending link names its expiry, and revoking it stops the client opening it', async ({browser, baseURL}) => {
  const o = await owner(browser, baseURL!);
  const created = await o.request.post('/api/scopes', {headers: o.H, data: scope('Expiry website')});
  expect(created.status(), await created.text()).toBe(201);
  const v1 = (await created.json()).scope as {project_id: string; token: string; version: number; created: string};
  const patched = await o.request.patch('/api/scopes/' + v1.project_id, {headers: o.H, data: {link_expiry_days: 14}});
  expect(patched.ok(), await patched.text()).toBe(true);
  const project = await (await o.request.get('/api/scopes/' + v1.project_id)).json();
  const expires = Date.parse(project.project.link_expires);
  expect(expires).toBeGreaterThan(Date.now());
  expect(expires - Date.parse(v1.created || project.project.link_issued || new Date().toISOString())).toBeLessThanOrEqual(15 * 86400000);
  const shown = await (await o.request.get('/api/review/' + v1.token)).json();
  expect(shown.link_expires).toBeTruthy();
  const revoked = await o.request.post('/api/scopes/' + v1.project_id + '/review-link', {headers: o.H, data: {version: 1, action: 'revoke'}});
  expect(revoked.ok(), await revoked.text()).toBe(true);
  expect((await o.request.get('/api/review/' + v1.token)).status()).toBe(404);
  await o.context.close();
});

test('approving a scope queues an email to the owner', async ({browser, baseURL}) => {
  const o = await owner(browser, baseURL!);
  const created = await o.request.post('/api/scopes', {headers: o.H, data: scope('Mail website')});
  expect(created.status()).toBe(201);
  const v1 = (await created.json()).scope as {project_id: string; token: string; version: number};
  const shown = await (await o.request.get('/api/review/' + v1.token)).json();
  const decided = await o.request.post('/api/review/' + v1.token, {headers: o.H, data: {
    decision: 'approved', signer: 'Flow Client', comment: '', version: v1.version, acknowledged: true, content_sha256: sha(JSON.stringify(shown.scope.content)),
  }});
  expect(decided.ok(), await decided.text()).toBe(true);
  await expect.poll(async () => {
    const body = await (await o.request.get('/api/scopes/' + v1.project_id + '/notifications')).json();
    return (body.owner_mail as {status: string; subject: string | null}[] | undefined)?.some(m => ['dev_log', 'queued', 'sent'].includes(m.status) && /Mail website/.test(m.subject ?? '')) ?? false;
  }, {timeout: 15_000}).toBe(true);
  await o.context.close();
});
