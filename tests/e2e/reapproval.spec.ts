import {test, expect, type Browser} from '@playwright/test';
import {createHash} from 'node:crypto';

// Client asks for changes, the owner saves a new version, the client approves that version,
// and both versions stay in the decision history.

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const scope = (title: string) => ({
  title, client: 'Reapproval Client', deliverables: '',
  items: [{id: 'i1', title: 'Logo suite', qty: 1, unit: '', price: 500, acceptance: 'SVG'}],
  client_inputs: [], exclusions: 'Printing', fee: 500, currency: 'USD', revisions: 1, due: '2026-12-15', notes: '',
});

async function owner(browser: Browser, baseURL: string) {
  const context = await browser.newContext();
  const request = context.request;
  const H = {Origin: baseURL};
  const email = `reapproval-${Date.now()}@example.test`;
  const up = await request.post('/api/auth/sign-up/email', {headers: H, data: {name: 'Reapproval Owner', email, password: 'Fictional-password-123'}});
  expect(up.ok(), await up.text()).toBe(true);
  return {context, request, H};
}

test('request changes, revise, and re-approve; both versions stay in history', async ({browser, baseURL}) => {
  const o = await owner(browser, baseURL!);
  const created = await o.request.post('/api/scopes', {headers: o.H, data: scope('Reapproval website')});
  expect(created.status()).toBe(201);
  const v1 = (await created.json()).scope as {project_id: string; token: string; version: number};

  const shown1 = await (await o.request.get('/api/review/' + v1.token)).json();
  const asked = await o.request.post('/api/review/' + v1.token, {headers: o.H, data: {
    decision: 'changes_requested', signer: 'Reapproval Client', comment: 'Please drop printing.', version: v1.version, acknowledged: true, content_sha256: sha(JSON.stringify(shown1.scope.content)),
  }});
  expect(asked.ok(), await asked.text()).toBe(true);

  const revised = await o.request.post('/api/scopes/' + v1.project_id, {headers: o.H, data: {expected_version: 1, content: scope('Reapproval website revised')}});
  expect(revised.status(), await revised.text()).toBe(201);
  const v2 = (await revised.json()).scope as {token: string; version: number};
  expect(v2.version).toBe(2);

  const client = await browser.newContext();
  const page = await client.newPage();
  await page.goto('/review/' + v2.token);
  await expect(page.getByRole('heading', {name: /Does everything look right/i})).toBeVisible();
  await page.getByLabel('Your name').fill('Reapproval Client');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', {name: 'Approve this scope'}).click();
  await expect(page.getByRole('heading', {name: 'Approved'})).toBeVisible();

  const ownerPage = await o.context.newPage();
  await ownerPage.goto('/');
  await ownerPage.getByRole('button', {name: 'Reapproval website revised'}).click();
  await expect(ownerPage.getByRole('heading', {name: 'Decision history'})).toBeVisible();
  await expect(ownerPage.getByText('Version 2 · Approved')).toBeVisible();
  await expect(ownerPage.getByText('Version 1 · Changes requested')).toBeVisible();
  await expect(ownerPage.getByText('Please drop printing.')).toBeVisible();
  await client.close();
  await o.context.close();
});
