// WS-03 properties. C2: any random sequence of invoice, credit-note, advance and change-order
// operations keeps the live invoices (gross, advances included) within the agreement total.
// M10: allocate() never goes negative, applies no more than was received net of refunds, and the
// statement's coverage equals the sum of the invoices' coverage. Seeded (FC_SEED), frozen clock.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fc, freezeClock} from '../support/property.mjs';

freezeClock();
const I = await import('../../lib/invoice.ts');
const G = await import('../../lib/invoice-gst.ts');
const C = await import('../../lib/invoice-cap.ts');
const CN = await import('../../lib/credit-note.ts');
const RV = await import('../../lib/receipt-voucher.ts');
const S = await import('../../lib/invoice-status.ts');

const seller = {name: 'Ada Studio', address: '12 MG Road, Chennai', tax_id: '33ABCDE1234F1Z5', payment_details: ''};
const places = {
  single: undefined,
  intra: {seller_state: '33', sac: '998314', lut_arn: '', client_gstin: '', client_state: '33', client_address: ''},
  inter: {seller_state: '33', sac: '998314', lut_arn: '', client_gstin: '', client_state: '29', client_address: ''},
};
const base = {issued: '2026-10-09', due_days: 15, description: '', seller, client: {name: 'Kaveri Foods', email: ''}, project: {id: 'p1', title: 'Packaging', version: 1}, currency: 'INR', tax_label: 'GST', paid: 0, payment_terms: ''};

const op = fc.oneof(
  fc.record({k: fc.constant('invoice'), amount: fc.integer({min: 1, max: 20_000_00}), includes_tax: fc.boolean()}),
  fc.record({k: fc.constant('credit'), pick: fc.nat(), amount: fc.option(fc.integer({min: 1, max: 20_000_00}), {nil: null})}),
  fc.record({k: fc.constant('advance'), amount: fc.integer({min: 1, max: 20_000_00})}),
  fc.record({k: fc.constant('co'), delta: fc.integer({min: 1, max: 5_000_00})}),
  // Invoice the whole balance (taxable value left), which adjusts any advances.
  fc.record({k: fc.constant('balance'), includes_tax: fc.constant(false)}),
);

const seen = {invoice: 0, credit: 0, advance: 0, co: 0, final: 0, refused: 0};
function run({fee, rate, place, ops}) {
  const gst = places[place];
  const kind = I.taxPlacement({gst, currency: 'INR', tax_label: 'GST', tax_pct: rate}).kind;
  let taxable = fee;
  const agreement = () => ({taxable, total: G.gstFromExclusive(taxable, rate, kind).total});
  const docs = {invoices: [], vouchers: [], credits: [], tdsCredits: [], acceptances: []};
  let seq = 0;
  const check = () => {
    const a = agreement();
    const live = docs.invoices.filter(i => !C.cancelled(i)).reduce((s, i) => s + (i.total - i.credited) + (i.content.advance?.total ?? 0), 0);
    const advances = C.unadjustedAdvances(docs).reduce((s, v) => s + v.total, 0);
    assert.ok(live + advances <= a.total, `live ${live} + advances ${advances} > agreement ${a.total}`);
    const cap = C.computeInvoiceable(a, docs);
    for (const v of [cap.total, cap.gross_total, cap.taxable, cap.gross_taxable]) assert.ok(v >= 0);
    assert.ok(cap.total <= cap.gross_total);
  };
  for (const o of ops) {
    const a = agreement(), cap = C.computeInvoiceable(a, docs);
    if (o.k === 'invoice' || o.k === 'balance') {
      const amount = o.k === 'balance' ? cap.gross_taxable : o.amount;
      if (!(amount > 0)) continue;
      const input = {...base, amount: amount / 100, includes_tax: o.includes_tax, tax_pct: rate, gst, agreed_total: a.total / 100};
      const gross = I.grossBreakdown(input);
      const final = cap.advances > 0 && gross.taxable >= cap.gross_taxable;
      if (I.invoiceProblem(gross, cap, 'INR', final)) { seen.refused++; continue; }
      const advances = final ? C.unadjustedAdvances(docs) : [];
      if (advances.reduce((s, v) => s + v.taxable, 0) > gross.taxable) continue;
      const content = I.invoiceContent({...input, number: I.invoiceNumber('INV-', ++seq), advances, cap});
      seen.invoice++; if (advances.length) seen.final++;
      const g = I.invoiceGross(content);
      docs.invoices.push({row: {id: 'i' + seq, seq, number: content.number, version: 1, amount: content.total, currency: 'INR', issued: content.issued, content: ''}, content, total: content.breakdown.total, gross: g.total, gross_taxable: g.taxable, credited: 0, credited_taxable: 0, cancelled_by: [], legacy: false});
    } else if (o.k === 'credit') {
      const open = docs.invoices.filter(i => i.total - i.credited > 0);
      if (!open.length) continue;
      const inv = open[o.pick % open.length];
      const live = inv.total - inv.credited, liveTaxable = Math.max(0, inv.gross_taxable - (inv.content.advance?.taxable ?? 0) - inv.credited_taxable);
      if (o.amount !== null && o.amount > live) continue;
      const n = docs.credits.length + 1;
      const content = CN.creditNoteContent({seq: n, issued: '2026-10-10', reason: 'Property', invoice_seq: inv.row.seq, invoice: inv.content, live, live_taxable: liveTaxable, amount: o.amount});
      assert.ok(content.breakdown.total <= live);
      docs.credits.push({seq: n, number: content.number, invoice_seq: inv.row.seq, amount: content.breakdown.total, taxable: content.breakdown.taxable, issued: '2026-10-10', content});
      inv.credited += content.breakdown.total; inv.credited_taxable += content.breakdown.taxable;
      seen.credit++;
    } else if (o.k === 'advance') {
      // lib/invoice-server.ts ensureReceiptVouchers: an advance beyond what is left to invoice is an excess.
      const amount = Math.min(o.amount, cap.total);
      if (amount <= 0) continue;
      const n = docs.vouchers.length + 1;
      const content = RV.receiptVoucherContent({seq: n, issued: '2026-10-09', received: '2026-10-09', amount: amount / 100, currency: 'INR', seller: {...seller, state: '33'}, client: {name: 'Kaveri Foods', email: ''}, project: base.project, tax_label: 'GST', tax_pct: rate, gst, payment: {ledger_seq: 100 + n, method: 'Bank transfer', reference: ''}});
      docs.vouchers.push({seq: n, number: content.number, ledger_seq: 100 + n, amount, taxable: content.breakdown?.taxable ?? amount, issued: '2026-10-09T10:00:00Z', content});
      seen.advance++;
    } else { taxable += o.delta; seen.co++; }
    check();
  }
}

test('C2 property: Σ live invoices (plus unadjusted advances) never exceeds the agreement total', () => {
  // @covers C2 H11 H12
  fc.assert(fc.property(
    fc.record({fee: fc.integer({min: 1, max: 50_000_00}), rate: fc.constantFrom(0, 5, 12, 18, 28), place: fc.constantFrom('single', 'intra', 'inter'), ops: fc.array(op, {minLength: 1, maxLength: 25})}),
    run,
  ), {numRuns: 300});
  // The generator reaches every kind of operation, including final invoices that adjust advances.
  for (const [k, n] of Object.entries(seen)) assert.ok(n > 0, `no ${k} operations were exercised`);
});

const history = fc.record({
  invoices: fc.array(fc.record({total: fc.integer({min: 0, max: 5_000_00}), credited: fc.integer({min: 0, max: 5_000_00}), tds: fc.integer({min: 0, max: 50_00}), day: fc.integer({min: 1, max: 28})}), {maxLength: 8}),
  payments: fc.array(fc.record({amount: fc.integer({min: -2_000_00, max: 5_000_00}).filter(v => v !== 0), rv: fc.boolean()}), {maxLength: 10}),
  tdsCredits: fc.array(fc.record({pick: fc.nat(), amount: fc.integer({min: 1, max: 50_00})}), {maxLength: 3}),
});

test('M10 property: allocate() is never negative; statement coverage == Σ invoice coverage', () => {
  // @covers M10
  fc.assert(fc.property(history, h => {
    const invoices = h.invoices.map((i, k) => ({seq: k + 1, issued: `2026-09-${String(i.day).padStart(2, '0')}`, due: `2026-10-${String(i.day).padStart(2, '0')}`, total: i.total, credited: Math.min(i.credited, i.total), tds: i.tds}));
    const payments = h.payments.map((p, k) => ({seq: k + 1, amount: p.amount, date: '2026-10-01'}));
    const receiptVouchers = h.payments.flatMap((p, k) => p.rv && p.amount > 0 ? [{seq: k + 1, payment_seq: k + 1, total: Math.ceil(p.amount / 2)}] : []);
    const tdsCredits = invoices.length ? h.tdsCredits.map(c => ({invoice_seq: invoices[c.pick % invoices.length].seq, amount: c.amount})) : [];
    const a = S.allocate({payments, invoices, receiptVouchers, tdsCredits, today: '2026-10-20'});
    const received = payments.filter(p => p.amount > 0).reduce((s, p) => s + p.amount, 0), refunded = payments.filter(p => p.amount < 0).reduce((s, p) => s - p.amount, 0);
    assert.equal(a.received, received); assert.equal(a.refunded, refunded);
    for (const i of a.invoices) {
      for (const k of ['live', 'covered', 'tds_expected', 'tds_credited', 'open', 'net_open', 'days_overdue']) assert.ok(i[k] >= 0, `${k} ${i[k]}`);
      assert.ok(i.covered + i.tds_credited <= i.live || i.covered <= i.live);
      assert.ok(i.covered <= i.live);
      assert.ok(i.net_open <= i.open + i.tds_expected);
      if (i.status === 'paid') assert.equal(i.open, 0);
      if (i.status === 'paid_net_of_tds') assert.equal(i.net_open, 0);
    }
    for (const r of a.receipt_vouchers) assert.ok(r.covered >= 0);
    assert.ok(a.unapplied >= 0);
    // The statement reads the same allocation: its coverage is the sum of the invoices' and vouchers'.
    const sum = a.invoices.reduce((s, i) => s + i.covered, 0) + a.receipt_vouchers.reduce((s, r) => s + r.covered, 0);
    assert.equal(a.applied, sum);
    assert.ok(a.applied <= Math.max(0, received - refunded), `applied ${a.applied} > net received ${received - refunded}`);
    if (received >= refunded) assert.equal(a.applied + a.unapplied, received - refunded);
  }), {numRuns: 500});
});

test('M10: FIFO by issue date, cash parts before TDS parts, refunds come off the latest allocation', () => {
  // @covers M10
  const inv = [{seq: 2, issued: '2026-09-02', due: '2026-09-20', total: 10000, credited: 0, tds: 0}, {seq: 1, issued: '2026-09-01', due: '2026-09-20', total: 10000, credited: 0, tds: 1000}];
  const a = S.allocate({payments: [{seq: 1, amount: 12000, date: '2026-09-25'}], invoices: inv, today: '2026-09-30'});
  assert.deepEqual(a.invoices.map(i => [i.seq, i.covered, i.status]), [[1, 9000, 'paid_net_of_tds'], [2, 3000, 'part']]);
  const r = S.allocate({payments: [{seq: 1, amount: 12000, date: '2026-09-25'}, {seq: 2, amount: -5000, date: '2026-09-26'}], invoices: inv, today: '2026-09-30'});
  assert.deepEqual(r.invoices.map(i => [i.seq, i.covered]), [[1, 7000], [2, 0]]);
  // A receipt voucher's advance covers the voucher first.
  const v = S.allocate({payments: [{seq: 1, amount: 5900, date: '2026-09-01'}, {seq: 2, amount: 1000, date: '2026-09-25'}], invoices: [{seq: 1, issued: '2026-09-10', due: '2026-09-20', total: 23600, credited: 0, tds: 0}], receiptVouchers: [{seq: 1, payment_seq: 1, total: 5900}], today: '2026-09-30'});
  assert.deepEqual([v.receipt_vouchers[0].covered, v.invoices[0].covered, v.unapplied], [5900, 1000, 0]);
});
