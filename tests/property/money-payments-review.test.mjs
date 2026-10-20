// Review section 1 (money and payments), M1–M11: pure regressions. No server, no network.
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fc} from '../support/property.mjs';

const M = await import('../../lib/money-ledger.ts');
const D = await import('../../lib/deposit-paid.ts');
const S = await import('../../lib/stripe.ts');
// lib/payment-record.ts pulls lib/server.ts ('@/db'); its pure helpers live in payment-record-pure.ts.
const PR = await import('../../lib/payment-record-pure.ts');
const MS = await import('../../lib/msmed.ts');
const G = await import('../../lib/gst.ts');
const IG = await import('../../lib/invoice-gst.ts');
const {paymentSchema, paymentsOf, describeEntry} = await import('../../lib/ledger.ts');

const entry = (seq, kind, payload) => ({seq, kind, payload, baseline_version: 1, created: '2026-10-07T09:00:00.000Z'});
const pay = (seq, amount, currency, purpose = 'deposit') => entry(seq, 'payment', {provider: 'stripe', purpose, order_id: 'o' + seq, payment_id: 'p' + seq, amount, currency});

test('M1: a known order whose payment did not reach the ledger is never stamped processed', () => {
  assert.equal(PR.notOnLedger({recorded: false, ledger: false, duplicate: true}), true);
  assert.equal(PR.notOnLedger({recorded: false, ledger: false, ignored: 'unknown_order'}), false);
  assert.equal(PR.notOnLedger({recorded: false, ledger: true, seq: 4, duplicate: true}), false);
  assert.equal(PR.notOnLedger(null), false);
});

test('M2: a ¥1,000 payment on an INR agreement is excess, never ₹1,000 toward it', () => {
  const agreement = {baseline_version: 1, currency: 'INR', total: 1_000_00, deposit: 1_000_00};
  const s = M.moneyState([pay(2, 1000, 'JPY')], agreement);
  assert.equal(s.received, 0);
  assert.equal(s.deposit.covered, false);
  assert.equal(s.by_purpose.excess, 100000);
  // A refund of it is skipped too, so the INR money is untouched.
  const r = M.moneyState([pay(2, 1000, 'JPY'), pay(3, 500, 'INR'), entry(4, 'refund', {amount: 1000, method: 'stripe', refund_of: 2})], agreement);
  assert.equal(r.received, 50000);
  assert.equal(r.refunded, 0);
  // Same-currency payments are unchanged.
  assert.equal(M.moneyState([pay(2, 1000, 'INR')], agreement).deposit.covered, true);
  assert.equal(D.depositCoveredBy([pay(2, 1000, 'JPY')], 'INR', 1_000_00).src, undefined);
  assert.equal(D.depositCoveredBy([pay(2, 1000, 'JPY'), pay(3, 1000, 'INR')], 'INR', 1_000_00).src.seq, 3);
  assert.equal(M.carryForwardOk([pay(2, 1000, 'JPY'), entry(3, 'baseline_superseded', {from: 1, to: 2, paid_minor: 0, invoiced_minor: 0})], 'INR'), true);
  fc.assert(fc.property(fc.integer({min: 1, max: 1_000_000}), fc.constantFrom('USD', 'JPY', 'EUR'), (amount, cur) => {
    assert.equal(M.moneyState([pay(2, amount, cur)], agreement).received, 0);
  }));
});

test('M3: a complete but unpaid Stripe session is processing, never expired', () => {
  assert.equal(S.sessionState(null, 'complete', 'unpaid'), 'processing');
  assert.equal(S.sessionState(null, 'expired', 'unpaid'), 'expired');
  assert.equal(S.sessionState(null, 'open', 'unpaid'), 'open');
  assert.equal(S.sessionState({payment_id: 'pi_1'}, 'complete', 'paid'), 'paid');
});

test("M6: the payment schema accepts purpose 'balance' (older 'deposit'/'invoice' entries still parse)", () => {
  const base = {provider: 'razorpay', order_id: 'order_1', payment_id: 'pay_1', amount: 10, currency: 'INR'};
  for (const purpose of ['deposit', 'invoice', 'balance']) assert.equal(paymentSchema.safeParse({...base, purpose}).success, true);
  assert.equal(paymentSchema.safeParse({...base, purpose: 'other'}).success, false);
});

test("M6: payments with purpose 'balance' are labelled \"Balance payment\", never \"Deposit\"", () => {
  const entries = [pay(2, 100, 'INR', 'deposit'), pay(3, 200, 'INR', 'balance'), {...pay(4, 300, 'INR', 'invoice'), payload: {...pay(4, 300, 'INR', 'invoice').payload, invoice_number: 'INV-0001'}}];
  assert.deepEqual(paymentsOf(entries).lines.map(l => l.note), ['Deposit', 'Balance payment', 'Invoice INV-0001']);
  assert.match(describeEntry(entries[0], 'INR'), /^Deposit received:/);
  assert.match(describeEntry(entries[1], 'INR'), /^Balance payment received:/);
  assert.match(describeEntry(entries[2], 'INR'), /^Payment for invoice INV-0001 received:/);
});

test('M8: the MSMED worksheet uses each currency\'s own decimals', () => {
  const r = {principal: 123456, interest_from: '2026-01-01', paid_on: '2026-02-01', rate_basis: 'on_due_date', periods: [], interest: 789, total: 124245, covered: true, note: ''};
  assert.match(MS.interestCsv(r, 'INR'), /total,,,1234\.56,,,7\.89,1242\.45/);
  assert.match(MS.interestCsv(r, 'JPY'), /total,,,123456,,,789,124245/);
  assert.match(MS.interestCsv(r, 'KWD'), /total,,,123\.456,,,0\.789,124\.245/);
});

test('M10: invoice-gst runs on the gst.ts engine with the same figures', () => {
  fc.assert(fc.property(fc.integer({min: 0, max: 10_000_000_00}), fc.constantFrom(0.25, 3, 5, 12, 18, 28), fc.constantFrom('intra', 'inter', 'export'), (minor, rate, kind) => {
    assert.deepEqual(IG.gstFromExclusive(minor, rate, kind), G.gstFromExclusive(minor, rate, kind));
    assert.deepEqual(IG.gstFromInclusive(minor, rate, kind), G.gstFromInclusive(minor, rate, kind));
  }), {numRuns: 2000});
  assert.deepEqual(IG.gstFromExclusive(10000, 18, 'single'), G.gstFromExclusive(10000, 18, 'none'));
  // A 0% invoice still carries no heads at all.
  assert.deepEqual(IG.gstFromExclusive(10000, 0, 'intra'), {taxable: 10000, heads: [], round_off: 0, total: 10000});
  assert.deepEqual(IG.gstFromInclusive(10000, 0, 'inter'), {taxable: 10000, heads: [], round_off: 0, total: 10000});
});

const withCheck = body => {
  const C = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let sum = 0;
  for (let i = 0; i < 14; i++) { const p = C.indexOf(body[i]) * (i % 2 ? 2 : 1); sum += Math.floor(p / 36) + (p % 36); }
  return body + C[(36 - (sum % 36)) % 36];
};
test('M11: GSTINs with prefixes 25, 28 and 99 are valid; they are not offered as states', () => {
  for (const code of ['25', '28', '99']) {
    const g = withCheck(code + 'ABCDE1234F1Z');
    assert.equal(G.validGstin(g), true, g);
    assert.equal(G.gstinState(g), '');
    assert.equal(G.stateCodes.includes(code), false);
  }
  assert.equal(G.validGstin(withCheck('00ABCDE1234F1Z')), false);
  assert.equal(G.validGstin(withCheck('33ABCDE1234F1Z')), true);
});
