import {test, expect, type Page} from '@playwright/test';

// UX round 3a (reaudit3 R3-01, R3-12): the Project name and Client typed above the templates survive picking
// one, with no "Replace this unsaved draft?" prompt for those two fields; a draft kept with the account does not
// prompt when a project link is opened, and leaving the page does not raise the browser's leave-page warning.
// Own fictional owner; localhost only; no retries.

const OWNER = {name: 'UX R3a Owner', email: `ux-r3a-owner-${Date.now()}@example.test`, password: 'Fictional-password-123'};
const scope = {title: 'TEST UX-R3a saved project', client: 'Harbour Dental', deliverables: '', items: [{id: 'i1', title: 'Design system', qty: 1, unit: '', price: 1000, acceptance: 'Figma library'}], client_inputs: [], exclusions: 'Hosting', fee: 1000, currency: 'INR', revisions: 2, due: '2026-12-15', notes: ''};

async function signUp(page: Page) {
  await page.goto('/auth/sign-up?return_to=%2F');
  await page.getByLabel('Your name').fill(OWNER.name);
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password', {exact: true}).fill(OWNER.password);
  await page.getByRole('button', {name: 'Create account'}).click();
  await expect(page.getByRole('button', {name: 'Sign out'})).toBeVisible();
}

test('ux-r3a: picking a template keeps the typed name and client; a kept draft does not block opening a project', async ({page, baseURL}) => {
  const dialogs: string[] = [];
  page.on('dialog', d => { dialogs.push(d.type() + ':' + d.message()); void d.accept(); });
  await signUp(page);

  // ---- R3-01: name and client survive the template, with no replace prompt -----------------------------------
  await page.getByRole('button', {name: 'New scope'}).first().click();
  await page.getByLabel('Project name').fill('Harbour rebrand');
  await page.getByLabel('Client', {exact: true}).fill('Harbour Dental');
  await page.getByRole('button', {name: 'Brand identity', exact: true}).click();
  await expect(page.getByText(/Starter template staged/)).toBeVisible();
  await expect(page.getByRole('dialog', {name: 'Replace this unsaved draft?'})).toHaveCount(0);
  await expect(page.getByLabel('Project name')).toHaveValue('Harbour rebrand');
  await expect(page.getByLabel('Client', {exact: true})).toHaveValue('Harbour Dental');
  await expect(page.locator('input[value="Primary logo and two variations"]')).toHaveCount(1);
  // Nothing was replaced, so there is nothing to undo.
  await expect(page.getByText('Your previous draft was replaced.')).toHaveCount(0);

  // A draft with more than the name and client is still protected: picking another template asks first.
  await page.getByRole('button', {name: 'Website project', exact: true}).click();
  const ask = page.getByRole('dialog', {name: 'Replace this unsaved draft?'});
  await expect(ask).toBeVisible();
  await ask.getByRole('button', {name: 'Keep editing'}).click();
  await expect(page.getByLabel('Project name')).toHaveValue('Harbour rebrand');
  await expect(page.locator('input[value="Primary logo and two variations"]')).toHaveCount(1);

  // ---- R3-12: once the draft is kept with the account, opening a project link does not prompt -----------------
  await expect(page.getByRole('status').filter({hasText: 'Draft kept with your account'})).toBeVisible();
  const made = await page.request.post('/api/scopes', {headers: {Origin: baseURL!}, data: scope});
  expect(made.ok()).toBe(true);
  const id = (await made.json()).scope.project_id as string;
  await page.goto('/?project=' + id);
  await expect(page.getByRole('heading', {name: /version 1 is locked/})).toBeVisible();
  await expect(page.getByRole('dialog', {name: 'Replace this unsaved draft?'})).toHaveCount(0);

  // The kept draft is still offered, and reopening it and leaving raises no leave-page warning.
  await page.getByRole('tab', {name: /Projects/}).click();
  const card = page.locator('.unsaved-card').filter({hasText: 'Harbour rebrand'});
  await expect(card).toContainText('kept with your account');
  await card.getByRole('button', {name: 'Continue draft'}).click();
  await expect(page.getByLabel('Project name')).toHaveValue('Harbour rebrand');
  await expect(page.getByLabel('Client', {exact: true})).toHaveValue('Harbour Dental');
  await page.close({runBeforeUnload: true});
  expect(dialogs.filter(d => d.startsWith('beforeunload'))).toEqual([]);
});
