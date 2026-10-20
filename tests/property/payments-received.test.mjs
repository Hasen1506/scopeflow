// Payments recorded by the creator (ledger kind payment_received). Pure: schema, validation against
// the agreement, the paid total (with Razorpay deposits), wording, and that payments never move the
// agreement itself (fee, items, dates stay exactly as the approved baseline plus change orders).
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fc, freezeClock, tick} from '../support/property.mjs';
import {approve, append} from '../support/chain.mjs';

freezeClock();
const L = await import('../../lib/ledger.ts');
const base = {title: 'Payments fixture', client: 'Acme', deliverables: 'Logo design suite', exclusions: '', fee: 1000, currency: 'INR', revisions: 2, due: '2026-12-15', notes: ''};
const good = {amount: 300, method: 'upi', received: '2026-10-01', reference: 'UTR9', note: ''};

test('schema: strict, positive amounts, known methods, a date', () => {
  assert.equal(L.payloadSchemas.payment_received.safeParse(good).success, true);
  assert.deepEqual(L.payloadSchemas.payment_received.parse({amount: 5, method: 'cash', received: '2026-10-01'}), {amount: 5, method: 'cash', received: '2026-10-01', reference: '', note: ''});
  for (const bad of [{...good, amount: 0}, {...good, amount: -1}, {...good, method: 'barter'}, {...good, received: ''}, {...good, received: '2026-13-01'}, {...good, extra: 1}, {...good, reference: 'x'.repeat(81)}]) {
    assert.equal(L.payloadSchemas.payment_received.safeParse(bad).success, false, JSON.stringify(bad));
  }
  assert.ok(L.entryKinds.includes('payment_received'));
});

test('checkEntry: two decimals at most (without float false alarms), no future dates', () => {
  const a = L.computeAgreement(base, 1, []);
  for (const amount of [0.29, 1.1, 19.99, 1234.56, 0.01]) assert.equal(L.checkEntry('payment_received', {...good, amount}, base, a, 'owner'), null, String(amount));
  assert.match(L.checkEntry('payment_received', {...good, amount: 10.005}, base, a, 'owner'), /two decimals/);
  assert.match(L.checkEntry('payment_received', {...good, received: '2999-01-01'}, base, a, 'owner'), /future/);
  fc.assert(fc.property(fc.integer({min: 1, max: 10_000_000_00}), cents => assert.equal(L.checkEntry('payment_received', {...good, amount: cents / 100}, base, a, 'owner'), null)), {numRuns: 2000});
});

test('paymentsOf: sums Razorpay deposits and recorded payments; payments leave the agreement unchanged', async () => {
  const b = await approve(base);
  const entries = [];
  entries.push(await append(entries, b, 'payment', {provider: 'razorpay', purpose: 'deposit', order_id: 'order_1', payment_id: 'pay_1', amount: 250.5, currency: 'INR'}, 'client', tick(1)));
  entries.push(await append(entries, b, 'payment_received', good, 'owner', tick(2)));
  entries.push(await append(entries, b, 'payment_received', {...good, amount: 0.29, method: 'bank_transfer', reference: ''}, 'owner', tick(3)));
  const {lines, paid} = L.paymentsOf(entries);
  assert.equal(paid, 550.79);
  assert.deepEqual(lines.map(l => [l.source, l.method, l.amount]), [['razorpay', 'Razorpay', 250.5], ['owner', 'UPI', 300], ['owner', 'Bank transfer', 0.29]]);
  assert.deepEqual(L.computeAgreement(base, 1, entries), L.computeAgreement(base, 1, []));
  assert.deepEqual(L.paymentsOf([]), {lines: [], paid: 0});
});

test('describeEntry: readable money, method and day', () => {
  assert.equal(L.describeEntry({seq: 2, kind: 'payment_received', payload: good}, 'INR'), 'Payment received: ₹300.00 by UPI on 1 Oct 2026 (ref. UTR9)');
  assert.equal(L.describeEntry({seq: 3, kind: 'payment_received', payload: {...good, method: 'bank_transfer', reference: ''}}, 'INR'), 'Payment received: ₹300.00 by bank transfer on 1 Oct 2026');
  assert.equal(L.describeEntry({seq: 5, kind: 'payment_received', payload: {...good, method: 'cash', reference: ''}}, 'INR'), 'Payment received: ₹300.00 in cash on 1 Oct 2026');
  assert.equal(L.describeEntry({seq: 4, kind: 'revision_round', payload: {feedback_date: '2026-10-08', note: ''}}, 'INR'), 'Revision round received 8 Oct 2026');
});

test('checkEntry: decimals follow the agreement currency (JPY has none); the project date bounds the future', () => {
  const jpy = {...base, currency: 'JPY'};
  const a = L.computeAgreement(jpy, 1, []);
  assert.equal(L.checkEntry('payment_received', {...good, amount: 300}, jpy, a, 'owner'), null);
  assert.match(L.checkEntry('payment_received', {...good, amount: 300.5}, jpy, a, 'owner'), /whole amount/);
  assert.match(L.checkEntry('refund', {amount: 1.5, method: 'upi', refunded: '2026-10-01', reference: '', note: ''}, jpy, a, 'owner'), /whole amount/);
  const inr = L.computeAgreement(base, 1, []);
  assert.match(L.checkEntry('payment_received', {...good, received: '2026-10-12'}, base, inr, 'owner', {today: '2026-10-10'}), /future/);
  assert.equal(L.checkEntry('payment_received', {...good, received: '2026-10-11'}, base, inr, 'owner', {today: '2026-10-10'}), null);
});
