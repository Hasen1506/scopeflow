import {test, expect, type APIRequestContext} from '@playwright/test';
import {readFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';

// WS-02 browser flows on pages WS-02 owns: the receipt check (QA-02), a countersigner's own link
// with a code to that role's own address (H1), and "Verify this record" opening /verify prefilled
// with a match (LT-09). The client page and workspace mounts of the same components are WS-07/WS-09.
const LOG = process.env.SCOPEFLOW_OTP_DEV_LOG || '';
const stamp = Date.now();

// @covers QA-02
test('ws-02 receipt check: "not-a-receipt" gets an inline error and no navigation', async ({page}) => {
  await page.goto('/verify');
  await page.getByLabel('Paste a receipt').fill('not-a-receipt');
  await page.getByRole('button', {name: 'Check receipt'}).click();
  await expect(page.getByRole('alert').filter({hasText: 'That doesn’t look like a ScopeFlow receipt'})).toBeVisible();
  await expect(page).toHaveURL(/\/verify$/);
  await expect(page.getByText(/Enter the project id printed on the receipt/)).toBeVisible(); // the disabled Verify button says why
});

async function owner(request: APIRequestContext, baseURL: string) {
  const headers = {Origin: baseURL};
  const who = {name: 'WS-02 Owner', email: `ws02-e2e-${stamp}@example.test`, password: 'Fictional-password-123'};
  await request.post('/api/auth/sign-up/email', {headers, data: who});
  expect((await request.post('/api/auth/sign-in/email', {headers, data: {email: who.email, password: who.password}})).status()).toBe(200);
  return headers;
}

// @covers H1 LT-09
test('ws-02 countersigner: own link, code to finance@, signed with the masked address; Verify this record matches', async ({page, playwright, baseURL}) => {
  expect(LOG, 'SCOPEFLOW_OTP_DEV_LOG (CI sets it)').toBeTruthy();
  const ownerApi = await playwright.request.newContext({baseURL});
  const headers = await owner(ownerApi, baseURL!);
  const created = await (await ownerApi.post('/api/scopes', {headers, data: {title: 'TEST WS-02 countersign ' + stamp, client: 'Fictional Client', deliverables: '', items: [{id: 'i_logo', title: 'Logo suite', qty: 1, unit: '', price: 900, acceptance: ''}], client_inputs: [], exclusions: '', fee: 900, currency: 'INR', revisions: 1, due: '', notes: ''}})).json();
  const {project_id: projectId, token, id: versionId, content} = created.scope;
  expect((await ownerApi.patch('/api/scopes/' + projectId, {headers, data: {cosigners: [{id: 'finance', role: 'Finance approver', name: 'Fin Ance', email: 'finance@example.test'}]}})).status()).toBe(200);
  // The client approves through the review link (signed out).
  const clientApi = await playwright.request.newContext({baseURL});
  const sha = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  expect((await clientApi.post('/api/review/' + token, {headers, data: {decision: 'approved', signer: 'Ada Client', comment: '', version: 1, acknowledged: true, content_sha256: sha}})).status()).toBe(200);
  const links = (await (await ownerApi.get('/api/scopes/' + projectId)).json()).cosign_links;
  expect(links[0].to).toBe('f***@e***.test');

  // Finance opens their own link in a signed-out browser, gets a code at finance@, signs.
  await page.goto(links[0].cosign_path);
  await expect(page.getByRole('heading', {name: 'Countersign as Finance approver'})).toBeVisible();
  await expect(page.getByText(/sent to f\*\*\*@e\*\*\*\.test/)).toBeVisible();
  await page.getByRole('button', {name: 'Email me a code'}).click();
  await expect(page.getByText(/Code sent to f\*\*\*@e\*\*\*\.test/)).toBeVisible();
  const code = () => existsSync(LOG) ? readFileSync(LOG, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(l => l.version_id === versionId && l.code && l.email === 'finance@example.test').at(-1)?.code : undefined;
  await expect.poll(code).toBeTruthy();
  await page.getByLabel('6-digit code').fill(code()!);
  await page.getByRole('button', {name: 'Verify code'}).click();
  await expect(page.getByText(/confirmed \(f\*\*\*@e\*\*\*\.test\)/)).toBeVisible();
  await expect(page.getByLabel('Your name')).toHaveValue('Fin Ance');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', {name: 'Countersign', exact: true}).click();
  await expect(page.getByTestId('cosign-done')).toContainText('Finance approver: countersigned by Fin Ance (code verified to f***@e***.test)');
  // The client's record shows the countersignature with the masked address.
  const review = await (await clientApi.get('/api/review/' + token)).json();
  expect(review.cosign.roles[0].cosign.verified_to).toBe('f***@e***.test');

  // LT-09: the full fingerprint is shown, and "Verify this record" opens /verify prefilled with a match.
  const fingerprint = (await page.getByTestId('evidence-fingerprint').textContent())!.trim();
  expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
  await page.getByRole('link', {name: 'Verify this record'}).click();
  await expect(page).toHaveURL(new RegExp(`/verify\\?p=${projectId}&v=1&a=${fingerprint}$`));
  await expect(page.locator('[data-verdict="valid"]')).toContainText('Verified · sealed by ScopeFlow');
  await ownerApi.dispose(); await clientApi.dispose();
});
