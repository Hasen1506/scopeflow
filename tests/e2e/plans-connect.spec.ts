import {test, expect} from '@playwright/test';
import {createHash, randomUUID} from 'node:crypto';

test('plans show freelancer and studio prices and the founding offer', async ({page}) => {
  await page.goto('/plans');
  await expect(page.getByRole('heading', {name: /Start small/i})).toBeVisible();
  await expect(page.locator('[data-plan="free"]')).toContainText('3 active projects');
  await expect(page.locator('[data-plan="pro"]')).toContainText('₹799');
  await expect(page.locator('[data-plan="pro"]')).toContainText('Founding price');
  await expect(page.locator('[data-plan="agency"]')).toContainText('₹2,499');
  await expect(page.getByTestId('founding-offer')).toContainText('24 months');
  await page.getByRole('link', {name: 'US dollars'}).click();
  await expect(page.locator('[data-plan="pro"]')).toContainText('$9');
  await expect(page.locator('[data-plan="agency"]')).toContainText('$29');
});

test('connect page lists each assistant and keeps JSON import', async ({page}) => {
  await page.goto('/connect');
  await expect(page.getByRole('heading', {name: /Connect your AI assistant/i})).toBeVisible();
  for (const name of ['Claude Desktop', 'Claude on the web', 'Claude Code', 'ChatGPT', 'Cursor', 'Grok']) {
    await expect(page.getByRole('heading', {name, exact: true})).toBeVisible();
  }
  await expect(page.getByTestId('mcp-endpoint')).toHaveValue(/\/mcp$/);
  await expect(page.getByRole('heading', {name: /Import a JSON draft/i})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Create / rotate token'})).toBeDisabled();
});

test('team page, one-time code switch and approval certificate', async ({page, baseURL}) => {
  const email = `plans-e2e-${randomUUID().slice(0, 8)}@example.test`;
  await page.goto('/auth/sign-up?return_to=%2Faccount%2Fteam');
  await page.getByLabel('Your name').fill('Plans E2E');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', {exact: true}).fill('Fictional-password-123');
  await page.getByRole('button', {name: 'Create account'}).click();
  await expect(page.getByRole('heading', {name: 'Studio seats.'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Invite'})).toBeVisible();

  const scope = {title: 'Certificate in the browser', client: 'North Studio', deliverables: 'One page', exclusions: 'Print', fee: 100, currency: 'USD', revisions: 1, due: '', notes: 'Disposable.'};
  const created = await page.request.post('/api/scopes', {headers: {Origin: baseURL!}, data: scope});
  expect(created.status()).toBe(201);
  const saved = (await created.json()).scope as {project_id: string; token: string; version: number};
  await page.goto('/?project=' + saved.project_id);
  const otp = page.locator('#project-otp');
  await expect(otp).toBeVisible();
  await expect(otp).not.toBeChecked();

  const shown = await (await page.request.get('/api/review/' + saved.token)).json();
  const hash = createHash('sha256').update(JSON.stringify(shown.scope.content)).digest('hex');
  const decided = await page.request.post('/api/review/' + saved.token, {headers: {Origin: baseURL!}, data: {decision: 'approved', signer: 'Browser Reviewer', comment: '', version: saved.version, acknowledged: true, content_sha256: hash}});
  expect(decided.ok()).toBe(true);
  const link = page.getByRole('link', {name: 'Download approval certificate'});
  await expect(link).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  const pdf = await (await import('node:fs/promises')).readFile(await download.path());
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.toString('latin1')).toContain('Browser Reviewer');
});
