import {test, expect, type Page} from '@playwright/test';
import {createHash} from 'node:crypto';

// WS-09 part A in a real browser: an approval made elsewhere reaches the open project without a reload
// (LT-05), validation is shown under the fields that need it and clears as they are fixed (LT-06), and
// amounts are explained, never coerced (LT-07). Own fictional owner; localhost only; no retries.
// @covers LT-05 LT-06 LT-07

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const OWNER = {name: 'WS09 Owner', email: `ws09-owner-${Date.now()}@example.test`, password: 'Fictional-password-123'};
const scope = {title: 'TEST WS-09 pending website', client: 'Harbour Dental', deliverables: '', items: [{id: 'i1', title: 'Design system', qty: 1, unit: '', price: 1000, acceptance: 'Figma library'}], client_inputs: [], exclusions: 'Hosting', fee: 1000, currency: 'INR', revisions: 2, due: '2026-12-15', notes: ''};

async function signUp(page: Page) {
  await page.goto('/auth/sign-up?return_to=%2F');
  await page.getByLabel('Your name').fill(OWNER.name);
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password', {exact: true}).fill(OWNER.password);
  await page.getByRole('button', {name: 'Create account'}).click();
  await expect(page.getByRole('button', {name: 'Sign out'})).toBeVisible();
}

test('ws-09: approval appears without reload; field errors; amounts are not coerced', async ({page, browser, baseURL}) => {
  page.on('dialog', d => d.accept());
  await signUp(page);
  const H = {Origin: baseURL!};
  const made = (await (await page.request.post('/api/scopes', {headers: H, data: scope})).json()).scope;

  // ---- LT-05: approve in a second tab (the client's own browser); the first tab follows -------------
  await page.goto('/?project=' + made.project_id);
  const approval = page.locator('#step-approval');
  await expect(approval.locator('.tag.status-pending')).toBeVisible();
  const client = await browser.newContext();
  const shown = (await (await client.request.get('/api/review/' + made.token)).json()).scope;
  const decided = await client.request.post('/api/review/' + made.token, {headers: H, data: {decision: 'approved', signer: 'WS09 Client', comment: '', version: made.version, acknowledged: true, content_sha256: sha(JSON.stringify(shown.content))}});
  expect(decided.ok()).toBe(true);
  await client.close();
  await expect(approval.locator('.tag.status-approved')).toBeVisible({timeout: 16_000});

  // ---- LT-06: submit an empty form -> messages under Project name, Client and Deliverables ---------
  await page.getByRole('button', {name: 'New scope'}).first().click();
  await page.getByLabel('Project name').fill('');
  await page.getByLabel('Client', {exact: true}).fill('');
  await page.getByRole('button', {name: 'Save & create review link'}).click();
  const title = page.locator('label', {hasText: 'Project name'});
  // UX-C36: field errors are plain text linked to their input (aria-describedby), not role=alert.
  await expect(title.locator('.error-text')).toHaveText('Use at least 3 characters');
  await expect(title.locator('input')).toHaveAttribute('aria-invalid', 'true');
  await expect(title.locator('input')).toHaveAccessibleDescription('Use at least 3 characters');
  // The message sits inside the label, so locate the Client field by its label element, not its accessible name.
  const clientLabel = page.locator('label').filter({hasText: /^Client(?! email| inputs)/}).first();
  await expect(clientLabel.locator('.error-text')).toHaveText('Use at least 2 characters');
  await expect(clientLabel.locator('input')).toHaveAccessibleDescription('Use at least 2 characters');
  await expect(page.locator('.error-text').filter({hasText: 'Add at least one deliverable'})).toBeVisible();
  await expect(page.getByRole('alert').filter({hasText: 'Check the highlighted fields: Project name, Client, Deliverables.'})).toBeVisible();
  await expect(page.getByText(/title: |client: |String must contain/)).toHaveCount(0);
  await title.locator('input').fill('Brand refresh');
  await expect(title.locator('.error-text')).toHaveCount(0);
  await expect(page.getByText('Check the highlighted fields:')).toHaveCount(0);
  await clientLabel.locator('input').fill('Kaveri Foods');
  await expect(page.getByText('Use at least 2 characters')).toHaveCount(0);

  // ---- LT-07: negative and huge prices are explained and kept as typed --------------------------------
  await page.getByLabel('Currency').click();
  await page.getByRole('option', {name: /^INR/}).click();
  await page.locator('fieldset.items').getByRole('button', {name: 'Add deliverable'}).click();
  await expect(page.getByText('Add at least one deliverable')).toHaveCount(0);
  const price = page.locator('fieldset.items').getByLabel(/^Price \(/).first();
  await price.fill('-500');
  await expect(page.getByText("Price can't be negative")).toBeVisible();
  await expect(price).toHaveValue('-500');
  await price.fill('99999999999');
  await expect(page.getByText('Max ₹1,00,00,000')).toBeVisible();
  await expect(price).toHaveValue('99999999999');
});
