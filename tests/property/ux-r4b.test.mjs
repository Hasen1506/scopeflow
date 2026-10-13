// UX round 4b (reaudit4.md): one line total for an item everywhere (R4-02), change-order unit prices kept as
// unit_price (R4-03), money tiles that never break mid-number at 390 (R4-04), and templates that keep the typed
// name, client and client email on every path (R4-05, R4-06). Seeded, no network.
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fc} from '../support/property.mjs';

const money = await import('../../lib/money.ts');
const E = await import('../../lib/editor.ts');
const {lintScope} = await import('../../lib/lint.ts');
const {semanticDiff, describeChange} = await import('../../lib/diff.ts');
const {formatMoney, scopeSchema, itemSchema, sample} = await import('../../lib/scope.ts');
const {computeAgreement, changeOrderSchema} = await import('../../lib/ledger.ts');
const {toMinor, fromMinor} = await import('../../lib/minor.ts');
const read = rel => readFileSync(new URL('../../' + rel, import.meta.url), 'utf8');

const CCY = ['INR', 'USD', 'JPY', 'BHD'];
// One item as the API, MCP or editor can store it: a legacy line total, a unit price, or unpriced.
const itemArb = ccy => fc.record({qty: fc.integer({min: 1, max: 50}), kind: fc.constantFrom('line', 'unit', 'none'), minor: fc.integer({min: 0, max: 2_000_000})})
  .map(({qty, kind, minor}) => {
    const amount = fromMinor(minor, ccy), base = {id: 'i' + Math.abs(minor % 9973) + '_' + qty, title: 'Item ' + qty, qty, unit: '', acceptance: ''};
    return kind === 'unit' ? {...base, price: null, unit_price: amount} : {...base, price: kind === 'line' ? amount : null};
  });
const scopeArb = fc.constantFrom(...CCY).chain(ccy => fc.record({ccy: fc.constant(ccy), items: fc.array(itemArb(ccy), {minLength: 1, maxLength: 8})}));
const sumMinor = (xs, ccy) => fromMinor(xs.reduce((a, x) => a + toMinor(x, ccy), 0), ccy);

test('R4-02: editor total = client page total = feeCheck = receipt lines, for any mix of line totals and unit prices', () => {
  fc.assert(fc.property(scopeArb, ({ccy, items}) => {
    const editor = money.itemsTotal(items, ccy);
    // The client page shows itemPriceView(i).line for each priced item (scope-document.tsx).
    const views = items.map(i => money.itemPriceView(i, ccy)).filter(Boolean);
    assert.equal(editor.total, sumMinor(views.map(v => v.line), ccy));
    assert.equal(editor.priced, views.length);
    assert.equal(editor.unpriced, items.length - views.length);
    const fc_ = money.feeCheck({fee: editor.total, currency: ccy, items, deliverables: ''});
    assert.equal(fc_.item_total, editor.total);
    // The receipt (and the version diff) print the same line total, plus "each" for a unit price.
    for (const i of items) {
      const v = money.itemPriceView(i, ccy), text = money.itemPriceText(i, ccy);
      if (!v) { assert.equal(text, ''); continue; }
      assert.ok(text.startsWith(' · ' + formatMoney(v.line, ccy)), text);
      assert.equal(text.includes('each'), v.each != null);
    }
    // The clarity check agrees: a fee equal to the line totals is no mismatch.
    const scope = {...sample, currency: ccy, fee: editor.total, deliverables: '', items};
    if (editor.unpriced === 0) assert.ok(!lintScope(scope).issues.some(x => x.rule === 'fee-mismatch'));
  }));
});

test('R4-02: the reaudit probe: {qty:12, unit_price:2500} reads ₹30,000 in the editor total, lint and receipt line', () => {
  const items = [{id: 'a', title: 'Brand guidelines', qty: 12, unit: 'pages', price: null, unit_price: 2500, acceptance: ''}, {id: 'b', title: 'Homepage', qty: 1, unit: '', price: 70000, acceptance: ''}];
  assert.deepEqual(money.itemsTotal(items, 'INR'), {total: 100000, priced: 2, unpriced: 0});
  assert.equal(money.itemPriceText(items[0], 'INR'), ` · ${formatMoney(30000, 'INR')} (${formatMoney(2500, 'INR')} each)`);
  const lint = lintScope({...sample, currency: 'INR', fee: 100000, deliverables: '', items});
  assert.ok(!lint.issues.some(x => x.rule === 'fee-mismatch'), 'no false fee mismatch');
  const off = lintScope({...sample, currency: 'INR', fee: 70000, deliverables: '', items});
  assert.ok(off.issues.some(x => x.rule === 'fee-mismatch' && x.message.includes(formatMoney(100000, 'INR'))));
});

test('R4-02: setting a line total clears the unit price and vice versa; switching keeps the money the same', () => {
  fc.assert(fc.property(scopeArb, ({ccy, items}) => {
    for (const i of items) {
      const line = E.withLinePrice(i, 5);
      assert.equal('unit_price' in line, false); assert.equal(line.price, 5);
      const unit = E.withUnitPrice(i, 7);
      assert.equal(unit.price, null); assert.equal(unit.unit_price, 7);
      assert.equal('unit_price' in E.withUnitPrice(i, null), false);
      const back = E.toLineTotal(i, ccy);
      assert.equal(money.lineTotal(back, ccy), money.lineTotal(i, ccy)); assert.equal('unit_price' in back, false);
      const per = E.toPerUnit(i, ccy);
      if (per) assert.equal(money.lineTotal(per, ccy), money.lineTotal(i, ccy));
      else assert.ok(i.unit_price == null && i.price != null && toMinor(i.price, ccy) % i.qty !== 0, 'only a total that does not divide by qty refuses');
    }
  }));
});

test('R4-02: a kept draft keeps its unit prices; the version diff compares line totals', () => {
  const d = E.normalizeDraft({...sample, items: [{id: 'a', title: 'Pages', qty: 12, unit: '', price: null, unit_price: 2500, acceptance: ''}]});
  assert.equal(d.items[0].unit_price, 2500);
  const base = {...sample, currency: 'INR', deliverables: ''};
  const legacy = {...base, items: [{id: 'a', title: 'Pages', qty: 12, unit: '', price: 30000, acceptance: ''}]};
  const unit = {...base, items: [{id: 'a', title: 'Pages', qty: 12, unit: '', price: null, unit_price: 2500, acceptance: ''}]};
  assert.deepEqual(semanticDiff(legacy, unit), [], 'same money, no price change');
  const dearer = {...base, items: [{...unit.items[0], unit_price: 3000}]};
  const [c] = semanticDiff(unit, dearer);
  assert.deepEqual(c.fields, ['price']);
  assert.equal(describeChange(c, 'INR'), `Changed: Pages (price ${formatMoney(30000, 'INR')} → ${formatMoney(36000, 'INR')})`);
  const added = semanticDiff({...base, items: []}, unit).find(x => x.kind === 'item_added');
  assert.match(describeChange(added, 'INR'), new RegExp(`${formatMoney(30000, 'INR').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

test('R4-02: the editor, change-order form, lint, diff and receipt read line totals through lib/money', () => {
  const ed = read('app/items-editor.tsx');
  assert.match(ed, /itemsTotal\(items, currency\)/);
  assert.doesNotMatch(ed, /i\.price \?\? 0/);
  assert.match(ed, /Price each \(\$\{currency\}\)/);
  // getByLabel('Unit') must find only the Unit field (e2e golden flow): no other label or name in a row says "unit".
  assert.doesNotMatch(ed.slice(ed.indexOf('function PriceField')), /aria-label=\{`[^`]*unit/i);
  assert.match(ed, /withUnitPrice\(item, unit\)/); assert.match(ed, /withLinePrice\(item, price\)/);
  assert.match(read('app/ledger-panel.tsx'), /itemsTotal\(add, cur\)\.total/);
  assert.match(read('lib/lint.ts'), /itemsTotal\(items, s\.currency\)/);
  assert.match(read('lib/receipt.ts'), /itemPriceText\(i, m\.content\.currency\)/);
  assert.doesNotMatch(read('lib/diff.ts'), /c\.item\.price|c\.before\.price/);
});

test('R4-03: 3 × ₹1,000 proposes ₹3,000 and the agreement shows ₹3,000 for that deliverable', () => {
  const co = {title: 'Extra pages', add_items: [{id: 'x1', title: 'Extra page', qty: 3, unit: 'pages', price: null, acceptance: ''}], fee_delta: 0};
  const priced = E.priceCoItems(co, new Map([['x1', 1000]]), 'INR');
  assert.equal(priced.fee_delta, 3000);
  assert.equal(priced.add_items[0].unit_price, 1000); assert.equal(priced.add_items[0].price, null);
  const payload = changeOrderSchema.parse(priced);
  const baseline = scopeSchema.parse({...sample, currency: 'INR', fee: 10000, deliverables: '', items: [{id: 'b', title: 'Homepage', qty: 1, unit: '', price: 10000, acceptance: ''}]});
  const entries = [{seq: 1, kind: 'change_order', baseline_version: 1, payload, created: '2026-10-13T10:00:00Z'}, {seq: 2, kind: 'settle', baseline_version: 1, payload: {ref_seq: 1, outcome: 'approved', signer: 'Client'}, created: '2026-10-13T11:00:00Z'}];
  const a = computeAgreement(baseline, 1, entries);
  assert.equal(a.fee, 13000);
  const page = a.items.find(i => i.id === 'x1');
  assert.equal(money.lineTotal(page, 'INR'), 3000, 'agreement line total');
  assert.equal(money.itemsTotal(a.items, 'INR').total, a.fee, 'the breakdown adds up to the fee');
});

test('R4-03: when every new item is priced, the line totals sum to fee_delta (any qty, any currency)', () => {
  fc.assert(fc.property(fc.constantFrom(...CCY), fc.array(fc.record({qty: fc.integer({min: 1, max: 40}), minor: fc.integer({min: 1, max: 500_000}), set: fc.boolean()}), {minLength: 1, maxLength: 6}), (ccy, rows) => {
    const add_items = rows.map((r, n) => ({id: 'n' + n, title: 'New ' + n, qty: r.qty, unit: '', price: r.set ? fromMinor(r.minor, ccy) : null, acceptance: ''}));
    const unit = new Map(rows.map((r, n) => [`n${n}`, fromMinor(r.minor, ccy)]));
    const co = E.priceCoItems({title: 'CO', add_items}, unit, ccy);
    assert.equal(co.fee_delta, money.itemsTotal(co.add_items, ccy).total);
    // A price the owner already set is a line total and is left as it is.
    co.add_items.forEach((i, n) => { if (rows[n].set) { assert.equal(i.price, fromMinor(rows[n].minor, ccy)); assert.equal(i.unit_price, undefined); } else assert.equal(i.unit_price, unit.get(i.id)); });
    // A fee change the owner typed is never overwritten.
    assert.equal(E.priceCoItems({title: 'CO', add_items, fee_delta: 1}, unit, ccy).fee_delta, 1);
  }));
});

test('R4-03: /share and the price radar write unit_price, never a unit value into price', () => {
  const share = read('app/share/share-client.tsx'), radar = read('lib/radar-server.ts');
  assert.match(share, /coFeeState\(fee, items, radar\.currency/); // R5-02: the fee follows the line totals via coFeeState
  assert.match(share, /withUnitPrice\(x, e\.target\.value === '' \? null : Number\(e\.target\.value\)\)/);
  assert.doesNotMatch(share, /setItem\(i, \{price:/);
  assert.match(share, /data-testid="co-unit-price"/);
  assert.match(radar, /priceCoItems\(co, new Map\(prices\.map\(p => \[p\.item_id, p\.unit_price\]\)\), currency\)/);
  assert.doesNotMatch(radar, /price: p\.unit_price/);
  // Price history suggests the price of one unit, not an earlier line total.
  assert.match(radar, /exactUnitPrice\(hit\.i, currency\)/);
});

test('R4-04: agreement money figures never break mid-number; a narrow card gives money tiles the full row', () => {
  const css = read('app/globals.css'), mod = read('app/review/[token]/client.module.css');
  const nowrap = css.match(/^([^{\n]*\.pay-fig[^{]*)\{white-space:nowrap;overflow-wrap:normal;word-break:normal\}/m);
  assert.ok(nowrap && nowrap[1].includes('.agreement-grid strong.money-fig'), 'money-fig in the visual #2 nowrap rule');
  assert.match(css, /@container \(max-width:419px\)\{\.agreement-grid:not\(:has\(>div:nth-child\(3\):last-child\)\)>div:has\(>\.money-fig\)\{grid-column:1\/-1\}\}/);
  assert.match(css, /@media \(max-width:420px\)\{\.agreement-grid:not\(:has\(>div:nth-child\(3\):last-child\)\)>div:has\(>\.money-fig\)\{grid-column:1\/-1\}\}/);
  assert.match(mod, /\.now dd\{white-space:normal;overflow-wrap:normal\}/);
  const ag = read('app/review/[token]/agreement.tsx');
  assert.match(ag, /<strong className="money-fig">\{formatMoney\(a\.fee, cur\)\}/);
  assert.match(ag, /<strong className="money-fig">\{formatMoney\(a\.goodwill_value, cur\)\}/);
  assert.match(ag, /const sign = \(n: number\) => fig\(\(n < 0 \? '−' : '\+'\) \+ fmt\(/, 'sign and figure are one nowrap span');
  assert.match(ag, /<span key=\{i\} className="whitespace-nowrap">\{figs\[Number\(p\)\]\}<\/span>/);
  assert.match(read('app/ledger-panel.tsx'), /<strong className="money-fig">\{formatMoney\(a\.fee, cur\)\}/);
  // Every money tile on the insights panel is marked (figures joined by " + " wrap between them only).
  const ins = read('app/insights-panel.tsx');
  assert.doesNotMatch(ins, /<strong>\{money\(/);
});

test('R4-05/R4-06: templates keep the typed name, client and client email (chip and /?template= alike)', () => {
  fc.assert(fc.property(fc.boolean(), fc.boolean(), fc.string(), fc.string(), fc.string(), (active, isSample, title, client, email) => {
    const k = E.templateKeep({active, isSample, draft: {title, client}, clientEmail: email});
    if (active || isSample) { assert.deepEqual(k, {}); return; }
    assert.equal(k.title, title.trim() ? title : undefined);
    assert.equal(k.client, client.trim() ? client : undefined);
    assert.equal(k.email, email.trim() ? email : undefined);
  }));
  const state = read('app/workspace/state.tsx'), editor = read('app/workspace/editor.tsx');
  // One keep for both paths: the default argument, so the ?template= effect's applyTemplate(id) keeps them too.
  assert.match(state, /async function applyTemplate\(id:string,keep=templateKeep\(\{active:!!active,isSample,draft,clientEmail\}\)\)/);
  assert.match(state, /const \{email,\.\.\.names\}=keep;setDraft\(\{[^;]*\.\.\.names\}\);if\(email\)setClientEmail\(email\);/);
  assert.match(state, /queueMicrotask\(\(\)=>\{void applyTemplate\(id\);/);
  assert.match(editor, /const pickTemplate=\(id:string\)=>\{void applyTemplate\(id\);\}/);
  assert.ok(Buffer.byteLength(state) < 48 * 1024, 'state.tsx stays inside the WS-09 module budget');
});

test('R4-02: item schema still takes either form (unchanged contract)', () => {
  assert.equal(itemSchema.parse({id: 'a', title: 'Logo', qty: 3, unit_price: 1000}).unit_price, 1000);
  assert.equal(itemSchema.parse({id: 'a', title: 'Logo', qty: 3, price: 3000}).price, 3000);
});

test('R4-09/R4-11: /share notify checkbox uses check-row; the template notice asks for the client only when none was kept', () => {
  const share = read('app/share/share-client.tsx'), state = read('app/workspace/state.tsx');
  assert.match(share, /<label className="check-row">[^]*?<input type="checkbox" checked=\{canEmail \? data\.notify_client : false\}[^]*?<span>Email the client when I propose a change order or issue an invoice<\/span><\/label>/);
  assert.match(state, /Edit it freely; set \$\{names\.client\?'the':'the client,'\} price and exact quantities before saving\./);
});
