import {test, expect, type Page} from '@playwright/test';
import {createHash} from 'node:crypto';

test.use({timezoneId: 'UTC'});

// Key pages at desktop and phone width, in Light, Dark and Etched.
// Dates and the approval sentence (it includes the decision time) are masked.

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const themes = [
  ['Light', 'b', 'light'],
  ['Dark', 'b', 'dark'],
  ['Etched', 'a', 'light'],
] as const;

const scope = {
  title: 'Visual identity', client: 'North Studio', deliverables: '',
  items: [{id: 'i1', title: 'Logo suite', qty: 2, unit: 'concepts', price: 800, acceptance: 'SVG and PDF'}],
  client_inputs: [], exclusions: 'Printing and hosting.', fee: 800, currency: 'USD', revisions: 2, due: '2026-12-15', notes: 'One consolidated list of feedback per round.',
};

async function appearance(page: Page, name: string, theme: string, scheme: string) {
  // Review links follow the visitor's colour scheme. The owner pages follow the button.
  if (page.url().includes('/review/')) await page.emulateMedia({colorScheme: scheme === 'dark' ? 'dark' : 'light'});
  await page.getByRole('button', {name}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.locator('html')).toHaveAttribute('data-scheme', scheme);
}

// Fonts swap in after first paint. Wait until that reflow has stopped so the
// screenshot is one height, on this machine and on CI.
async function settle(page: Page) {
  await page.waitForFunction(() => document.documentElement.classList.contains('fonts-ready'));
  await page.evaluate(async () => { await document.fonts.ready; });
  let last = -1;
  let stable = 0;
  for (let i = 0; i < 25; i++) {
    const h = await page.locator('main').first().evaluate((el) => Math.round(el.getBoundingClientRect().height));
    stable = h === last ? stable + 1 : 0;
    last = h;
    if (stable >= 2) return;
    await page.waitForTimeout(80);
  }
}

function shot(page: Page, file: string) {
  return settle(page).then(() => expect(page.locator('main').first()).toHaveScreenshot(file, {
    animations: 'disabled',
    caret: 'hide',
    mask: [page.locator('.volatile'), page.locator('[data-testid=record-evidence]'), page.locator('[data-testid=evidence-fingerprint]')],
  }));
}

test('landing, editor, account, templates, review and approved', async ({page, browser, baseURL}) => {
  test.setTimeout(240_000);
  const widths = [1280, 390] as const;
  await page.goto('/');
  await expect(page.getByRole('heading', {name: /clear agreement/i})).toBeVisible();
  await expect(page.getByRole('heading', {name: /Everything a scope needs/i})).toBeVisible();
  await page.addStyleTag({content: '.lp-section,.lp-cta{content-visibility:visible!important}'});
  for (const width of widths) {
    await page.setViewportSize({width, height: width === 390 ? 844 : 900});
    for (const [name, theme, scheme] of themes) {
      await appearance(page, name, theme, scheme);
      await shot(page, `landing-${name.toLowerCase()}-${width}.png`);
    }
  }

  await page.getByRole('button', {name: 'Try the editor', exact: true}).click();
  await expect(page.getByLabel('Outside this scope')).toBeVisible();
  for (const width of widths) {
    await page.setViewportSize({width, height: width === 390 ? 844 : 900});
    for (const [name, theme, scheme] of themes) {
      await appearance(page, name, theme, scheme);
      await shot(page, `editor-${name.toLowerCase()}-${width}.png`);
    }
  }

  await page.goto('/templates');
  await expect(page.getByRole('heading', {level: 1})).toBeVisible();
  for (const width of widths) {
    await page.setViewportSize({width, height: width === 390 ? 844 : 900});
    for (const [name, theme, scheme] of themes) {
      await appearance(page, name, theme, scheme);
      await shot(page, `templates-${name.toLowerCase()}-${width}.png`);
    }
  }

  const context = await browser.newContext();
  const request = context.request;
  const H = {Origin: baseURL!};
  const email = `visual-${Date.now()}@example.test`;
  expect((await request.post('/api/auth/sign-up/email', {headers: H, data: {name: 'Visual Owner', email, password: 'Fictional-password-123'}})).ok()).toBe(true);
  const account = await context.newPage();
  await account.goto('/account');
  await expect(account.getByRole('heading', {name: /your work/i})).toBeVisible();
  await expect(account.getByRole('button', {name: 'Save settings'})).toBeVisible();
  for (const width of widths) {
    await account.setViewportSize({width, height: width === 390 ? 844 : 900});
    for (const [name, theme, scheme] of themes) {
      await appearance(account, name, theme, scheme);
      await shot(account, `account-${name.toLowerCase()}-${width}.png`);
    }
  }

  const created = await request.post('/api/scopes', {headers: H, data: scope});
  expect(created.status()).toBe(201);
  const v1 = (await created.json()).scope as {token: string; version: number};
  const client = await browser.newContext();
  const review = await client.newPage();
  await review.goto('/review/' + v1.token);
  await expect(review.getByRole('heading', {name: /Does everything look right/i})).toBeVisible();
  for (const width of widths) {
    await review.setViewportSize({width, height: width === 390 ? 844 : 900});
    for (const [name, theme, scheme] of themes) {
      await appearance(review, name, theme, scheme);
      await shot(review, `review-${name.toLowerCase()}-${width}.png`);
    }
  }

  const shown = await (await request.get('/api/review/' + v1.token)).json();
  const decided = await request.post('/api/review/' + v1.token, {headers: H, data: {
    decision: 'approved', signer: 'North Studio', comment: '', version: v1.version, acknowledged: true, content_sha256: sha(JSON.stringify(shown.scope.content)),
  }});
  expect(decided.ok(), await decided.text()).toBe(true);
  await review.reload();
  await expect(review.getByTestId('approval-success')).toBeVisible();
  for (const width of widths) {
    await review.setViewportSize({width, height: width === 390 ? 844 : 900});
    for (const [name, theme, scheme] of themes) {
      await appearance(review, name, theme, scheme);
      await shot(review, `approved-${name.toLowerCase()}-${width}.png`);
    }
  }
  await client.close();
  await context.close();
});
