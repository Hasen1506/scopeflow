// WS-01 money/tax goldens (plan §9.3). Byte-exact JSON of the per-head GST engine and the agreement
// totals for the live-test figures. A diff means the tax arithmetic changed: regenerate only
// deliberately with UPDATE_GOLDEN=1 and explain why in the PR.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import '../support/property.mjs';

const G = await import('../../lib/gst.ts');
const {totals} = await import('../../lib/money.ts');
const {formatMinor} = await import('../../lib/currency.ts');

function golden(name, value) {
  const file = new URL(name, import.meta.url);
  const text = JSON.stringify(value, null, 2) + '\n';
  if (process.env.UPDATE_GOLDEN === '1' || !existsSync(file)) writeFileSync(file, text);
  assert.equal(text, readFileSync(file, 'utf8'), `${name} changed; run with UPDATE_GOLDEN=1 only if the change is intended`);
}
const show = b => ({taxable: formatMinor(b.taxable, 'INR'), heads: b.heads.map(h => `${h.name} ${h.rate}% ${formatMinor(h.amount, 'INR')}`), round_off: formatMinor(b.round_off, 'INR'), total: formatMinor(b.total, 'INR'), minor: b});

// @covers M1
test('golden M1: ₹100 inclusive intra-state → 84.75 / 7.63 / 7.63 / round-off −0.01 / 100.00', () => {
  const b = G.gstFromInclusive(10000, 18, 'intra');
  assert.deepEqual(b, {taxable: 8475, heads: [{name: 'CGST', rate: 9, amount: 763}, {name: 'SGST', rate: 9, amount: 763}], round_off: -1, total: 10000});
});
// @covers M1
test('golden M1: ₹101 inclusive → 85.59 / 7.70 / 7.70 / round-off +0.01', () => {
  const b = G.gstFromInclusive(10100, 18, 'intra');
  assert.deepEqual(b, {taxable: 8559, heads: [{name: 'CGST', rate: 9, amount: 770}, {name: 'SGST', rate: 9, amount: 770}], round_off: 1, total: 10100});
});
// @covers M1
test('golden M1: ₹25,000 exclusive 18% → tax ₹4,500.00, total ₹29,500.00', () => {
  for (const supply of ['intra', 'inter', 'none']) {
    const b = G.gstFromExclusive(2500000, 18, supply);
    assert.equal(b.heads.reduce((s, h) => s + h.amount, 0), 450000, supply);
    assert.equal(b.total, 2950000, supply);
  }
  const t = totals({fee: 25000, tax_pct: 18, tax_label: 'GST', currency: 'INR'});
  assert.deepEqual([t.tax, t.total], [4500, 29500]);
});
// @covers M1 M2 M4
test('golden: money/tax figures file (byte-exact)', () => {
  golden('ws-01-gst.golden.json', {
    inclusive_100_intra: show(G.gstFromInclusive(10000, 18, 'intra')),
    inclusive_101_intra: show(G.gstFromInclusive(10100, 18, 'intra')),
    exclusive_25000_intra: show(G.gstFromExclusive(2500000, 18, 'intra')),
    exclusive_25000_inter: show(G.gstFromExclusive(2500000, 18, 'inter')),
    co_32500_50_single_head: show(G.gstFromExclusive(3250050, 18, 'none')),
    co_32500_50_intra: show(G.gstFromExclusive(3250050, 18, 'intra')),
    jpy_1000_deposit_33_333: totals({fee: 1000, currency: 'JPY', deposit_pct: 33.333}),
  });
});
