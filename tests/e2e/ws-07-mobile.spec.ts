import {test, expect, devices, type Browser, type Page} from '@playwright/test';
import {createHash} from 'node:crypto';

// LT-19: the client page (and a workspace smoke) on phones. Pixel 7 and iPhone 13 emulation inside
// the Chromium project: viewport, device scale, touch and mobile user agent of each device (the
// iPhone's WebKit engine itself is not used; playwright.config.ts projects belong to WS-10, see the
// WS-07 PR). No horizontal scroll at 390 px, and the change-order actions are reachable by touch.
// @covers LT-19

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const FROZEN = new Date('Wed 2026-10-07 2:30 PM IST (UTC+05:30)');
const PHONES = {
  'Pixel 7': devices['Pixel 7'],
  'iPhone 13': devices['iPhone 13'],
  'iPhone 13 at 390 px': {...devices['iPhone 13'], viewport: {width: 390, height: 844}},
} as const;

const scope = {
  title: 'TEST Mobile brand refresh with a deliberately long title that has to wrap on a phone', client: 'TEST Kaveri Foods Private Limited, Coimbatore', deliverables: '',
  items: [{id: 'i1', title: 'Logo suite with three concepts and a supersizedunbreakablewordthatmustnotoverflowthecard', qty: 3, unit: 'concepts', price: 12500, acceptance: 'Approved in writing'}],
  client_inputs: [], exclusions: 'Printing', fee: 25000, currency: 'INR', revisions: 2, due: '2026-12-15', notes: '', tax_label: 'GST', tax_pct: 18, deposit_pct: 30,
};

async function seed(browser: Browser, baseURL: string) {
  const context = await browser.newContext();
  const H = {Origin: baseURL};
  const up = await context.request.post('/api/auth/sign-up/email', {headers: H, data: {name: 'TEST Mobile Owner', email: `ws07-mobile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`, password: 'Fictional-password-123'}});
  expect(up.ok()).toBe(true);
  const v = (await (await context.request.post('/api/scopes', {headers: H, data: scope})).json()).scope;
  const {scope: shown} = await (await context.request.get('/api/review/' + v.token)).json();
  expect((await context.request.post('/api/review/' + v.token, {headers: H, data: {decision: 'approved', signer: 'TEST Client', comment: '', version: 1, acknowledged: true, content_sha256: sha(JSON.stringify(shown.content))}})).ok()).toBe(true);
  const co = await context.request.post(`/api/scopes/${v.project_id}/ledger`, {headers: H, data: {kind: 'change_order', baseline_version: 1, payload: {title: 'TEST Landing page for the launch campaign', reason: 'Outside the agreed deliverables', request_quote: 'Could you also build a landing page?', add_items: [], remove_item_ids: [], fee_delta: 7500.5, days_delta: 3, revisions_delta: 0}, request_id: crypto.randomUUID()}});
  expect(co.ok()).toBe(true);
  return {context, v};
}
async function noHorizontalScroll(page: Page) {
  const {scroll, width, wide} = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth, width: window.innerWidth,
    // Anything (outside the decorative footer art) whose right edge leaves the viewport.
    wide: [...document.querySelectorAll('main *, header *, footer input, footer button')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 1; }).slice(0, 5).map(el => el.tagName + '.' + (el as HTMLElement).className),
  }));
  expect(wide, 'elements overflowing the viewport').toEqual([]);
  expect(scroll, 'page scrolls sideways').toBeLessThanOrEqual(width);
}

for (const [name, device] of Object.entries(PHONES)) {
  test.describe(name, () => {
    const {defaultBrowserType: _engine, ...emulation} = device as typeof device & {defaultBrowserType?: string};
    test.use(emulation);

    // @covers LT-19
    test(`client page fits the screen and change-order actions are reachable (${name})`, async ({browser, page, baseURL}) => {
      const owner = await seed(browser, baseURL!);
      await page.context().route('**/*', route => (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(route.request().url()) ? route.continue() : route.abort('blockedbyclient')));
      await page.clock.setFixedTime(FROZEN);
      await page.goto('/review/' + owner.v.token);
      const card = page.locator('#co-1.change-order');
      await expect(card).toBeVisible();
      await expect(page.getByText('Verified · sealed by Scopeflow')).toBeVisible();
      await noHorizontalScroll(page);
      // CO card inputs and actions are inside the screen and work by touch.
      for (const field of [card.getByLabel('Your name'), card.getByLabel(/Comment/)]) {
        const box = (await field.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      }
      await card.getByLabel('Your name').tap();
      await card.getByLabel('Your name').fill('TEST Client');
      await card.getByRole('checkbox').tap();
      const approve = card.getByRole('button', {name: 'Approve change'});
      await approve.scrollIntoViewIfNeeded();
      await expect(approve).toBeInViewport();
      await expect(card.getByRole('button', {name: 'Decline'})).toBeInViewport();
      await approve.tap();
      await expect(page.getByTestId('co-decided-1')).toContainText('Approved');
      await expect(page.locator('[data-testid=agreement-now] [data-row="total"]')).toHaveText('₹38,350.59');
      await noHorizontalScroll(page);
      // The language picker and the footer receipt check fit too.
      await expect(page.getByLabel('Language')).toBeInViewport();
      await page.locator('#receipt-check').scrollIntoViewIfNeeded();
      const receipt = (await page.locator('#receipt-check').boundingBox())!;
      expect(receipt.x + receipt.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      await owner.context.close();
    });

    // @covers LT-19
    test(`unknown link and workspace smoke fit the screen (${name})`, async ({page}) => {
      await page.clock.setFixedTime(FROZEN);
      await page.goto('/review/' + 'cd'.repeat(32));
      await expect(page.getByTestId('link-problem')).toBeVisible();
      await noHorizontalScroll(page);
      await page.goto('/');
      await expect(page.locator('main')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
    });
  });
}
