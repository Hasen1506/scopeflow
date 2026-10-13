// PR C: money and terms. Pure: configured currencies with locale-aware formatting, the new
// optional tax / deposit / payment-terms fields (legacy content unchanged), totals, the
// fee-vs-items check, and timestamps shown with their time zone.
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fc} from '../support/property.mjs';

const {scopeSchema, sample, formatMoney, currencies} = await import('../../lib/scope.ts');
const {currencyList, currencyInfo} = await import('../../lib/currency.ts');
const {totals, feeCheck} = await import('../../lib/money.ts');
const {formatInZone, validTimeZone, zoneOrUtc} = await import('../../lib/time.ts');
const {lintScope} = await import('../../lib/lint.ts');
const legacy = {title: 'Legacy scope', client: 'Client Co', deliverables: 'Logo\nGuidelines', exclusions: '', fee: 100, currency: 'USD', revisions: 1, due: '', notes: ''};

test('currency list comes from config, keeps the original four, and every code formats', () => {
  for (const c of ['USD', 'INR', 'GBP', 'EUR']) assert.ok(currencies.includes(c), c);
  assert.ok(currencyList.length >= 20);
  assert.equal(new Set(currencies).size, currencies.length);
  for (const c of currencyList) {
    assert.match(c.code, /^[A-Z]{3}$/);
    assert.doesNotThrow(() => formatMoney(1234.5, c.code), c.code);
    assert.equal(currencyInfo(c.code).locale, c.locale);
  }
});

test('amounts are formatted in the currency’s own locale', () => {
  assert.equal(formatMoney(180000, 'INR'), '₹1,80,000.00');
  assert.equal(formatMoney(1800, 'USD'), '$1,800.00');
  assert.equal(formatMoney(1800, 'GBP'), '£1,800.00');
  assert.equal(formatMoney(1800, 'EUR'), '€1,800.00');
  assert.equal(formatMoney(1800, 'JPY'), '¥1,800');
  assert.equal(formatMoney(1800, 'INR', 'en-US'), '₹1,800.00');
  assert.match(formatMoney(5, 'ZZZ'), /^ZZZ\s5\.00$/u); // unconfigured codes still format plainly
});

test('regression: no component formats money in a hardcoded en-US locale any more', () => {
  for (const file of ['lib/insights.ts', 'app/items-editor.tsx', 'lib/scope.ts']) {
    assert.ok(!/NumberFormat\('en-US', \{style: 'currency'/.test(readFileSync(new URL('../../' + file, import.meta.url), 'utf8')), file);
  }
});

test('new optional terms validate; legacy content is stored exactly as before', () => {
  assert.deepEqual(scopeSchema.parse(legacy), legacy);
  assert.ok(!('tax_pct' in scopeSchema.parse(sample)));
  const full = {...legacy, currency: 'AUD', tax_label: 'GST', tax_pct: 10, deposit_pct: 30, payment_terms: 'Balance within 15 days of delivery'};
  const parsed = scopeSchema.parse(full);
  assert.deepEqual(parsed, full);
  assert.deepEqual(scopeSchema.parse(parsed), parsed);
  for (const bad of [{tax_pct: 101}, {tax_pct: -1}, {deposit_pct: 100.5}, {deposit_pct: Number.NaN}, {tax_label: ''}, {payment_terms: 'x'.repeat(501)}, {currency: 'XYZ'}, {currency: 'usd'}, {tip: 1}]) {
    assert.equal(scopeSchema.safeParse({...legacy, ...bad}).success, false, JSON.stringify(bad));
  }
});

test('totals: tax on the fee, deposit on the tax-inclusive total', () => {
  assert.deepEqual(totals({fee: 1000, tax_pct: 18, tax_label: 'GST', deposit_pct: 50}), {fee: 1000, tax_label: 'GST', tax_pct: 18, tax: 180, total: 1180, deposit_pct: 50, deposit: 590, balance: 590});
  assert.deepEqual(totals({fee: 500}), {fee: 500, tax_label: 'Tax', tax_pct: 0, tax: 0, total: 500, deposit_pct: 0, deposit: 0, balance: 500});
  fc.assert(fc.property(fc.integer({min: 0, max: 1_000_000_00}).map(c => c / 100), fc.integer({min: 0, max: 10000}).map(x => x / 100), fc.integer({min: 0, max: 100}), (fee, tax_pct, deposit_pct) => {
    const t = totals({fee, tax_pct, deposit_pct});
    assert.ok(t.tax >= 0 && t.total >= fee && t.deposit <= t.total + 1e-9);
    assert.ok(Math.abs(t.deposit + t.balance - t.total) < 0.011);
  }));
});

test('fee check: item prices against the fee, with a message for every mismatch', () => {
  const items = prices => prices.map((price, i) => ({id: 'i' + i, title: 'Item ' + i, qty: 1, unit: '', price, acceptance: ''}));
  const s = (fee, prices) => ({fee, currency: 'INR', deliverables: '', items: items(prices)});
  assert.equal(feeCheck(s(1000, [null, null])).status, 'none');
  assert.equal(feeCheck(s(1000, [600, 400])).status, 'match');
  assert.equal(feeCheck(s(1000, [600, 400])).message, null);
  const under = feeCheck(s(100000, [60000, 20000]));
  assert.equal(under.status, 'under'); assert.equal(under.difference, 20000);
  assert.equal(under.message, 'Item prices add up to ₹80,000.00, ₹20,000.00 less than the fee of ₹1,00,000.00.');
  const over = feeCheck(s(1000, [900, 300]));
  assert.equal(over.status, 'over'); assert.match(over.message, /₹200\.00 more than the fee/);
  assert.equal(feeCheck(s(1000, [300, null])).status, 'partial');
  assert.equal(feeCheck(s(300, [300, null])).status, 'partial');
  assert.equal(feeCheck(s(0.3, [0.1, 0.2])).status, 'match'); // float sums
});

test('timestamps are shown in the project time zone with its offset', () => {
  assert.equal(formatInZone('2026-10-07T09:00:00.000Z', 'Asia/Kolkata'), '7 Oct 2026, 14:30 GMT+5:30');
  assert.equal(formatInZone('2026-10-07T09:00:00.000Z', null), '7 Oct 2026, 09:00 UTC');
  assert.equal(formatInZone('2026-10-07T09:00:00.000Z', 'Not/AZone'), '7 Oct 2026, 09:00 UTC');
  assert.equal(formatInZone('2026-01-07T09:00:00.000Z', 'America/New_York'), '7 Jan 2026, 04:00 GMT-5');
  assert.equal(formatInZone(null, 'UTC'), '');
  assert.equal(formatInZone('garbage', 'UTC'), '');
  assert.equal(validTimeZone('Asia/Kolkata'), true);
  assert.equal(validTimeZone("Asia/Kolkata'; DROP"), false);
  assert.equal(zoneOrUtc(undefined), 'UTC');
});

test('lint: deposit without payment terms, tax without a name', () => {
  const rules = s => lintScope(scopeSchema.parse(s), '2026-10-01').issues.map(i => i.rule);
  assert.ok(rules({...legacy, deposit_pct: 30}).includes('deposit-no-terms'));
  assert.ok(!rules({...legacy, deposit_pct: 30, payment_terms: 'Net 15'}).includes('deposit-no-terms'));
  assert.ok(rules({...legacy, tax_pct: 18}).includes('tax-no-label'));
  assert.ok(!rules({...legacy, tax_pct: 18, tax_label: 'GST'}).includes('tax-no-label'));
});
