// WS-01: scope money validation (M5, LT-07 support) and unit prices (M6). Pure.
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fc} from '../support/property.mjs';

const S = await import('../../lib/scope.ts');
const {feeCheck, lineTotal, coDisplay} = await import('../../lib/money.ts');
const base = {title: 'Validation fixture', client: 'Acme', deliverables: 'Some work', exclusions: '', fee: 1000, currency: 'INR', revisions: 2, due: '', notes: ''};
const issues = r => (r.success ? [] : S.fieldIssues(r.error));

// @covers M5
test('M5 regression: fee 100.0049 INR → "Use at most 2 decimals"; JPY fee 10.5 refused', () => {
  const r = S.scopeSchema.safeParse({...base, fee: 100.0049});
  assert.equal(r.success, false);
  assert.deepEqual(issues(r).map(i => [i.key, i.label, i.message]), [['fee', 'Fee', 'Use at most 2 decimals']]);
  const jpy = S.scopeSchema.safeParse({...base, currency: 'JPY', fee: 10.5});
  assert.equal(jpy.success, false);
  assert.deepEqual(issues(jpy).map(i => [i.key, i.message]), [['fee', 'Use whole amounts: JPY has no decimals']]);
  assert.equal(S.scopeSchema.safeParse({...base, currency: 'JPY', fee: 10}).success, true);
  assert.equal(S.scopeSchema.safeParse({...base, fee: 100.01}).success, true);
  assert.equal(S.scopeSchema.safeParse({...base, fee: 0.1 + 0.2}).success, false, '0.30000000000000004 has more than 2 decimals');
  // Item prices, unit prices and a money revision bank follow the same rule, with field paths.
  const items = [{id: 'i1', title: 'Pages', qty: 2, unit: '', price: 10.555, acceptance: ''}, {id: 'i2', title: 'Posts', qty: 3, unit: '', price: null, acceptance: '', unit_price: 5.001}];
  const r2 = S.scopeSchema.safeParse({...base, deliverables: '', items, revision_bank: {unit: 'money', amount: 50.123}});
  assert.deepEqual(issues(r2).map(i => [i.key, i.label]), [['items.0.price', 'Item 1 price'], ['items.1.unit_price', 'Item 2 price each'], ['revision_bank.amount', 'Revision bank amount']]);
});

// @covers M5
test('M5 regression: change-order fee_delta 7500.505 is refused (helper WS-05 wires into checkEntry)', () => {
  assert.deepEqual(S.changeOrderMoneyProblems({fee_delta: 7500.505}, 'INR'), [[['fee_delta'], 'Use at most 2 decimals']]);
  assert.deepEqual(S.changeOrderMoneyProblems({fee_delta: 7500.5}, 'INR'), []);
  assert.deepEqual(S.changeOrderMoneyProblems({fee_delta: -10.5, add_items: [{price: 1.5}]}, 'JPY').map(p => p[0].join('.')), ['fee_delta', 'add_items.0.price']);
});

// @covers M5 LT-07
test('M5 property: decimals are judged exactly; negatives and huge values carry field messages', () => {
  fc.assert(fc.property(fc.integer({min: 0, max: 1_000_000_000}), fc.integer({min: 3, max: 6}), (n, d) => {
    const v = n / 10 ** d;
    const ok = S.scopeSchema.safeParse({...base, fee: v}).success;
    assert.equal(ok, /^\d+(\.\d{1,2})?$/.test(String(v)), String(v));
  }), {numRuns: 300});
  assert.deepEqual(issues(S.scopeSchema.safeParse({...base, fee: -1})).map(i => i.message), ["The fee can't be negative"]);
  assert.deepEqual(issues(S.scopeSchema.safeParse({...base, deliverables: '', items: [{id: 'i1', title: 'Pages', price: -500}]})).map(i => [i.label, i.message]), [['Item 1 price', "Price can't be negative"]]);
  assert.equal(S.scopeSchema.safeParse({...base, fee: 99_999_999_999}).success, false);
  assert.equal(S.MAX_AMOUNT, 10_000_000);
  assert.equal(S.fieldLabel(['milestones', 0, 'pct']), 'Milestone 1 share');
  assert.equal(S.fieldLabel(['fx', 'as_of']), 'Second currency rate date');
});

// @covers M6
test('M6 regression: 12 pages @ unit_price 600 → line 7,200; feeCheck flags a fee of 600', () => {
  const item = {id: 'i_guide', title: 'Brand guidelines', qty: 12, unit: 'pages', price: null, acceptance: '', unit_price: 600};
  assert.equal(lineTotal(item, 'USD'), 7200);
  const parsed = S.scopeSchema.parse({...base, currency: 'USD', fee: 600, deliverables: '', items: [item]});
  const check = feeCheck(parsed);
  assert.equal(check.status, 'over'); assert.equal(check.item_total, 7200);
  assert.match(check.message, /\$7,200\.00, which is \$6,600\.00 more than the fee of \$600\.00/);
  assert.equal(feeCheck({...parsed, fee: 7200}).status, 'match');
  // Legacy `price` stays the line total (qty ignored), as signed.
  assert.equal(lineTotal({qty: 12, price: 600}, 'USD'), 600);
  assert.equal(S.scopeSchema.safeParse({...base, deliverables: '', items: [{...item, qty: 10000, unit_price: 5000}]}).success, false, 'line total over the limit');
});

// @covers M6
test('golden M6: the signed scope-v1 golden content hash is unchanged (unit_price omitted when unset)', () => {
  const golden = JSON.parse(readFileSync(new URL('../golden/receipt.golden.json', import.meta.url), 'utf8'));
  const content = S.scopeSchema.parse({...S.sample, due: '2026-12-15'});
  assert.equal(createHash('sha256').update(JSON.stringify(content)).digest('hex'), golden.content_sha256);
  for (const i of content.items) assert.ok(!('unit_price' in i));
  const withUnit = S.scopeSchema.parse({...S.sample, items: S.sample.items.map(i => i.id === 'i_guide' ? {...i, unit_price: 50} : i)});
  assert.equal(withUnit.items.find(i => i.id === 'i_guide').unit_price, 50, 'kept when set');
});

// Support for WS-03 (M7) / WS-07: one helper for how change-order money reads.
test('coDisplay: change-order money with tax at the agreement rate', () => {
  assert.equal(coDisplay({fee: 0, currency: 'INR', tax_pct: 18, tax_label: 'GST'}, 10000).text, '+₹10,000.00 + GST ₹1,800.00 = +₹11,800.00');
  assert.equal(coDisplay({fee: 0, currency: 'INR'}, -2500).text, '−₹2,500.00');
  assert.deepEqual(coDisplay({fee: 0, currency: 'INR', tax_pct: 18}, 7500.5), {delta: 750050, tax: 135009, total: 885059, text: '+₹7,500.50 + Tax ₹1,350.09 = +₹8,850.59'});
});
