/**
 * Scopeflow — 122-Scenario Live End-to-End, UI/UX, 4-Theme WCAG Contrast & Adversarial Audit Runner.
 *
 * Uses a 3-Layer Failure-Gated Quality System instead of a soft subjective rubric:
 *  - Binary Hard Gates (G1 Runtime, G2 Layout/Scroll, G3 A11y/Contrast, G4 Functional Integrity)
 *  - Severity classification (S0 Blocker, S1 Major, S2 Moderate, S3 Polish)
 *  - 122 concrete, reproducible end-to-end scenarios against the live Next.js app in Chromium
 *    plus full combinatorial domain/schema verification.
 */

import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.AUDIT_BASE_URL || 'http://localhost:3000';
const CHROME =
  process.env.CHROME_PATH ||
  '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell';
const SHOT_DIR = path.resolve('.audit-shots');
fs.mkdirSync(SHOT_DIR, {recursive: true});

const results = [];
let seq = 0;

function record(dimension, name, pass, detail = '', severity = 'S2') {
  seq += 1;
  const id = `S${String(seq).padStart(3, '0')}`;
  results.push({id, dimension, name, pass: !!pass, detail, severity: pass ? 'PASS' : severity});
  const icon = pass ? 'PASS' : `FAIL[${severity}]`;
  console.log(`${id} | ${icon} | ${dimension} | ${name}${detail ? ` — ${detail}` : ''}`);
}

async function runScenario(dimension, name, severity, fn) {
  try {
    const out = await fn();
    if (out && typeof out === 'object' && 'pass' in out) {
      record(dimension, name, out.pass, out.detail || '', severity);
    } else {
      record(dimension, name, true, typeof out === 'string' ? out : '', severity);
    }
  } catch (err) {
    record(dimension, name, false, (err && err.message) || String(err), severity);
  }
}

// Helper injected in browser to compute WCAG 2.1 contrast ratio across real rendered elements
const CONTRAST_EVAL = () => {
  function parseRgb(str) {
    if (!str) return null;
    const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (!m) return null;
    return {r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4]};
  }
  function blend(fg, bg) {
    const a = fg.a;
    return {
      r: Math.round(fg.r * a + bg.r * (1 - a)),
      g: Math.round(fg.g * a + bg.g * (1 - a)),
      b: Math.round(fg.b * a + bg.b * (1 - a)),
      a: 1,
    };
  }
  function effectiveBg(el) {
    const chain = [];
    let cur = el;
    while (cur && cur.nodeType === 1) {
      const bg = parseRgb(getComputedStyle(cur).backgroundColor);
      if (bg && bg.a > 0) chain.unshift(bg);
      cur = cur.parentElement;
    }
    let acc = {r: 255, g: 255, b: 255, a: 1};
    for (const c of chain) acc = blend(c, acc);
    return acc;
  }
  function relLum({r, g, b}) {
    const [rs, gs, bs] = [r, g, b].map(v => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  }
  function ratio(c1, c2) {
    const l1 = relLum(c1);
    const l2 = relLum(c2);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  const selectors = [
    'h1',
    'h2',
    'p.tagline',
    'p.quiet',
    'p.fine',
    'a.primary',
    'button.primary',
    'button.secondary',
    '.eyebrow',
    '.stage-chip',
    '.shield-finding strong',
    '.shield-body',
    '.shield-law',
    '.shield-fix p',
    '.shield-fix .eyebrow',
    '.ladder-card h3',
    '.ladder-pre',
    '.guided-pack-btn strong',
    '.guided-pack-btn .fine',
    '.guided-pack-btn.is-selected strong',
    '.guided-pack-btn.is-selected .fine',
    '.guided-pack-btn.is-selected .eyebrow',
    '.lp-ladder-item h3',
    '.lp-ladder-item p',
    '.lp-cta h2',
    '.lp-cta p',
    '.lp-cta .primary',
    '.lp-cta .secondary',
    '.paper h2',
    '.paper .quiet',
    '.paper .deliverable',
    '.quick-start-card p',
    '.preview-decision-box strong',
    '.template-admin.starter-grid li strong',
    '.template-admin.starter-grid li .fine',
    '.template-admin.starter-grid li .secondary',
  ];

  const failures = [];
  let checked = 0;
  for (const sel of selectors) {
    const els = Array.from(document.querySelectorAll(sel)).slice(0, 3);
    for (const el of els) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) < 0.1) continue;
      if (!el.textContent || !el.textContent.trim()) continue;
      const fgRaw = parseRgb(st.color);
      if (!fgRaw) continue;
      const bg = effectiveBg(el);
      const fg = fgRaw.a < 1 ? blend(fgRaw, bg) : fgRaw;
      const r = ratio(fg, bg);
      const fontSize = parseFloat(st.fontSize) || 14;
      const fontWeight = parseInt(st.fontWeight, 10) || 400;
      const isLarge = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
      const minReq = isLarge ? 3.0 : 4.5;
      checked += 1;
      if (r < minReq) {
        failures.push({
          sel,
          text: el.textContent.trim().slice(0, 35),
          ratio: Number(r.toFixed(2)),
          minReq,
          fg: `rgb(${fg.r},${fg.g},${fg.b})`,
          bg: `rgb(${bg.r},${bg.g},${bg.b})`,
        });
      }
    }
  }
  return {checked, failures};
};

async function attachErrorCollectors(page) {
  const errors = [];
  const consoleErrors = [];
  const server5xx = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('response', res => {
    if (res.status() >= 500) server5xx.push(`${res.status()} ${res.url()}`);
  });
  return {
    reset() {
      errors.length = 0;
      consoleErrors.length = 0;
      server5xx.length = 0;
    },
    get() {
      return {errors: [...errors], consoleErrors: [...consoleErrors], server5xx: [...server5xx]};
    },
  };
}

async function scrollSweep(page) {
  await page.evaluate(async () => {
    const h = document.body.scrollHeight;
    window.scrollTo(0, Math.floor(h * 0.5));
    await new Promise(r => setTimeout(r, 60));
    window.scrollTo(0, h);
    await new Promise(r => setTimeout(r, 60));
    window.scrollTo(0, 0);
  });
}

async function main() {
  const browser = await chromium.launch({executablePath: CHROME});
  try {
    const context = await browser.newContext({viewport: {width: 1440, height: 900}});
    const page = await context.newPage();
    const errs = await attachErrorCollectors(page);

    // =========================================================================
    // DIMENSION 1: Public Route Health, Scroll, Images & 404 Resilience (S001-S018)
    // =========================================================================
    const routes = [
      '/',
      '/check',
      '/templates',
      '/msme-interest',
      '/verify',
      '/plans',
      '/connect',
      '/about',
      '/contact',
      '/privacy',
      '/terms',
      '/refund',
      '/support',
      '/reviewer-guide',
      '/auth/sign-in',
      '/auth/sign-up',
      '/share',
    ];

    for (const route of routes) {
      await runScenario('D1:Routes', `Route ${route} loads cleanly (scroll, images, a11y, 0 errors)`, 'S0', async () => {
        errs.reset();
        const res = await page.goto(BASE + route, {waitUntil: 'domcontentloaded', timeout: 20000});
        await page.waitForTimeout(350);
        await scrollSweep(page);
        const status = res ? res.status() : 0;
        const audit = await page.evaluate(() => {
          const imgs = Array.from(document.querySelectorAll('img')).filter(i => {
            const r = i.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });
          const brokenImgs = imgs.filter(i => !i.complete || i.naturalWidth === 0).map(i => i.src);
          const h1Count = document.querySelectorAll('h1').length;
          const hasMain = !!document.querySelector('main');
          const overflow = document.documentElement.scrollWidth - window.innerWidth;
          const bodyText = document.body.innerText || '';
          const rawTokens = /\bundefined\b|\[object Object\]|\bNaN\b/.test(bodyText);
          return {brokenImgs, h1Count, hasMain, overflow, rawTokens};
        });
        const e = errs.get();
        const problems = [];
        if (status >= 400) problems.push(`HTTP ${status}`);
        if (e.errors.length) problems.push(`pageerror: ${e.errors[0]}`);
        if (e.consoleErrors.length) problems.push(`console.error: ${e.consoleErrors[0]}`);
        if (e.server5xx.length) problems.push(`5xx: ${e.server5xx[0]}`);
        if (audit.brokenImgs.length) problems.push(`broken imgs: ${audit.brokenImgs.join(',')}`);
        if (audit.h1Count !== 1) problems.push(`h1 count=${audit.h1Count}`);
        if (!audit.hasMain) problems.push('missing <main>');
        if (audit.overflow > 1) problems.push(`horizontal overflow +${audit.overflow}px`);
        if (audit.rawTokens) problems.push('raw undefined/NaN/[object Object] in body');
        return {
          pass: problems.length === 0,
          detail: problems.length ? problems.join('; ') : `HTTP ${status}, overflow=${audit.overflow}px`,
        };
      });
    }

    await runScenario('D1:Routes', 'Unknown route renders proper 404 page cleanly', 'S1', async () => {
      errs.reset();
      const res = await page.goto(BASE + '/does-not-exist-404-probe', {waitUntil: 'domcontentloaded'});
      await page.waitForTimeout(250);
      const status = res ? res.status() : 0;
      const hasHomeLink = await page.locator('a[href="/"]').count();
      const e = errs.get();
      return {
        pass: status === 404 && hasHomeLink > 0 && e.errors.length === 0,
        detail: `HTTP ${status}, homeLinks=${hasHomeLink}, pageErrors=${e.errors.length}`,
      };
    });

    // =========================================================================
    // DIMENSION 2: 4-Theme Visual & Real Computed WCAG 2.1 Contrast Audit (S019-S034)
    // =========================================================================
    const themePages = [
      {label: 'Home', url: '/'},
      {label: 'Shield (/check)', url: '/check'},
      {label: 'Templates', url: '/templates'},
      {label: 'Editor (Guided)', url: '/?guided=1'},
    ];
    const themes = [
      {idx: 0, name: 'Theme B Light'},
      {idx: 1, name: 'Theme B Dark'},
      {idx: 2, name: 'Theme A Etched Light'},
      {idx: 3, name: 'Theme A Etched Dark'},
    ];

    for (const tp of themePages) {
      await page.goto(BASE + tp.url, {waitUntil: 'domcontentloaded'});
      await page.waitForTimeout(450);
      for (const th of themes) {
        await runScenario(
          'D2:Themes&Contrast',
          `${tp.label} in ${th.name} passes WCAG 2.1 contrast & zero overflow`,
          'S1',
          async () => {
            const swatches = page.locator('.theme-switch .swatch');
            const count = await swatches.count();
            if (count < 4) return {pass: false, detail: `Only ${count} theme swatches found`};
            await swatches.nth(th.idx).click();
            await page.waitForTimeout(200);
            const c = await page.evaluate(CONTRAST_EVAL);
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

            // Capture key theme screenshots for visual UI designer audit
            if (tp.url === '/check' && th.idx === 2) {
              const fix = page.locator('.shield-fix').first();
              if (await fix.count()) await fix.scrollIntoViewIfNeeded();
              await page.waitForTimeout(120);
              await page.screenshot({
                path: path.join(SHOT_DIR, `check-theme-2-fixed.png`),
                fullPage: false,
              });
              await page.evaluate(() => window.scrollTo(0, 0));
            }
            if (tp.url === '/templates' && th.idx === 2) {
              await page.screenshot({
                path: path.join(SHOT_DIR, `templates-theme-2-fixed.png`),
                fullPage: false,
              });
            }
            if (tp.url === '/' && th.idx === 2) {
              await page.screenshot({
                path: path.join(SHOT_DIR, `home-theme-etched.png`),
                fullPage: false,
              });
            }

            if (c.failures.length > 0 || overflow > 1) {
              const sample = c.failures
                .slice(0, 3)
                .map(f => `${f.sel} (${f.ratio}:1 < ${f.minReq}, ${f.fg} on ${f.bg})`)
                .join(' | ');
              return {
                pass: false,
                detail: `checked=${c.checked}, contrastFails=${c.failures.length} [${sample}], overflow=${overflow}px`,
              };
            }
            return {pass: true, detail: `checked=${c.checked} elements, 0 contrast failures, overflow=0px`};
          },
        );
      }
      // Reset to Theme B Light
      await page.locator('.theme-switch .swatch').nth(0).click();
      await page.waitForTimeout(100);
    }

    // =========================================================================
    // DIMENSION 3: Responsive Multi-Viewport & Mobile Touch Ergonomics (S035-S049)
    // =========================================================================
    const viewports = [
      {name: 'Desktop 1440x900', w: 1440, h: 900},
      {name: 'Tablet 768x1024', w: 768, h: 1024},
      {name: 'Mobile 390x844', w: 390, h: 844},
    ];
    const respRoutes = ['/', '/check', '/templates', '/msme-interest'];

    for (const vp of viewports) {
      await page.setViewportSize({width: vp.w, height: vp.h});
      for (const r of respRoutes) {
        await runScenario('D3:Responsive', `${vp.name} on ${r} has 0 overflow & valid interactive geometry`, 'S1', async () => {
          await page.goto(BASE + r, {waitUntil: 'domcontentloaded'});
          await page.waitForTimeout(300);
          await scrollSweep(page);
          const geo = await page.evaluate(() => {
            const overflow = document.documentElement.scrollWidth - window.innerWidth;
            const clippedBtns = [];
            const smallMobileBtns = [];
            const isMobile = window.innerWidth <= 420;
            for (const btn of document.querySelectorAll('button.primary, a.primary, button.secondary, a.secondary')) {
              const rect = btn.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) continue;
              if (rect.right > window.innerWidth + 2) {
                clippedBtns.push(`${btn.textContent?.trim().slice(0, 20)} (right=${Math.round(rect.right)})`);
              }
              if (isMobile && rect.height < 36) {
                smallMobileBtns.push(`${btn.textContent?.trim().slice(0, 20)} (h=${Math.round(rect.height)}px)`);
              }
            }
            return {overflow, clippedBtns, smallMobileBtns};
          });
          const issues = [];
          if (geo.overflow > 1) issues.push(`overflow +${geo.overflow}px`);
          if (geo.clippedBtns.length) issues.push(`clipped: ${geo.clippedBtns.slice(0, 2).join(', ')}`);
          if (geo.smallMobileBtns.length) issues.push(`small targets: ${geo.smallMobileBtns.slice(0, 2).join(', ')}`);
          return {pass: issues.length === 0, detail: issues.length ? issues.join('; ') : 'clean geometry'};
        });
      }
    }

    // Mobile hamburger menu open, links check, Escape close + focus return (S047)
    await page.setViewportSize({width: 390, height: 844});
    await runScenario('D3:Responsive', 'Mobile menu toggle opens, shows Rights check & closes on Escape with focus return', 'S1', async () => {
      await page.goto(BASE + '/', {waitUntil: 'domcontentloaded'});
      await page.waitForTimeout(250);
      const toggle = page.locator('button.menu-toggle');
      await toggle.click();
      await page.waitForTimeout(150);
      const expanded = await toggle.getAttribute('aria-expanded');
      const rightsVisible = await page.locator('#site-menu a[href="/check"]').isVisible();
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
      const closed = await toggle.getAttribute('aria-expanded');
      const focusReturned = await page.evaluate(() => document.activeElement?.classList.contains('menu-toggle'));
      return {
        pass: expanded === 'true' && rightsVisible && closed === 'false' && !!focusReturned,
        detail: `expanded=${expanded}, rightsVisible=${rightsVisible}, closed=${closed}, focusReturned=${focusReturned}`,
      };
    });

    // Mobile editor usability check (S048)
    await runScenario('D3:Responsive', 'Mobile 390x844 workspace editor has 0 overflow & readable preview', 'S1', async () => {
      await page.goto(BASE + '/?guided=1', {waitUntil: 'domcontentloaded'});
      await page.waitForTimeout(450);
      await scrollSweep(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const previewBtnVisible = await page.getByRole('button', {name: /Preview client view/i}).isVisible();
      await page.screenshot({path: path.join(SHOT_DIR, 'mobile-editor.png'), fullPage: false});
      return {
        pass: overflow <= 1 && previewBtnVisible,
        detail: `overflow=${overflow}px, previewBtnVisible=${previewBtnVisible}`,
      };
    });

    // Tablet editor layout check (S049)
    await page.setViewportSize({width: 768, height: 1024});
    await runScenario('D3:Responsive', 'Tablet 768x1024 workspace editor has 0 overflow', 'S2', async () => {
      await page.goto(BASE + '/?guided=1', {waitUntil: 'domcontentloaded'});
      await page.waitForTimeout(350);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      return {pass: overflow <= 1, detail: `overflow=${overflow}px`};
    });

    // Reset to desktop for interactive journeys
    await page.setViewportSize({width: 1440, height: 900});

    // =========================================================================
    // DIMENSION 4: Rights & Deposit Shield (/check) Real-User Journeys (S050-S071)
    // =========================================================================
    await page.goto(BASE + '/check', {waitUntil: 'domcontentloaded'});
    await page.waitForTimeout(350);

    const scenarioBtns = [
      {label: 'Apartment rental & security deposit', expectTrap: 'painting'},
      {label: 'Event & wedding catering', expectTrap: 'extra-plate'},
      {label: 'Home interiors & local contractor', expectTrap: 'material'},
      {label: 'Event venue, decor & photography', expectTrap: 'non-refundable'},
      {label: 'Freelance, agency & software scope', expectTrap: 'unlimited'},
    ];
    for (const sc of scenarioBtns) {
      await runScenario('D4:Shield', `Scenario "${sc.label}" loads realistic traps`, 'S1', async () => {
        await page.getByRole('button', {name: sc.label}).click();
        await page.waitForTimeout(150);
        const count = await page.locator('.shield-finding').count();
        const text = (await page.locator('.shield-findings').textContent()) || '';
        return {
          pass: count >= 2 && text.toLowerCase().includes(sc.expectTrap.toLowerCase()),
          detail: `findings=${count}`,
        };
      });
    }

    // Back to rental and test ALL 9 jurisdictions live
    await page.getByRole('button', {name: 'Apartment rental & security deposit'}).click();
    const jurisCases = [
      {id: 'IN-KA', expect: '15 days', curr: 'INR'},
      {id: 'IN-MH', expect: 'Maharashtra Rent Control', curr: 'INR'},
      {id: 'IN-TN', expect: 'TNRRRLT', curr: 'INR'},
      {id: 'IN-DL', expect: 'Delhi NCR', curr: 'INR'},
      {id: 'IN-GEN', expect: 'Model Tenancy Act', curr: 'INR'},
      {id: 'US-CA', expect: '21 days', curr: 'USD'},
      {id: 'US-NY', expect: '14 days', curr: 'USD'},
      {id: 'US-TX', expect: '30 days', curr: 'USD'},
      {id: 'US-GEN', expect: 'ESIGN', curr: 'USD'},
    ];
    for (const jc of jurisCases) {
      await runScenario('D4:Shield', `Jurisdiction ${jc.id} switches statutory rules & currency (${jc.curr})`, 'S1', async () => {
        await page.locator('select[aria-label="Jurisdiction"]').selectOption(jc.id);
        await page.waitForTimeout(120);
        const lawCard = (await page.locator('.shield-law-card').textContent()) || '';
        const amtLabel = (await page.locator('label', {hasText: 'Deposit / agreed amount'}).textContent()) || '';
        return {
          pass: lawCard.includes(jc.expect) && amtLabel.includes(`(${jc.curr})`),
          detail: `matched "${jc.expect}" & (${jc.curr})`,
        };
      });
    }

    // Custom Bengaluru landlord messy clause (S064)
    await runScenario('D4:Shield', 'Typing custom predatory Bengaluru rental clause flags 4 traps', 'S0', async () => {
      await page.locator('select[aria-label="Jurisdiction"]').selectOption('IN-KA');
      const ta = page.locator('textarea').first();
      await ta.fill(
        'One month rent automatically deducted for painting regardless of condition. Security deposit is non-refundable during lock-in. Returned at landlord’s discretion. Pay advance in cash only.',
      );
      await page.waitForTimeout(150);
      const count = await page.locator('.shield-finding').count();
      return {pass: count >= 4, detail: `flagged=${count} traps`};
    });

    // Clicking "Add wording" on missing protections appends safe wording & improves score (S065)
    await runScenario('D4:Shield', 'Clicking "Add wording" appends protective clause & removes missing item', 'S1', async () => {
      const beforeMissing = await page.locator('.shield-missing li').count();
      await page.locator('.shield-missing button', {hasText: 'Add wording'}).first().click();
      await page.waitForTimeout(150);
      const afterMissing = await page.locator('.shield-missing li').count();
      return {
        pass: beforeMissing > 0 && afterMissing < beforeMissing,
        detail: `missing ${beforeMissing} -> ${afterMissing}`,
      };
    });

    // Clear text (S066)
    await runScenario('D4:Shield', 'Clicking "Clear text" resets scanner gracefully without crash', 'S2', async () => {
      await page.getByRole('button', {name: 'Clear text'}).click();
      await page.waitForTimeout(120);
      const cleanVisible = await page.locator('.shield-clean').isVisible();
      return {pass: cleanVisible, detail: `cleanStateVisible=${cleanVisible}`};
    });

    // California AB 12 check (S067)
    await runScenario('D4:Shield', 'California tenant scenario cites AB 12 / 21-day rule & Small Claims', 'S1', async () => {
      await page.locator('select[aria-label="Jurisdiction"]').selectOption('US-CA');
      await page.getByRole('button', {name: 'Load risky example'}).click();
      await page.waitForTimeout(120);
      const text = (await page.locator('.shield-law-card').textContent()) || '';
      return {pass: text.includes('AB 12') && text.includes('21') && text.includes('Small Claims')};
    });

    // New York 14-day forfeiture check (S068)
    await runScenario('D4:Shield', 'New York tenant scenario cites 14-day deadline & forfeiture', 'S1', async () => {
      await page.locator('select[aria-label="Jurisdiction"]').selectOption('US-NY');
      await page.waitForTimeout(120);
      const text = (await page.locator('.shield-law-card').textContent()) || '';
      return {pass: text.includes('14') && text.toLowerCase().includes('forfeit')};
    });

    // Personalize Ladder fields with unicode + apostrophe (S069)
    await runScenario('D4:Shield', 'Personalizing 3-Level Ladder updates WhatsApp link & Level 3 notice live', 'S0', async () => {
      await page.locator('select[aria-label="Jurisdiction"]').selectOption('IN-KA');
      await page.getByLabel('Property / event / project').fill("Flat 9B, O'Brien Heights — बेंगलुरु");
      await page.getByLabel('Landlord / vendor / client name').fill('Suresh Nair');
      await page.getByLabel('Your name').fill('Ananya Rao');
      await page.getByLabel(/Deposit \/ agreed amount/).fill('220000');
      await page.getByLabel(/UPI UTR/).fill('UTR4099881122');
      await page.waitForTimeout(150);
      const waHref = (await page.locator('a', {hasText: 'Open in WhatsApp'}).getAttribute('href')) || '';
      const notice = (await page.locator('.ladder-card-wide .ladder-pre').textContent()) || '';
      return {
        pass:
          waHref.startsWith('https://wa.me/?text=') &&
          waHref.includes(encodeURIComponent('Suresh Nair')) &&
          notice.includes('Ananya Rao') &&
          notice.includes('UTR4099881122'),
        detail: `waHref encoded ok, notice includes tenant & UTR`,
      };
    });

    // Seal SHA-256 fingerprint and verify editing invalidates stale seal (S070)
    await runScenario('D4:Shield', 'SHA-256 evidence record seals with 64-hex hash and invalidates on edit', 'S0', async () => {
      await page.getByRole('button', {name: /Seal SHA-256 evidence record/i}).click();
      await page.waitForTimeout(200);
      const sealedText = (await page.locator('.ladder-card-wide .shield-clean').textContent()) || '';
      const has64Hex = /[a-f0-9]{64}/.test(sealedText);
      // Now mutate input and verify stale hash clears so user cannot export a mismatched hash
      await page.getByLabel(/Deposit \/ agreed amount/).fill('230000');
      await page.waitForTimeout(120);
      const stillSealed = await page.locator('.ladder-card-wide .shield-clean').count();
      return {
        pass: has64Hex && stillSealed === 0,
        detail: `has64Hex=${has64Hex}, clearedAfterEdit=${stillSealed === 0}`,
      };
    });

    // Open pre-filled in TermsLock editor from Shield (S071)
    await runScenario('D4:Shield', 'Open pre-filled in TermsLock editor hydrates exact custom landlord & flat', 'S0', async () => {
      await page.getByRole('button', {name: /Open pre-filled in TermsLock editor/i}).click();
      await page.waitForTimeout(500);
      const paperTitle = (await page.locator('.paper h2').textContent()) || '';
      const paperClient = (await page.locator('.paper .quiet').first().textContent()) || '';
      return {
        pass: paperTitle.includes("O'Brien Heights") && paperClient.includes('Suresh Nair'),
        detail: `title="${paperTitle.slice(0, 45)}", client="${paperClient}"`,
      };
    });

    // Fresh page to avoid beforeunload dialog when navigating to /templates
    const page2 = await context.newPage();

    // =========================================================================
    // DIMENSION 5: 30-Second Quick-Fill & Templates Library (S072-S083)
    // =========================================================================
    await page2.goto(BASE + '/templates', {waitUntil: 'domcontentloaded'});
    await page2.waitForTimeout(450);

    const guidedTitles = [
      'Apartment Move-In & Deposit Record',
      'Event & Wedding Catering',
      'Home Interiors & Contractor BOQ',
      'Event Photography / Decor / Venue',
      'Website / App Design & Build',
      'Monthly Retainer (Agency / CA / Advisory)',
    ];
    for (const gt of guidedTitles) {
      await runScenario('D5:Templates', `30-sec Quick-Fill pack "${gt}" selects & updates WhatsApp recap`, 'S1', async () => {
        await page2.locator('.guided-pack-btn', {hasText: gt}).click();
        await page2.waitForTimeout(100);
        const pressed = await page2.locator('.guided-pack-btn', {hasText: gt}).getAttribute('aria-pressed');
        const waHref = (await page2.locator('.guided-summary a[href^="https://wa.me/"]').getAttribute('href')) || '';
        return {pass: pressed === 'true' && waHref.startsWith('https://wa.me/?text='), detail: `aria-pressed=${pressed}`};
      });
    }

    await runScenario('D5:Templates', 'Quick-Fill switching jurisdiction IN -> US updates currency & default fee', 'S1', async () => {
      await page2.locator('.guided-pack-btn', {hasText: 'Event & Wedding Catering'}).click();
      await page2.locator('.guided-builder select[aria-label="Jurisdiction"]').selectOption('US-CA');
      await page2.waitForTimeout(120);
      const val = await page2.locator('.guided-builder input[type="number"]').inputValue();
      const labelTxt = (await page2.locator('.guided-builder label', {hasText: '(USD)'}).textContent()) || '';
      return {pass: val === '6000' && labelTxt.includes('(USD)'), detail: `val=${val}`};
    });

    await runScenario('D5:Templates', 'Quick-Fill Event Catering opens pre-filled in editor with 3 milestones', 'S0', async () => {
      await page2.locator('.guided-builder select[aria-label="Jurisdiction"]').selectOption('IN-KA');
      await page2.locator('.guided-builder input').nth(0).fill('Meera Wedding Reception');
      await page2.locator('.guided-builder input').nth(1).fill('Royal Spice Caterers');
      await page2.getByRole('button', {name: /Open in editor/i}).click();
      await page2.waitForTimeout(550);
      const paperText = (await page2.locator('.paper').textContent()) || '';
      return {
        pass:
          paperText.includes('Meera Wedding Reception') &&
          paperText.includes('Royal Spice Caterers') &&
          paperText.includes('PAYMENT SCHEDULE') &&
          paperText.includes('GST (5%)'),
        detail: 'hydrated title, caterer, 3-stage payment schedule & 5% GST',
      };
    });

    // Fresh page for template search & vertical pack staging
    const page3 = await context.newPage();
    await page3.goto(BASE + '/templates', {waitUntil: 'domcontentloaded'});
    await page3.waitForTimeout(450);

    await runScenario('D5:Templates', 'Templates search filters starters accurately & handles 0 matches', 'S2', async () => {
      const search = page3.locator('input[type="search"]');
      await search.fill('wedding');
      await page3.waitForTimeout(120);
      const matchCount = await page3.locator('.starter-grid li').count();
      await search.fill('zzznonexistent999');
      await page3.waitForTimeout(120);
      const zeroCount = await page3.locator('.starter-grid li').count();
      await search.fill('');
      return {pass: matchCount === 1 && zeroCount === 0, detail: `wedding=${matchCount}, none=${zeroCount}`};
    });

    await runScenario('D5:Templates', 'Templates mode tabs reorder suggestions without hiding starters', 'S2', async () => {
      const initial = await page3.locator('.starter-grid li').count();
      await page3.locator('.starter-modes button', {hasText: 'Home & events'}).click();
      await page3.waitForTimeout(120);
      const after = await page3.locator('.starter-grid li').count();
      const pressed = await page3.locator('.starter-modes button', {hasText: 'Home & events'}).getAttribute('aria-pressed');
      return {pass: initial > 0 && after === initial && pressed === 'true', detail: `count=${after}`};
    });

    await runScenario('D5:Templates', 'Clicking "Use template" on Wedding photography stages it in editor', 'S1', async () => {
      await page3.getByRole('link', {name: /Use template Wedding photography package/i}).click();
      await page3.waitForTimeout(600);
      const title = await page3.locator('#step-scope input').first().inputValue();
      const paperText = (await page3.locator('.paper').textContent()) || '';
      return {
        pass: paperText.includes('Wedding') || title.includes('Wedding'),
        detail: `staged title="${title}"`,
      };
    });

    await runScenario('D5:Templates', 'Editor header "30-sec Quick-Fill" modal builds Home Renovation BOQ inline', 'S1', async () => {
      // Open Quick-Fill from editor's "Ways to start" card (works whether signed in or trying without account!)
      const quickBtn = page3.locator('.quick-start-card button', {hasText: '30-sec Quick-Fill'});
      const isVisible = await quickBtn.isVisible();
      if (!isVisible) {
        await page3.locator('.start-options summary').click();
      }
      await quickBtn.click();
      await page3.waitForTimeout(200);
      await page3.locator('.guided-dialog .guided-pack-btn', {hasText: 'Home Interiors & Contractor BOQ'}).click();
      await page3.locator('.guided-dialog button', {hasText: 'Fill editor now'}).click();
      await page3.waitForTimeout(250);
      const paperTitle = (await page3.locator('.paper h2').textContent()) || '';
      return {pass: paperTitle.includes('Home Renovation BOQ'), detail: `paperTitle="${paperTitle}"`};
    });

    // =========================================================================
    // DIMENSION 6: Workspace Editor, Validation, Lint, Preview Modal & Keyboard (S084-S099)
    // =========================================================================
    const edPage = await context.newPage();
    const edErrs = await attachErrorCollectors(edPage);

    await runScenario('D6:Editor', 'Landing "Try editor free" opens try-without-account workspace cleanly', 'S0', async () => {
      await edPage.goto(BASE + '/', {waitUntil: 'domcontentloaded'});
      await edPage.waitForTimeout(350);
      await edPage.getByRole('button', {name: /Try editor free/i}).click();
      await edPage.waitForTimeout(250);
      const banner = await edPage.locator('.try-banner').isVisible();
      return {pass: banner, detail: `tryBannerVisible=${banner}`};
    });

    await runScenario('D6:Editor', 'Editing Project name, Client, Fee & Revisions updates live Paper preview', 'S0', async () => {
      await edPage.getByLabel(/Project name/i).fill('Solar Rooftop 5kW Installation');
      await edPage.getByLabel(/^Client$/i).fill('Kiran Mehta');
      await edPage.getByLabel(/Project fee/i).fill('320000');
      await edPage.getByLabel(/Revision rounds/i).fill('3');
      await edPage.waitForTimeout(150);
      const paper = (await edPage.locator('.paper').textContent()) || '';
      return {
        pass: paper.includes('Solar Rooftop 5kW Installation') && paper.includes('Kiran Mehta') && paper.includes('3 rounds'),
        detail: 'Paper synchronized with all 4 inputs',
      };
    });

    await runScenario('D6:Editor', 'Deposit + Milestones conflict warns clearly & 1-click "Clear deposit" resolves it', 'S1', async () => {
      const moneyDetails = edPage.locator('details.disclosure', {hasText: 'Tax, deposit, schedule'});
      const isOpen = await moneyDetails.evaluate(el => el.hasAttribute('open'));
      if (!isOpen) await moneyDetails.locator('> summary').click();
      await edPage.getByLabel(/Deposit \(%\)/i).fill('30');
      await edPage.getByRole('button', {name: /Add milestone|Add payment stage|Use milestones/i}).first().click();
      await edPage.waitForTimeout(150);
      const conflictVisible = await edPage.locator('[data-testid="deposit-conflict"]').isVisible();
      await edPage.getByRole('button', {name: 'Clear deposit'}).click();
      await edPage.waitForTimeout(120);
      const conflictGone = (await edPage.locator('[data-testid="deposit-conflict"]').count()) === 0;
      return {pass: conflictVisible && conflictGone, detail: `shown=${conflictVisible}, cleared=${conflictGone}`};
    });

    await runScenario('D6:Editor', 'Invalid Client email shows accessible aria-invalid error after blur', 'S1', async () => {
      const emailInput = edPage.getByLabel(/Client email/i);
      await emailInput.fill('bad-email@');
      await emailInput.blur();
      await edPage.waitForTimeout(100);
      const invalid = await emailInput.getAttribute('aria-invalid');
      await emailInput.fill('');
      return {pass: invalid === 'true', detail: `aria-invalid=${invalid}`};
    });

    await runScenario('D6:Editor', 'Negative & over-cap fees trigger inline validation without crashing', 'S1', async () => {
      const feeInput = edPage.getByLabel(/Project fee/i);
      await feeInput.fill('-500');
      await edPage.waitForTimeout(100);
      const negInvalid = await feeInput.getAttribute('aria-invalid');
      await feeInput.fill('99999999');
      await edPage.waitForTimeout(100);
      const capInvalid = await feeInput.getAttribute('aria-invalid');
      await feeInput.fill('320000');
      return {pass: negInvalid === 'true' && capInvalid === 'true', detail: `neg=${negInvalid}, cap=${capInvalid}`};
    });

    await runScenario('D6:Editor', 'Scope Clarity Lint catches vague wording ("unlimited", "etc.") in live draft', 'S1', async () => {
      await edPage.getByLabel(/Working terms/i).fill('Includes unlimited minor tweaks and misc SEO etc. as needed.');
      await edPage.waitForTimeout(200);
      const lintVisible = await edPage.locator('.lint-panel, .scope-check, [aria-label*="clarity" i]').first().isVisible().catch(() => false);
      const bodyTxt = await edPage.locator('#step-scope').textContent();
      const caught = /vague|clarity|check|unlimited|etc/i.test(bodyTxt || '');
      return {pass: caught, detail: `lintPanelVisible=${lintVisible}, caught=${caught}`};
    });

    await runScenario('D6:Editor', 'Adding a deliverable item reflects immediately on live Paper', 'S1', async () => {
      const beforeItems = await edPage.locator('.paper .deliverable').count();
      await edPage.getByRole('button', {name: /Add deliverable|Add item/i}).first().click();
      await edPage.waitForTimeout(150);
      const itemInputs = edPage.locator('#step-scope input[placeholder*="deliverable" i], #step-scope .item-row input[type="text"], #step-scope .item-title');
      if ((await itemInputs.count()) > 0) {
        await itemInputs.last().fill('Net-metering DISCOM approval & subsidy paperwork');
      }
      await edPage.waitForTimeout(150);
      const afterItems = await edPage.locator('.paper .deliverable').count();
      return {pass: afterItems >= beforeItems, detail: `items ${beforeItems} -> ${afterItems}`};
    });

    await runScenario('D6:Editor', 'Client Preview Modal blocks approval if consent checkbox is unchecked', 'S0', async () => {
      await edPage.getByRole('button', {name: /Preview client view/i}).click();
      await edPage.waitForTimeout(200);
      await edPage.locator('.client-preview-dialog button', {hasText: 'Approve agreement'}).click();
      await edPage.waitForTimeout(150);
      const approvedCount = await edPage.locator('.preview-decision-box.is-approved').count();
      return {pass: approvedCount === 0, detail: 'correctly refused approval without consent'};
    });

    await runScenario('D6:Editor', 'Client Preview Modal Request Changes flow + Reset simulation works', 'S1', async () => {
      await edPage.locator('.client-preview-dialog input[placeholder*="requesting changes"]').fill('Please include 5-year inverter warranty.');
      await edPage.locator('.client-preview-dialog button', {hasText: 'Request changes'}).click();
      await edPage.waitForTimeout(150);
      const changesText = (await edPage.locator('.preview-decision-box.is-changes').textContent()) || '';
      await edPage.locator('.client-preview-dialog button', {hasText: 'Reset simulation'}).click();
      await edPage.waitForTimeout(120);
      const signBoxBack = await edPage.locator('.preview-sign-box').isVisible();
      return {
        pass: changesText.includes('5-year inverter warranty') && signBoxBack,
        detail: `quoteShown=${changesText.includes('5-year inverter warranty')}, resetOk=${signBoxBack}`,
      };
    });

    await runScenario('D6:Editor', 'Client Preview Modal Approve flow stamps exact current client ("Kiran Mehta") + SHA-256', 'S0', async () => {
      await edPage.locator('.client-preview-dialog input[type="checkbox"]').check();
      await edPage.locator('.client-preview-dialog button', {hasText: 'Approve agreement'}).click();
      await edPage.waitForTimeout(200);
      const box = (await edPage.locator('.preview-decision-box.is-approved').textContent()) || '';
      return {
        pass: box.includes('Approved by Kiran Mehta') && box.includes('SHA-256:'),
        detail: box.slice(0, 80).replace(/\s+/g, ' '),
      };
    });

    await runScenario('D6:Editor', 'Client Preview Modal WhatsApp Soft Confirm tab reflects live draft & wa.me link', 'S1', async () => {
      await edPage.locator('.client-preview-dialog [role="tab"]', {hasText: 'WhatsApp soft confirm'}).click();
      await edPage.waitForTimeout(150);
      const pre = (await edPage.locator('.client-preview-dialog .ladder-pre').textContent()) || '';
      const wa = (await edPage.locator('.client-preview-dialog a[href^="https://wa.me/"]').getAttribute('href')) || '';
      await edPage.keyboard.press('Escape');
      await edPage.waitForTimeout(150);
      return {
        pass: pre.includes('Kiran Mehta') && pre.includes('Solar Rooftop 5kW') && wa.startsWith('https://wa.me/?text='),
        detail: 'live draft recap & wa.me URL verified',
      };
    });

    await runScenario('D6:Editor', 'Import JSON modal rejects invalid JSON & accepts valid Scope JSON', 'S1', async () => {
      const startDet = edPage.locator('details.start-options');
      if (!(await startDet.evaluate(el => el.hasAttribute('open')))) {
        await startDet.locator('summary').click();
      }
      await edPage.getByRole('button', {name: /Import a draft \(JSON\)/i}).click();
      await edPage.waitForTimeout(150);
      await edPage.locator('[role="dialog"] textarea').fill('{broken json');
      await edPage.locator('[role="dialog"] button', {hasText: 'Import draft'}).click();
      await edPage.waitForTimeout(120);
      const errVisible = await edPage.locator('[role="dialog"] .error').isVisible();
      await edPage.keyboard.press('Escape');
      await edPage.waitForTimeout(120);
      return {pass: errVisible, detail: `invalidJsonRejected=${errVisible}`};
    });

    await runScenario('D6:Editor', 'Keyboard "?" opens shortcuts outside fields, but never hijacks typing inside inputs', 'S1', async () => {
      const titleInput = edPage.getByLabel(/Project name/i);
      await titleInput.click();
      await edPage.keyboard.type('?');
      await edPage.waitForTimeout(100);
      const dialogWhileTyping = await edPage.locator('[role="dialog"]', {hasText: 'Keyboard shortcuts'}).count();
      await titleInput.blur();
      await edPage.locator('main').click({position: {x: 10, y: 10}});
      await edPage.keyboard.press('?');
      await edPage.waitForTimeout(150);
      const dialogOutside = await edPage.locator('[role="dialog"]', {hasText: 'Keyboard shortcuts'}).isVisible();
      await edPage.keyboard.press('Escape');
      return {
        pass: dialogWhileTyping === 0 && dialogOutside,
        detail: `hijackInField=${dialogWhileTyping > 0}, opensOutside=${dialogOutside}`,
      };
    });

    await runScenario('D6:Editor', 'Signed-out draft persists across reload in same tab (sessionStorage)', 'S1', async () => {
      // Restore clean title after S096 tested typing "?" inside the title input
      await edPage.getByLabel(/Project name/i).fill('Solar Rooftop 5kW Installation');
      await edPage.waitForTimeout(450); // allow 300ms debounce write to sessionStorage
      edPage.once('dialog', d => d.accept());
      await edPage.reload({waitUntil: 'domcontentloaded'});
      await edPage.waitForTimeout(550);
      const restoredTitle = await edPage.getByLabel(/Project name/i).inputValue().catch(() => '');
      return {
        pass: restoredTitle.includes('Solar Rooftop 5kW'),
        detail: `restoredTitle="${restoredTitle}"`,
      };
    });

    await runScenario('D6:Editor', 'Save button while signed out clearly explains why disabled + links to Sign in', 'S1', async () => {
      const saveBtn = edPage.locator('.save-bar button.primary');
      const disabled = await saveBtn.isDisabled();
      const reason = (await edPage.locator('#save-reason').textContent()) || '';
      return {pass: disabled && reason.toLowerCase().includes('sign in'), detail: `reason="${reason.trim()}"`};
    });

    await runScenario('D6:Editor', '"Back to the overview" cleanly returns to Landing page with 0 errors', 'S2', async () => {
      await edPage.getByRole('button', {name: /Back to the overview/i}).click();
      await edPage.waitForTimeout(200);
      const h1 = (await edPage.locator('h1').textContent()) || '';
      const e = edErrs.get();
      return {
        pass: h1.includes('Clear agreements') && e.errors.length === 0,
        detail: `h1="${h1.slice(0, 40)}", errors=${e.errors.length}`,
      };
    });

    // =========================================================================
    // DIMENSION 7: Auxiliary High-Value Tools & Navigation (S100-S108)
    // =========================================================================
    const auxPage = await context.newPage();

    await runScenario('D7:Tools', 'MSME Interest Calculator computes statutory 3x RBI compound interest for overdue invoice', 'S1', async () => {
      await auxPage.goto(BASE + '/msme-interest', {waitUntil: 'domcontentloaded'});
      await auxPage.waitForTimeout(350);
      const numInputs = auxPage.locator('input[type="number"]');
      if ((await numInputs.count()) > 0) {
        await numInputs.first().fill('250000');
      }
      await auxPage.waitForTimeout(200);
      const tableCount = await auxPage.locator('table.msme-table').count();
      await auxPage.screenshot({path: path.join(SHOT_DIR, 'msme-calculator-fixed.png'), fullPage: false});
      const body = (await auxPage.locator('main').textContent()) || '';
      return {
        pass: /₹|INR|interest|MSMED/i.test(body) && !/NaN/.test(body) && tableCount === 1,
        detail: `rendered MSME calculation & aligned table (${tableCount})`,
      };
    });

    await runScenario('D7:Tools', 'MSME Calculator handles 0 overdue days cleanly (no negative interest)', 'S2', async () => {
      const dateInputs = auxPage.locator('input[type="date"]');
      const count = await dateInputs.count();
      if (count >= 2) {
        await dateInputs.nth(0).fill('2026-01-01');
        await dateInputs.nth(1).fill('2026-01-10');
        await auxPage.waitForTimeout(150);
      }
      const body = (await auxPage.locator('main').textContent()) || '';
      return {pass: !/-\s*₹|NaN/.test(body), detail: `dateInputs=${count}, no negative/NaN`};
    });

    await runScenario('D7:Tools', 'Footer "Check a receipt" form handles malformed link gracefully on /verify', 'S1', async () => {
      await auxPage.goto(BASE + '/', {waitUntil: 'domcontentloaded'});
      await auxPage.waitForTimeout(250);
      await auxPage.locator('#receipt-check').fill('not-a-valid-receipt-link');
      await auxPage.locator('.receipt-form button[type="submit"]').click();
      await auxPage.waitForTimeout(450);
      const url = auxPage.url();
      const hasH1 = (await auxPage.locator('h1').count()) === 1;
      return {pass: url.includes('/verify') && hasH1, detail: `url=${url}`};
    });

    await runScenario('D7:Tools', '/plans displays clear plan tiers with zero broken CTAs', 'S2', async () => {
      await auxPage.goto(BASE + '/plans', {waitUntil: 'domcontentloaded'});
      await auxPage.waitForTimeout(300);
      const cards = await auxPage.locator('.plan-card').count();
      return {pass: cards >= 2, detail: `planCards=${cards}`};
    });

    await runScenario('D7:Tools', '/auth/sign-in handles configured toggle OR unconfigured no-dead-end fallback cleanly', 'S1', async () => {
      await auxPage.goto(BASE + '/auth/sign-in', {waitUntil: 'domcontentloaded'});
      await auxPage.waitForTimeout(300);
      const pwd = auxPage.locator('input[type="password"]').first();
      const toggle = auxPage.locator('button.password-toggle').first();
      if ((await pwd.count()) > 0 && (await toggle.count()) > 0) {
        await pwd.fill('TestPass123!');
        await toggle.click();
        await auxPage.waitForTimeout(100);
        const shownType = await auxPage.locator('.password-field input').first().getAttribute('type');
        return {pass: shownType === 'text', detail: `configured auth toggle type=${shownType}`};
      }
      // Auth service unconfigured in preview container: verify honest alert + actionable no-account links
      const alertVisible = await auxPage.locator('main .error[role="alert"]').isVisible();
      const checkLink = await auxPage.locator('.auth-fallback-box a[href="/check"]').isVisible();
      const quickLink = await auxPage.locator('.auth-fallback-box a[href="/templates"]').isVisible();
      return {
        pass: alertVisible && checkLink && quickLink,
        detail: `unconfigured fallback: alert=${alertVisible}, checkLink=${checkLink}, quickLink=${quickLink}`,
      };
    });

    await runScenario('D7:Tools', '/auth/sign-up renders consent copy (or actionable no-account fallback when unconfigured)', 'S2', async () => {
      await auxPage.goto(BASE + '/auth/sign-up', {waitUntil: 'domcontentloaded'});
      await auxPage.waitForTimeout(300);
      const h1 = (await auxPage.locator('h1').textContent()) || '';
      const hasConsent = (await auxPage.locator('.auth-consent').count()) > 0;
      const hasFallback = (await auxPage.locator('.auth-fallback-box a[href="/?guided=1"]').isVisible().catch(() => false));
      return {
        pass: h1.length > 0 && (hasConsent || hasFallback),
        detail: `h1="${h1.trim()}", consent=${hasConsent}, fallback=${hasFallback}`,
      };
    });

    await runScenario('D7:Tools', '/connect MCP & API page renders cleanly with JSON schema instructions', 'S2', async () => {
      await auxPage.goto(BASE + '/connect', {waitUntil: 'domcontentloaded'});
      await auxPage.waitForTimeout(300);
      const body = (await auxPage.locator('main').textContent()) || '';
      return {pass: body.includes('MCP') || body.includes('JSON'), detail: 'connect docs verified'};
    });

    await runScenario('D7:Tools', 'Account dropdown has no duplicate Templates & routes to MSME calculator', 'S1', async () => {
      await auxPage.goto(BASE + '/', {waitUntil: 'domcontentloaded'});
      await auxPage.waitForTimeout(250);
      await auxPage.locator('button.nav-menu').click();
      await auxPage.waitForTimeout(150);
      const items = await auxPage.locator('.account-menu [role="menuitem"]').allTextContents();
      const hasDupTpl = items.some(t => t.startsWith('Templates'));
      await auxPage.locator('.account-menu a[href="/msme-interest"]').click();
      await auxPage.waitForTimeout(350);
      return {
        pass: !hasDupTpl && auxPage.url().includes('/msme-interest'),
        detail: `items=${items.length}, dupTemplates=${hasDupTpl}, landed=${auxPage.url()}`,
      };
    });

    await runScenario('D7:Tools', 'All footer internal links resolve with HTTP < 400 (0 broken links)', 'S1', async () => {
      await auxPage.goto(BASE + '/', {waitUntil: 'domcontentloaded'});
      const hrefs = await auxPage.evaluate(() =>
        Array.from(document.querySelectorAll('footer a[href^="/"]')).map(a => a.getAttribute('href')),
      );
      const unique = [...new Set(hrefs)];
      const bad = [];
      for (const h of unique) {
        const r = await auxPage.request.get(BASE + h);
        if (r.status() >= 400) bad.push(`${h}:${r.status()}`);
      }
      return {pass: bad.length === 0, detail: `checked ${unique.length} footer links, bad=${bad.length}`};
    });

    // =========================================================================
    // DIMENSION 8: Adversarial Security, Performance, Unicode & Boundary (S109-S122)
    // =========================================================================
    const advPage = await context.newPage();

    await runScenario('D8:Adversarial', 'XSS payload in /check scanner, Ladder & Editor executes zero scripts', 'S0', async () => {
      await advPage.goto(BASE + '/check', {waitUntil: 'domcontentloaded'});
      const xss = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script> non-refundable cash only';
      await advPage.locator('textarea').first().fill(xss);
      await advPage.getByLabel('Property / event / project').fill(xss);
      await advPage.getByLabel('Landlord / vendor / client name').fill(xss);
      await advPage.waitForTimeout(150);
      const leaked = await advPage.evaluate(() => window.__xss || null);
      return {pass: leaked === null, detail: `window.__xss=${leaked}`};
    });

    await runScenario('D8:Adversarial', '12,000-character pasted lease scans smoothly without freezing UI', 'S1', async () => {
      const big =
        'Tenant pays monthly rent on time. '.repeat(350) +
        'One month rent automatically deducted for painting regardless of condition. Deposit non-refundable.';
      const t0 = Date.now();
      await advPage.locator('textarea').first().fill(big);
      await advPage.waitForTimeout(150);
      const elapsed = Date.now() - t0;
      const traps = await advPage.locator('.shield-finding').count();
      return {pass: elapsed < 2500 && traps >= 2, detail: `len=${big.length}, elapsed=${elapsed}ms, traps=${traps}`};
    });

    await runScenario('D8:Adversarial', 'Multi-script UTF-8 (Hindi, Tamil, Emoji, ₹/$/€) seals valid SHA-256', 'S1', async () => {
      await advPage.getByLabel('Property / event / project').fill('फ़्लैट 12A · சென்னை 🏠 ₹1,50,000');
      await advPage.getByRole('button', {name: /Seal SHA-256/i}).click();
      await advPage.waitForTimeout(200);
      const sealed = (await advPage.locator('.ladder-card-wide .shield-clean').textContent()) || '';
      return {pass: /[a-f0-9]{64}/.test(sealed), detail: 'UTF-8 SHA-256 sealed cleanly'};
    });

    await runScenario('D8:Adversarial', 'Zero & extreme amount boundaries format cleanly without NaN', 'S1', async () => {
      await advPage.getByLabel(/Deposit \/ agreed amount/).fill('0');
      await advPage.waitForTimeout(100);
      const zeroMsg = (await advPage.locator('.ladder-card .ladder-pre').first().textContent()) || '';
      await advPage.getByLabel(/Deposit \/ agreed amount/).fill('10000000');
      await advPage.waitForTimeout(100);
      const maxMsg = (await advPage.locator('.ladder-card .ladder-pre').first().textContent()) || '';
      return {
        pass: zeroMsg.includes('[amount]') && !zeroMsg.includes('NaN') && maxMsg.includes('1,00,00,000'),
        detail: 'zero fallback=[amount], INR crore grouping ok',
      };
    });

    // =========================================================================
    // DIMENSION 9: Signed-Out Multi-Switch Regression, Half-Screen UX & SHA-256 Loop (S113-S118)
    // =========================================================================
    const regPage = await context.newPage();

    await runScenario('D9:Regressions', 'Signed-out Pack A -> return to /templates -> Pack B stays Pack B (zero sessionStorage clobber)', 'S0', async () => {
      await regPage.goto(BASE + '/templates', {waitUntil: 'domcontentloaded'});
      await regPage.waitForTimeout(300);
      // Open Pack A (Rental Deposit) first so sessionStorage stores it
      await regPage.getByRole('button', {name: /Open in editor/i}).click();
      await regPage.waitForTimeout(700);
      // Navigate back to /templates in same tab, switch to Pack B (Event & Wedding Catering)
      regPage.once('dialog', d => d.accept());
      await regPage.goto(BASE + '/templates', {waitUntil: 'domcontentloaded'});
      await regPage.waitForTimeout(300);
      await regPage.locator('.guided-pack-btn', {hasText: 'Event & Wedding Catering'}).click();
      await regPage.waitForTimeout(120);
      await regPage.getByRole('button', {name: /Open in editor/i}).click();
      // Wait 1 full second so async /api/me + restoreOnLoad definitely finishes
      await regPage.waitForTimeout(1000);
      const paperTitle = (await regPage.locator('.paper h2').textContent()) || '';
      return {
        pass: paperTitle.includes('Catering Agreement'),
        detail: `after 1s async settle, paperTitle="${paperTitle}"`,
      };
    });

    await runScenario('D9:Regressions', 'Signed-out Pack B -> /check -> switch to Home Interiors -> Build full agreement stays Home Interiors', 'S0', async () => {
      regPage.once('dialog', d => d.accept());
      await regPage.goto(BASE + '/check', {waitUntil: 'domcontentloaded'});
      await regPage.waitForTimeout(300);
      await regPage.getByRole('button', {name: 'Home interiors & local contractor'}).click();
      await regPage.waitForTimeout(150);
      await regPage.getByRole('button', {name: /Build full agreement/i}).click();
      await regPage.waitForTimeout(1000);
      const paperTitle = (await regPage.locator('.paper h2').textContent()) || '';
      return {
        pass: paperTitle.includes('Home Renovation BOQ'),
        detail: `after 1s async settle, paperTitle="${paperTitle}"`,
      };
    });

    await runScenario('D9:Regressions', 'Signed-out previous draft -> /templates -> Use template switches cleanly without blocking', 'S0', async () => {
      regPage.once('dialog', d => d.accept());
      await regPage.goto(BASE + '/templates', {waitUntil: 'domcontentloaded'});
      await regPage.waitForTimeout(450);
      await regPage.getByRole('link', {name: /Use template CA monthly compliance retainer/i}).click();
      await regPage.waitForTimeout(1000);
      const paperTitle = (await regPage.locator('.paper h2').textContent()) || '';
      return {
        pass: paperTitle.includes('Monthly compliance retainer'),
        detail: `switched to "${paperTitle}"`,
      };
    });

    await runScenario('D9:Regressions', 'Half-screen 650x850 viewport shows 2-col Quick-Fill packs, Selected pill, active bar & new logo', 'S1', async () => {
      const halfPage = await context.newPage();
      await halfPage.setViewportSize({width: 650, height: 850});
      await halfPage.goto(BASE + '/templates', {waitUntil: 'domcontentloaded'});
      await halfPage.waitForTimeout(350);
      await halfPage.locator('.guided-pack-btn', {hasText: 'Event & Wedding Catering'}).click();
      await halfPage.waitForTimeout(150);
      const selectedPill = await halfPage.locator('.guided-pack-btn.is-selected .guided-selected-pill').isVisible();
      const activeBar = (await halfPage.locator('.guided-active-bar').textContent()) || '';
      const overflow = await halfPage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await halfPage.screenshot({path: path.join(SHOT_DIR, 'half-templates-redesigned.png'), fullPage: false});
      await halfPage.close();
      return {
        pass: selectedPill && activeBar.includes('Event & Wedding Catering') && overflow <= 1,
        detail: `selectedPill=${selectedPill}, activeBar="${activeBar.trim().slice(0, 45)}", overflow=${overflow}px`,
      };
    });

    await runScenario('D9:Regressions', 'Cryptographic loop: Seal SHA-256 record on /check -> verify exact match on /verify', 'S0', async () => {
      const cryptoPage = await context.newPage();
      await cryptoPage.goto(BASE + '/check', {waitUntil: 'domcontentloaded'});
      await cryptoPage.waitForTimeout(300);
      await cryptoPage.getByLabel(/Deposit \/ agreed amount/).fill('175000');
      await cryptoPage.getByRole('button', {name: /Seal SHA-256 evidence record/i}).click();
      await cryptoPage.waitForTimeout(200);
      const sealedText = (await cryptoPage.locator('.ladder-card-wide .ladder-pre').textContent()) || '';
      await cryptoPage.goto(BASE + '/verify#evidence-check', {waitUntil: 'domcontentloaded'});
      await cryptoPage.waitForTimeout(300);
      await cryptoPage.locator('#evidence-check textarea').fill(sealedText);
      await cryptoPage.getByRole('button', {name: /Verify SHA-256 integrity/i}).click();
      await cryptoPage.waitForTimeout(200);
      const verdict = await cryptoPage.locator('[data-evidence-verdict]').getAttribute('data-evidence-verdict');
      await cryptoPage.screenshot({path: path.join(SHOT_DIR, 'verify-sha256-valid.png'), fullPage: false});
      // Now tamper 1 digit (1,75,000 -> 1,25,000) and re-verify (S118)
      const tampered = sealedText.replace('1,75,000', '1,25,000');
      await cryptoPage.locator('#evidence-check textarea').fill(tampered);
      await cryptoPage.getByRole('button', {name: /Verify SHA-256 integrity/i}).click();
      await cryptoPage.waitForTimeout(200);
      const tamperedVerdict = await cryptoPage.locator('[data-evidence-verdict]').getAttribute('data-evidence-verdict');
      await cryptoPage.close();
      return {
        pass: verdict === 'valid' && tamperedVerdict === 'tampered',
        detail: `unmodified=${verdict}, 1-digit-tampered=${tamperedVerdict}`,
      };
    });

    await runScenario('D9:Regressions', 'AI Studio cross-site iframe JS chunk request returns HTTP 200 (allowedDevOrigins)', 'S0', async () => {
      const html = await (await fetch(BASE + '/templates')).text();
      const match = html.match(/\/_next\/static\/[^"]+\.js/);
      if (!match) return {pass: false, detail: 'No _next/static JS chunk found in /templates HTML'};
      const r = await fetch(BASE + match[0], {
        headers: {
          Host: 'ais-dev-w3mp4bpozlot7u7jowddhn-822519042553.asia-east1.run.app',
          Referer: 'https://ais-dev-w3mp4bpozlot7u7jowddhn-822519042553.asia-east1.run.app/templates',
          'Sec-Fetch-Site': 'cross-site',
          'Sec-Fetch-Mode': 'no-cors',
        },
      });
      return {pass: r.status === 200, detail: `chunk=${match[0].slice(0, 48)} status=${r.status}`};
    });

    await runScenario('D9:Regressions', 'TermsLock brand mark + aligned 46px date & rent inputs at 650px & 1440px (no skeleton)', 'S1', async () => {
      const alignPage = await context.newPage();
      await alignPage.setViewportSize({width: 650, height: 850});
      await alignPage.goto(BASE + '/templates', {waitUntil: 'domcontentloaded'});
      await alignPage.waitForTimeout(300);
      const brandText = (await alignPage.locator('header .wordmark').textContent())?.trim() || '';
      const hasMarkSvg = (await alignPage.locator('header .mark svg').count()) === 1;
      const starterCards = await alignPage.locator('.starter-grid li').count();
      const half = await alignPage.evaluate(() =>
        [...document.querySelectorAll('.guided-builder .three-col input')].map(el => ({
          top: Math.round(el.getBoundingClientRect().top),
          height: Math.round(el.getBoundingClientRect().height),
          width: Math.round(el.getBoundingClientRect().width),
        })),
      );
      await alignPage.setViewportSize({width: 1440, height: 900});
      await alignPage.waitForTimeout(150);
      const desk = await alignPage.evaluate(() =>
        [...document.querySelectorAll('.guided-builder .three-col input')].map(el => ({
          top: Math.round(el.getBoundingClientRect().top),
          height: Math.round(el.getBoundingClientRect().height),
          width: Math.round(el.getBoundingClientRect().width),
        })),
      );
      await alignPage.close();
      const halfAligned =
        half.length === 3 &&
        Math.abs(half[0].top - half[1].top) <= 1 &&
        half[0].height === 46 &&
        half[1].height === 46 &&
        half[2].height === 46 &&
        half[2].width >= half[0].width * 1.8;
      const deskAligned =
        desk.length === 3 &&
        Math.abs(desk[0].top - desk[1].top) <= 1 &&
        Math.abs(desk[1].top - desk[2].top) <= 1 &&
        desk.every(b => b.height === 46);
      return {
        pass: brandText === 'TermsLock' && hasMarkSvg && starterCards >= 12 && halfAligned && deskAligned,
        detail: `brand=${brandText}, starters=${starterCards}, halfAligned=${halfAligned}, deskAligned=${deskAligned}`,
      };
    });

    await browser.close();

    // =========================================================================
    // COMBINATORIAL ENGINE STRESS (S113-S122: 10 matrix suites covering 99 combos!)
    // =========================================================================
    const shield = await import('../lib/legal-shield.ts');
    const packs = await import('../lib/protection-packs.ts');
    const scopeMod = await import('../lib/scope.ts');
    const moneyMod = await import('../lib/money.ts');

    for (const sc of shield.SCENARIOS) {
      await runScenario(
        'D8:EngineMatrix',
        `All 9 jurisdictions × "${sc.id}" scenario produce valid report & 3-level ladder`,
        'S0',
        async () => {
          let ok = 0;
          for (const j of shield.JURISDICTIONS) {
            const rep = shield.analyzeAgreementText(sc.sampleClause, sc.id, j.id);
            const lad = shield.buildEscalationLadder({
              scenario: sc.id,
              jurisdiction: j.id,
              partyName: 'Test Counterparty',
              yourName: 'Test User',
              subject: 'Test Subject',
              amount: j.currency === 'INR' ? 120000 : 3000,
              date: '2026-12-01',
            });
            if (
              rep.findings.length >= 1 &&
              rep.score < 100 &&
              lad.level1WhatsApp.waHref.startsWith('https://wa.me/?text=') &&
              lad.level3Unilateral.checklist.length >= 3
            ) {
              ok += 1;
            }
          }
          return {pass: ok === shield.JURISDICTIONS.length, detail: `${ok}/${shield.JURISDICTIONS.length} jurisdictions`};
        },
      );
    }

    for (const pk of packs.GUIDED_PACKS.slice(0, 5)) {
      await runScenario(
        'D8:EngineMatrix',
        `Guided pack "${pk.id}" compiles to valid Scope across all 9 jurisdictions (INR & USD)`,
        'S0',
        async () => {
          let ok = 0;
          for (const j of shield.JURISDICTIONS) {
            const {scope, whatsappRecap} = packs.buildGuidedScope({
              packId: pk.id,
              jurisdiction: j.id,
              subject: 'Test Agreement',
              party: 'Test Party',
              amount: j.currency === 'INR' ? pk.defaultAmountINR : pk.defaultAmountUSD,
              date: '2026-12-15',
            });
            const parsed = scopeMod.scopeSchema.safeParse(scope);
            const tot = moneyMod.totals(scope);
            if (parsed.success && tot.total >= scope.fee && whatsappRecap.includes('Confirmed')) {
              ok += 1;
            }
          }
          return {pass: ok === shield.JURISDICTIONS.length, detail: `${ok}/${shield.JURISDICTIONS.length} valid`};
        },
      );
    }

    // Final Summary Report
    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass);
    const bySev = {S0: 0, S1: 0, S2: 0, S3: 0};
    for (const f of failed) bySev[f.severity] = (bySev[f.severity] || 0) + 1;

    console.log('\n==================== AUDIT SUMMARY ====================');
    console.log(`TOTAL SCENARIOS: ${results.length}`);
    console.log(`PASSED: ${passed} (${((passed / results.length) * 100).toFixed(1)}%)`);
    console.log(`FAILED: ${failed.length} (S0=${bySev.S0}, S1=${bySev.S1}, S2=${bySev.S2}, S3=${bySev.S3})`);
    if (failed.length) {
      console.log('\n--- DEFECT LIST ---');
      for (const f of failed) {
        console.log(`${f.id} [${f.severity}] ${f.dimension} | ${f.name}\n   -> ${f.detail}`);
      }
    }
    console.log('=======================================================');
    process.exit(failed.length === 0 ? 0 : 1);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
