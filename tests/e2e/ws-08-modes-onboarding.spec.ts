import {test, expect, type Page, type APIRequestContext} from '@playwright/test';
import {createHash, randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';

// WS-08 in the browser: first-run onboarding for an Indian user (en-IN → INR, Asia/Kolkata, UPI),
// accessible sign-up labels, the searchable time-zone picker, real Back navigation from Account,
// workspace modes with the All features index, upgrading on /plans through the local billing
// double, and account deletion that keeps the client's record. Own fictional accounts; no retries.

const require = createRequire(import.meta.url);
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const who = (tag: string) => ({name: 'TEST ' + tag, email: `ws08-e2e-${tag}-${randomUUID().slice(0, 8)}@example.test`, password: 'Fictional-password-123'});
const scope = (title: string, extra: object = {}) => ({title: 'TEST ' + title, client: 'Kaveri Foods', deliverables: 'Packaging design', exclusions: '', fee: 10000, currency: 'INR', revisions: 1, due: '', notes: '', ...extra});

async function signUp(page: Page, user: ReturnType<typeof who>, returnTo: string | null = '/') {
  await page.goto(returnTo === null ? '/auth/sign-up' : '/auth/sign-up?return_to=' + encodeURIComponent(returnTo));
  await page.getByLabel('Your name').fill(user.name);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', {exact: true}).fill(user.password);
  await page.getByRole('button', {name: 'Create account'}).click();
}
async function approve(request: APIRequestContext, baseURL: string, token: string) {
  const {scope: shown} = await (await request.get('/api/review/' + token)).json();
  const r = await request.post('/api/review/' + token, {headers: {Origin: baseURL}, data: {decision: 'approved', signer: 'TEST Client', comment: '', version: 1, acknowledged: true, content_sha256: sha(JSON.stringify(shown.content))}});
  expect(r.ok()).toBe(true);
}
const features = (page: Page) => page.getByRole('list', {name: 'All features'}).getByRole('listitem').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.feature ?? '').sort());

// @covers LT-11 LT-04 SF-11 LT-16 LT-20
test('ws-08: an Indian user is onboarded to INR and UPI; labels pass axe; the time-zone picker searches; Back leaves Account', async ({browser, baseURL}) => {
  const context = await browser.newContext({baseURL, locale: 'en-IN', timezoneId: 'Asia/Kolkata'});
  const page = await context.newPage();
  // LT-11: no label violations on the sign-up form (axe-core).
  await page.goto('/auth/sign-up');
  await page.addScriptTag({path: require.resolve('axe-core/axe.min.js')});
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as {axe: {run: (c: Document, o: object) => Promise<{violations: {id: string}[]}>}}).axe;
    const r = await axe.run(document, {runOnly: {type: 'rule', values: ['label', 'label-title-only', 'form-field-multiple-labels', 'aria-input-field-name']}});
    return r.violations.map(v => v.id);
  });
  expect(violations).toEqual([]);
  await expect(page.getByLabel('Password', {exact: true})).toHaveAttribute('aria-describedby', 'password-hint');

  // LT-04: a new account without a destination starts with onboarding; defaults come from en-IN.
  await signUp(page, who('india'), null);
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole('radio', {name: /Freelancer/})).toBeChecked();
  await page.getByRole('button', {name: 'Next'}).click();
  await expect(page.getByLabel('Country')).toHaveValue('IN');
  await expect(page.getByLabel('Currency for new scopes')).toHaveValue('INR');
  await expect(page.getByRole('combobox', {name: 'Time zone'})).toHaveValue(/Kolkata|Calcutta/);
  await page.getByRole('button', {name: 'Next'}).click();
  await page.getByLabel(/Business or trading name/).fill('TEST Ada Studio');
  await page.getByLabel(/UPI ID/).fill('ada.e2e@okaxis');
  await expect(page.getByRole('img', {name: 'UPI QR code to pay ada.e2e@okaxis'})).toBeVisible();
  await page.getByLabel(/^GSTIN/).fill('33ABCDE1234F1Z5'); // wrong check character (LT-17)
  await expect(page.locator('#ob-gstin-hint')).toHaveClass(/error/);
  await expect(page.getByRole('button', {name: 'Finish setup'})).toBeDisabled();
  await page.getByLabel(/^GSTIN/).fill('');
  await page.getByRole('button', {name: 'Finish setup'}).click();
  await expect(page).toHaveURL(/\/$/);
  // The first scope is in INR and the project starts in the account's zone; the UPI ID is saved.
  const me = await (await page.request.get('/api/me')).json();
  expect([me.defaults.currency, me.defaults.onboarded]).toEqual(['INR', true]);
  const {currency: _currency, ...noCurrency} = scope('First INR scope');
  const created = await (await page.request.post('/api/scopes', {headers: {Origin: baseURL!}, data: noCurrency})).json();
  expect(created.scope.content.currency).toBe('INR');
  const project = await (await page.request.get('/api/scopes/' + created.scope.project_id)).json();
  expect(project.project.timezone).toMatch(/Asia\/(Kolkata|Calcutta)/);
  expect((await (await page.request.get('/api/profile')).json()).profile.upi_vpa).toBe('ada.e2e@okaxis');

  // LT-16: the account's time-zone picker is a searchable combobox; "Kolk" finds Asia/Kolkata.
  await page.goto('/account');
  await page.getByRole('combobox', {name: 'Account time zone'}).fill('Kolk');
  await expect(page.getByRole('option', {name: 'Asia/Kolkata'})).toBeVisible();
  await page.getByRole('option', {name: 'Asia/Kolkata'}).click();
  await expect(page.getByText('New projects start in Asia/Kolkata.')).toBeVisible();

  // LT-20: / → /account → Back returns to /.
  await page.goto('/');
  await page.goto('/account');
  await expect(page.getByRole('heading', {name: /Keep control of/})).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(new URL('/', baseURL!).href);
  await context.close();
});

// @covers SF-17
test('ws-08: switching modes reorders but never hides; every feature stays in All features', async ({page, baseURL}) => {
  await signUp(page, who('modes'));
  await expect(page.getByRole('button', {name: 'Sign out'})).toBeVisible();
  await page.goto('/account/features');
  await expect(page.getByRole('list', {name: 'All features'})).toHaveAttribute('data-mode', 'freelancer');
  const all = await features(page);
  expect(all.length).toBeGreaterThan(30);
  await page.goto('/account');
  await page.getByRole('radio', {name: /Enterprise/}).click();
  await expect(page.getByText('Enterprise mode is on. Every feature is still available under All features.')).toBeVisible();
  await expect(page.getByText('A retention policy is required (30 to 3650 days).')).toBeVisible();
  for (const mode of ['enterprise', 'consumer', 'agency', 'freelancer']) {
    if (mode !== 'enterprise') expect((await page.request.put('/api/workspace/mode', {headers: {Origin: baseURL!}, data: {mode}})).ok()).toBe(true);
    await page.goto('/account/features');
    await expect(page.getByRole('list', {name: 'All features'})).toHaveAttribute('data-mode', mode);
    expect(await features(page)).toEqual(all);
  }
});

// @covers M13
test('ws-08: upgrade from /plans through checkout; the plan badge turns Freelancer', async ({page}) => {
  await signUp(page, who('upgrade'));
  await expect(page.getByRole('button', {name: 'Sign out'})).toBeVisible();
  await page.goto('/plans');
  await expect(page.getByTestId('plan-badge')).toHaveText('Early beta');
  await expect(page.locator('[data-plan="pro"]')).toContainText('₹799');
  await page.getByRole('button', {name: 'Upgrade to Freelancer'}).click();
  await expect(page).toHaveURL(/\/plans\/checkout\?subscription=sub_local_/);
  await page.getByRole('button', {name: 'Pay (test)'}).click();
  await expect(page).toHaveURL(/\/plans\?checkout=done/);
  await expect(page.getByTestId('plan-badge')).toHaveText('Freelancer');
  await expect(page.getByRole('link', {name: /^SF-\d{4}-\d{5}$/})).toBeVisible();
});

// @covers H10 M32
test('ws-08: deleting the account in Data controls keeps the client’s record readable with a closed-account notice', async ({page, browser, baseURL}) => {
  await signUp(page, who('closure'));
  await expect(page.getByRole('button', {name: 'Sign out'})).toBeVisible();
  const created = await (await page.request.post('/api/scopes', {headers: {Origin: baseURL!}, data: scope('Closure e2e')})).json();
  const token: string = created.scope.token;
  const client = await browser.newContext({baseURL});
  const cpage = await client.newPage();
  await approve(cpage.request, baseURL!, token);
  // M32: the client's data notice states the retention period (WS-07 renders it on the client page).
  const notice = await (await cpage.request.get('/api/account/notice/' + token)).json();
  expect(notice.data_notice).toContain('kept for 180 days');
  // The owner deletes everything from Data controls.
  await page.goto('/account');
  await expect(page.getByText('Your clients keep their records.')).toBeVisible();
  await page.getByRole('button', {name: 'Delete all Scopeflow data'}).click();
  await page.getByRole('dialog').getByLabel('Type DELETE to confirm').fill('DELETE');
  await page.getByRole('dialog').getByRole('button', {name: 'Permanently delete my data'}).click();
  await expect(page.getByText('Your Scopeflow data has been deleted.')).toBeVisible();
  await expect(page.getByText(/kept read-only for your clients until/)).toBeVisible();
  await expect(page.getByText(/Your login (stays active|was deleted too)/)).toBeVisible();
  // The client's saved link still opens, with the closed-account notice, and the receipt downloads.
  await cpage.goto('/review/' + token);
  await expect(cpage.locator('.error[role=alert]')).toHaveCount(0);
  const closed = await (await cpage.request.get('/api/account/notice/' + token)).json();
  expect(closed.closed.message).toMatch(/^The creator closed their ScopeFlow account; this record is kept for you until /);
  const receipt = await cpage.request.get(`/api/review/${token}/receipt`);
  expect(receipt.status()).toBe(200);
  expect(receipt.headers()['content-type']).toBe('application/pdf');
  await client.close();
});
