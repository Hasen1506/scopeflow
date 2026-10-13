// Old-vs-new differential against the pre-rebuild production build (5e59e44).
//
// tests/fixtures/pre-rebuild/ holds the pure modules exactly as they were at 5e59e44
// (`git show 5e59e44:<path>`, unedited). Every pure function that exists in both versions is run
// on the same fast-check inputs (fixed seed from tests/support/property.mjs) and must agree.
// Where the rebuild changed behaviour on purpose, the test asserts the documented difference (and
// only that difference) and names the doc. Anything else that differs is a regression.
//
// Not compared (changed on purpose, nothing left to hold equal):
//  - invoice.invoiceProblem: new signature (breakdown + C2 cap) replaces the decimal balance check (docs/ws-03.md, C2).
//  - signing.verificationKeys/publishedKeys: new exports (docs/ws-02.md, C6); verification itself is compared below.
//  - PDF renderers (renderReceiptPdf/renderStatementPdf/renderInvoicePdf): wording changed (docs/ws-02.md C1/C5/L2, docs/ws-03.md); covered by goldens.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fc, scopeArb, idArb, dateArb, freezeClock, tick, FROZEN_NOW, TEST_SECRET} from '../support/property.mjs';
import {approve, append, buildLedger, opArb} from '../support/chain.mjs';

freezeClock();
const OLD = '../fixtures/pre-rebuild/lib/';
const N = {}, O = {};
for (const m of ['scope', 'currency', 'money', 'gst', 'time', 'ledger', 'signing', 'invoice', 'invoice-status', 'statement', 'diff', 'link', 'cosign', 'receipt', 'record-check']) {
  N[m] = await import(`../../lib/${m}.ts`);
  O[m] = await import(`${OLD}${m}.ts`);
}
const minor = await import('../../lib/minor.ts');
const RUNS = Number(process.env.DIFF_RUNS ?? 1000);
const SLOW = Math.max(50, Math.round(RUNS / 5)); // properties that hash and sign whole ledgers

const json = v => JSON.stringify(v);
const codes = N.currency.currencyCodes;
const sameCodes = O.currency.currencyCodes;
const exp = c => minor.exponentOf(c);
/** Decimal places in the shortest text form of a number. */
const decimals = x => (String(x).split('.')[1] ?? '').length;
/** An exact half at the first dropped decimal: the only place exact half-up and the old float rounding may disagree (docs/ws-01.md, M3). */
const isTieText = (x, keep) => { const f = String(x).split('.')[1] ?? ''; return f.length === keep + 1 && f.endsWith('5'); };
const halfUpDiv = (num, den) => Number((2n * BigInt(num) + BigInt(den)) / (2n * BigInt(den)));

// ------------------------------------------------------------------------------------------------
// Scope canonicalisation and hashing
// ------------------------------------------------------------------------------------------------

const pct2 = fc.integer({min: 0, max: 10000}).map(h => h / 100);
const termsArb = fc.record({
  tax: fc.option(fc.record({tax_label: fc.constantFrom('GST', 'VAT', 'Tax', 'IGST @18%'), tax_pct: pct2})),
  pay: fc.oneof(
    fc.constant(null),
    fc.record({deposit_pct: pct2}),
    fc.array(fc.integer({min: 1, max: 60}), {minLength: 1, maxLength: 4}).map(parts => {
      const total = parts.reduce((a, b) => a + b, 0), pcts = parts.map(p => Math.round(p * 10000 / total) / 100);
      pcts[pcts.length - 1] = Math.round((100 - pcts.slice(0, -1).reduce((a, b) => a + b, 0)) * 100) / 100;
      return {milestones: pcts.map((pct, i) => ({id: 'm' + i, title: 'Milestone ' + (i + 1), pct, due: ''}))};
    }),
  ),
  payment_terms: fc.option(fc.constantFrom('Net 30', 'net-15', 'within 7 days', 'On delivery')),
  fx: fc.option(fc.record({currency: fc.constantFrom('INR', 'USD', 'JPY', 'EUR'), rate: fc.integer({min: 1, max: 9_999_999}).map(r => r / 10000), as_of: dateArb, source: fc.constant('ECB reference rate')})),
  revision_bank: fc.option(fc.record({unit: fc.constantFrom('hours', 'money'), amount: fc.integer({min: 1, max: 500000}).map(c => c / 100), overage_rate: fc.option(fc.integer({min: 0, max: 900000}).map(c => c / 100), {nil: undefined})})),
});
const withTerms = (s, t) => {
  const out = {...s};
  if (t.tax) Object.assign(out, t.tax);
  if (t.pay) Object.assign(out, t.pay);
  if (t.payment_terms) out.payment_terms = t.payment_terms;
  if (t.fx) out.fx = t.fx;
  if (t.revision_bank) out.revision_bank = Object.fromEntries(Object.entries(t.revision_bank).filter(([, v]) => v !== undefined));
  return out;
};
const scopeWithTermsArb = fc.tuple(scopeArb, termsArb).map(([s, t]) => withTerms(s, t));
const parsedScopeArb = scopeWithTermsArb.filter(s => N.scope.scopeSchema.safeParse(s).success).map(s => N.scope.scopeSchema.parse(s));

// @covers M5
test('scope: scopeSchema parses old-valid content to the identical canonical form; anchor hash unchanged', async () => {
  let compared = 0;
  await fc.assert(fc.asyncProperty(scopeWithTermsArb, idArb, fc.option(fc.string({maxLength: 20}), {nil: null}), fc.nat(1000), async (s, pid, signer, v) => {
    const a = N.scope.scopeSchema.safeParse(s), b = O.scope.scopeSchema.safeParse(s);
    // Every generated money value has at most 2 decimals and the currencies all have exponent 2,
    // so M5 (docs/ws-01.md) never applies here: acceptance must be identical.
    assert.equal(a.success, b.success, `acceptance differs for ${json(s)}: new ${json(a.error?.issues)} old ${json(b.error?.issues)}`);
    if (!a.success) return;
    compared++;
    assert.equal(json(a.data), json(b.data));
    const anchor = {project_id: pid, version: v, content: a.data, signer, decided: signer ? tick(v) : null};
    assert.equal(await N.ledger.anchorHash(anchor), await O.ledger.anchorHash(anchor));
    assert.equal(json(N.scope.itemsOf(a.data)), json(O.scope.itemsOf(a.data)));
    for (const i of N.scope.itemsOf(a.data)) assert.equal(N.scope.itemLine(i), O.scope.itemLine(i));
    assert.equal(N.scope.money(a.data), O.scope.money(a.data));
  }), {numRuns: RUNS});
  assert.ok(compared > RUNS / 4, `enough valid scopes compared (${compared})`);
});

// @covers M5
test('scope: the only acceptance difference is M5 (money with more decimals than the currency allows), docs/ws-01.md', () => {
  fc.assert(fc.property(scopeArb, fc.constantFrom(...codes.filter(c => sameCodes.includes(c))), fc.integer({min: 0, max: 10_000_000_000}), fc.integer({min: 0, max: 4}), (s0, currency, units, d) => {
    const fee = units / 10 ** d;
    fc.pre(fee <= 10_000_000);
    const s = {...s0, currency, fee, items: s0.items.map(i => ({...i, price: null}))};
    const a = N.scope.scopeSchema.safeParse(s), b = O.scope.scopeSchema.safeParse(s);
    if (a.success === b.success) { if (a.success) assert.equal(json(a.data), json(b.data)); return; }
    assert.ok(b.success && !a.success, 'the new schema never accepts what the old one refused');
    assert.ok(decimals(fee) > exp(currency), `rejected a fee that fits ${currency}: ${fee}`);
    assert.deepEqual(a.error.issues.map(i => i.path.join('.')), ['fee']);
    assert.match(a.error.issues[0].message, /^Use (at most \d decimals|whole amounts)/);
  }), {numRuns: RUNS});
});

test('scope: label() is unchanged', () => {
  fc.assert(fc.property(fc.oneof(fc.constantFrom('pending', 'approved', 'changes_requested', 'proposed', 'declined', 'withdrawn', 'superseded'), fc.string({maxLength: 12})), st => {
    assert.equal(N.scope.label(st), O.scope.label(st));
  }), {numRuns: RUNS});
});

// ------------------------------------------------------------------------------------------------
// Money and currency formatting / rounding
// ------------------------------------------------------------------------------------------------

/** The fraction digits Intl shows for a currency by default in its configured locale. */
const intlDigits = c => {
  const loc = N.currency.currencyInfo(c)?.locale ?? 'en-US';
  try { return new Intl.NumberFormat(loc, {style: 'currency', currency: c}).resolvedOptions().minimumFractionDigits; } catch { return null; }
};

// @covers M4
test('currency: formatMoney equal on amounts that fit the currency; differences only where M4/M3 say (docs/ws-01.md)', () => {
  const seen = {equal: 0, m4_digits: 0, m4_extra_decimals: 0, m3_tie: 0};
  fc.assert(fc.property(fc.constantFrom(...sameCodes), fc.integer({min: 0, max: 99_999_999_999}), fc.integer({min: 0, max: 4}), (c, units, d) => {
    const amount = units / 10 ** d, e = exp(c);
    const a = N.currency.formatMoney(amount, c), b = O.currency.formatMoney(amount, c);
    // The new output is always the amount rounded exactly (half-up on its decimal text) to the exponent.
    const exact = minor.fromMinor(minor.toMinor(amount, c), c);
    assert.equal(a, N.currency.formatMoney(exact, c));
    const fits = decimals(amount) <= e, digitsAgree = intlDigits(c) === e;
    if (fits && digitsAgree) { assert.equal(a, b, `${c} ${amount}`); seen.equal++; return; }
    if (a === b) { seen.equal++; return; }
    if (!digitsAgree) { seen.m4_digits++; return; } // M4: decimals = ISO exponent, not Intl's display default (IDR/PKR show .00, JPY never shows decimals)
    if (e < 2) { seen.m4_extra_decimals++; return; } // M4: a zero-decimal currency no longer shows ¥333.33
    assert.ok(isTieText(amount, e), `undocumented formatMoney difference ${c} ${amount}: new ${a} old ${b}`);
    seen.m3_tie++;
  }), {numRuns: RUNS * 4});
  assert.ok(seen.equal > RUNS, json(seen));
});

test('money: feeCheck identical on legacy items (price only, no unit_price), every exponent-2 currency', () => {
  const item = fc.record({id: idArb, title: fc.constantFrom('Logo', 'Guide', 'Pages'), qty: fc.integer({min: 1, max: 20}), unit: fc.constant(''), price: fc.option(fc.integer({min: 0, max: 2_000_000}).map(c => c / 100), {nil: null}), acceptance: fc.constant('')});
  fc.assert(fc.property(fc.constantFrom(...sameCodes.filter(c => exp(c) === 2 && intlDigits(c) === 2)), fc.integer({min: 0, max: 5_000_000}), fc.uniqueArray(item, {maxLength: 6, selector: i => i.id}), fc.boolean(), (currency, feeC, items, matchFee) => {
    let fee = feeC / 100;
    if (matchFee) fee = Math.round(items.reduce((s, i) => s + Math.round((i.price ?? 0) * 100), 0)) / 100;
    const s = {fee, currency, items, deliverables: ''};
    assert.deepEqual(N.money.feeCheck(s), O.money.feeCheck(s));
  }), {numRuns: RUNS});
});

// @covers M3 M4
test('money: inFx/fxLine equal except exact half-cent ties (M3) and zero-decimal targets (M4), docs/ws-01.md', () => {
  const seen = {equal: 0, tie: 0, jpy: 0};
  fc.assert(fc.property(fc.constantFrom('USD', 'INR', 'EUR', 'GBP'), fc.constantFrom('INR', 'USD', 'EUR', 'JPY', 'AED'), fc.integer({min: 0, max: 5_000_000}), fc.integer({min: 1, max: 2_000_000}), (from, to, cents, rateH) => {
    fc.pre(from !== to);
    const s = {currency: from, fx: {currency: to, rate: rateH / 10000, as_of: '2026-10-01', source: 'ECB reference rate'}}, amount = cents / 100;
    const a = N.money.inFx(s, amount), b = O.money.inFx(s, amount);
    // New: exact half-up of cents × rate in the target's minor unit.
    const exact = halfUpDiv(BigInt(cents) * BigInt(rateH), 10n ** BigInt(4 + 2 - exp(to)));
    assert.equal(a.amount, exact / 10 ** exp(to));
    if (a.amount === b.amount) { seen.equal++; assert.equal(N.money.fxLine(s, amount), O.money.fxLine(s, amount)); return; }
    if (exp(to) === 0) { seen.jpy++; return; }
    assert.equal((BigInt(cents) * BigInt(rateH)) % 10000n, 5000n, `undocumented inFx difference ${json(s)} ${amount}: new ${a.amount} old ${b.amount}`);
    assert.equal(Math.round(a.amount * 100) - Math.round(b.amount * 100), 1);
    seen.tie++;
  }), {numRuns: RUNS});
  assert.ok(seen.equal > RUNS / 2, json(seen));
});

test('statement: coverSchedule identical on 2-dp schedules', () => {
  fc.assert(fc.property(fc.array(fc.integer({min: 0, max: 5_000_000}), {minLength: 1, maxLength: 6}), fc.integer({min: 0, max: 30_000_000}), (amounts, paidC) => {
    const lines = amounts.map((c, i) => ({id: 'm' + i, title: 'M' + i, pct: 10, due: '', amount: c / 100}));
    assert.deepEqual(N.statement.coverSchedule(lines, paidC / 100), O.statement.coverSchedule(lines, paidC / 100));
  }), {numRuns: RUNS});
});

// ------------------------------------------------------------------------------------------------
// GST helpers
// ------------------------------------------------------------------------------------------------

const stateCodeArb = fc.constantFrom(...O.gst.stateCodes);
const gstinArb = fc.oneof(
  fc.tuple(stateCodeArb, fc.stringMatching(/^[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/)).map(([s, r]) => s + r),
  fc.constantFrom('33ABCDE1234F1Z7', '33ABCDE1234F1Z5', '27AAPFU0939F1ZV', ''),
  fc.string({maxLength: 16}),
);

test('gst: validGstin, gstinState, stateName, isGstLabel unchanged', () => {
  fc.assert(fc.property(gstinArb, fc.oneof(stateCodeArb, fc.string({maxLength: 3})), fc.oneof(fc.constantFrom('GST', 'IGST', 'gst @18%', 'VAT', 'Tax', 'GSTIN', 'CGST'), fc.string({maxLength: 10})), (g, st, lbl) => {
    assert.equal(N.gst.validGstin(g), O.gst.validGstin(g));
    assert.equal(N.gst.gstinState(g), O.gst.gstinState(g));
    assert.equal(N.gst.stateName(st), O.gst.stateName(st));
    assert.equal(N.gst.isGstLabel(lbl), O.gst.isGstLabel(lbl));
  }), {numRuns: RUNS});
});

// FINDING (docs/testing.md): docs/ws-01.md and the gstSplit comment say the odd paisa goes to SGST.
// Neither build does that: both give it to CGST (cgst = half rounded up). The old float code
// sometimes rounded the half down on large amounts (₹82,538,997.07 → CGST .53 / SGST .54); the new
// code is exact, so the only differences are those odd-paise ties (M3 class). gstSplit amounts are no
// longer read anywhere (lib/invoice.ts uses only `.kind`; issued snapshots store their own split).
test('gst: legacy gstSplit identical except odd-paise intra-state ties; rupeesInWords identical on paise amounts', () => {
  let ties = 0;
  fc.assert(fc.property(fc.integer({min: 0, max: 10_000_000_000}), stateCodeArb, fc.oneof(stateCodeArb, fc.constant('96')), fc.boolean(), (paise, seller, pos0, same) => {
    const tax = paise / 100, pos = same ? seller : pos0;
    const a = N.gst.gstSplit(tax, seller, pos), b = O.gst.gstSplit(tax, seller, pos);
    assert.equal(N.gst.rupeesInWords(tax), O.gst.rupeesInWords(tax));
    if (a.kind === 'intra') assert.deepEqual([Math.round(a.cgst * 100), Math.round(a.sgst * 100)], [Math.ceil(paise / 2), Math.floor(paise / 2)], 'new: odd paisa to CGST');
    if (json(a) === json(b)) return;
    assert.ok(a.kind === 'intra' && paise % 2 === 1, `undocumented gstSplit difference for ${tax} ${seller}→${pos}: new ${json(a)} old ${json(b)}`);
    assert.deepEqual([Math.round(b.cgst * 100), Math.round(b.sgst * 100)], [Math.floor(paise / 2), Math.ceil(paise / 2)]);
    ties++;
  }), {numRuns: RUNS});
  assert.ok(ties < RUNS / 10, `odd-paise ties are rare (${ties})`);
});

// @covers H13
test('gst: placeOfSupply agrees on code/basis except the documented H13 cases (docs/ws-01.md)', () => {
  const seen = {same: 0, currency_not_location: 0, abroad_unconfirmed: 0};
  fc.assert(fc.property(stateCodeArb, gstinArb, fc.option(fc.oneof(stateCodeArb, fc.constant('96'), fc.constant('XX')), {nil: undefined}), fc.constantFrom('INR', 'USD', 'EUR'), (seller, gstin, client_state, currency) => {
    const p = {seller_state: seller, client_gstin: gstin, client_state, currency};
    const a = N.gst.placeOfSupply(p), b = O.gst.placeOfSupply(p);
    const viaGstin = !!O.gst.gstinState(gstin);
    if (!viaGstin && client_state === '96') {
      // H13: outside India without the forex confirmation is IGST (inter-state), not a zero-rated export.
      assert.deepEqual([b.code, b.basis], ['96', 'export']);
      assert.deepEqual([a.code, a.basis, a.supply, a.zero_rated], ['96', 'address', 'inter', false]);
      assert.deepEqual(a.warnings, [N.gst.NOT_EXPORT_WARNING]);
      seen.abroad_unconfirmed++; return;
    }
    if (!viaGstin && !(client_state && O.gst.GST_STATES[client_state]) && currency !== 'INR') {
      // H13: the currency no longer decides the place of supply; the supplier's state does, with a warning.
      assert.deepEqual([b.code, b.basis], ['96', 'export']);
      assert.deepEqual([a.code, a.basis], [seller, 'supplier']);
      assert.deepEqual(a.warnings, [N.gst.CURRENCY_NOT_LOCATION_WARNING]);
      seen.currency_not_location++; return;
    }
    assert.deepEqual([a.code, a.basis], [b.code, b.basis]);
    assert.equal(a.supply, a.code === seller ? 'intra' : 'inter');
    seen.same++;
  }), {numRuns: RUNS});
  assert.ok(seen.same > 0 && seen.currency_not_location > 0 && seen.abroad_unconfirmed > 0, json(seen));
});

// ------------------------------------------------------------------------------------------------
// Date helpers (lib/time.ts, ledger.addDays, invoice.netDays, link expiry)
// ------------------------------------------------------------------------------------------------

const isoArb = fc.integer({min: Date.parse('2020-01-01'), max: Date.parse('2030-12-31')}).map(ms => new Date(ms).toISOString());
const zoneArb = fc.oneof(fc.constantFrom('UTC', 'Asia/Kolkata', 'America/New_York', 'Europe/London', 'Australia/Lord_Howe', 'Asia/Kathmandu', 'Pacific/Chatham', 'Not/AZone', ''), fc.string({maxLength: 10}));

test('time: formatInZone, formatDay, daysAgo, stamp, zoneOrUtc, validTimeZone unchanged', () => {
  fc.assert(fc.property(isoArb, zoneArb, fc.oneof(dateArb, fc.string({maxLength: 12})), fc.integer({min: 0, max: 400 * 86400000}), (iso, tz, day, back) => {
    assert.equal(N.time.formatInZone(iso, tz), O.time.formatInZone(iso, tz));
    assert.equal(N.time.formatDay(day), O.time.formatDay(day));
    assert.deepEqual(N.time.daysAgo(iso, Date.parse(iso) + back), O.time.daysAgo(iso, Date.parse(iso) + back));
    assert.equal(N.time.stamp(iso, tz), O.time.stamp(iso, tz));
    assert.equal(N.time.zoneOrUtc(tz), O.time.zoneOrUtc(tz));
    assert.equal(N.time.validTimeZone(tz), O.time.validTimeZone(tz));
  }), {numRuns: RUNS});
  assert.deepEqual(N.time.timeZones(), O.time.timeZones());
});

test('dates: ledger.addDays, invoice.netDays/invoiceNumber, linkExpires/linkExpired unchanged', () => {
  const terms = fc.oneof(fc.constantFrom('Net 30', 'net-15', 'NET 7', 'within 7 days', 'within 200 days', 'net 121', 'On delivery', ''), fc.string({maxLength: 20}));
  fc.assert(fc.property(dateArb, fc.integer({min: -400, max: 400}), terms, fc.string({maxLength: 6}), fc.nat(99999), isoArb, fc.option(isoArb, {nil: null}), fc.option(fc.constantFrom(7, 14, 30, 60, 90, 0), {nil: null}), fc.constantFrom('pending', 'approved', 'declined'), fc.integer({min: 0, max: 120 * 86400000}),
    (day, n, t, prefix, seq, created, issued, expiry, status, later) => {
      assert.equal(N.ledger.addDays(day, n), O.ledger.addDays(day, n));
      assert.equal(N.invoice.netDays(t), O.invoice.netDays(t));
      assert.equal(N.invoice.invoiceNumber(prefix, seq), O.invoice.invoiceNumber(prefix, seq));
      const v = {status, created, link_issued: issued, link_expiry_days: expiry};
      assert.equal(N.link.linkExpires(v), O.link.linkExpires(v));
      assert.equal(N.link.linkExpired(v, Date.parse(created) + later), O.link.linkExpired(v, Date.parse(created) + later));
    }), {numRuns: RUNS});
});

// ------------------------------------------------------------------------------------------------
// Invoice/statement totals
// ------------------------------------------------------------------------------------------------

test('invoice-status: invoiceStatuses and invoiceReminderDue (pre-WS-03 statuses) unchanged', () => {
  const inv = fc.record({total: fc.integer({min: 1, max: 5_000_000}).map(c => c / 100), due: dateArb, paid_before: fc.integer({min: 0, max: 1_000_000}).map(c => c / 100)});
  fc.assert(fc.property(fc.array(inv, {maxLength: 6}), fc.integer({min: 0, max: 20_000_000}), dateArb, fc.array(isoArb, {maxLength: 4}), fc.integer({min: 1, max: 14}), isoArb, (list, paidC, today, sent, every, now) => {
    const invoices = list.map((x, i) => ({...x, seq: i + 1}));
    const a = N['invoice-status'].invoiceStatuses(invoices, paidC / 100, today), b = O['invoice-status'].invoiceStatuses(invoices, paidC / 100, today);
    assert.deepEqual(a, b);
    for (const s of b) assert.equal(N['invoice-status'].invoiceReminderDue(s, sent, every, Date.parse(now)), O['invoice-status'].invoiceReminderDue(s, sent, every, Date.parse(now)));
  }), {numRuns: RUNS});
});

const party = {seller: {name: 'Studio', address: 'Chennai', tax_id: '33ABCDE1234F1Z7', payment_details: 'UPI studio@bank'}, client: {name: 'Acme', email: 'a@acme.test'}, project: {id: 'p1', title: 'Brand identity', version: 2}};
const OLD_FIELDS = ['number', 'issued', 'due', 'seller', 'client', 'project', 'currency', 'line', 'tax', 'total', 'agreement', 'payment_terms', 'gst', 'milestone', 'fx'];
const oldShape = c => Object.fromEntries(OLD_FIELDS.filter(k => c[k] !== undefined).map(k => [k, c[k]]));

// @covers M1
test('invoice: invoiceContent without tax is the old snapshot plus the WS-03 fields; with tax only the per-head round-off differs (docs/ws-03.md, docs/ws-01.md M1/M2)', () => {
  const seen = {no_tax: 0, tax_same: 0, tax_round_off: 0, taxable_tie: 0};
  fc.assert(fc.property(fc.integer({min: 1, max: 10_000_000_000}), fc.option(fc.integer({min: 1, max: 2800}).map(h => h / 100), {nil: 0}), fc.constantFrom('INR', 'USD', 'EUR'), fc.integer({min: 0, max: 20_000_000}), fc.integer({min: 0, max: 5_000_000}), fc.integer({min: 0, max: 60}), dateArb, fc.boolean(),
    (cents, tax_pct, currency, agreedC, paidC, due_days, issued, milestone) => {
      const input = {number: 'INV-0001', issued, due_days, description: '', amount: cents / 100, ...party, currency, tax_label: 'Tax', tax_pct, agreed_total: agreedC / 100, paid: paidC / 100, payment_terms: 'Net 15', ...(milestone ? {milestone: {id: 'm1', title: 'Design', pct: 40}} : {})};
      const a = N.invoice.invoiceContent(input), b = O.invoice.invoiceContent(input);
      if (!tax_pct) { assert.deepEqual(oldShape(a), b); seen.no_tax++; return; }
      const c = v => Math.round(v * 100);
      // Old: taxable = round2(amount / (1 + p/100)), tax = amount − taxable. New: taxable = exact
      // half-up of amount × 100 / (100 + p), heads from the taxable value, residue on an explicit round-off line.
      const exactTaxable = halfUpDiv(BigInt(cents) * 10000n, 10000n + BigInt(Math.round(tax_pct * 100)));
      assert.equal(a.breakdown.taxable, exactTaxable);
      assert.equal(a.breakdown.total, cents);
      if (c(b.tax.taxable) !== exactTaxable) { assert.equal(Math.abs(c(b.tax.taxable) - exactTaxable), 1); seen.taxable_tie++; return; }
      assert.equal(c(a.tax.taxable), c(b.tax.taxable));
      assert.equal(c(a.tax.amount) + a.breakdown.round_off, c(b.tax.amount)); // old tax == new heads + round-off
      assert.deepEqual({...oldShape(a), tax: null}, {...b, tax: null});
      if (a.breakdown.round_off === 0) { assert.deepEqual(oldShape(a), b); seen.tax_same++; } else seen.tax_round_off++;
    }), {numRuns: RUNS});
  assert.ok(seen.no_tax > 0 && seen.tax_same > 0, json(seen));
});

// ------------------------------------------------------------------------------------------------
// Ledger fold, statement, review/record verification
// ------------------------------------------------------------------------------------------------

/** Adds recorded payments and refunds to a built ledger (as the server appends them). */
async function withPayments(b, entries, pays) {
  const out = [...entries];
  for (const [i, p] of pays.entries()) {
    const at = tick(1000 + i);
    if (p.refund) out.push(await append(out, b, 'refund', {amount: p.cents / 100, method: 'bank_transfer', refunded: at.slice(0, 10), reference: '', note: ''}, 'owner', at));
    else out.push(await append(out, b, 'payment_received', {amount: p.cents / 100, method: 'upi', received: at.slice(0, 10), reference: 'R' + i, note: ''}, 'owner', at));
  }
  return out;
}
const payArb = fc.array(fc.record({cents: fc.integer({min: 1, max: 3_000_000}), refund: fc.boolean()}), {maxLength: 4});
// Baselines in exponent-2 currencies with terms (tax, deposit or milestones, fx, revision bank).
const baselineArb = parsedScopeArb;

// @covers LT-14
test('ledger: entry hashes, verifyChain, computeAgreement (+ LT-14 deliverables), paymentsOf, refundableOf, describeEntry, coSummary agree', async () => {
  await fc.assert(fc.asyncProperty(baselineArb, fc.array(opArb, {minLength: 1, maxLength: 8}), payArb, fc.nat(), async (content, ops, pays, pick) => {
    const b = await approve(content);
    const entries = await withPayments(b, await buildLedger(b, ops), pays);
    for (const e of entries) {
      assert.equal(await O.ledger.entryHash(e, b.anchor), e.hash);
      assert.equal(await O.ledger.sha256(JSON.stringify(e.payload)), e.payload_hash);
    }
    const tampered = entries.length ? entries.map((e, n) => (n === pick % entries.length ? {...e, created: tick(99999)} : e)) : entries;
    for (const list of [entries, tampered, entries.slice(1)]) assert.deepEqual(await N.ledger.verifyChain(list, {1: b.anchor}), await O.ledger.verifyChain(list, {1: b.anchor}));
    const a = N.ledger.computeAgreement(content, 1, entries), o = O.ledger.computeAgreement(content, 1, entries);
    const {deliverables, ...rest} = a; // LT-14 (docs/ws-05.md): the derived deliverables-in-force line is new
    assert.deepEqual(rest, o);
    assert.equal(deliverables, a.items.map(i => N.scope.itemLine(i) + (i.source === 'baseline' ? '' : ` [CO-${i.source}]`)).join('\n'));
    const pa = N.ledger.paymentsOf(entries), po = O.ledger.paymentsOf(entries);
    assert.deepEqual(pa, po);
    for (const l of po.lines) assert.equal(N.ledger.refundableOf(l, po.lines), O.ledger.refundableOf(l, po.lines));
    for (const e of entries) {
      assert.equal(N.ledger.describeEntry(e, content.currency, o.items, content.client_inputs ?? []), O.ledger.describeEntry(e, content.currency, o.items, content.client_inputs ?? []));
      if (e.kind === 'change_order') assert.equal(N.ledger.coSummary(e.payload, content.currency, o.items), O.ledger.coSummary(e.payload, content.currency, o.items));
    }
  }), {numRuns: SLOW});
});

// @covers M5
test('ledger: checkEntry gives the same verdict on pre-rebuild entry kinds and shapes (no date context)', async () => {
  const coArb = fc.record({fee_delta: fc.integer({min: -500_000, max: 500_000}).map(c => c / 100), days: fc.integer({min: -10, max: 10}), revs: fc.integer({min: -3, max: 3}), add: fc.array(fc.record({id: fc.constantFrom('i1', 'co_a', 'co_b', 'new'), title: fc.constantFrom('Extra page', 'Banner'), qty: fc.integer({min: 1, max: 3}), unit: fc.constant(''), price: fc.constant(null), acceptance: fc.constant('')}), {maxLength: 2}), remove: fc.array(fc.constantFrom('i1', 'nope', 'co_a'), {maxLength: 2}), bank: fc.option(fc.integer({min: -50, max: 50}), {nil: undefined})});
  await fc.assert(fc.asyncProperty(baselineArb, fc.array(opArb, {maxLength: 5}), coArb, fc.constantFrom('owner', 'client', 'system'), fc.nat(), async (content, ops, co, actor, pick) => {
    const b = await approve(content);
    const entries = await buildLedger(b, ops);
    const ag = N.ledger.computeAgreement(content, 1, entries), og = O.ledger.computeAgreement(content, 1, entries);
    const ids = ag.items.map(i => i.id);
    const candidates = [
      ['change_order', {title: 'Change', reason: '', request_quote: '', add_items: co.add, remove_item_ids: co.remove.map(r => (r === 'i1' && ids.length ? ids[pick % ids.length] : r)), fee_delta: co.fee_delta, days_delta: co.days, revisions_delta: co.revs, ...(co.bank !== undefined ? {bank_delta: co.bank} : {})}],
      ['settle', {ref_seq: (pick % 6) + 1, outcome: ['approved', 'declined', 'withdrawn'][pick % 3], signer: '', comment: ''}],
      ['revision_round', {feedback_date: '2026-10-09', note: '', ...(pick % 2 ? {used: 1} : {})}],
      ['goodwill', {title: 'Extra polish', value: 10, hours: 0, note: '', visible: true}],
      ['client_input', {input_id: (content.client_inputs ?? [])[0]?.id ?? 'nope', received: '2026-10-08', note: ''}],
      ['payment_received', {amount: 10, method: 'upi', received: '2026-10-08', reference: '', note: ''}],
      ['refund', {amount: 10, method: 'upi', refunded: '2026-10-08', reference: '', note: ''}],
    ];
    for (const [kind, raw] of candidates) {
      const np = N.ledger.payloadSchemas[kind].safeParse(raw), op = O.ledger.payloadSchemas[kind].safeParse(raw);
      assert.equal(np.success, op.success, `${kind} payload acceptance differs: ${json(raw)}`);
      if (!np.success) continue;
      assert.equal(json(np.data), json(op.data));
      assert.equal(N.ledger.checkEntry(kind, np.data, content, ag, actor), O.ledger.checkEntry(kind, op.data, content, og, actor), `${kind} ${json(raw)}`);
    }
  }), {numRuns: SLOW});
});

test('statement: statementModel equal; totals-derived fields equal wherever old and new totals() agree (ties: tests/differential/ws-01-totals)', async () => {
  let compared = 0;
  await fc.assert(fc.asyncProperty(baselineArb, fc.array(opArb, {maxLength: 6}), payArb, zoneArb, async (content, ops, pays, tz) => {
    const b = await approve(content);
    const entries = await withPayments(b, await buildLedger(b, ops), pays);
    const ag = N.ledger.computeAgreement(content, 1, entries), og = O.ledger.computeAgreement(content, 1, entries);
    const args = {project_id: 'p_prop', version: 1, content, entries, time_zone: tz, generated: tick(5000)};
    const a = N.statement.statementModel({...args, agreement: ag}), o = O.statement.statementModel({...args, agreement: og});
    const derived = ['tax', 'total', 'deposit', 'balance', 'overpaid', 'schedule', 'fx'];
    const strip = m => Object.fromEntries(Object.entries(m).filter(([k]) => !derived.includes(k)));
    assert.deepEqual(strip(a), strip(o));
    const sameTotals = json(N.money.totals(content, ag.fee)) === json(O.money.totals(content, og.fee)) && json(N.money.totals(content)) === json(O.money.totals(content));
    const sameSchedule = json(N.money.schedule(content, a.total)) === json(O.money.schedule(content, a.total));
    const sameFx = !content.fx || N.money.fxLine(content, a.total) === O.money.fxLine(content, a.total);
    if (sameTotals && sameSchedule && sameFx) { assert.deepEqual(a, o); compared++; }
  }), {numRuns: SLOW});
  assert.ok(compared > SLOW / 2, `most statements compared in full (${compared})`);
});

test('diff: semanticDiff and describeChange unchanged', () => {
  fc.assert(fc.property(baselineArb, baselineArb, fc.boolean(), (p, q, sameItems) => {
    const next = sameItems ? {...q, items: p.items?.map((i, n) => (n === 0 ? {...i, title: i.title + ' v2', price: i.price == null ? 10 : null} : i)), currency: p.currency} : {...q, currency: p.currency};
    const a = N.diff.semanticDiff(p, next), o = O.diff.semanticDiff(p, next);
    assert.deepEqual(a, o);
    for (const c of o) assert.equal(N.diff.describeChange(c, p.currency), O.diff.describeChange(c, p.currency));
  }), {numRuns: RUNS});
});

test('cosign: cosignersSchema, cosignMessage and cosignStatus unchanged for pre-rebuild cosigners (id, role)', async () => {
  const cos = fc.uniqueArray(fc.record({id: fc.stringMatching(/^[a-z0-9_-]{1,8}$/), role: fc.constantFrom('Director', 'Finance head', 'Legal', 'X')}), {maxLength: 4, selector: c => c.id});
  await fc.assert(fc.asyncProperty(cos, fc.nat(), fc.stringMatching(/^[0-9a-f]{64}$/), async (list, mask, anchor) => {
    const a = N.cosign.cosignersSchema.safeParse(list), o = O.cosign.cosignersSchema.safeParse(list);
    assert.equal(a.success, o.success);
    if (!o.success) return;
    assert.deepEqual(a.data, o.data);
    const signed = o.data.filter((_, i) => mask & (1 << i)).map((c, i) => ({cosigner_id: c.id, role: c.role, signer: 'Signer ' + i, signed: tick(i), signature: null}));
    assert.deepEqual(N.cosign.cosignStatus(o.data, signed), O.cosign.cosignStatus(o.data, signed));
    for (const s of signed) assert.equal(await N.cosign.cosignMessage(anchor, s), await O.cosign.cosignMessage(anchor, s));
  }), {numRuns: RUNS});
});

test('receipt: verifyUrl and qrMatrix unchanged', () => {
  fc.assert(fc.property(fc.constantFrom('https://scope-flow.tech', 'http://127.0.0.1:5173', 'https://scope-flow.tech/'), idArb, fc.nat(99), fc.stringMatching(/^[0-9a-f]{64}$/), (origin, pid, v, anchor) => {
    const u = N.receipt.verifyUrl(origin, pid, v, anchor);
    assert.equal(u, O.receipt.verifyUrl(origin, pid, v, anchor));
    assert.deepEqual(N.receipt.qrMatrix(u), O.receipt.qrMatrix(u));
  }), {numRuns: Math.max(100, RUNS / 5)});
});

// ---- signatures: records sealed by the old build must still verify on the new one --------------

const SECRET_B = 'scopeflow-differential-rotated-signing-secret-987654321';
const COOKIE = 'scopeflow-differential-neon-auth-cookie-secret-0123456789';
const ENV_KEYS = ['SCOPEFLOW_SIGNING_SECRET', 'SCOPEFLOW_SIGNING_SECRET_PREVIOUS', 'NEON_AUTH_COOKIE_SECRET', 'NODE_ENV', 'SCOPEFLOW_ALLOW_COOKIE_SIGNING', 'SCOPEFLOW_LEGACY_KEY_IDS'];
function withEnv(env, fn) {
  const saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  for (const k of ENV_KEYS) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  try { return fn(); } finally { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}

// @covers C6
test('signing: old-sealed anchors and entries verify on the new build (current key, rotated key); C6 cookie-key rule as documented (docs/ws-02.md)', () => {
  fc.assert(fc.property(fc.stringMatching(/^[0-9a-f]{64}$/), fc.boolean(), fc.nat(63), (hash, entry, flip) => {
    const msgOld = entry ? O.signing.entryMessage(hash) : O.signing.anchorMessage(hash);
    assert.equal(msgOld, entry ? N.signing.entryMessage(hash) : N.signing.anchorMessage(hash));
    const tamperedMsg = msgOld.slice(0, -1) + (msgOld.at(-1) === 'a' ? 'b' : 'a');
    // 1. Dedicated key: signed by the old build, verified by the new one.
    const dedicated = {SCOPEFLOW_SIGNING_SECRET: TEST_SECRET, NODE_ENV: 'production'};
    const sig = withEnv(dedicated, () => O.signing.signRecord(msgOld));
    withEnv(dedicated, () => {
      assert.equal(sig, N.signing.signRecord(msgOld), 'Ed25519 is deterministic: same key, same signature');
      assert.equal(N.signing.verifyRecord(msgOld, sig), 'valid');
      assert.equal(N.signing.verifyRecordDetailed(msgOld, sig), 'valid');
      assert.equal(N.signing.verifyRecord(tamperedMsg, sig), O.signing.verifyRecord(tamperedMsg, sig));
      assert.equal(N.signing.verifyRecord(tamperedMsg, sig), 'invalid');
      const badSig = sig.slice(0, 17 + (flip % 20)) + (sig[17 + (flip % 20)] === 'A' ? 'B' : 'A') + sig.slice(18 + (flip % 20));
      assert.equal(N.signing.verifyRecord(msgOld, badSig), O.signing.verifyRecord(msgOld, badSig));
      assert.equal(N.signing.verifyRecord(msgOld, null), O.signing.verifyRecord(msgOld, null));
      assert.deepEqual(N.signing.publicSigningKey(), O.signing.publicSigningKey());
    });
    // 2. Rotation: the old secret moved to SCOPEFLOW_SIGNING_SECRET_PREVIOUS stays fully trusted.
    const rotated = {SCOPEFLOW_SIGNING_SECRET: SECRET_B, SCOPEFLOW_SIGNING_SECRET_PREVIOUS: TEST_SECRET, NODE_ENV: 'production'};
    withEnv(rotated, () => {
      assert.equal(O.signing.verifyRecord(msgOld, sig), 'valid');
      assert.equal(N.signing.verifyRecord(msgOld, sig), 'valid');
      assert.equal(N.signing.verifyRecordDetailed(msgOld, sig), 'valid');
    });
    // 3. Cookie-derived key (records sealed before the dedicated secret existed).
    const cookieSig = withEnv({NEON_AUTH_COOKIE_SECRET: COOKIE, NODE_ENV: 'development'}, () => O.signing.signRecord(msgOld));
    withEnv({NEON_AUTH_COOKIE_SECRET: COOKIE, NODE_ENV: 'development'}, () => assert.equal(N.signing.verifyRecord(msgOld, cookieSig), 'valid'));
    const prod = {SCOPEFLOW_SIGNING_SECRET: SECRET_B, NEON_AUTH_COOKIE_SECRET: COOKIE, NODE_ENV: 'production'};
    withEnv(prod, () => {
      assert.equal(O.signing.verifyRecord(msgOld, cookieSig), 'valid'); // old: always trusted
      // C6: in production the cookie key is trusted only when allow-listed (or cookie signing is allowed).
      assert.equal(N.signing.verifyRecordDetailed(msgOld, cookieSig), 'unknown_key');
      assert.equal(N.signing.verifyRecord(msgOld, cookieSig), 'invalid');
    });
    withEnv({...prod, SCOPEFLOW_LEGACY_KEY_IDS: cookieSig.split('.')[0]}, () => {
      assert.equal(N.signing.verifyRecordDetailed(msgOld, cookieSig), 'legacy_key');
      assert.equal(N.signing.verifyRecord(msgOld, cookieSig), 'valid');
    });
    withEnv({...prod, SCOPEFLOW_ALLOW_COOKIE_SIGNING: '1'}, () => assert.equal(N.signing.verifyRecord(msgOld, cookieSig), 'valid'));
  }), {numRuns: Math.max(100, RUNS / 5)});
});

test('review: a record built and sealed by the old build passes the new client check and the new server verification', async () => {
  await fc.assert(fc.asyncProperty(baselineArb, fc.array(opArb, {minLength: 1, maxLength: 6}), fc.nat(), async (content, ops, pick) => {
    // Build the record with the OLD hashing and signing code.
    const anchor = await O.ledger.anchorHash({project_id: 'p_old', version: 1, content, signer: 'Client Signer', decided: tick(0)});
    const b = {project_id: 'p_old', version: 1, content, signer: 'Client Signer', decided: tick(0), anchor, signature: O.signing.signRecord(O.signing.anchorMessage(anchor))};
    const built = await buildLedger(b, ops);
    const entries = [];
    for (const e of built) {
      const {hash: _h, signature: _s, payload, ...head} = e;
      const prev = entries.at(-1);
      const fixed = {...head, prev_hash: prev?.hash ?? O.ledger.GENESIS, payload_hash: await O.ledger.sha256(JSON.stringify(payload))};
      const hash = await O.ledger.entryHash(fixed, anchor);
      entries.push({...fixed, payload, hash, signature: O.signing.signRecord(O.signing.entryMessage(hash))});
    }
    const head = (await O.ledger.verifyChain(entries, {1: anchor})).head;
    const scope = {project_id: 'p_old', version: 1, content, signer: 'Client Signer', decided: tick(0)};
    const ledger = {entries, anchors: {1: anchor}, head, seal: {state: 'valid'}};
    // New server verification: anchor recomputes, chain intact, every signature valid.
    assert.equal(await N.ledger.anchorHash(scope), anchor);
    const chain = await N.ledger.verifyChain(entries, {1: anchor});
    assert.deepEqual(chain, await O.ledger.verifyChain(entries, {1: anchor}));
    assert.equal(N.signing.verifyRecord(N.signing.anchorMessage(anchor), b.signature), 'valid');
    for (const e of entries) assert.equal(N.signing.verifyRecord(N.signing.entryMessage(e.hash), e.signature), 'valid');
    // New and old client checks agree, on the record and on a tampered copy.
    assert.deepEqual(await N['record-check'].checkClientRecord(scope, ledger), await O['record-check'].checkClientRecord(scope, ledger));
    if (chain.intact) assert.equal((await N['record-check'].checkClientRecord(scope, ledger)).state, 'ok');
    if (!entries.length) return;
    const i = pick % entries.length;
    const bad = {...ledger, entries: entries.map((e, n) => (n === i ? {...e, payload_hash: '0'.repeat(64)} : e))};
    assert.deepEqual(await N['record-check'].checkClientRecord(scope, bad), await O['record-check'].checkClientRecord(scope, bad));
  }), {numRuns: SLOW});
});

test('fixtures are the 5e59e44 code (FROZEN_NOW sanity)', () => {
  assert.ok(FROZEN_NOW > 0);
  assert.equal(typeof O.money.totals, 'function');
  assert.equal(O.money.totalsMinor, undefined, 'the frozen money module predates WS-01');
  assert.equal(O.gst.gstFromExclusive, undefined, 'the frozen gst module predates WS-01');
});
