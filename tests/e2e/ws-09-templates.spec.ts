import {test, expect, type Page} from '@playwright/test';

// WS-09 part B: Templates as a top-level section (SF-18). A template edited twice shows revisions 1..3,
// the diff against the current one and a restore; the tag filter narrows the list; a share link imports a
// copy and stops working once revoked; a vertical pack (SF-22) opens in the editor via "Use template".
// Own fictional owner; localhost only; no retries.
// @covers SF-18 SF-22

const OWNER = {name: 'WS09 Templates', email: `ws09-templates-${Date.now()}@example.test`, password: 'Fictional-password-123'};
const content = {title: 'Website design and build', client: '', deliverables: '', items: [{id: 'i_pages', title: 'Responsive pages', qty: 5, unit: 'pages', price: null, acceptance: ''}], client_inputs: [], exclusions: 'Hosting', fee: 1000, currency: 'INR', revisions: 2, due: '', notes: ''};

async function signUp(page: Page) {
  await page.goto('/auth/sign-up?return_to=%2F');
  await page.getByLabel('Your name').fill(OWNER.name);
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password', {exact: true}).fill(OWNER.password);
  await page.getByRole('button', {name: 'Create account'}).click();
  await expect(page.getByRole('button', {name: 'Sign out'})).toBeVisible();
}

test('ws-09: templates section — history r1..r3, diff, restore, tag filter, share import, vertical pack', async ({page, baseURL}) => {
  page.on('dialog', d => d.accept());
  await signUp(page);
  const H = {Origin: baseURL!};
  const made = (await (await page.request.post('/api/templates', {headers: H, data: {name: 'Web package', content, tags: ['website']}})).json()).template;
  expect((await page.request.put('/api/templates/' + made.id, {headers: H, data: {content: {...content, fee: 1500}}})).ok()).toBe(true);
  expect((await page.request.put('/api/templates/' + made.id, {headers: H, data: {name: 'Web package v3', content: {...content, fee: 2000, items: [...content.items, {id: 'i_seo', title: 'SEO setup', qty: 1, unit: '', price: null, acceptance: ''}]}}})).ok()).toBe(true);
  expect((await page.request.post('/api/templates', {headers: H, data: {name: 'Brand kit', content: {...content, title: 'Brand identity'}, tags: ['branding']}})).ok()).toBe(true);

  // Top-level nav reaches the section.
  await page.getByRole('navigation', {name: 'Main'}).getByRole('link', {name: 'Templates'}).click();
  await expect(page.getByRole('heading', {name: 'Your templates'})).toBeVisible();
  const mine = page.getByRole('listitem', {name: 'Web package v3'});
  await expect(mine.getByText('revision 3')).toBeVisible();

  // ---- history r1..r3, diff, restore r1 ----------------------------------------------------------------
  await mine.getByRole('button', {name: 'History'}).click();
  const hist = page.getByRole('region', {name: 'Revisions of Web package v3'});
  await expect(hist.getByText(/^Revision \d/)).toHaveText([/Revision 3 · “Web package v3” · current/, /Revision 2 · “Web package”/, /Revision 1 · “Web package”/]);
  await hist.getByRole('listitem').filter({hasText: 'Revision 1 ·'}).getByRole('button', {name: 'Compare with current'}).click();
  const diff = page.getByRole('region', {name: 'Changes from revision 1 to 3'});
  await expect(diff).toContainText('Renamed “Web package” to “Web package v3”');
  await expect(diff).toContainText('SEO setup');
  await hist.getByRole('button', {name: 'Restore revision 1'}).click();
  await expect(page.getByText('Revision 1 restored as revision 4.')).toBeVisible();
  const restored = page.getByRole('listitem', {name: 'Web package'});
  await expect(restored.getByText(/revision 4 · ₹1,000/)).toBeVisible();

  // ---- tag filter and search ------------------------------------------------------------------------------
  const tags = page.getByRole('group', {name: 'Filter by tag'});
  await tags.getByRole('button', {name: 'branding'}).click();
  await expect(page.getByRole('listitem', {name: 'Brand kit'})).toBeVisible();
  await expect(page.getByRole('listitem', {name: 'Web package'})).toHaveCount(0);
  await tags.getByRole('button', {name: 'All'}).click();
  await expect(page.getByRole('listitem', {name: 'Web package'})).toBeVisible();

  // ---- share link imports a copy; revoking it stops the link ---------------------------------------------
  await page.getByRole('listitem', {name: 'Brand kit'}).getByRole('button', {name: 'Share by link'}).click();
  const sharedText = page.getByRole('listitem', {name: 'Brand kit'}).locator('.mono');
  await expect(sharedText).toContainText('/templates/shared/');
  const link = (await sharedText.textContent())!;
  await page.getByLabel('Share link').fill(link);
  await page.getByRole('button', {name: 'Add to my templates'}).click();
  await expect(page.getByText('Added “Brand kit” to your templates.')).toBeVisible();
  await expect(page.getByText('Imported from a shared link (revision 1)')).toBeVisible();
  const token = link.match(/([a-f0-9]{32})$/)![1];
  await page.getByRole('listitem', {name: 'Brand kit'}).filter({hasText: 'Shared:'}).getByRole('button', {name: 'Stop sharing'}).click();
  await expect(page.getByText('Sharing turned off.')).toBeVisible();
  expect((await page.request.get('/api/templates/shared/' + token)).status()).toBe(404);

  // ---- vertical pack, ordered by mode, opens in the editor -------------------------------------------------
  await page.getByRole('group', {name: 'Suggested for'}).getByRole('button', {name: 'Home & events'}).click();
  await page.getByLabel('Search templates').fill('wedding');
  await page.getByRole('link', {name: 'Use template Wedding photography package'}).click();
  await expect(page.getByLabel('Project name')).toHaveValue('Wedding photography package');
});
