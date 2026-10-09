// Statement of account (lib/statement.ts): the figures come only from the approved baseline and its
// ledger, the balance never goes negative, and the PDF is deterministic and states every figure.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fc, freezeClock, tick} from '../support/property.mjs';
import {approve, append} from '../support/chain.mjs';

freezeClock();
const L = await import('../../lib/ledger.ts');
const {statementModel, renderStatementPdf} = await import('../../lib/statement.ts');
const {totals} = await import('../../lib/money.ts');
const base = {title: 'Statement fixture', client: 'Acme', deliverables: 'Logo design suite', exclusions: '', fee: 1000, currency: 'INR', revisions: 2, due: '2026-12-15', notes: '', tax_pct: 18, tax_label: 'GST', deposit_pct: 30, payment_terms: 'Balance within 15 days of delivery.'};
const latin1 = bytes => Buffer.from(bytes).toString('latin1');

async function ledger(payments, {co} = {}) {
  const b = await approve(base);
  const entries = [];
  if (co) {
    entries.push(await append(entries, b, 'change_order', {title: 'Extra', reason: '', request_quote: '', add_items: [], remove_item_ids: [], fee_delta: co, days_delta: 0, revisions_delta: 0}, 'owner', tick(entries.length + 1)));
    entries.push(await append(entries, b, 'settle', {ref_seq: 1, outcome: 'approved', signer: 'Ada', comment: ''}, 'client', tick(entries.length + 1)));
  }
  for (const p of payments) entries.push(await append(entries, b, 'payment_received', {method: 'upi', received: '2026-10-01', reference: '', note: '', ...p}, 'owner', tick(entries.length + 1)));
  return {b, entries, agreement: L.computeAgreement(base, 1, entries)};
}
const model = ({entries, agreement}) => statementModel({project_id: 'p1', version: 1, content: base, agreement, entries, time_zone: 'Asia/Kolkata', generated: tick(0)});

test('figures: total with tax after approved change orders, paid, balance, overpaid', async () => {
  const m = model(await ledger([{amount: 354}, {amount: 500, method: 'bank_transfer', reference: 'UTR1'}], {co: 200}));
  assert.equal(m.fee, 1200); assert.equal(m.fee_base, 1000);
  assert.equal(m.tax, 216); assert.equal(m.total, 1416);
  assert.equal(m.deposit, totals(base).deposit); // the deposit stays what was signed
  assert.equal(m.paid, 854); assert.equal(m.balance, 562); assert.equal(m.overpaid, 0);
  assert.equal(m.lines.length, 2); assert.equal(m.entries, 4); assert.ok(/^[0-9a-f]{64}$/.test(m.head));
  const over = model(await ledger([{amount: 1500}]));
  assert.equal(over.balance, 0); assert.equal(over.overpaid, 1500 - 1180);
});

test('balance = max(0, total - paid) for any payments', async () => {
  await fc.assert(fc.asyncProperty(fc.array(fc.integer({min: 1, max: 80000}), {maxLength: 4}), async cents => {
    const m = model(await ledger(cents.map(c => ({amount: c / 100}))));
    const paid = Math.round(cents.reduce((s, c) => s + c, 0)) / 100;
    assert.equal(m.paid, paid);
    assert.equal(m.balance, Math.max(0, Math.round((1180 - paid) * 100) / 100));
    assert.ok(m.balance >= 0 && m.overpaid >= 0 && (m.balance === 0 || m.overpaid === 0));
  }), {numRuns: 40});
});

test('PDF: deterministic, states the figures, payment terms and the record fingerprint', async () => {
  const m = model(await ledger([{amount: 354, reference: 'UTR77', note: 'Deposit'}]));
  const a = renderStatementPdf(m), b = renderStatementPdf(m);
  assert.deepEqual(a, b);
  const text = latin1(a);
  assert.ok(text.startsWith('%PDF-1.4'));
  for (const s of ['STATEMENT OF ACCOUNT', 'Total with GST', 'Rs.1,180', 'Rs.354', 'Balance due', 'Rs.826', 'ref. UTR77', 'Balance within 15 days', m.head, 'not a tax invoice']) assert.ok(text.includes(s), s);
  const none = latin1(renderStatementPdf(model(await ledger([]))));
  assert.ok(none.includes('No payments are on the record yet.'));
  const paid = latin1(renderStatementPdf(model(await ledger([{amount: 1180}]))));
  assert.ok(paid.includes('Paid in full.'));
});
