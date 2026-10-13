// WS-01: place of supply by recipient location (H13) and the per-head GST engine (M1, M2). Pure.
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fc} from '../support/property.mjs';

const G = await import('../../lib/gst.ts');
const {agreementTotals} = await import('../../lib/agreement-totals.ts');
const {scopeSchema} = await import('../../lib/scope.ts');
const {approve, append} = await import('../support/chain.mjs');
const {tick} = await import('../support/property.mjs');

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'JPY', 'AED'];
const states = Object.keys(G.GST_STATES).filter(s => s !== G.EXPORT_STATE);

// @covers H13
test('H13 regression: an Indian client (IN, Tamil Nadu) billed in USD by a Tamil Nadu seller is CGST + SGST, not an export', () => {
  const pos = G.placeOfSupply({seller_state: '33', client_country: 'IN', client_state: '33', currency: 'USD'});
  assert.equal(pos.supply, 'intra'); assert.equal(pos.code, '33'); assert.equal(pos.zero_rated, false);
  const b = G.gstFromExclusive(2500000, 18, pos.supply);
  assert.deepEqual(b.heads.map(h => [h.name, h.amount]), [['CGST', 225000], ['SGST', 225000]]);
  // No state on record: still not an export because of the currency (5e59e44 made this an export).
  const noState = G.placeOfSupply({seller_state: '33', client_country: 'IN', currency: 'USD'});
  assert.equal(noState.supply, 'intra'); assert.equal(noState.code, '33'); assert.equal(noState.basis, 'supplier');
  const unknown = G.placeOfSupply({seller_state: '33', currency: 'USD'});
  assert.notEqual(unknown.code, G.EXPORT_STATE); assert.equal(unknown.supply, 'intra');
  assert.deepEqual(unknown.warnings, [G.CURRENCY_NOT_LOCATION_WARNING]);
});

// @covers H13
test('H13 regression: a US client billed in INR without forex confirmation gets a warning and is not zero-rated', () => {
  const pos = G.placeOfSupply({seller_state: '33', client_country: 'US', currency: 'INR'});
  assert.equal(pos.zero_rated, false); assert.notEqual(pos.supply, 'export'); assert.equal(pos.supply, 'inter');
  assert.deepEqual(pos.warnings, [G.NOT_EXPORT_WARNING]);
  assert.deepEqual(G.gstFromExclusive(100000, 18, pos.supply).heads.map(h => [h.name, h.amount]), [['IGST', 18000]]);
  // State 96 ("outside India") in INR is not auto-export either.
  const s96 = G.placeOfSupply({seller_state: '33', client_state: G.EXPORT_STATE, currency: 'INR'});
  assert.equal(s96.zero_rated, false); assert.equal(s96.supply, 'inter');
  // With the owner's confirmation it is a zero-rated export, with the LUT/bond note.
  const ok = G.placeOfSupply({seller_state: '33', client_country: 'US', currency: 'INR', forex_confirmed: true});
  assert.deepEqual([ok.supply, ok.zero_rated, ok.code, ok.basis], ['export', true, G.EXPORT_STATE, 'export']);
  assert.match(ok.warnings[0], /Letter of Undertaking \(LUT\) or bond/);
  assert.deepEqual(G.gstFromExclusive(100000, 0, 'export'), {taxable: 100000, heads: [], round_off: 0, total: 100000});
  // A registered recipient's GSTIN still wins.
  assert.deepEqual(G.placeOfSupply({seller_state: '33', client_gstin: '29AAGCB7383J1Z4', client_country: 'IN', currency: 'USD'}).code, '29');
});

// @covers H13
test('H13 property: the supply type is invariant under a change of currency', () => {
  fc.assert(fc.property(
    fc.constantFrom(...states), fc.option(fc.constantFrom(...states, G.EXPORT_STATE), {nil: undefined}),
    fc.option(fc.constantFrom('IN', 'US', 'GB', 'AE', 'SG'), {nil: undefined}), fc.boolean(),
    fc.option(fc.constantFrom('', '29AAGCB7383J1Z4', '27AAPFU0939F1ZV'), {nil: undefined}),
    fc.constantFrom(...CURRENCIES), fc.constantFrom(...CURRENCIES),
    (seller_state, client_state, client_country, forex_confirmed, client_gstin, a, b) => {
      const p = {seller_state, client_state, client_country, forex_confirmed, client_gstin};
      const x = G.placeOfSupply({...p, currency: a}), y = G.placeOfSupply({...p, currency: b});
      assert.deepEqual([x.supply, x.code, x.zero_rated], [y.supply, y.code, y.zero_rated]);
    }), {numRuns: 500});
});

// @covers M1
test('M1 property: every head is within half a paisa of rate × taxable, and total − round_off == taxable + Σ heads', () => {
  const rates = fc.constantFrom(0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 12, 18, 28, 40);
  fc.assert(fc.property(fc.integer({min: 0, max: 10_000_000_000}), rates, fc.constantFrom('intra', 'inter', 'export', 'none'), fc.boolean(), (amount, rate, supply, inclusive) => {
    const b = inclusive ? G.gstFromInclusive(amount, rate, supply) : G.gstFromExclusive(amount, rate, supply);
    const sum = b.heads.reduce((s, h) => s + h.amount, 0);
    assert.equal(b.total - b.round_off, b.taxable + sum);
    if (inclusive) assert.equal(b.total, amount); else { assert.equal(b.taxable, amount); assert.equal(b.round_off, 0); }
    for (const h of b.heads) {
      // |head − head_rate × taxable| < 0.5 paise, checked exactly with integers (rates have ≤ 3 decimals).
      const exactTimes200k = BigInt(b.taxable) * BigInt(Math.round(h.rate * 1000)) * 2n; // 2 × taxable × rate × 1000
      const diff = BigInt(h.amount) * 200000n - exactTimes200k;
      assert.ok((diff < 0n ? -diff : diff) <= 100000n, `${h.name} ${h.amount} on ${b.taxable} @ ${h.rate}`);
    }
    if (inclusive && rate > 0) assert.ok(Math.abs(b.round_off) <= 2, `round-off ${b.round_off}`);
  }), {numRuns: 1000});
});

// @covers M2
test('M2 regression: ₹100 inclusive intra-state → CGST 7.63 == SGST 7.63 (the live test had 7.63/7.62)', () => {
  const legacy = G.gstSplit(15.25, '33', '33');
  assert.deepEqual([legacy.cgst, legacy.sgst], [7.63, 7.62], 'the 5e59e44 split, kept for already-issued invoices');
  const b = G.gstFromInclusive(10000, 18, 'intra');
  assert.equal(b.heads[0].amount, 763); assert.equal(b.heads[1].amount, 763);
  assert.equal(b.heads[0].amount, b.heads[1].amount);
});

// @covers M2
test('M2 property: cgst_minor == sgst_minor for all intra-state inputs', () => {
  fc.assert(fc.property(fc.integer({min: 0, max: 10_000_000_000}), fc.integer({min: 0, max: 40_000}).map(x => x / 1000), fc.boolean(), (amount, rate, inclusive) => {
    const b = inclusive ? G.gstFromInclusive(amount, rate, 'intra') : G.gstFromExclusive(amount, rate, 'intra');
    assert.equal(b.heads.length, 2);
    assert.deepEqual(b.heads.map(h => h.name), ['CGST', 'SGST']);
    assert.equal(b.heads[0].amount, b.heads[1].amount);
    assert.equal(b.heads[0].rate * 2, rate);
  }), {numRuns: 1000});
});

// @covers M1 LT-01
test('agreementTotals: baseline + approved COs, the same head logic for a project (plan §9.3 CO scenario)', async () => {
  const content = scopeSchema.parse({title: 'CO scenario', client: 'Acme', deliverables: 'Website', exclusions: '', fee: 25000, currency: 'INR', revisions: 2, due: '', notes: '', tax_label: 'GST', tax_pct: 18, deposit_pct: 30});
  const b = await approve(content);
  const co = (fee_delta, n) => append(entries, b, 'change_order', {title: 'CO ' + n, reason: '', request_quote: '', add_items: [], remove_item_ids: [], fee_delta, days_delta: 0, revisions_delta: 0}, 'owner', tick(entries.length + 1));
  const entries = [];
  entries.push(await co(7500.5, 1));
  entries.push(await append(entries, b, 'settle', {ref_seq: entries[0].seq, outcome: 'approved', signer: 'Ada', comment: ''}, 'client', tick(entries.length + 1)));
  entries.push(await co(1000, 2));
  entries.push(await append(entries, b, 'settle', {ref_seq: entries[2].seq, outcome: 'declined', signer: 'Ada', comment: ''}, 'client', tick(entries.length + 1)));
  const single = agreementTotals(b.content, entries);
  assert.deepEqual([single.fee, single.tax, single.total, single.change_orders], [3250050, 585009, 3835059, 750050]);
  assert.deepEqual(single.heads, [{name: 'GST', label: 'GST', rate: 18, amount: 585009}]);
  assert.deepEqual(single.baseline, {fee: 2500000, tax: 450000, total: 2950000});
  assert.equal(single.deposit, 885000, 'deposit on the signed baseline total');
  const intra = agreementTotals(b.content, entries, {place: {seller_state: '33', client_state: '33', client_country: 'IN'}});
  assert.deepEqual(intra.heads.map(h => [h.label, h.amount]), [['CGST', 292505], ['SGST', 292505]]);
  assert.equal(intra.total, 3835060);
  const inter = agreementTotals(b.content, entries, {place: {seller_state: '33', client_state: '29'}});
  assert.deepEqual([inter.heads[0].name, inter.total], ['IGST', 3835059]);
  const vat = agreementTotals(scopeSchema.parse({...content, currency: 'AED', tax_label: 'VAT', tax_pct: 5}), []);
  assert.deepEqual(vat.heads, [{name: 'OTHER', label: 'VAT', rate: 5, amount: 125000}]);
});
