// WS-01 differential (M3): the integer minor-unit totals()/schedule()/feeCheck() against the float
// implementation they replace (vendored below verbatim from lib/money.ts at 5e59e44). On 2-decimal
// inputs they must agree exactly, except the documented half-cent cases: where an exact
// intermediate (tax, deposit, a milestone share) lies exactly on half a cent, the new code rounds
// it up (half-up on the exact value) while the float code sometimes rounded it down because the
// binary product was a hair below the half (e.g. 1.005 → 1.00). Each such case is checked to be
// exactly such a tie, and the new value is the exact half-up one.
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fc} from '../support/property.mjs';

const {totals, schedule, feeCheck} = await import('../../lib/money.ts');

// ---- vendored from 5e59e44 lib/money.ts (float implementation) ---------------------------------
const old = (() => {
  const round2 = n => Math.round(n * 100) / 100;
  function totals(s, fee = s.fee) {
    const tax_pct = s.tax_pct ?? 0, deposit_pct = s.deposit_pct ?? 0;
    const tax = round2(fee * tax_pct / 100), total = round2(fee + tax), deposit = round2(total * deposit_pct / 100);
    return {fee, tax_label: s.tax_label || 'Tax', tax_pct, tax, total, deposit_pct, deposit, balance: round2(total - deposit)};
  }
  function schedule(s, total) {
    const list = s.milestones ?? [];
    let left = round2(total);
    return list.map((m, i) => {
      const amount = i === list.length - 1 ? left : round2(total * m.pct / 100);
      left = round2(left - amount);
      return {id: m.id, title: m.title, pct: m.pct, due: m.due, amount};
    });
  }
  return {totals, schedule};
})();
// -------------------------------------------------------------------------------------------------

/** cents × pct(hundredths) / 100: is the exact value a half-cent tie? (pct given in hundredths of a percent) */
const isTie = (cents, pctHundredths) => (BigInt(cents) * BigInt(pctHundredths)) % 10000n === 5000n;
const halfUp = (cents, pctHundredths) => Number((BigInt(cents) * BigInt(pctHundredths) + 5000n) / 10000n);
const cents = v => Math.round(v * 100);

const money = fc.integer({min: 0, max: 1_000_000_000}); // up to ₹1,00,00,000.00 in paise
const pct = fc.integer({min: 0, max: 10000}); // 0.00% … 100.00% in hundredths

// @covers M3
test('differential: new totals() == old totals() on 2-dp inputs, except exact half-cent ties (rounded up)', () => {
  let ties = 0;
  fc.assert(fc.property(money, pct, pct, (feeC, taxH, depH) => {
    const s = {fee: feeC / 100, tax_pct: taxH / 100, deposit_pct: depH / 100, currency: 'INR'};
    const a = totals(s), b = old.totals(s);
    // The new code is the exact half-up arithmetic, always.
    const tax = halfUp(feeC, taxH), total = feeC + tax, deposit = halfUp(total, depH);
    assert.deepEqual([cents(a.tax), cents(a.total), cents(a.deposit), cents(a.balance)], [tax, total, deposit, total - deposit]);
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    ties++;
    // Otherwise a tie explains it, and the old value is one cent lower in the tied step.
    const taxTie = isTie(feeC, taxH), depTie = isTie(total, depH) || isTie(cents(b.total), depH);
    assert.ok(taxTie || depTie, `undocumented difference for ${JSON.stringify(s)}: new ${JSON.stringify(a)} old ${JSON.stringify(b)}`);
    if (taxTie && cents(a.tax) !== cents(b.tax)) assert.equal(cents(a.tax) - cents(b.tax), 1);
  }), {numRuns: 20000});
  assert.ok(ties < 20000 * 0.05, `ties are rare (${ties})`);
  // A documented tie: ₹0.10 at 5% is exactly half a paisa.
  assert.deepEqual([totals({fee: 0.1, tax_pct: 5, currency: 'INR'}).tax, old.totals({fee: 0.1, tax_pct: 5}).tax], [0.01, 0.01]);
  assert.deepEqual([totals({fee: 1.1, tax_pct: 50, currency: 'INR'}).tax, old.totals({fee: 1.1, tax_pct: 50}).tax], [0.55, 0.55]);
  assert.deepEqual([totals({fee: 2.01, tax_pct: 50, currency: 'INR'}).tax, old.totals({fee: 2.01, tax_pct: 50}).tax], [1.01, 1]); // 1.005 → old 1.00
  assert.deepEqual([totals({fee: 10.05, tax_pct: 10, currency: 'INR'}).tax, old.totals({fee: 10.05, tax_pct: 10}).tax], [1.01, 1]); // 1.005 → old 1.00
});

// @covers M3
test('differential: new schedule() == old schedule() except half-cent ties; lines always add up exactly', () => {
  fc.assert(fc.property(money, fc.array(fc.integer({min: 1, max: 5000}), {minLength: 1, maxLength: 6}), (totalC, shares) => {
    const sum = shares.reduce((x, y) => x + y, 0);
    const pcts = shares.map((p, i) => i === shares.length - 1 ? 10000 - shares.slice(0, -1).map(x => Math.floor(x * 10000 / sum)).reduce((x, y) => x + y, 0) : Math.floor(p * 10000 / sum));
    const ms = {milestones: pcts.map((p, i) => ({id: 'm' + i, title: 'M' + i, pct: p / 100, due: ''})), currency: 'INR'};
    const a = schedule(ms, totalC / 100), b = old.schedule(ms, totalC / 100);
    assert.equal(a.reduce((s, l) => s + cents(l.amount), 0), totalC);
    a.forEach((l, i) => {
      if (l.amount === b[i].amount) return;
      if (i === a.length - 1) return; // the remainder line follows any earlier tie
      assert.ok(isTie(totalC, pcts[i]), `undocumented schedule difference at line ${i}`);
    });
  }), {numRuns: 5000});
});

// @covers M3
test('differential: feeCheck() status and sums unchanged for legacy price-only items', () => {
  fc.assert(fc.property(money, fc.array(fc.option(money, {nil: null}), {maxLength: 8}), (feeC, prices) => {
    const items = prices.map((p, i) => ({id: 'i' + i, title: 'Item ' + i, qty: 1, unit: '', price: p == null ? null : p / 100, acceptance: ''}));
    const s = {fee: feeC / 100, currency: 'INR', deliverables: '', items};
    const a = feeCheck(s);
    const priced = prices.filter(p => p != null), itemC = priced.reduce((x, y) => x + y, 0);
    assert.equal(cents(a.item_total), itemC); assert.equal(cents(a.difference), feeC - itemC);
    const expected = !priced.length ? 'none' : feeC === itemC ? (priced.length < prices.length ? 'partial' : 'match') : feeC < itemC ? 'over' : priced.length < prices.length ? 'partial' : 'under';
    assert.equal(a.status, expected);
  }), {numRuns: 3000});
});
