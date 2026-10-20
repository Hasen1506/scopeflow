// WS-03 pure regressions and unit tests: the invoicing cap (C2), receipt vouchers (H11), credit
// notes and the 16-character rule (H12), TDS (H19/SF-08), CO tax display (M7), the frozen milestone
// schedule (M9) and the per-head GST figures of plan §9.3 (M1 at invoice level). The API-level
// versions of the same scenarios are in tests/ws-03-invoicing.mjs (run by test:local in CI).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {freezeClock} from '../support/property.mjs';

freezeClock();
const I = await import('../../lib/invoice.ts');
const G = await import('../../lib/invoice-gst.ts');
const C = await import('../../lib/invoice-cap.ts');
const RV = await import('../../lib/receipt-voucher.ts');
const CN = await import('../../lib/credit-note.ts');
const T = await import('../../lib/tds.ts');
const S = await import('../../lib/invoice-status.ts');
const MS = await import('../../lib/msmed.ts');
const P = await import('../../lib/profile.ts');

const seller = {name: 'Ada Studio', address: '12 MG Road, Chennai', tax_id: '33ABCDE1234F1Z5', payment_details: 'UPI ada@okbank'};
const intra = {seller_state: '33', sac: '998314', lut_arn: '', client_gstin: '', client_state: '33', client_address: '4 Anna Salai, Chennai'};
const base = {issued: '2026-10-09', due_days: 15, description: '', seller, client: {name: 'Kaveri Foods', email: 'ops@kaveri.test'}, project: {id: 'p1', title: 'Packaging', version: 1}, currency: 'INR', tax_label: 'GST', tax_pct: 18, paid: 0, payment_terms: 'Net 15'};

/** A project on paper: the agreement (minor units) and its documents, as lib/invoice-server.ts loads them. */
function project({fee, rate = 18, gst} = {}) {
  const kind = I.taxPlacement({gst, currency: 'INR', tax_label: 'GST', tax_pct: rate}).kind;
  const b = G.gstFromExclusive(fee, rate, kind);
  return {rate, gst, kind, agreement: {total: b.total, taxable: fee}, docs: {invoices: [], vouchers: [], credits: [], tdsCredits: [], acceptances: []}, seq: 0};
}
const docOf = (content, seq) => { const g = I.invoiceGross(content); return {row: {id: 'i' + seq, seq, number: content.number, version: 1, amount: content.total, currency: 'INR', issued: content.issued, content: JSON.stringify(content)}, content, total: content.breakdown.total, gross: g.total, gross_taxable: g.taxable, credited: 0, credited_taxable: 0, cancelled_by: [], legacy: false}; };
/** The invoice route's decision for one request (pure mirror of POST /api/scopes/[id]/invoices). */
function issue(p, {amount, includes_tax = false, tds = null}) {
  const cap = C.computeInvoiceable(p.agreement, p.docs);
  const input = {...base, amount, includes_tax, tax_pct: p.rate, gst: p.gst, agreed_total: p.agreement.total / 100};
  const gross = I.grossBreakdown(input);
  const final = cap.advances > 0 && gross.taxable >= cap.gross_taxable;
  const problem = I.invoiceProblem(gross, cap, 'INR', final);
  if (problem) return {status: problem.status, ...problem};
  const advances = final ? C.unadjustedAdvances(p.docs) : [];
  const seq = ++p.seq;
  const content = I.invoiceContent({...input, number: I.invoiceNumber('INV-', seq), advances, cap, tds});
  p.docs.invoices.push(docOf(content, seq));
  return {status: 201, content, cap: C.computeInvoiceable(p.agreement, p.docs)};
}
function credit(p, seq, amount = null) {
  const inv = p.docs.invoices.find(i => i.row.seq === seq);
  const live = inv.total - inv.credited, liveTaxable = Math.max(0, inv.gross_taxable - (inv.content.advance?.taxable ?? 0) - inv.credited_taxable);
  const n = p.docs.credits.length + 1;
  // M5: as the route does, pass the invoice heads less those of earlier credit notes on it.
  const liveHeads = CN.liveHeadsOf(inv.content, p.docs.credits.filter(c => c.invoice_seq === seq));
  const content = CN.creditNoteContent({seq: n, issued: '2026-10-10', reason: 'Cancelled by agreement', invoice_seq: seq, invoice: inv.content, live, live_taxable: liveTaxable, amount, ...(liveHeads ? {live_heads: liveHeads} : {})});
  p.docs.credits.push({seq: n, number: content.number, invoice_seq: seq, amount: content.breakdown.total, taxable: content.breakdown.taxable, issued: '2026-10-10', content});
  inv.credited += content.breakdown.total; inv.credited_taxable += content.breakdown.taxable;
  if (content.full) inv.cancelled_by.push(content.number);
  return content;
}

test('C2: three ₹1,000 invoices on a ₹1,000 fee (no tax): only the first is issued', () => {
  // @covers C2
  const p = project({fee: 100000, rate: 0});
  assert.equal(issue(p, {amount: 1000}).status, 201);
  const second = issue(p, {amount: 1000});
  assert.equal(second.status, 409); assert.equal(second.code, 'exceeds_uninvoiced');
  assert.match(second.error, /invoiced in full/);
  assert.equal(issue(p, {amount: 1000}).status, 409);
  assert.equal(p.docs.invoices.length, 1);
});

test('C2: ₹118 agreement (₹100 + 18%): ₹100 is issued, ₹101 is refused with the amount left', () => {
  // @covers C2
  const fresh = project({fee: 10000});
  const over = issue(fresh, {amount: 101});
  assert.equal(over.status, 409); assert.equal(over.code, 'exceeds_uninvoiced');
  assert.match(over.error, /Only ₹118\.00 is left to invoice on this agreement/);
  assert.equal(over.invoiceable, 118);
  const ok = issue(fresh, {amount: 100});
  assert.equal(ok.status, 201); assert.equal(ok.content.total, 118);
  assert.equal(ok.cap.total, 0);
  // Inclusive entry ("amount includes GST"): ₹118 inclusive is the whole agreement; ₹118.01 is too much.
  const inc = project({fee: 10000});
  assert.equal(issue(inc, {amount: 118.01, includes_tax: true}).status, 409);
  assert.equal(issue(inc, {amount: 118, includes_tax: true}).status, 201);
});

test('C2: the copy names what is left, and partial invoices decrease it', () => {
  // @covers C2
  const p = project({fee: 2500000, gst: intra}); // ₹29,500 with tax
  assert.equal(issue(p, {amount: 10000}).cap.total, 1770000);
  const r = issue(p, {amount: 20000});
  assert.equal(r.status, 409); assert.match(r.error, /Only ₹17,700\.00 is left to invoice/);
  assert.equal(issue(p, {amount: 15000}).status, 201);
  assert.equal(C.computeInvoiceable(p.agreement, p.docs).total, 0);
});

test('H11: a ₹5,900 deposit (₹5,000 + 18%) gets RV-0001 with CGST 450 / SGST 450; the final invoice adjusts it', () => {
  // @covers H11
  const p = project({fee: 2500000, gst: intra}); // ₹25,000 + 18% = ₹29,500
  const rv = RV.receiptVoucherContent({seq: 1, issued: '2026-10-09', received: '2026-10-08', amount: 5900, currency: 'INR', seller: {...seller, state: '33'}, client: {name: 'Kaveri Foods', email: ''}, project: base.project, tax_label: 'GST', tax_pct: 18, gst: intra, payment: {ledger_seq: 2, method: 'Bank transfer', reference: 'UTR1'}});
  assert.equal(rv.kind, 'receipt_voucher'); assert.equal(rv.number, 'RV-0001');
  assert.deepEqual(rv.breakdown, {taxable: 500000, heads: [{name: 'CGST', rate: 9, amount: 45000}, {name: 'SGST', rate: 9, amount: 45000}], round_off: 0, total: 590000});
  p.docs.vouchers.push({seq: 1, number: rv.number, ledger_seq: 2, amount: rv.amount, taxable: rv.breakdown.taxable, issued: '2026-10-09T10:00:00Z', content: rv});
  const cap = C.computeInvoiceable(p.agreement, p.docs);
  assert.deepEqual([cap.total, cap.gross_total, cap.advances], [2360000, 2950000, 590000]);
  // An ordinary invoice may not eat into the advance; the whole balance adjusts it.
  assert.match(issue(p, {amount: 21000}).error, /beyond the ₹5,900\.00 already received as an advance/);
  const fin = issue(p, {amount: 25000});
  assert.equal(fin.status, 201);
  const c = fin.content;
  assert.deepEqual(c.advance.vouchers.map(v => v.number), ['RV-0001']);
  assert.equal(c.gross_taxable, 2500000);
  assert.deepEqual(c.breakdown, {taxable: 2000000, heads: [{name: 'CGST', rate: 9, amount: 180000}, {name: 'SGST', rate: 9, amount: 180000}], round_off: 0, total: 2360000});
  assert.equal(c.total, 23600);
  assert.equal(C.computeInvoiceable(p.agreement, p.docs).gross_total, 0);
  const pdf = Buffer.from(I.renderInvoicePdf(c)).toString('latin1');
  assert.ok(pdf.includes('Less: advance received vide RV-0001'));
  // An unregistered seller gets a plain payment receipt with no tax.
  const plain = RV.receiptVoucherContent({seq: 1, issued: '2026-10-09', received: '2026-10-08', amount: 5900, currency: 'INR', seller: {...seller, tax_id: '', state: ''}, client: {name: 'Kaveri Foods', email: ''}, project: base.project, tax_label: 'GST', tax_pct: 18, payment: {ledger_seq: 2, method: 'Bank transfer', reference: ''}});
  assert.deepEqual([plain.kind, plain.number, plain.breakdown], ['payment_receipt', 'PR-0001', null]);
});

test('H11: what counts as an advance', () => {
  // @covers H11
  const line = (o) => ({source: 'owner', note: '', reference: '', created: '2026-10-09T10:00:00Z', ...o});
  assert.equal(I.isAdvanceOf(line({source: 'razorpay', note: 'Deposit'}), '2026-10-01T00:00:00Z'), true);
  assert.equal(I.isAdvanceOf(line({note: 'Advance for October'}), '2026-10-01T00:00:00Z'), true);
  assert.equal(I.isAdvanceOf(line({}), null), true);
  assert.equal(I.isAdvanceOf(line({}), '2026-10-01T00:00:00Z'), false);
  assert.equal(I.isAdvanceOf(line({source: 'refund'}), null), false);
});

test('H12: a full credit note cancels INV-0001 and gives back ₹1,000 to invoice', () => {
  // @covers H12
  const p = project({fee: 100000, rate: 0});
  assert.equal(issue(p, {amount: 1000}).status, 201);
  assert.equal(C.computeInvoiceable(p.agreement, p.docs).total, 0);
  const cn = credit(p, 1);
  assert.equal(cn.number, 'CN-0001'); assert.equal(cn.full, true); assert.equal(cn.breakdown.total, 100000);
  assert.equal(C.cancelled(p.docs.invoices[0]), true);
  assert.deepEqual(p.docs.invoices[0].cancelled_by, ['CN-0001']);
  assert.equal(C.computeInvoiceable(p.agreement, p.docs).total, 100000);
  const alloc = S.allocate({payments: [], invoices: p.docs.invoices.map(i => ({seq: i.row.seq, issued: i.content.issued, due: i.content.due, total: i.total, credited: i.credited, tds: 0})), today: '2026-10-12'});
  assert.equal(alloc.invoices[0].status, 'cancelled');
  assert.equal(issue(p, {amount: 1000}).status, 201);
  const pdf = Buffer.from(I.renderInvoicePdf(p.docs.invoices[0].content, null, {cancelled_by: ['CN-0001']})).toString('latin1');
  assert.ok(pdf.includes('Cancelled by CN-0001'));
});

test('H12: a partial credit note splits at the invoice rate; GST invoices cancel to the paisa', () => {
  // @covers H12
  const p = project({fee: 3250050, gst: intra});
  const r = issue(p, {amount: 32500.50});
  assert.equal(r.content.total, 38350.60); // intra-state: CGST 2,925.05 + SGST 2,925.05 (plan §9.3)
  const part = credit(p, 1, 1180000);
  assert.equal(part.full, false);
  assert.deepEqual([part.breakdown.taxable, part.breakdown.heads.map(h => h.amount), part.breakdown.total], [1000000, [90000, 90000], 1180000]);
  const rest = credit(p, 1);
  assert.equal(rest.full, true);
  assert.equal(part.breakdown.total + rest.breakdown.total, 3835060);
  assert.equal(part.breakdown.taxable + rest.breakdown.taxable, 3250050);
  // M5: the full credit after a partial one reverses the remaining heads exactly, per head.
  assert.deepEqual(rest.breakdown.heads.map(h => [h.name, h.amount]), [['CGST', 202505], ['SGST', 202505]]);
  assert.deepEqual(r.content.breakdown.heads.map((h, i) => h.amount - part.breakdown.heads[i].amount - rest.breakdown.heads[i].amount), [0, 0]);
  assert.equal(rest.breakdown.round_off, 0);
  // liveHeadsOf: null for a pre-WS-03 snapshot or a credit head the invoice does not carry.
  assert.equal(CN.liveHeadsOf({...r.content, breakdown: undefined}, []), null);
  assert.equal(CN.liveHeadsOf(r.content, [{content: {breakdown: {taxable: 1, heads: [{name: 'IGST', rate: 18, amount: 1}], round_off: 0, total: 2}}}]), null);
  assert.equal(C.computeInvoiceable(p.agreement, p.docs).total, 3835060);
});

test('H12: invoice numbers longer than 16 characters are refused (GST rule 46)', () => {
  // @covers H12
  assert.match(I.invoicePrefixProblem('SCOPEFLOW-2026-27/'), /^Invoice numbers must be 16 characters or fewer/);
  assert.equal(I.invoicePrefixProblem('AS/26-27/'), null);
  assert.equal(I.invoicePrefixProblem('ABCDEFGHIJKL'), null); // 12 + 4 digits = 16
  assert.match(I.invoicePrefixProblem('ABCDEFGHIJKLM'), /16 characters/);
  assert.equal(I.invoiceNumberProblem('CN-0001'), null);
  assert.match(I.invoiceNumberProblem('INV 0001'), /letters, digits/);
});

test('H19 / SF-08: ₹1,00,000 + 18% with 10% professional TDS: paid ₹1,08,000 → paid net of TDS, not chased', () => {
  // @covers H19 SF-08
  const p = project({fee: 10000000, gst: intra});
  const tds = T.normalizeTds({section_2025: '393(1) Sl.6(iii)-professional', rate_pct: 10});
  assert.deepEqual(tds, {section_2025: '393(1) Sl.6(iii)-professional', legacy_label: '194J(b)', rate_pct: 10, base: 'taxable_value'});
  const r = issue(p, {amount: 100000, tds});
  assert.equal(r.content.total, 118000);
  assert.deepEqual([r.content.tds.amount, r.content.tds.net_receivable], [1000000, 10800000]);
  assert.equal(r.content.tds.label, 's.393(1) Sl.6(iii) (formerly s.194J(b))');
  const inv = p.docs.invoices[0];
  const figures = [{seq: 1, issued: inv.content.issued, due: '2026-09-01', total: inv.total, credited: 0, tds: inv.content.tds.amount}];
  const a = S.allocate({payments: [{seq: 3, amount: 10800000, date: '2026-10-10'}], invoices: figures, today: '2026-10-12'}).invoices[0];
  assert.deepEqual([a.status, a.net_open, a.open, a.overdue], ['paid_net_of_tds', 0, 1000000, false]);
  assert.equal(S.invoiceReminderDue({overdue: true, status: a.status}, [], 5, Date.now()), false);
  // The certificate closes it.
  const closed = S.allocate({payments: [{seq: 3, amount: 10800000, date: '2026-10-10'}], invoices: figures, tdsCredits: [{invoice_seq: 1, amount: 1000000}], today: '2026-10-12'}).invoices[0];
  assert.deepEqual([closed.status, closed.open], ['tds_credited', 0]);
  // Without the TDS part paid, the invoice is still chased for the cash part only.
  const part = S.allocate({payments: [{seq: 3, amount: 5000000, date: '2026-10-10'}], invoices: figures, today: '2026-10-12'}).invoices[0];
  assert.deepEqual([part.status, part.net_open, part.overdue], ['part', 5800000, true]);
});

test('H19 unit: TDS on the taxable value only (GST excluded), rounded to the rupee, never defaulted', () => {
  // @covers H19 SF-08
  assert.equal(T.tdsAmount(10000000, 10), 1000000);
  assert.equal(T.tdsAmount(1234567, 2), 24700); // ₹246.91 → ₹247
  assert.equal(T.tdsAmount(1225000, 2), 24500); // ₹245.00
  assert.equal(T.tdsAmount(1227500, 2), 24600); // ₹245.50 → ₹246 (half up)
  assert.equal(T.tdsAmount(1227499, 2), 24500);
  assert.equal(T.tdsAmount(0, 10), 0);
  assert.equal(T.tdsAmount(100000, 0), 0);
  assert.equal(T.tdsAmount(12345, 1, 'USD'), 123);
  // Section and rate are both required: nothing is filled in for the owner.
  assert.equal(T.tdsInputSchema.safeParse({section_2025: '393(1) Sl.6(iii)-technical'}).success, false);
  assert.equal(T.tdsInputSchema.safeParse({rate_pct: 2}).success, false);
  assert.equal(T.tdsInputSchema.safeParse({section_2025: '393(1) Sl.6(iii)-technical', rate_pct: 2}).success, true);
  // An invoice without TDS input carries none.
  assert.equal(issue(project({fee: 100000}), {amount: 1000}).content.tds, undefined);
  // Labels: old numbering for FY 2025-26 and earlier, the 2025 Act afterwards.
  assert.equal(T.tdsLabel({section_2025: '393(1) Sl.6(i)-contractor-other', legacy_label: null}, '2026-03-31'), 's.194C (now s.393(1) Sl.6(i) of the Income-tax Act 2025)');
  assert.equal(T.tdsLabel({section_2025: '393(1) Sl.6(i)-contractor-other', legacy_label: null}, '2026-04-01'), 's.393(1) Sl.6(i) (formerly s.194C)');
  assert.deepEqual([T.financialYear('2026-03-31'), T.financialYear('2026-04-01'), T.tdsQuarter('2026-10-12'), T.tdsQuarter('2027-02-01')], ['2025-26', '2026-27', 'Q3 FY 2026-27', 'Q4 FY 2026-27']);
  assert.equal(T.certificateDueFor('2026-10-12'), '2027-02-15');
  assert.equal(T.TDS_BANNER, 'TDS rates depend on the nature of service; confirm with your CA.');
});

test('M7: a change order shows its tax and invoices at the tax-inclusive figure', () => {
  // @covers M7
  assert.equal(I.coDisplay(10000, 18, 'GST', 'INR').text, '+₹10,000.00 + GST ₹1,800.00 = ₹11,800.00');
  assert.equal(I.coDisplay(7500.50, 18, 'GST', 'INR').text, '+₹7,500.50 + GST ₹1,350.09 = ₹8,850.59');
  assert.equal(I.coDisplay(-2000, 18, 'GST', 'INR').text, '−₹2,000.00 − GST ₹360.00 = −₹2,360.00');
  assert.equal(I.coDisplay(10000, 18, 'GST', 'INR', 'intra').text, '+₹10,000.00 + CGST + SGST ₹1,800.00 = ₹11,800.00');
  assert.equal(I.coDisplay(10000, 0, '', 'INR').text, '+₹10,000.00');
  // The CO's own invoice: ₹11,800 tax-inclusive is exactly ₹10,000 + ₹1,800.
  const c = I.invoiceContent({...base, number: 'INV-0002', amount: 11800, includes_tax: true, agreed_total: 11800, change_order: {seq: 4, title: 'Extra pack size'}});
  assert.deepEqual([c.total, c.breakdown.taxable, G.taxOf(c.breakdown)], [11800, 1000000, 180000]);
  assert.match(c.line.description, /^Change order: Extra pack size/);
});

test('M9: a milestone invoiced in full stays closed when a change order is approved; the CO is its own line', () => {
  // @covers M9
  // Frozen schedule: shares of the baseline total at approval (₹1,18,000), never re-spread.
  const schedule = [{id: 'm1', amount: 5900000, invoiced: 0}, {id: 'm2', amount: 5900000, invoiced: 0}];
  const p = project({fee: 10000000});
  const m1 = issue(p, {amount: 59000, includes_tax: true});
  assert.equal(m1.status, 201);
  schedule[0].invoiced = C.invoicedFor(p.docs, () => true);
  // A CO of +₹10,000 is approved: the agreement grows by ₹11,800; the milestone does not.
  p.agreement = {taxable: 11000000, total: G.gstFromExclusive(11000000, 18, 'single').total};
  assert.equal(Math.max(0, schedule[0].amount - schedule[0].invoiced), 0, 'm1 is still invoiced in full');
  const cap = C.computeInvoiceable(p.agreement, p.docs);
  assert.equal(cap.total, 5900000 + 1180000);
  // The CO line can be invoiced on its own at ₹11,800.
  assert.equal(issue(p, {amount: 11800, includes_tax: true}).status, 201);
});

test('M1 / §9.3 at invoice level: the golden rounding figures', () => {
  // @covers M1
  assert.deepEqual(G.gstFromExclusive(2500000, 18, 'intra'), {taxable: 2500000, heads: [{name: 'CGST', rate: 9, amount: 225000}, {name: 'SGST', rate: 9, amount: 225000}], round_off: 0, total: 2950000});
  assert.deepEqual(G.gstFromInclusive(10000, 18, 'intra'), {taxable: 8475, heads: [{name: 'CGST', rate: 9, amount: 763}, {name: 'SGST', rate: 9, amount: 763}], round_off: -1, total: 10000});
  assert.deepEqual(G.gstFromInclusive(10100, 18, 'intra'), {taxable: 8559, heads: [{name: 'CGST', rate: 9, amount: 770}, {name: 'SGST', rate: 9, amount: 770}], round_off: 1, total: 10100});
  assert.equal(G.gstFromExclusive(3250050, 18, 'single').total, 3835059); // ₹38,350.59, single head
  assert.equal(G.gstFromExclusive(3250050, 18, 'none').total, 3835059); // WS-01's name for the same head
  assert.equal(G.gstFromExclusive(3250050, 18, 'inter').total, 3835059); // IGST
  assert.equal(G.gstFromExclusive(3250050, 18, 'intra').total, 3835060); // ₹38,350.60 intra-state
  assert.deepEqual(G.labeledHeads(G.gstFromExclusive(10000, 18, 'single'), 'GST'), [{name: 'GST', label: 'GST', rate: 18, amount: 1800}]);
  assert.deepEqual(G.labeledHeads(G.gstFromExclusive(10000, 20, 'single'), 'VAT'), [{name: 'OTHER', label: 'VAT', rate: 20, amount: 2000}]);
  assert.deepEqual(G.labeledHeads(G.gstFromExclusive(10000, 18, 'intra'), 'GST').map(h => [h.name, h.label]), [['CGST', 'CGST'], ['SGST', 'SGST']]);
});

test('SF-07: acceptance, 15/45-day due dates, warnings', () => {
  // @covers SF-07
  assert.deepEqual(MS.acceptanceDay({delivered_on: '2026-09-01'}, '2026-09-10'), {day: null, basis: 'pending'});
  assert.deepEqual(MS.acceptanceDay({delivered_on: '2026-09-01'}, '2026-09-17'), {day: '2026-09-01', basis: 'deemed'});
  assert.deepEqual(MS.acceptanceDay({delivered_on: '2026-09-01', accepted_on: '2026-09-03'}, '2026-09-04'), {day: '2026-09-03', basis: 'accepted'});
  assert.deepEqual(MS.acceptanceDay({delivered_on: '2026-09-01', objection_on: '2026-09-10'}, '2026-10-01'), {day: null, basis: 'objection_open'});
  assert.deepEqual(MS.acceptanceDay({delivered_on: '2026-09-01', objection_on: '2026-09-10', objection_removed_on: '2026-09-20'}, '2026-10-01'), {day: '2026-09-20', basis: 'objection_removed'});
  assert.deepEqual(MS.msmedDueDates('2026-09-01'), {pay_by: '2026-09-16', interest_from: '2026-09-17', agreed: false});
  assert.deepEqual(MS.msmedDueDates('2026-09-01', 60), {pay_by: '2026-10-16', interest_from: '2026-10-17', agreed: true}); // capped at 45
  // M9: an agreed term of 0 days (pay on acceptance) is kept, not replaced by the 15-day default.
  assert.deepEqual(MS.msmedDueDates('2026-09-01', 0), {pay_by: '2026-09-01', interest_from: '2026-09-02', agreed: true});
  assert.deepEqual(MS.msmedDueDates('2026-09-01', null), {pay_by: '2026-09-16', interest_from: '2026-09-17', agreed: false});
  const micro = {udyam_number: 'UDYAM-TN-02-0012345', registered_on: '2026-06-01', category: 'micro'};
  assert.deepEqual(MS.msmedWarnings({profile: micro, contract_date: '2026-07-01T10:00:00Z'}), []);
  const late = MS.msmedWarnings({profile: {...micro, registered_on: '2026-08-01'}, contract_date: '2026-07-01T10:00:00Z'});
  assert.deepEqual(late.map(w => w.code), ['registered_after_contract']);
  assert.match(late[0].message, /may not apply to work agreed before your Udyam registration \(registered 2026-08-01, agreement approved 2026-07-01\) \(Silpi\/Mahakali; NBCC reference pending\)/);
  assert.deepEqual(MS.msmedWarnings({profile: {...micro, category: 'medium'}, contract_date: null}).map(w => w.code), ['medium_excluded']);
  assert.equal(MS.msmedApplies({...micro, category: 'medium'}), false);
  assert.equal(MS.msmeProfileSchema.safeParse({...micro, udyam_number: 'UDYAM-TN-2-1'}).success, false);
  assert.match(MS.msmedClause(micro), /within 15 days of the day of acceptance/);
  assert.match(MS.msmedClause(micro, 30), /within 30 days/);
  // M9: 0 agreed days is "payment on acceptance", consistent with msmedDueDates; null keeps the 15-day wording.
  assert.match(MS.msmedClause(micro, 0), /due on the day of acceptance .*\(payment on acceptance\)/);
  assert.doesNotMatch(MS.msmedClause(micro, 0), /15 days/);
  assert.match(MS.msmedClause(micro, null), /within 15 days of the day of acceptance/);
  assert.match(MS.msmedClause(micro, 60), /within 45 days/);
  // The Bank Rate is read from the dated table, never hard-coded.
  assert.deepEqual([MS.bankRateOn('2025-12-04')?.rate, MS.bankRateOn('2025-12-05')?.rate, MS.bankRateOn('2026-10-06')?.rate, MS.bankRateOn('2026-10-07')?.rate, MS.bankRateOn('2024-01-01')], [5.75, 5.5, 5.5, 5.75, null]);
});

test('profile: the invoice prefix rule is exported for WS-08 and matches the issue-time check', () => {
  // @covers H12
  assert.equal(typeof P.profileFromRow, 'function');
  for (const prefix of ['INV-', 'AS/26-27/', 'SCOPEFLOW-2026-27/', 'X'.repeat(13)]) {
    const atIssue = I.invoiceNumberProblem(I.invoiceNumber(prefix, 1)) === null;
    assert.equal(I.invoicePrefixProblem(prefix) === null, atIssue, prefix);
  }
});

// N4: the allocation names the payment that settled each invoice's cash part (TDS "paid on").
test('allocate: settled_by is the payment that completed each invoice, not the latest payment', () => {
  const a = S.allocate({
    payments: [{seq: 1, amount: 90000, date: '2026-06-20'}, {seq: 2, amount: 90000, date: '2026-07-10'}],
    invoices: [
      {seq: 1, issued: '2026-06-01', due: '2026-06-15', total: 100000, credited: 0, tds: 10000},
      {seq: 2, issued: '2026-06-05', due: '2026-06-20', total: 100000, credited: 0, tds: 10000},
    ],
    today: '2026-10-20',
  });
  assert.deepEqual(a.invoices.map(i => i.status), ['paid_net_of_tds', 'paid_net_of_tds']);
  assert.deepEqual(a.invoices.map(i => i.settled_by), [{seq: 1, date: '2026-06-20'}, {seq: 2, date: '2026-07-10'}]);
  // Amounts are unchanged by the bookkeeping; a part-paid invoice names no settling payment.
  const part = S.allocate({payments: [{seq: 1, amount: 50000, date: '2026-06-20'}], invoices: [{seq: 1, issued: '2026-06-01', due: '2026-06-15', total: 100000, credited: 0, tds: 10000}], today: '2026-10-20'});
  assert.equal(part.invoices[0].covered, 50000);
  assert.equal(part.invoices[0].settled_by, undefined);
  // A refund takes from the latest payment first, so the settling payment moves to the one that still covers it.
  const refunded = S.allocate({payments: [{seq: 1, amount: 90000, date: '2026-06-20'}, {seq: 2, amount: 30000, date: '2026-07-01'}, {seq: 3, amount: -30000, date: '2026-07-02'}], invoices: [{seq: 1, issued: '2026-06-01', due: '2026-06-15', total: 100000, credited: 0, tds: 10000}], today: '2026-10-20'});
  assert.deepEqual(refunded.invoices[0].settled_by, {seq: 1, date: '2026-06-20'});
});
