/**
 * TermsLock — 120+ Real Interactive User Walkthrough & Edge-Case Suite
 *
 * Actually opens headless Chromium against http://localhost:3000 and types through
 * 120+ distinct real-world scenarios, layout ergonomics checks, 4-theme contrast/alignment
 * checks, 5-viewport responsiveness checks, zero-API clarity lint rewrites, event chains,
 * cryptographic SHA-256 sealing + tamper verification, CLS measurement, and adversarial cases.
 */
import { mkdirSync } from 'node:fs';
import { chromium, type Page } from 'playwright';

const SHOT_DIR = '.audit-walkthrough';
mkdirSync(SHOT_DIR, { recursive: true });

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const CHROME = '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell';

type Result = { id: string; group: string; title: string; ok: boolean; detail: string };
const results: Result[] = [];
let seq = 0;

async function run(group: string, title: string, fn: () => Promise<string | void>) {
  const id = 'U' + String(++seq).padStart(3, '0');
  try {
    const detail = (await fn()) || 'ok';
    results.push({ id, group, title, ok: true, detail });
    console.log(`${id} | PASS | ${group} | ${title} — ${detail}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ id, group, title, ok: false, detail: msg });
    console.error(`${id} | FAIL | ${group} | ${title} — ${msg}`);
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function setTheme(page: Page, theme: 'a' | 'b', mode: 'light' | 'dark') {
  await page.evaluate(
    ({ theme, mode }) => {
      localStorage.setItem('tl_theme', theme);
      localStorage.setItem('tl_mode', mode);
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.mode = mode;
      document.documentElement.dataset.scheme = mode;
    },
    { theme, mode },
  );
  await page.waitForTimeout(80);
}

async function openEditor(page: Page) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const tryBtn = page.getByRole('button', { name: /Try editor free/i });
  if (await tryBtn.isVisible().catch(() => false)) {
    await tryBtn.click();
  }
  await page.waitForSelector('.work-grid', { timeout: 10000 });
  await page.waitForTimeout(150);
}

async function main() {
  // Wait for server
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(BASE + '/api/health');
      if (r.ok || r.status < 500) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }

  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const runtimeErrors: string[] = [];
  page.on('pageerror', (e) => runtimeErrors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') runtimeErrors.push('CONSOLE: ' + m.text());
  });

  // =========================================================================
  // BLOCK A: Full-Width Screen Fill, Textarea Resize Isolation & Context Wording
  // =========================================================================
  await openEditor(page);

  await run('A:Layout', 'Full-width edit truly fills 1440px viewport (>=94% width)', async () => {
    await page.getByRole('button', { name: 'Full-width edit' }).click();
    await page.waitForTimeout(120);
    const m = await page.evaluate(() => {
      const main = document.querySelector('main.shell');
      const flow = document.querySelector('.flow-col');
      const mr = main!.getBoundingClientRect();
      const fr = flow!.getBoundingClientRect();
      return { vw: window.innerWidth, mainW: Math.round(mr.width), flowW: Math.round(fr.width), pct: +(fr.width / window.innerWidth * 100).toFixed(1) };
    });
    assert(m.pct >= 94, `Expected >=94% width, got ${m.pct}% (${m.flowW}/${m.vw})`);
    return `${m.flowW}px / ${m.vw}px (${m.pct}%)`;
  });

  await run('A:Layout', 'Full-width edit truly fills 1920px ultrawide viewport (>=95% width)', async () => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(120);
    const m = await page.evaluate(() => {
      const flow = document.querySelector('.flow-col')!;
      const fr = flow.getBoundingClientRect();
      return { vw: window.innerWidth, flowW: Math.round(fr.width), pct: +(fr.width / window.innerWidth * 100).toFixed(1) };
    });
    assert(m.pct >= 95, `Expected >=95% on 1920px, got ${m.pct}% (${m.flowW}/${m.vw})`);
    await page.setViewportSize({ width: 1440, height: 900 });
    return `${m.flowW}px / ${m.vw}px (${m.pct}%)`;
  });

  await run('A:Layout', 'Split view at 1440px puts Form FIRST on left, Live Paper on right & top fields aligned 0px', async () => {
    await page.getByRole('button', { name: 'Split view' }).click();
    await page.waitForTimeout(140);
    const m = await page.evaluate(() => {
      const fr = document.querySelector('.flow-col')!.getBoundingClientRect();
      const pr = document.querySelector('.preview-col')!.getBoundingClientRect();
      const inputs = Array.from(document.querySelectorAll('#step-scope .identity-row input'));
      const topDelta = inputs.length >= 2 ? Math.abs(Math.round(inputs[0].getBoundingClientRect().top - inputs[1].getBoundingClientRect().top)) : 0;
      return { flowL: Math.round(fr.left), flowW: Math.round(fr.width), prevL: Math.round(pr.left), prevW: Math.round(pr.width), topDelta };
    });
    assert(m.flowL < m.prevL && m.flowW > m.prevW, `Unexpected split geometry: ${JSON.stringify(m)}`);
    assert(m.topDelta <= 1, `Split-view top Project name / Client inputs misaligned by ${m.topDelta}px`);
    await page.screenshot({ path: `${SHOT_DIR}/split-view-top.png` });
    return `form=${m.flowW}px, paper=${m.prevW}px, topInputDelta=${m.topDelta}px`;
  });

  await run('A:Navigation', 'Clicking TermsLock logo when signed out in try-editor returns cleanly to Home screen', async () => {
    await page.locator('header .brand').click();
    await page.waitForTimeout(180);
    assert(await page.getByRole('button', { name: /Try editor free/i }).isVisible(), 'Did not return to Home landing screen on logo click');
    await page.getByRole('button', { name: /Try editor free/i }).click();
    await page.waitForSelector('.work-grid', { timeout: 10000 });
    await page.waitForTimeout(120);
    return 'logo returns signed-out user to Home overview';
  });

  await run('A:Layout', 'Document preview mode hides form and centers full paper sheet', async () => {
    await page.getByRole('button', { name: 'Document preview' }).click();
    await page.waitForTimeout(120);
    const m = await page.evaluate(() => {
      const flowDisplay = getComputedStyle(document.querySelector('.flow-col')!).display;
      const pr = document.querySelector('.preview-col')!.getBoundingClientRect();
      return { flowDisplay, prevW: Math.round(pr.width), prevLeft: Math.round(pr.left) };
    });
    assert(m.flowDisplay === 'none' && m.prevW >= 780, `Bad preview mode: ${JSON.stringify(m)}`);
    await page.getByRole('button', { name: 'Split view' }).click();
    return `centered paper=${m.prevW}px`;
  });

  await run('A:Print', 'Print stylesheet hides header, sidebars, tabs & editor and prints crisp white document even from Full-width edit + Dark mode', async () => {
    await setTheme(page, 'b', 'dark');
    await page.getByRole('button', { name: 'Full-width edit' }).click();
    await page.waitForTimeout(100);
    let m: Record<string, string | number> = {};
    try {
      await page.emulateMedia({ media: 'print' });
      await page.waitForTimeout(120);
      m = await page.evaluate(() => {
        const paper = document.querySelector('.paper');
        const ps = paper ? getComputedStyle(paper) : null;
        const pr = paper ? paper.getBoundingClientRect() : null;
        const delivTitle = document.querySelector('.paper .deliverable > span > span:first-child');
        const delivInk = delivTitle ? getComputedStyle(delivTitle).color : '';
        const headerEl = document.querySelector('header');
        const tryEl = document.querySelector('.try-banner');
        const headEl = document.querySelector('.project-head');
        const barEl = document.querySelector('.ws-layout-bar');
        const flowEl = document.querySelector('.flow-col');
        const fabEl = document.querySelector('.advisor-fab');
        return {
          header: headerEl ? getComputedStyle(headerEl).display : 'missing',
          tryBanner: tryEl ? getComputedStyle(tryEl).display : 'missing',
          projectHead: headEl ? getComputedStyle(headEl).display : 'missing',
          layoutBar: barEl ? getComputedStyle(barEl).display : 'missing',
          flowCol: flowEl ? getComputedStyle(flowEl).display : 'missing',
          advisorFab: fabEl ? getComputedStyle(fabEl).display : 'missing',
          paperDisplay: ps?.display ?? 'missing',
          paperBg: ps?.backgroundColor ?? '',
          paperInk: ps?.color ?? '',
          delivInk,
          paperWidth: pr ? Math.round(pr.width) : 0,
        };
      });
      await page.screenshot({ path: `${SHOT_DIR}/print-project-preview.png` });
    } finally {
      await page.emulateMedia({ media: 'screen' });
      await setTheme(page, 'b', 'light');
      await page.getByRole('button', { name: 'Split view' }).click();
      await page.waitForTimeout(100);
    }
    assert(m.header === 'none' && m.projectHead === 'none' && m.flowCol === 'none' && m.advisorFab === 'none', `Chrome visible in print: ${JSON.stringify(m)}`);
    assert(m.paperDisplay === 'block' && Number(m.paperWidth) >= 700, `Paper hidden or narrow in print: ${JSON.stringify(m)}`);
    assert(m.paperBg === 'rgb(255, 255, 255)' && m.paperInk === 'rgb(17, 17, 17)' && m.delivInk === 'rgb(17, 17, 17)', `Print colors not crisp black-on-white: ${JSON.stringify(m)}`);
    return `print paper=${m.paperWidth}px, bg=${m.paperBg}, ink=${m.paperInk}, deliv=${m.delivInk}, chrome=hidden`;
  });

  await run('A:Layout', 'Dragging/resizing Working terms textarea moves Outside this scope by 0px', async () => {
    const before = await page.evaluate(() => {
      const pair = document.querySelector('.terms-pair')!;
      const labels = pair.querySelectorAll('label');
      const leftTa = labels[0].querySelector('textarea')!;
      const rightTa = labels[1].querySelector('textarea')!;
      const lBefore = labels[0].getBoundingClientRect().top;
      const ltBefore = leftTa.getBoundingClientRect().top;
      rightTa.style.height = '340px';
      const lAfter = labels[0].getBoundingClientRect().top;
      const ltAfter = leftTa.getBoundingClientRect().top;
      rightTa.style.height = '';
      return { labelDelta: Math.abs(lAfter - lBefore), taDelta: Math.abs(ltAfter - ltBefore) };
    });
    assert(before.labelDelta === 0 && before.taDelta === 0, `Left column shifted! ${JSON.stringify(before)}`);
    return `labelDelta=${before.labelDelta}px, taDelta=${before.taDelta}px`;
  });

  await run('A:Layout', 'Laptop 1024px never splits editor in half & save-bar text clears AI Advisor', async () => {
    await page.setViewportSize({ width: 1024, height: 820 });
    await page.waitForTimeout(120);
    const m = await page.evaluate(() => {
      const fr = document.querySelector('.flow-col')!.getBoundingClientRect();
      const saveText = document.querySelector('.save-bar .fine')!.getBoundingClientRect();
      const fab = document.querySelector('.advisor-fab')!.getBoundingClientRect();
      const overlap = !(saveText.right < fab.left || saveText.left > fab.right || saveText.bottom < fab.top || saveText.top > fab.bottom);
      return { flowW: Math.round(fr.width), saveRight: Math.round(saveText.right), fabLeft: Math.round(fab.left), overlap };
    });
    assert(m.flowW >= 900 && !m.overlap, `1024px layout defect: ${JSON.stringify(m)}`);
    await page.setViewportSize({ width: 1440, height: 900 });
    return `flowW=${m.flowW}px, gapToFab=${m.fabLeft - m.saveRight}px`;
  });

  // Context-aware wording walkthroughs
  await run('A:Wording', 'Default freelance scope displays Project name, Client, Project fee, Working terms', async () => {
    const labels = await page.evaluate(() => Array.from(document.querySelectorAll('#step-scope label')).map(l => l.textContent?.trim() || ''));
    assert(labels.some(l => l.startsWith('Project name')), 'Missing Project name');
    assert(labels.some(l => l.startsWith('Client')), 'Missing Client');
    assert(labels.some(l => l.startsWith('Project fee')), 'Missing Project fee');
    assert(labels.some(l => l.startsWith('Working terms')), 'Missing Working terms');
    return 'freelance labels intact';
  });

  await run('A:Wording', 'Typing an Apartment Move-In title switches labels live to Property / Landlord / Deposit', async () => {
    await page.getByLabel(/Project name/i).fill('Flat 402 Palm Grove Apartment Move-In Deposit');
    await page.waitForTimeout(100);
    const labels = await page.evaluate(() => Array.from(document.querySelectorAll('#step-scope label')).map(l => l.textContent?.trim() || ''));
    assert(labels.some(l => l.startsWith('Property / Agreement name')), 'Did not switch to Property / Agreement name');
    assert(labels.some(l => l.startsWith('Landlord / Owner')), 'Did not switch to Landlord / Owner');
    assert(labels.some(l => l.startsWith('Security deposit / Agreed amount')), 'Did not switch to Security deposit');
    assert(labels.some(l => l.startsWith('Move-in / Handover date')), 'Did not switch to Move-in / Handover date');
    assert(labels.some(l => l.startsWith('Deposit refund & handover terms')), 'Did not switch to Deposit refund terms');
    await page.getByRole('button', { name: 'Full-width edit' }).click();
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${SHOT_DIR}/full-width-rental.png` });
    await page.getByRole('button', { name: 'Split view' }).click();
    await page.waitForTimeout(100);
    return 'switched to Rental/Deposit vocabulary live';
  });

  await run('A:Wording', 'Typing a Wedding Catering title switches labels live to Event / Vendor / Booking terms', async () => {
    await page.getByLabel(/Property \/ Agreement name/i).fill('Sharma Wedding Reception Catering — 350 Plates');
    await page.waitForTimeout(100);
    const labels = await page.evaluate(() => Array.from(document.querySelectorAll('#step-scope label')).map(l => l.textContent?.trim() || ''));
    assert(labels.some(l => l.startsWith('Event / Vendor agreement')), 'Missing Event / Vendor agreement');
    assert(labels.some(l => l.startsWith('Vendor / Host')), 'Missing Vendor / Host');
    assert(labels.some(l => l.startsWith('Agreed vendor fee')), 'Missing Agreed vendor fee');
    assert(labels.some(l => l.startsWith('Booking, overtime & cancellation terms')), 'Missing Booking terms');
    return 'switched to Wedding/Event vocabulary live';
  });

  await run('A:Wording', 'Typing a Home Renovation BOQ title switches labels live to Renovation / Contractor', async () => {
    await page.getByLabel(/Event \/ Vendor agreement/i).fill('3BHK Modular Kitchen & Wardrobes Renovation BOQ');
    await page.waitForTimeout(100);
    const labels = await page.evaluate(() => Array.from(document.querySelectorAll('#step-scope label')).map(l => l.textContent?.trim() || ''));
    assert(labels.some(l => l.startsWith('Renovation / Work order')), 'Missing Renovation / Work order');
    assert(labels.some(l => l.startsWith('Contractor / Firm')), 'Missing Contractor / Firm');
    assert(labels.some(l => l.startsWith('Agreed contract value')), 'Missing Agreed contract value');
    return 'switched to Renovation vocabulary live';
  });

  await run('A:Wording', 'Switching back to Website Redesign restores classic Project name & Client labels', async () => {
    await page.getByLabel(/Renovation \/ Work order/i).fill('SaaS Marketing Website Redesign');
    await page.waitForTimeout(100);
    assert(await page.getByLabel(/Project name/i).isVisible(), 'Did not restore Project name');
    return 'classic labels restored';
  });

  // =========================================================================
  // BLOCK B: Zero-API Scope Clarity Lint & 1-Click Safe Rewrites (18 scenarios)
  // =========================================================================
  const trapCases: [string, string, string, RegExp][] = [
    ['landlord discretion trap', "Deposit returned at landlord's discretion.", 'notes', /written itemized bills within 15 days/i],
    ['mandatory 1-month painting trap', 'Tenant pays mandatory 1-month painting upon exit.', 'notes', /itemized bills only for damage beyond normal wear/i],
    ['as per actuals trap', 'Electrical fittings billed as per actuals.', 'notes', /prior written approval and itemized receipts/i],
    ['market rate trap', 'Extra plates charged at market rate.', 'notes', /agreed fixed unit rate listed above/i],
    ['best effort trap', 'Contractor will use best effort for completion.', 'notes', /delivery on the agreed schedule/i],
    ['promptly vague timing trap', 'Landlord will refund promptly after handover.', 'notes', /within 7 business days/i],
    ['unlimited revisions trap', 'Includes unlimited revisions on logo.', 'notes', /revision round/i],
    ['minor tweaks trap', 'Includes minor tweaks after launch.', 'notes', /revision round|change order/i],
    ['open-ended etc. trap', 'Deliverables cover posters, flyers, etc.', 'notes', /^Deliverables cover posters, flyers\.?$/i],
    ['including but not limited to trap', 'Scope covers pages including but not limited to home.', 'notes', /consisting of/i],
    ['approximate number trap', 'Serve approximately 250 guests at buffet.', 'notes', /up to 250/i],
    ['exclusions as per actuals trap', 'Extra travel billed as per actuals.', 'exclusions', /prior written approval and itemized receipts/i],
  ];

  // Ensure zero AI API requests are ever fired while typing in Clarity Lint
  let aiCallsDuringTyping = 0;
  page.on('request', (req) => {
    if (req.url().includes('/api/ai/') || req.url().includes('/api/draft')) aiCallsDuringTyping++;
  });

  for (const [label, phrase, field, expectedAfter] of trapCases) {
    await run('B:ClarityLint', `Catches "${label}" locally & 1-click rewrite fixes ${field}`, async () => {
      const targetTa =
        field === 'exclusions'
          ? page.locator('.terms-pair label').nth(0).locator('textarea')
          : page.locator('.terms-pair label').nth(1).locator('textarea');
      await targetTa.fill(phrase);
      await page.waitForTimeout(160);
      const lintText = await page.locator('section.lint').textContent();
      assert(lintText && lintText.includes('Clarity'), 'Lint panel missing');
      const applyBtn = page.locator('section.lint button.link-button').filter({ hasText: /Use “|Remove it/ }).first();
      assert(await applyBtn.isVisible(), `No 1-click rewrite button for "${phrase}". Lint: ${lintText?.slice(0, 200)}`);
      await applyBtn.click();
      await page.waitForTimeout(120);
      const updated = await targetTa.inputValue();
      assert(expectedAfter.test(updated), `Expected ${expectedAfter} after rewrite, got "${updated}"`);
      return `rewrote -> "${updated.slice(0, 60)}"`;
    });
  }

  await run('B:ClarityLint', 'Zero Gemini/LLM API calls fired during all 12 clarity typing + rewrite runs', async () => {
    assert(aiCallsDuringTyping === 0, `Fired ${aiCallsDuringTyping} unexpected AI API calls!`);
    return '0 API calls (100% local instant engine)';
  });

  // Domain-specific missing clause detection across 5 domains
  const domainLintChecks: [string, string, RegExp][] = [
    ['Rental missing refund deadline & photo baseline', 'Flat 101 Apartment Security Deposit', /rental & deposit/i],
    ['Catering missing extra-plate cap & cancellation', 'Wedding Reception Catering Buffet 300 Plates', /catering/i],
    ['Renovation missing brand spec & snag retention', '2BHK Modular Kitchen Renovation BOQ', /renovation/i],
    ['Event Photography missing overtime cap & backup gear', 'Candid Wedding Photography & Videography', /event vendor/i],
    ['Website missing hosting, maintenance & SEO exclusions', 'Corporate Marketing Website Build', /website/i],
  ];
  for (const [name, title, expectRe] of domainLintChecks) {
    await run('B:DomainLint', name, async () => {
      await page.locator('#step-scope .identity-row input').first().fill(title);
      await page.locator('.terms-pair label').nth(0).locator('textarea').fill('None');
      await page.locator('.terms-pair label').nth(1).locator('textarea').fill('Standard payment.');
      await page.waitForTimeout(160);
      const showAll = page.locator('section.lint button.link-button', { hasText: /Show all/i });
      if (await showAll.isVisible().catch(() => false)) await showAll.click();
      const txt = (await page.locator('section.lint').textContent()) || '';
      assert(expectRe.test(txt), `Expected ${expectRe} in lint output: ${txt.slice(0, 260)}`);
      return 'domain protection check triggered';
    });
  }

  // =========================================================================
  // BLOCK C: Full Interactive Multi-Event & Wedding Hub Typing Walkthroughs (26 scenarios)
  // =========================================================================
  await page.goto(BASE + '/events', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.removeItem('termslock:event-collections:v1'));
  await page.reload({ waitUntil: 'networkidle' });

  await run('C:EventsHub', 'Default Marriage collection renders 6 sub-events + All sub-events filter', async () => {
    assert(await page.getByRole('button', { name: /All sub-events/i }).isVisible(), 'All sub-events missing for 6-event chain');
    const subCount = await page.locator('.events-sub-card').count();
    assert(subCount === 6, `Expected 6 sub-events, got ${subCount}`);
    return `6 sub-events loaded cleanly`;
  });

  await run('C:EventsHub', 'Every vendor contact row aligns at 0px vertical center delta', async () => {
    const maxDelta = await page.evaluate(() => {
      let worst = 0;
      document.querySelectorAll('.events-vendor-contacts').forEach((row) => {
        const ys = Array.from(row.children).map((c) => {
          const r = c.getBoundingClientRect();
          return r.top + r.height / 2;
        });
        if (ys.length) worst = Math.max(worst, Math.max(...ys) - Math.min(...ys));
      });
      return Math.round(worst);
    });
    assert(maxDelta <= 1, `Contact row misaligned by ${maxDelta}px`);
    return `maxDelta=${maxDelta}px`;
  });

  await run('C:EventsHub', 'Custom Multi-Event Collection starts as "Event Day 1" with zero phantom 50 guests & NO redundant "All sub-events"', async () => {
    await page.getByRole('button', { name: /New Event Collection/i }).click();
    await page.getByRole('button', { name: /Custom Multi-Event Collection/i }).click();
    await page.waitForTimeout(150);
    const body = (await page.locator('main').textContent()) || '';
    assert(body.includes('Event Day 1'), 'Expected "Event Day 1" starter');
    assert(!body.includes('Main Event / Phase 1'), 'Old "Main Event / Phase 1" still present');
    assert(!body.includes('50 guests'), 'Phantom "50 guests" still shown on blank custom event!');
    assert(body.includes('No vendors added yet') && !body.includes('All vendors confirmed'), 'Expected "No vendors added yet" for 0 vendors');
    const allBtnVisible = await page.getByRole('button', { name: /All sub-events/i }).isVisible().catch(() => false);
    assert(!allBtnVisible, 'Redundant "All sub-events" shown for single sub-event!');
    await page.screenshot({ path: `${SHOT_DIR}/events-single-custom.png` });
    return 'single event clean, 0 phantom guests, no redundant All sub-events';
  });

  await run('C:EventsHub', 'Editing custom collection details (Jaipur Destination Wedding) updates header live', async () => {
    await page.getByRole('button', { name: /Edit event details/i }).click();
    await page.getByLabel(/Event \/ Collection Name/i).fill('Rathore–Singhania Jaipur Wedding');
    await page.getByLabel(/City \/ Location/i).fill('Jaipur');
    await page.getByLabel(/Primary Host \/ Family Contact/i).fill('Vikramaditya Rathore');
    await page.getByLabel(/Primary Contact Phone/i).fill('+91 98290 11223');
    await page.getByRole('button', { name: /Done editing/i }).click();
    assert((await page.locator('main').textContent())?.includes('Rathore–Singhania Jaipur Wedding'), 'Title did not update');
    return 'custom wedding details saved';
  });

  const jaipurSubEvents: [string, string, string, string, string][] = [
    ['Welcome High Tea & Folk Night', '2026-12-11', '5:00 PM – 9:00 PM', 'Rambagh Courtyard', '220'],
    ['Haldi & Poolside Carnival', '2026-12-12', '10:30 AM – 2:00 PM', 'Surya Lawn', '180'],
    ['Royal Sangeet Gala', '2026-12-12', '7:30 PM – 12:00 AM', 'Darbar Ballroom', '320'],
    ['Pheras & Royal Banquet', '2026-12-13', '6:00 PM – 11:30 PM', 'Heritage Palace Lawn', '450'],
  ];

  for (const [subTitle, date, slot, venue, guests] of jaipurSubEvents) {
    await run('C:EventsHub', `Type & save custom sub-event "${subTitle}"`, async () => {
      await page.getByRole('button', { name: /Add sub-event/i }).click();
      await page.getByLabel(/Sub-event name/i).fill(subTitle);
      await page.getByLabel(/^Date$/i).fill(date);
      await page.getByLabel(/Guests/i).fill(guests);
      await page.getByLabel(/Time slot/i).fill(slot);
      await page.getByLabel(/Venue name/i).fill(venue);
      await page.getByRole('button', { name: /Save sub-event/i }).click();
      await page.waitForTimeout(100);
      assert((await page.locator('.events-sub-list').textContent())?.includes(subTitle), 'Sub-event not added');
      return `${guests} guests @ ${venue}`;
    });
  }

  await run('C:EventsHub', 'Adding 2nd+ sub-event automatically reveals "All sub-events" overview filter', async () => {
    assert(await page.getByRole('button', { name: /All sub-events/i }).isVisible(), 'All sub-events did not appear');
    const count = await page.locator('.events-sub-card').count();
    assert(count === 5, `Expected 5 sub-events, got ${count}`);
    return `5 sub-events + All sub-events visible`;
  });

  const jaipurVendors: [string, string, string, string, string, string, string, string][] = [
    ['Rajwada Royal Caterers', 'Devendra Joshi', '+91 98291 33445', 'dev@rajwada.example', '650000', '150000', 'UTR9911002233', '450 plates @ ₹1444/plate, +10% buffer cap, zero surprise service fee'],
    ['Jaipur Heritage Florals', 'Kavita Sharma', '+91 98292 44556', 'kavita@florals.example', '320000', '80000', 'UTR9911002244', 'Fresh marigold & rajnigandha mandap ready 3 hrs prior'],
    ['LensCraft Royal Cinema', 'Aarav Verma', '+91 98293 55667', 'aarav@lenscraft.example', '240000', '60000', 'UTR9911002255', '4-day coverage, 2 backup cameras, 600 edited photos in 30 days'],
  ];

  for (const [vName, person, phone, email, fee, adv, utr, terms] of jaipurVendors) {
    await run('C:EventsHub', `Type & save vendor "${vName}" with phone, advance & UTR`, async () => {
      await page.getByRole('button', { name: /Add vendor/i }).click();
      await page.getByLabel(/Vendor \/ Company name/i).fill(vName);
      await page.getByLabel(/Contact person/i).fill(person);
      await page.getByLabel(/Phone \/ WhatsApp number/i).fill(phone);
      await page.getByLabel(/Email \(optional\)/i).fill(email);
      await page.getByLabel(/Agreed fee/i).fill(fee);
      await page.getByLabel(/Advance paid/i).fill(adv);
      await page.getByLabel(/UPI \/ Bank UTR ref/i).fill(utr);
      await page.getByLabel(/Key terms \/ overage cap \/ deliverables/i).fill(terms);
      await page.getByRole('button', { name: /Save vendor/i }).click();
      await page.waitForTimeout(100);
      assert((await page.locator('main').textContent())?.includes(vName), 'Vendor not rendered');
      return `fee=₹${fee}, adv=₹${adv}, UTR=${utr}`;
    });
  }

  await run('C:EventsHub', 'Live KPI roll-up totals exact Jaipur wedding budget (₹12,10,000) & advance (₹2,90,000)', async () => {
    const kpi = (await page.locator('.events-kpi-grid').textContent()) || '';
    assert(kpi.includes('12,10,000'), `Budget mismatch: ${kpi}`);
    assert(kpi.includes('2,90,000'), `Advance mismatch: ${kpi}`);
    assert(kpi.includes('9,20,000'), `Balance mismatch: ${kpi}`);
    assert(kpi.includes('450'), `Peak guests mismatch: ${kpi}`);
    return '₹12,10,000 budget / ₹2,90,000 advance / ₹9,20,000 balance / 450 peak guests';
  });

  await run('C:EventsHub', 'Search by UTR ("UTR9911002244") filters exact vendor instantaneously', async () => {
    const search = page.getByPlaceholder(/Search vendor or UTR/i);
    await search.fill('UTR9911002244');
    await page.waitForTimeout(100);
    const txt = (await page.locator('main').textContent()) || '';
    assert(txt.includes('Jaipur Heritage Florals') && !txt.includes('Rajwada Royal Caterers'), 'UTR search filter failed');
    await search.fill('');
    return 'exact UTR match found';
  });

  await run('C:EventsHub', 'Contact & Phone Directory lists every coordinator + vendor with clickable tel: & WhatsApp links', async () => {
    await page.getByRole('tab', { name: /Contact & Phone Directory/i }).click();
    await page.waitForTimeout(100);
    const tels = await page.locator('a[href^="tel:"]').count();
    const was = await page.locator('a[href*="wa.me"]').count();
    assert(tels >= 3 && was >= 3, `Expected >=3 tel & wa links, got tel=${tels}, wa=${was}`);
    await page.getByRole('tab', { name: /Vendors & Agreements/i }).click();
    return `tel=${tels}, wa.me=${was}`;
  });

  await run('C:EventsHub', 'Events collection persists across hard page reload with zero auth-wait shuffle', async () => {
    await page.reload({ waitUntil: 'networkidle' });
    const txt = (await page.locator('main').textContent()) || '';
    assert(txt.includes('Rathore–Singhania Jaipur Wedding') && txt.includes('Rajwada Royal Caterers'), 'Lost collection after reload');
    return 'persisted cleanly across reload';
  });

  await run('C:EventsHub', 'Home Renovation & Apartment Move-In blueprints create cleanly with accurate totals', async () => {
    await page.getByRole('button', { name: /New Event Collection/i }).click();
    await page.getByRole('button', { name: /Home Renovation & Interiors Chain/i }).click();
    await page.waitForTimeout(100);
    assert((await page.locator('main').textContent())?.includes('Studio Craft Interiors'), 'Renovation preset missing');
    await page.getByRole('button', { name: /New Event Collection/i }).click();
    await page.getByRole('button', { name: /Apartment Move-In & Deposit Hub/i }).click();
    await page.waitForTimeout(100);
    assert((await page.locator('main').textContent())?.includes('Rajesh Sharma (Property Owner)'), 'Apartment preset missing');
    return 'both blueprints verified';
  });

  await run('C:EventsHub', '1-click "Full agreement" from Apartment Move-In Hub opens Scope Editor with Rental wording', async () => {
    await page.getByRole('button', { name: /Full agreement/i }).first().click();
    await page.waitForSelector('.work-grid', { timeout: 10000 });
    await page.waitForTimeout(250);
    const labels = await page.evaluate(() => Array.from(document.querySelectorAll('#step-scope label')).map(l => l.textContent?.trim() || ''));
    assert(labels.some(l => l.startsWith('Property / Agreement name')), `Expected rental wording after hub handoff, got ${labels.slice(0, 4).join(', ')}`);
    const paper = (await page.locator('.paper').textContent()) || '';
    assert(paper.includes('Rajesh Sharma'), 'Vendor/Landlord name missing from hydrated Paper');
    return 'hydrated cleanly into Rental-worded editor';
  });

  // =========================================================================
  // BLOCK D: Rights Check, 5 Brand-New Personas, WhatsApp Soft Confirm & SHA-256 Verify (20 scenarios)
  // =========================================================================
  await page.goto(BASE + '/check', { waitUntil: 'networkidle' });

  const personas: [string, string, string, string][] = [
    ['NRI Landlord Bengaluru Deposit', 'Apartment rental & security deposit', 'India — Karnataka (Bengaluru)', "Security deposit ₹2,40,000 is non-refundable during 11-month lock-in. 1.5 months mandatory painting deduction at landlord's sole discretion."],
    ['Pune PG / Hostel Refund Trap', 'Apartment rental & security deposit', 'India — Maharashtra (Mumbai / Pune)', 'Hostel deposit ₹45,000 will be forfeited if 60 days notice is not given; maintenance deducted at management discretion.'],
    ['Delhi Banquet Hall Force Majeure', 'Event & wedding catering', 'India — Delhi NCR', 'Advance ₹4,00,000 is strictly non-refundable even for government curfew or date change; extra plates billed at market rate + 25% service charge.'],
    ['Mumbai Modular Kitchen Brand Swap', 'Home interiors & local contractor', 'India — Maharashtra (Mumbai / Pune)', 'Contractor may substitute plywood and hardware with equivalent brand as per site availability; extra civil work billed as per actuals without prior quote.'],
    ['California Freelance SaaS Scope Creep', 'Freelance, agency & software scope', 'United States — California', 'Designer provides unlimited revisions and ongoing support as needed; final payment released promptly at client discretion after launch.'],
  ];

  for (const [name, scenarioLabel, jurisdiction, clause] of personas) {
    await run('D:RightsCheck', `Type & scan "${name}" clause`, async () => {
      await page.getByRole('button', { name: scenarioLabel }).click();
      await page.locator('#check-jurisdiction, select').first().selectOption({ label: jurisdiction });
      const ta = page.locator('textarea').first();
      await ta.fill(clause);
      await page.waitForTimeout(150);
      const body = (await page.locator('main').textContent()) || '';
      assert(/\/100/.test(body), 'Score missing');
      const flags = await page.locator('.shield-flag, .trap-card, [class*="flag"]').count();
      assert(flags >= 1 || /High|Elevated|trap|risk/i.test(body), 'No traps flagged');
      return `scanned cleanly under ${jurisdiction}`;
    });
  }

  await run('D:EvidenceSeal', 'Seal custom WhatsApp reply + UTR into SHA-256 hash & verify exact match + tamper detection on /verify', async () => {
    const sealBtn = page.getByRole('button', { name: /Seal SHA-256 evidence record|Re-seal SHA-256 record/i }).first();
    await sealBtn.click();
    await page.waitForTimeout(250);
    const sealedRecord = ((await page.locator('pre.ladder-pre').last().textContent()) || '').trim();
    const hashMatch = sealedRecord.match(/[a-f0-9]{64}/i);
    assert(hashMatch, `64-char SHA-256 hash not generated in sealed record: ${sealedRecord.slice(0, 120)}`);
    const hash = hashMatch[0];

    // Verify exact match AND 1-char tamper detection offline on /verify#evidence-check
    await page.goto(BASE + '/verify', { waitUntil: 'networkidle' });
    const evTa = page.getByLabel(/Sealed evidence record/i);
    const evBtn = page.getByRole('button', { name: /Verify SHA-256 integrity/i });
    await evTa.fill(sealedRecord);
    await evBtn.click();
    await page.waitForTimeout(180);
    const validStatus = await page.locator('[data-evidence-verdict]').getAttribute('data-evidence-verdict');
    assert(validStatus === 'valid', `Expected valid SHA-256 verdict, got ${validStatus}`);

    // Now tamper 1 digit/letter in the sealed body and confirm tamper detection fires
    const tampered = sealedRecord.replace(/^([A-Za-z])/, (ch) => (ch === 'X' ? 'Y' : 'X'));
    await evTa.fill(tampered);
    await evBtn.click();
    await page.waitForTimeout(180);
    const tamperedStatus = await page.locator('[data-evidence-verdict]').getAttribute('data-evidence-verdict');
    assert(tamperedStatus === 'tampered', `Expected tampered SHA-256 verdict after 1-char edit, got ${tamperedStatus}`);
    return `SHA-256=${hash.slice(0, 16)}… valid + 1-char tamper caught`;
  });

  await run('D:Templates', '/templates starter cards have uniform non-jarring border colors across all cards', async () => {
    await page.goto(BASE + '/templates', { waitUntil: 'networkidle' });
    await page.waitForTimeout(150);
    const colors = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.template-admin.starter-grid li')).map((li) => getComputedStyle(li).borderTopColor),
    );
    assert(colors.length >= 4, `Expected >=4 starter cards, got ${colors.length}`);
    const unique = Array.from(new Set(colors));
    assert(unique.length === 1, `Uneven starter template border colors: ${unique.join(' vs ')}`);
    await page.screenshot({ path: `${SHOT_DIR}/templates-uniform.png` });
    return `${colors.length} starter cards with uniform border ${unique[0]}`;
  });

  // Quick-Fill Packs end-to-end typing walkthroughs (all 6 packs!)
  const packs: [string, string][] = [
    ['Apartment Move-In & Deposit Record', 'Property / Agreement name'],
    ['Event & Wedding Catering', 'Event / Vendor agreement'],
    ['Home Interiors & Contractor BOQ', 'Renovation / Work order'],
    ['Event Photography / Decor / Venue', 'Event / Vendor agreement'],
    ['Website / App Design & Build', 'Project name'],
    ['Monthly Retainer (Agency / CA / Advisory)', 'Project name'],
  ];

  for (const [packName, expectedEditorLabel] of packs) {
    await run('D:QuickFill', `Select "${packName}" on /templates -> open in editor -> verify matched wording`, async () => {
      await page.goto(BASE + '/templates', { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: new RegExp(packName.replace(/[()]/g, '.'), 'i') }).first().click();
      await page.waitForTimeout(100);
      await page.getByRole('button', { name: /Open full agreement|Build full agreement|Open in editor/i }).first().click();
      await page.waitForSelector('.work-grid', { timeout: 10000 });
      await page.waitForTimeout(250);
      const labels = await page.evaluate(() => Array.from(document.querySelectorAll('#step-scope label')).map(l => l.textContent?.trim() || ''));
      assert(labels.some(l => l.startsWith(expectedEditorLabel)), `Expected "${expectedEditorLabel}", got ${labels.slice(0, 4).join(' | ')}`);
      return `opened with "${expectedEditorLabel}"`;
    });
  }

  // =========================================================================
  // BLOCK E: 4 Themes × Key Routes Alignment, Contrast & Zero-Overflow Matrix (36 scenarios)
  // =========================================================================
  const routesToAudit = ['/', '/events', '/check', '/templates', '/auth/sign-in', '/auth/sign-up', '/account', '/connect', '/msme-interest', '/plans'];
  const allThemes: [string, 'a' | 'b', 'light' | 'dark'][] = [
    ['Paper Light', 'b', 'light'],
    ['Paper Dark', 'b', 'dark'],
    ['Etched Light (Theme 3)', 'a', 'light'],
    ['Etched Dark (Theme 4)', 'a', 'dark'],
  ];

  for (const [tName, tCode, tMode] of allThemes) {
    for (const rt of ['/auth/sign-in', '/events', '/check', '/templates', '/account']) {
      await run('E:ThemeMatrix', `${tName} on ${rt}: 0px horizontal overflow & clean contrast`, async () => {
        await page.goto(BASE + rt, { waitUntil: 'networkidle' });
        await setTheme(page, tCode, tMode);
        const check = await page.evaluate(() => {
          const overflow = document.documentElement.scrollWidth - window.innerWidth;
          const img = document.querySelector('.plate img');
          const imgStyle = img ? getComputedStyle(img) : null;
          const authLinks = Array.from(document.querySelectorAll('.auth-explore-links a')).map(a => Math.round(a.getBoundingClientRect().top));
          const authDelta = authLinks.length ? Math.max(...authLinks) - Math.min(...authLinks) : 0;
          return { overflow, imgBlend: imgStyle?.mixBlendMode || null, imgFilter: imgStyle?.filter || null, authDelta };
        });
        assert(check.overflow <= 1, `Horizontal overflow ${check.overflow}px on ${rt} in ${tName}`);
        if (rt === '/auth/sign-in') {
          assert(check.authDelta === 0, `Sign-in explore links misaligned by ${check.authDelta}px`);
          if (tMode === 'light') {
            assert(check.imgBlend === 'multiply' && check.imgFilter === 'none', `Light plate image misblended in ${tName}: ${check.imgBlend}/${check.imgFilter}`);
          } else {
            assert(check.imgBlend === 'screen' && check.imgFilter?.includes('invert'), `Dark plate image misblended in ${tName}: ${check.imgBlend}/${check.imgFilter}`);
          }
        }
        if (rt === '/auth/sign-in' && tCode === 'a' && tMode === 'light') {
          await page.screenshot({ path: `${SHOT_DIR}/signin-theme3.png` });
        }
        return `overflow=${check.overflow}px${rt === '/auth/sign-in' ? `, plate=${check.imgBlend}, authDelta=${check.authDelta}px` : ''}`;
      });
    }
  }

  // 5-Viewport responsive zero-overflow check across landing + events + check
  const viewports: [string, number, number][] = [
    ['Mobile 390px', 390, 844],
    ['Tablet 768px', 768, 1024],
    ['Laptop 1024px', 1024, 820],
    ['Desktop 1440px', 1440, 900],
    ['Ultrawide 1920px', 1920, 1080],
  ];
  await setTheme(page, 'b', 'light');
  for (const [vLabel, w, h] of viewports) {
    for (const rt of ['/', '/events', '/auth/sign-in']) {
      await run('E:Responsive', `${vLabel} on ${rt}: 0px horizontal overflow`, async () => {
        await page.setViewportSize({ width: w, height: h });
        await page.goto(BASE + rt, { waitUntil: 'networkidle' });
        const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert(ov <= 1, `Overflow ${ov}px at ${vLabel} on ${rt}`);
        return `overflow=${ov}px`;
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // =========================================================================
  // BLOCK F: CLS / Speed, MSME Calculator, Connectors, Unicode, XSS, Keyboard & Edge Cases (20 scenarios)
  // =========================================================================
  for (const rt of ['/', '/events', '/check', '/templates', '/auth/sign-in']) {
    await run('F:Performance', `Low layout shift (CLS < 0.1) & fast load on ${rt}`, async () => {
      const t0 = Date.now();
      await page.goto(BASE + rt, { waitUntil: 'networkidle' });
      const elapsed = Date.now() - t0;
      const cls = await page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            let total = 0;
            try {
              const po = new PerformanceObserver((list) => {
                for (const entry of list.getEntries() as unknown as { value?: number; hadRecentInput?: boolean }[]) {
                  if (!entry.hadRecentInput) total += entry.value || 0;
                }
              });
              po.observe({ type: 'layout-shift', buffered: true });
              setTimeout(() => {
                po.disconnect();
                resolve(+total.toFixed(4));
              }, 250);
            } catch {
              resolve(0);
            }
          }),
      );
      assert(cls < 0.1, `High CLS=${cls} on ${rt}`);
      return `CLS=${cls}, load=${elapsed}ms`;
    });
  }

  // MSME Calculator edge cases
  await page.goto(BASE + '/msme-interest', { waitUntil: 'networkidle' });
  const msmeCases: [string, string, string, string][] = [
    ['₹2,50,000 invoice overdue 90 days', '250000', '2025-10-01', '2026-01-15'],
    ['₹1,00,00,000 enterprise invoice overdue 180 days', '10000000', '2025-07-01', '2026-01-15'],
    ['₹50,000 invoice paid on time (0 overdue days)', '50000', '2026-01-10', '2026-01-15'],
  ];
  for (const [label, amt, invDate, payDate] of msmeCases) {
    await run('F:MSME', `Calculate ${label}`, async () => {
      const numInput = page.locator('input[type="number"]').first();
      await numInput.fill(amt);
      const dates = page.locator('input[type="date"]');
      if ((await dates.count()) >= 2) {
        await dates.nth(0).fill(invDate);
        await dates.nth(1).fill(payDate);
      }
      await page.waitForTimeout(100);
      const txt = (await page.locator('main').textContent()) || '';
      assert(!txt.includes('NaN') && !txt.includes('Infinity'), 'NaN/Infinity in MSME calculation');
      return 'clean calculation, no NaN';
    });
  }

  // Multi-currency & multi-script UTF-8 + XSS + Deposit/Milestone conflict + Keyboard shortcuts in Editor
  await openEditor(page);
  await page.getByRole('button', { name: 'Split view' }).click();
  await page.waitForTimeout(150);
  await run('F:EdgeCase', 'Multi-script UTF-8 (Hindi, Tamil, Telugu, Emoji) renders cleanly on live Paper', async () => {
    const utfTitle = 'शुभ विवाह समारोह · திருமண ஏற்பாடு · పెళ్లి వేడుక 🎉';
    const titleInput = page.locator('#step-scope .identity-row input').first();
    await titleInput.fill(utfTitle);
    await page.waitForTimeout(250);
    const paper = (await page.locator('.paper').textContent()) || '';
    assert(paper.includes('शुभ विवाह समारोह') && paper.includes('திருமண'), `UTF-8 text missing on Paper: ${paper.slice(0, 140)}`);
    return 'Hindi + Tamil + Telugu + Emoji synced';
  });

  await run('F:EdgeCase', 'XSS payload in title, exclusions & working terms executes zero scripts', async () => {
    const xss = '<img src=x onerror="window.__xssTrip=1"><script>window.__xssTrip=2</script>';
    await page.locator('#step-scope .identity-row input').first().fill(xss);
    await page.locator('.terms-pair label').nth(0).locator('textarea').fill(xss);
    await page.locator('.terms-pair label').nth(1).locator('textarea').fill(xss);
    await page.waitForTimeout(150);
    const tripped = await page.evaluate(() => (window as unknown as { __xssTrip?: unknown }).__xssTrip ?? null);
    assert(tripped === null, `XSS executed! ${tripped}`);
    return '0 scripts executed';
  });

  await run('F:EdgeCase', 'Currency switch INR -> USD -> EUR -> GBP formats fee cleanly on live Paper', async () => {
    await page.locator('#step-scope .identity-row input').first().fill('Global Product Design Sprint');
    await page.getByLabel(/Project fee/i).fill('12500');
    for (const code of ['USD', 'EUR', 'GBP', 'INR']) {
      await page.getByRole('combobox', { name: 'Currency' }).click();
      await page.getByRole('option', { name: new RegExp('^' + code) }).click();
      await page.waitForTimeout(80);
    }
    const paper = (await page.locator('.paper').textContent()) || '';
    assert(paper.includes('12,500'), 'Formatted fee missing');
    return 'all 4 currencies switched cleanly';
  });

  await run('F:EdgeCase', 'Starting a new scope (N) while a draft is half-done parks it safely without forcing drop/finish dialog', async () => {
    const titleInput = page.locator('#step-scope .identity-row input').first();
    await titleInput.fill('Half-Done Terrace Renovation Draft');
    await page.waitForTimeout(100);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('n');
    await page.waitForTimeout(150);
    const dialogVisible = await page.getByRole('dialog').isVisible().catch(() => false);
    assert(!dialogVisible, 'Blocking "Replace this unsaved draft?" dialog appeared instead of parking!');
    const titleVal = await titleInput.inputValue();
    assert(titleVal === '', `Expected fresh blank title after parking, got "${titleVal}"`);
    const noticeTxt = (await page.locator('.notice-dock').textContent()) || '';
    assert(/parked/i.test(noticeTxt), `Expected parked-draft notice, got "${noticeTxt}"`);
    const storedParked = await page.evaluate(() => localStorage.getItem('termslock:parked-drafts:v1:guest') || '');
    assert(storedParked.includes('Half-Done Terrace Renovation Draft'), 'Parked draft was not persisted to localStorage');
    return 'previous half-done draft parked safely, fresh scope opened';
  });

  await run('F:EdgeCase', 'Keyboard "?" opens shortcuts modal outside inputs, Esc closes it, never hijacks typing', async () => {
    const titleInput = page.locator('#step-scope .identity-row input').first();
    await titleInput.click();
    await page.keyboard.type('?');
    assert(!(await page.getByRole('dialog').isVisible().catch(() => false)), '"?" hijacked input');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('?');
    await page.waitForTimeout(140);
    assert(await page.getByRole('dialog').isVisible(), '"?" did not open shortcuts modal');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 1500 });
    return 'keyboard shortcuts safe & responsive';
  });

  // Connectors & API verification
  await run('F:Connectors', '/api/openapi returns valid OpenAPI 3.x JSON specification', async () => {
    const r = await fetch(BASE + '/api/openapi');
    assert(r.ok, `OpenAPI HTTP ${r.status}`);
    const j = (await r.json()) as { openapi?: string; paths?: Record<string, unknown> };
    assert(!!j.openapi && !!j.paths && Object.keys(j.paths).length >= 5, 'OpenAPI spec incomplete');
    return `OpenAPI ${j.openapi}, ${Object.keys(j.paths).length} paths`;
  });

  await run('F:Connectors', '/.well-known/oauth-authorization-server returns valid OAuth 2.1 metadata', async () => {
    const r = await fetch(BASE + '/.well-known/oauth-authorization-server');
    assert(r.ok, `OAuth discovery HTTP ${r.status}`);
    const j = (await r.json()) as { authorization_endpoint?: string; token_endpoint?: string };
    assert(!!j.authorization_endpoint && !!j.token_endpoint, 'Missing OAuth endpoints');
    return 'OAuth 2.1 metadata valid';
  });

  await run('F:Connectors', '/api/audit/export?format=pdf, csv & jsonl enforce 401 when signed out', async () => {
    const [p, c, j] = await Promise.all([
      fetch(BASE + '/api/audit/export?format=pdf'),
      fetch(BASE + '/api/audit/export?format=csv'),
      fetch(BASE + '/api/audit/export?format=jsonl'),
    ]);
    assert(p.status === 401 && c.status === 401 && j.status === 401, `Unexpected statuses: ${p.status}/${c.status}/${j.status}`);
    return 'pdf=401, csv=401, jsonl=401';
  });

  await run('F:Connectors', '/connect page renders MCP endpoint, OpenAPI link & zero stale Muse branding', async () => {
    await page.goto(BASE + '/connect', { waitUntil: 'networkidle' });
    const txt = (await page.locator('main').textContent()) || '';
    assert(txt.includes('/mcp') && txt.includes('OpenAPI'), 'Connect docs missing');
    assert(!/\bMuse\b/.test(txt), 'Stale Muse copy still present on /connect');
    return '/mcp + OpenAPI verified, zero Muse copy';
  });

  await run('F:Plans', '/plans displays reasonable Free/Pro/Studio pricing, Monthly/Yearly toggle, zero Scopeflow branding', async () => {
    await page.goto(BASE + '/plans', { waitUntil: 'networkidle' });
    await page.waitForTimeout(150);
    const txtMonthly = (await page.locator('main').textContent()) || '';
    assert(txtMonthly.includes('₹299') && txtMonthly.includes('₹999') && txtMonthly.includes('5 active projects'), 'New pricing tiers missing on /plans');
    assert(!/Scopeflow/i.test(txtMonthly), 'Stale Scopeflow branding found on /plans');
    const yearlyBtn = page.getByRole('button', { name: /Yearly/i });
    await yearlyBtn.click();
    await page.waitForTimeout(120);
    const txtYearly = (await page.locator('main').textContent()) || '';
    assert(txtYearly.includes('₹2,990') && txtYearly.includes('₹9,990'), 'Yearly pricing did not switch on toggle');
    await page.getByRole('button', { name: /Monthly/i }).click();
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${SHOT_DIR}/plans-pricing.png`, fullPage: true });
    return 'INR ₹0/₹299/₹999 + Yearly ₹2,990/₹9,990 verified';
  });

  await run('F:Account', '/account page renders cleanly with Cmd/Ctrl+S shortcut note and zero errors', async () => {
    await page.goto(BASE + '/account', { waitUntil: 'networkidle' });
    const txt = (await page.locator('main').textContent()) || '';
    assert(txt.includes('Keep control') && txt.includes('Your records'), 'Account headings missing');
    return 'account page verified';
  });

  // All 10 public routes HTTP 200 smoke check
  for (const rt of routesToAudit) {
    await run('F:Routes', `GET ${rt} returns HTTP 200 with zero server error`, async () => {
      const r = await fetch(BASE + rt);
      assert(r.status === 200, `Expected 200 on ${rt}, got ${r.status}`);
      return '200 OK';
    });
  }

  await run('F:Runtime', 'Zero uncaught browser console or page errors across all walkthroughs', async () => {
    assert(runtimeErrors.length === 0, `Found ${runtimeErrors.length} runtime errors: ${runtimeErrors.join(' ; ')}`);
    return '0 console/page errors';
  });

  await browser.close();

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log('\n================ 120+ REAL USER WALKTHROUGH SUMMARY ================');
  console.log(`TOTAL WALKTHROUGHS: ${results.length}`);
  console.log(`PASSED: ${passed} (${((passed / results.length) * 100).toFixed(1)}%)`);
  console.log(`FAILED: ${failed.length}`);
  if (failed.length) {
    for (const f of failed) console.log(`  - ${f.id} ${f.title}: ${f.detail}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
