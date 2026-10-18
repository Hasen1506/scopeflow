import {expect, type Page} from '@playwright/test';

// next/font already self-hosts Fraunces and Instrument Sans as /_next/static/media/*.woff2.
// Production uses font-display: optional so a slow first visit does not hold LCP. That choice
// is timing-dependent, so a screenshot would sometimes draw the fallback. These specs rewrite
// optional to block, preload every face, and wait until document.fonts.ready and the layout
// height have both settled. Animations are disabled on the screenshot itself.

export async function prepare(page: Page) {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.route('**/*', async (route) => {
    const type = route.request().resourceType();
    if (type !== 'document' && type !== 'stylesheet') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const ct = response.headers()['content-type'] || '';
    if (!ct.includes('text/html') && !ct.includes('text/css')) {
      await route.fulfill({response});
      return;
    }
    const raw = await response.text();
    // The flight payload repeats the same @font-face text. Rewriting that string
    // changes its length and the page crashes on hydration. Only the style tags
    // (and real stylesheets) decide which face is painted.
    const body = ct.includes('text/css')
      ? raw.replaceAll('font-display:optional', 'font-display:block')
      : raw.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (block) => block.replaceAll('font-display:optional', 'font-display:block'));
    await route.fulfill({response, body});
  });
}

export async function settle(page: Page) {
  await page.waitForFunction(() => document.documentElement.classList.contains('fonts-ready'));
  await page.evaluate(async () => {
    for (const sheet of document.styleSheets) {
      let rules: CSSRule[];
      try { rules = [...sheet.cssRules]; } catch { continue; }
      for (let i = rules.length - 1; i >= 0; i--) {
        const rule = rules[i];
        if (!(rule instanceof CSSFontFaceRule)) continue;
        if (rule.style.getPropertyValue('font-display') !== 'optional') continue;
        const css = rule.cssText.replaceAll('font-display: optional', 'font-display: block').replaceAll('font-display:optional', 'font-display: block');
        try {
          sheet.deleteRule(i);
          sheet.insertRule(css, i);
        } catch { /* a constructed sheet can refuse the edit; the style-tag rewrite still applies */ }
      }
    }
    await Promise.all([...document.fonts].map((font) => font.load().catch(() => undefined)));
    await document.fonts.ready;
  });
  await page.waitForFunction(() => {
    const heading = document.querySelector('h1');
    if (!heading) return false;
    const first = getComputedStyle(heading).fontFamily.split(',')[0].replace(/['"]/g, '').trim();
    return document.fonts.check(`400 32px "${first}"`);
  });
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

export function shot(page: Page, file: string) {
  return settle(page).then(() => expect(page.locator('main').first()).toHaveScreenshot(file, {
    animations: 'disabled',
    caret: 'hide',
    mask: [page.locator('.volatile'), page.locator('[data-testid=record-evidence]'), page.locator('[data-testid=evidence-fingerprint]')],
  }));
}
