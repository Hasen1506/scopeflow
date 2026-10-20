// UX round 5 (reaudit 5): paper-safe text in every CSS module (R5-01), a /share change-order fee that follows the
// items until the owner types one and asks before proposing a different fee (R5-02), the deliverable title at 390
// (R5-03), huge amounts that never crash the workspace (R5-04), the unsaved draft's client email kept across
// /templates → Use template (R5-05), and the polish items. Seeded, no network, no browser.
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {fc} from '../support/property.mjs';

const T = await import('../../lib/theme.ts');
const money = await import('../../lib/money.ts');
const E = await import('../../lib/editor.ts');
const A = await import('../../lib/a11y.ts');
const {formatMoney} = await import('../../lib/scope.ts');
const {toMinor, fromMinor} = await import('../../lib/minor.ts');
const read = rel => readFileSync(new URL('../../' + rel, import.meta.url), 'utf8');

// ---- R5-01: text on --paper ------------------------------------------------------------------------------------
const strip = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
const css = strip(read('app/globals.css'));
const blocks = src => [...src.matchAll(/(^|\n|\})\s*([^{}\n@][^{}]*?)\s*\{([^{}]*)\}/g)].map(m => ({sel: m[2].trim(), body: m[3]}));
const props = body => Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)].map(m => [m[1], m[2].trim()]));
const pick = sel => Object.assign({}, ...blocks(css).filter(x => x.sel === sel).map(x => props(x.body)));
const BASE = pick(':root');
const A_LIGHT = ':root[data-theme="a"],:root:not([data-theme])';
const COMBOS = {
  'B light': [], 'B dark': [':root[data-scheme="dark"]'], 'A light': [A_LIGHT],
  'A dark': [A_LIGHT, ':root[data-scheme="dark"]', ':root[data-theme="a"][data-scheme="dark"]'],
};
const tokensFor = name => Object.assign({}, BASE, ...COMBOS[name].map(pick));
function color(t, name, seen = new Set()) {
  const v = t[name]; assert.ok(v, `${name} defined`);
  const ref = v.match(/^var\((--[\w-]+)\)$/);
  if (ref) { assert.ok(!seen.has(ref[1])); seen.add(ref[1]); return color(t, ref[1], seen); }
  const c = T.parseColor(v); assert.ok(c, `${name}: ${v}`); return c;
}
const ratio = (t, fg, bg) => { const page = color(t, '--bg'), back = T.over(color(t, bg), page); return T.contrastRatio(T.over(color(t, fg), back), back); };
const modules = (dir = 'app', out = []) => {
  for (const f of readdirSync(new URL('../../' + dir, import.meta.url))) {
    const rel = dir + '/' + f, st = statSync(new URL('../../' + rel, import.meta.url));
    if (st.isDirectory()) modules(rel, out); else if (f.endsWith('.module.css')) out.push(rel);
  }
  return out;
};
const decl = (body, prop) => body.match(new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*var\\((--[\\w-]+)\\)`))?.[1];
const PAPER_SAFE = new Set(['--paper-ink', '--paper-ink-2', '--paper-accent']);

test('R5-01: every CSS module rule on background var(--paper) sets a paper-safe text colour', () => {
  const files = modules(), bad = [];
  assert.ok(files.length > 10, 'modules found');
  for (const f of files) for (const b of blocks(strip(read(f)))) {
    if ((decl(b.body, 'background') ?? decl(b.body, 'background-color')) !== '--paper') continue;
    const fg = decl(b.body, 'color');
    if (!fg || !PAPER_SAFE.has(fg)) bad.push(`${f} ${b.sel}: color ${fg ?? '(inherited app ink)'} on --paper`);
  }
  assert.deepEqual(bad, []);
});

test('R5-01: every CSS module text/background token pair is >= 4.5:1 in all four themes', () => {
  const bad = [];
  for (const f of modules()) for (const b of blocks(strip(read(f)))) {
    const fg = decl(b.body, 'color'), bg = decl(b.body, 'background') ?? decl(b.body, 'background-color');
    if (!fg || !bg || !/^--(ink|paper|surface|accent|ok|warn|bad|info|on-|muted|card|popover|bg)/.test(bg)) continue;
    for (const name of Object.keys(COMBOS)) {
      const t = tokensFor(name); if (!t[fg] || !t[bg]) continue;
      const r = ratio(t, fg, bg); if (r < 4.5) bad.push(`${name} ${f} ${b.sel}: ${fg} on ${bg} ${r.toFixed(2)}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('R5-01: the reaudit cases: /share quote and fields, identity panels, evidence box, ws-05 totals, clause, WhatsApp text', () => {
  assert.match(read('app/share/share.module.css'), /\.quote \{[^}]*background: var\(--paper\); color: var\(--paper-ink\)/);
  assert.match(read('app/share/share.module.css'), /\.field input, \.field textarea \{[^}]*color: var\(--paper-ink\); background: var\(--paper\)/);
  assert.match(read('app/components/evidence/identity-slots.module.css'), /\.panel \{[^}]*background: var\(--surface\)/);
  assert.match(read('app/components/evidence/record-evidence.module.css'), /\.box \{[^}]*background: var\(--surface\)/);
  assert.match(read('app/components/ws-05/ws-05.module.css'), /\.totals > div \{[^}]*background: var\(--surface-2\)/);
  assert.match(read('app/components/ws03-slots.module.css'), /\.clause \{[^}]*color: var\(--paper-ink\); background: var\(--paper\)/);
  assert.match(read('app/components/slots/whatsapp-share.module.css'), /\.text \{[^}]*color: var\(--paper-ink\); background: var\(--paper\)/);
  // Theme A light is where it broke: cream --ink on cream --paper.
  const a = tokensFor('A light');
  assert.ok(ratio(a, '--ink', '--paper') < 1.5, 'premise: --ink on --paper is unreadable in A light');
  for (const name of Object.keys(COMBOS)) assert.ok(ratio(tokensFor(name), '--paper-ink', '--paper') >= 4.5, name);
});

// ---- R5-02: the /share change-order fee -----------------------------------------------------------------------
const CCY = ['INR', 'USD', 'JPY', 'BHD'];
const itemArb = ccy => fc.record({qty: fc.integer({min: 1, max: 40}), unit: fc.boolean(), minor: fc.integer({min: 0, max: 5_000_000}), priced: fc.boolean()})
  .map(({qty, unit, minor, priced}) => { const amount = fromMinor(minor, ccy), base = {qty, price: null};
    return !priced ? base : unit ? {...base, unit_price: amount} : {...base, price: amount}; });

test('R5-02: until the owner types a fee it is the items total; a typed fee is kept as typed', () => {
  fc.assert(fc.property(fc.constantFrom(...CCY).chain(ccy => fc.record({ccy: fc.constant(ccy), items: fc.array(itemArb(ccy), {minLength: 1, maxLength: 6}), suggested: fc.integer({min: 0, max: 900000}), typed: fc.integer({min: -500000, max: 5_000_000})})),
    ({ccy, items, suggested, typed}) => {
      const t = money.itemsTotal(items, ccy), s = money.coFeeState('', items, ccy, {suggested});
      assert.equal(s.following, true);
      assert.equal(s.fee, t.priced ? t.total : suggested, 'follows the items (radar suggestion only while nothing is priced)');
      assert.equal(s.mismatch, false, 'a following fee never needs confirming');
      const typedAmount = fromMinor(typed, ccy), u = money.coFeeState(String(typedAmount), items, ccy, {suggested});
      assert.equal(u.following, false); assert.equal(u.fee, typedAmount);
      assert.equal(u.mismatch, t.priced > 0 && toMinor(typedAmount, ccy) !== toMinor(t.total, ccy));
      if (u.mismatch) { assert.ok(u.message.includes(formatMoney(typedAmount, ccy))); assert.ok(u.message.includes(formatMoney(t.total, ccy))); }
      else assert.equal(u.message, null);
    }));
});

test('R5-02: the reaudit probe: items change after the radar suggestion and the fee follows them', () => {
  const before = [{qty: 1, price: null, unit_price: 5000}], after = [{qty: 3, price: null, unit_price: 5000}];
  assert.equal(money.coFeeState('', before, 'INR', {suggested: 5000}).fee, 5000);
  assert.equal(money.coFeeState('', after, 'INR', {suggested: 5000}).fee, 15000, 'qty 3 → fee 15,000, not the stale 5,000');
  const typed = money.coFeeState('12000', after, 'INR', {tax_pct: 18});
  assert.equal(typed.mismatch, true); assert.equal(typed.with_tax, 14160);
  assert.equal(money.coFeeState('15000.00', after, 'INR').mismatch, false, 'same amount in minor units');
  // Never throws, whatever is typed.
  for (const v of ['1e400', 'abc', '-', '1e20']) assert.doesNotThrow(() => money.coFeeState(v, after, 'INR', {tax_pct: 18}));
  assert.equal(money.coFeeState('1e400', after, 'INR').mismatch, true);
});

test('R5-02: /share starts the fee empty (following), warns on a different fee and needs a confirmation to propose', () => {
  const share = read('app/share/share-client.tsx');
  assert.match(share, /const \[fee, setFee\] = useState\(''\)/);
  assert.doesNotMatch(share, /useState<string>\(co\.fee_delta/);
  assert.match(share, /coFeeState\(fee, items, radar\.currency, \{suggested: co\.fee_delta/);
  const propose = share.slice(share.indexOf('async function propose()'));
  assert.ok(propose.indexOf('feeState.mismatch && !confirmed') < propose.indexOf('await api('), 'checked before anything is sent');
  assert.match(share, /data-testid="co-fee-warn"/);
  assert.match(share, /data-testid="co-fee-confirm"/);
  assert.match(share, /Use the items total/);
  // The confirmation is for one fee and one items total only.
  assert.match(share, /mismatchKey = feeState\.mismatch \? `\$\{fee\}\|\$\{feeState\.items_total\}` : ''/);
});

// ---- R5-03: deliverable title at 390 --------------------------------------------------------------------------
test('R5-03: at <= 600px the item row wraps so the title input takes the full first line', () => {
  const m = css.match(/@media \(max-width:600px\)\{\.item-main\{flex-wrap:wrap\}\.item-main>input\{flex:1 1 calc\(100% - 34px\);min-width:0\}\.item-tools\{flex:1 0 100%;justify-content:flex-end\}\}/);
  assert.ok(m, 'phone rule for .item-main');
});

// ---- R5-04: huge amounts --------------------------------------------------------------------------------------
const wild = fc.oneof(fc.double({noNaN: false}), fc.constantFrom(1e400, -1e400, 1e20, 1e15, 9007199254740993, NaN, 0.1, 1.005), fc.integer());
test('R5-04: feeCheck, itemsTotal and computable never throw, whatever is typed', () => {
  fc.assert(fc.property(fc.constantFrom(...CCY), fc.array(fc.record({qty: fc.oneof(fc.integer({min: 1, max: 10000}), fc.constantFrom(1.5, NaN)), price: fc.option(wild), unit_price: fc.option(wild, {nil: undefined})}), {maxLength: 5}), wild, fc.option(wild, {nil: undefined}),
    (currency, raw, fee, tax_pct) => {
      const items = raw.map((r, n) => ({id: 'i' + n, title: 'Item', unit: '', acceptance: '', ...r}));
      const s = {fee, currency, items, deliverables: '', tax_pct, tax_label: 'GST', deposit_pct: 30};
      assert.doesNotThrow(() => money.feeCheck(s));
      assert.doesNotThrow(() => money.itemsTotal(items, currency));
      const c = money.computable(s);
      // What the live preview renders from it.
      assert.doesNotThrow(() => money.totals(c));
      for (const i of c.items) assert.doesNotThrow(() => money.itemPriceView(i, currency));
      // Values that compute pass through untouched.
      if (Number.isFinite(fee) && Math.abs(fee) < 1e6 && (tax_pct == null || (tax_pct >= 0 && tax_pct <= 100))) assert.equal(c.fee, fee);
    }));
});

test('R5-04: the reaudit probe: 1e400 / 1e20 prices and a 10,000 × 1e14 unit price leave the editor rendering', () => {
  const it = x => ({id: 'a', title: 'Thing', unit: '', acceptance: '', qty: 1, price: null, ...x});
  for (const items of [[it({price: 1e20})], [it({qty: 10000, unit_price: 1e14})], [it({qty: 1.5, unit_price: 100.01})], [it({price: Infinity})]]) {
    assert.equal(money.feeCheck({fee: 100, currency: 'INR', items, deliverables: ''}).status, 'none');
    const c = money.computable({fee: 100, currency: 'INR', items, tax_pct: 18, deposit_pct: 0, tax_label: 'GST'});
    assert.equal(c.items[0].price, null); assert.equal(c.items[0].unit_price, undefined);
  }
  assert.equal(money.computable({fee: 1e20, currency: 'INR', items: []}).fee, 0);
  assert.equal(E.amountProblem(Infinity, 'INR', 'Price each'), `Max ${E.maxAmountLabel('INR')}`);
  assert.equal(E.amountProblem(1e20, 'INR', 'Price each'), `Max ${E.maxAmountLabel('INR')}`);
  // The preview and the milestones editor render the computable copy; the price field keeps what was typed.
  assert.match(read('app/workspace/project-body.tsx'), /<Paper scope=\{computable\(preview\)\}/);
  assert.match(read('app/terms-editor.tsx'), /totals\(computable\(scope\)\)/);
  assert.match(read('app/items-editor.tsx'), /value=\{raw\}/);
});

test('R5-04: app/workspace/state.tsx stays under 48 KiB', () => {
  assert.ok(Buffer.byteLength(read('app/workspace/state.tsx')) < 49152);
});

// ---- R5-05: the unsaved draft's client email -------------------------------------------------------------------
const memory = () => { const m = new Map(); return {getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m}; };
test('R5-05: the client email of an unsaved draft is kept in this tab for the same account', () => {
  fc.assert(fc.property(fc.emailAddress(), fc.option(fc.string({minLength: 1, maxLength: 12}), {nil: null}), (email, account) => {
    const s = memory(), now = 1_800_000_000_000;
    E.writeDraftEmail(() => s, account, email, now);
    assert.equal(E.readDraftEmail(() => s, account, now + 1000), email);
    assert.equal(E.readDraftEmail(() => s, account === null ? 'other' : null, now), '', 'never another account’s');
    assert.equal(E.readDraftEmail(() => s, account, now + 15 * 86400_000), '', 'stale');
    E.writeDraftEmail(() => s, account, '  ', now);
    assert.equal(s.m.size, 0, 'an empty email removes it');
  }));
  assert.ok(E.DRAFT_EMAIL_KEY.startsWith(E.DRAFT_PREFIX), 'cleared with the drafts on sign-out');
  assert.equal(E.readDraftEmail(() => { throw new Error('denied'); }, null), '');
  assert.doesNotThrow(() => E.writeDraftEmail(() => { throw new Error('denied'); }, null, 'a@b.c'));
  const state = read('app/workspace/state.tsx');
  assert.match(state, /writeDraftEmail\(\(\)=>sessionStorage,account,clientEmail\)/);
  assert.match(state, /readDraftEmail\(\(\)=>sessionStorage,who\)/);
});

// ---- Polish ---------------------------------------------------------------------------------------------------
test('polish: /share amounts use the currency minor unit, not 2 decimals', () => {
  assert.equal(money.amountStep('JPY'), '1'); assert.equal(money.amountStep('INR'), '0.01'); assert.equal(money.amountStep('BHD'), '0.001');
  assert.equal(money.unitFromLine(1000, 3, 'JPY'), 333);
  assert.equal(money.unitFromLine(10, 3, 'BHD'), 3.333);
  assert.equal(money.unitFromLine(100, 3, 'INR'), 33.33);
  const share = read('app/share/share-client.tsx');
  assert.doesNotMatch(share, /\* 100\) \/ 100/);
  assert.doesNotMatch(share, /step="0\.01"/);
});

test('polish: the "confirm you reviewed" error clears when the box is ticked', () => {
  assert.equal(A.afterConsent('Confirm X', 'Confirm X', true), '');
  assert.equal(A.afterConsent('Confirm X', 'Confirm X', false), 'Confirm X');
  assert.equal(A.afterConsent('Enter your name', 'Confirm X', true), 'Enter your name');
  for (const f of ['app/review/[token]/review.tsx', 'app/review/[token]/agreement.tsx', 'app/review/[token]/countersign.tsx', 'app/components/slots/co-card.tsx']) assert.match(read(f), /afterConsent\(/, f);
});

test('polish: the "Price each" note and its link never run together; errors say "Price each"', () => {
  assert.match(css, /\.price-cell \.price-mode\{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 10px/);
  const ed = read('app/items-editor.tsx');
  assert.doesNotMatch(ed, /fine block price-mode/);
  assert.doesNotMatch(ed, /'Unit price'/);
  assert.doesNotMatch(read('app/share/share-client.tsx'), /Unit price \(/);
  assert.equal(E.humanIssue({path: ['items', 1, 'unit_price'], code: 'too_small', type: 'number', minimum: 0, message: ''}), 'Deliverable 2 price each: can’t be negative');
});

test('polish: the Stripe "Also take INR" and WhatsApp consent boxes sit beside their text', () => {
  assert.match(read('app/components/slots/payment-settings.tsx'), /<label className="check-row">[^]*?checked=\{st\.include_inr\}/);
  assert.match(read('app/whatsapp-settings.tsx'), /<label className="check-row fine">[^]*?checked=\{consent\}/);
});
