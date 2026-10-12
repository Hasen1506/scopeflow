// WS-01: integer minor units (M3) and currency exponents (M4). Pure; seeded fast-check.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fc} from '../support/property.mjs';

const Mi = await import('../../lib/minor.ts');
const {formatMoney, currencyList} = await import('../../lib/currency.ts');
const {totals, schedule, inFx} = await import('../../lib/money.ts');
const {agreementTotals} = await import('../../lib/agreement-totals.ts');
const {moneyState} = await import('../../lib/money-ledger.ts');
const {scopeSchema} = await import('../../lib/scope.ts');
const {approve, append} = await import('../support/chain.mjs');
const {tick} = await import('../support/property.mjs');

const CCYS = ['INR', 'USD', 'JPY', 'EUR', 'KWD', 'IDR'];

// @covers M3
test('M3 property: toMinor(fromMinor(x)) == x for every safe amount and exponent', () => {
  fc.assert(fc.property(fc.integer({min: -9_000_000_000_000, max: 9_000_000_000_000}), fc.constantFrom(...CCYS), (x, ccy) => {
    assert.equal(Mi.toMinor(Mi.fromMinor(x, ccy), ccy), x);
    assert.equal(Mi.toMinor(Mi.minorToString(x, ccy), ccy), x);
  }), {numRuns: 2000});
});

// @covers M3
test('M3 property: sums are associative and exact; no float drift over 10^5 random operations', () => {
  fc.assert(fc.property(fc.array(fc.integer({min: -1e9, max: 1e9}), {minLength: 3, maxLength: 40}), xs => {
    const mid = Math.floor(xs.length / 2);
    assert.equal(Mi.sumMinor([Mi.sumMinor(xs.slice(0, mid)), Mi.sumMinor(xs.slice(mid))]), Mi.sumMinor(xs));
    assert.equal(Mi.sumMinor([...xs].reverse()), Mi.sumMinor(xs));
  }));
  // 10^5 additions of decimal amounts: the minor-unit total equals the exact decimal total, where
  // naive float accumulation drifts.
  const amounts = fc.sample(fc.integer({min: 1, max: 10_000_000}), {numRuns: 100_000, seed: 20261012});
  let minor = 0, exact = 0n, pctMinor = 0, pctExact = 0n;
  for (const c of amounts) {
    minor = Mi.sumMinor([minor, Mi.toMinor(c / 100, 'INR')]); exact += BigInt(c);
    // 18% of each amount, rounded per line: equals the exact integer half-up of each product.
    pctMinor = Mi.sumMinor([pctMinor, Mi.mulPct(c, 18)]); pctExact += (BigInt(c) * 18n + 50n) / 100n;
  }
  assert.equal(BigInt(minor), exact);
  assert.equal(BigInt(pctMinor), pctExact);
  // mulPct of a sum is within one minor unit per term of the sum of mulPcts, and exact for the total.
  fc.assert(fc.property(fc.integer({min: 0, max: 1e10}), fc.integer({min: 0, max: 100_000}).map(x => x / 1000), (m, pct) => {
    const v = Mi.mulPct(m, pct);
    const exactTimes2 = BigInt(m) * BigInt(Math.round(pct * 1000)) * 2n; // 2 × m × pct × 1000
    // half-up: |v × 100000 − m × pct × 1000| ≤ 50000
    const diff = BigInt(v) * 200000n - exactTimes2;
    assert.ok((diff < 0n ? -diff : diff) <= 100000n, `${m} × ${pct}% → ${v}`);
  }));
});

// @covers M3
test('M3 regression: 1.005 → 101 paise and 1.255 → 126 paise (half-up on the decimal, not the binary float)', () => {
  assert.equal(Math.round(1.005 * 100), 100, 'the 5e59e44 rounding (round2) gives 100');
  assert.equal(Math.round(1.255 * 100), 125, 'the 5e59e44 rounding (round2) gives 125');
  assert.equal(Mi.toMinor(1.005, 'INR'), 101);
  assert.equal(Mi.toMinor(1.255, 'INR'), 126);
  assert.equal(Mi.toMinor('1.005', 'INR'), 101);
  assert.equal(Mi.toMinor('25000.555', 'INR'), 2500056);
  assert.equal(Mi.toMinor(-1.005, 'INR'), -101, 'symmetric: half away from zero');
  assert.equal(Mi.round2(1.005), 1.01);
  assert.equal(totals({fee: 1.005, currency: 'INR'}).fee, 1.01);
  assert.equal(totals({fee: 100, tax_pct: 1.005, currency: 'INR'}).tax, 1.01); // 1.005 exactly → 1.01
  assert.throws(() => Mi.toMinor(Number.NaN, 'INR'), RangeError);
  assert.throws(() => Mi.toMinor(1e300, 'INR'), RangeError);
  assert.throws(() => Mi.sumMinor([Number.MAX_SAFE_INTEGER, 1]), RangeError);
});

// @covers M3
test('M3: no `Math.round(n * 100) / 100` money rounding left in the files WS-01 owns', () => {
  const owned = ['lib/money.ts', 'lib/currency.ts', 'lib/gst.ts', 'lib/fx.ts', 'lib/time.ts', 'lib/scope.ts', 'lib/minor.ts', 'lib/agreement-totals.ts', 'config/currencies.ts', 'db/client.ts', 'app/api/fx/route.ts'];
  for (const f of owned) {
    const text = readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
    assert.ok(!/Math\.round\([^)]*\*\s*100\)\s*\/\s*100/.test(text), `${f} still rounds money with Math.round(n * 100) / 100`);
    assert.ok(!/const round2 = /.test(text), `${f} still defines a float round2`);
  }
});

// @covers M4
test('M4 unit: formatMoney uses the currency exponent', () => {
  assert.equal(formatMoney(1800, 'JPY'), '¥1,800');
  assert.equal(formatMoney(333.33, 'JPY'), '¥333', 'no decimals for yen');
  assert.equal(formatMoney(1000.5, 'JPY'), '¥1,001', 'rounded half-up to whole yen');
  assert.equal(formatMoney(29500, 'INR'), '₹29,500.00');
  assert.equal(formatMoney(1.005, 'INR'), '₹1.01');
  assert.match(formatMoney(1.5, 'KWD', 'en-US'), /^KWD\s1\.500$/u);
  assert.equal(Mi.exponentOf('JPY'), 0); assert.equal(Mi.exponentOf('INR'), 2); assert.equal(Mi.exponentOf('KWD'), 3);
  assert.equal(Mi.exponentOf('IDR'), 2, 'ISO 4217, not the CLDR display digits');
  for (const c of currencyList) assert.equal(Mi.exponentOf(c.code), c.code === 'JPY' ? 0 : 2, c.code);
  assert.equal(currencyList.length, 29, 'all 29 currencies are kept');
});

const jpy = {title: 'JPY deposit', client: 'Tokyo Co', deliverables: 'Logo design', exclusions: '', fee: 1000, currency: 'JPY', revisions: 1, due: '', notes: '', deposit_pct: 33.333};

// @covers M4
test('M4 regression: JPY fee 1,000 @ 33.333% → deposit ¥333, balance ¥667; recording ¥333 covers the deposit', async () => {
  const t = totals(jpy);
  assert.deepEqual([t.deposit, t.balance, t.total], [333, 667, 1000]);
  const content = scopeSchema.parse(jpy);
  const b = await approve(content);
  const a = agreementTotals(b.content, []);
  assert.deepEqual([a.deposit, a.total], [333, 1000]);
  const entries = [await append([], b, 'payment_received', {amount: 333, method: 'bank_transfer', received: '2026-10-01', reference: '', note: ''}, 'owner', tick(1))];
  const ms = moneyState(entries, {baseline_version: 1, currency: 'JPY', total: a.total, deposit: a.deposit});
  assert.deepEqual(ms.deposit, {due: 333, paid: 333, covered: true});
  assert.equal(a.total - ms.received, 667, 'no ¥0.33 residue');
  // Milestones in yen are whole yen and add up exactly.
  const lines = schedule({currency: 'JPY', milestones: [{id: 'a', title: 'One', pct: 33.333, due: ''}, {id: 'b', title: 'Two', pct: 33.333, due: ''}, {id: 'c', title: 'Three', pct: 33.334, due: ''}]}, 1000);
  assert.deepEqual(lines.map(l => l.amount), [333, 333, 334]);
  assert.deepEqual(inFx({currency: 'USD', fx: {currency: 'JPY', rate: 149.123, as_of: '2026-10-01', source: 'x'}}, 10.01), {amount: 1493, currency: 'JPY'});
});

// @covers M4
test('M4 property: deposit + balance == total exactly, in every exponent', () => {
  fc.assert(fc.property(fc.integer({min: 0, max: 10_000_000}), fc.constantFrom('INR', 'JPY', 'USD'), fc.integer({min: 0, max: 100_000}).map(x => x / 1000), fc.integer({min: 0, max: 2800}).map(x => x / 100), (fee, currency, deposit_pct, tax_pct) => {
    const t = totals({fee, currency, deposit_pct, tax_pct});
    const m = v => Mi.toMinor(v, currency);
    assert.equal(m(t.deposit) + m(t.balance), m(t.total));
    assert.equal(m(t.fee) + m(t.tax), m(t.total));
    for (const v of [t.tax, t.total, t.deposit, t.balance]) assert.ok(Mi.fitsExponent(v, currency), `${v} ${currency}`);
  }));
});
