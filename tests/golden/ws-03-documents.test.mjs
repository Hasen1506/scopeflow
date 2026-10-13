// WS-03 goldens: the receipt voucher (H11), the credit note PDF (H12), the MSMED s.16 interest
// computation with its CA worksheet (SF-07), the consumer evidence pack manifest (SF-24), the MSMED
// pack's Samadhaan field sheet, and the §9.3 GST figures at invoice level (M1). Produced by the real
// lib code from fixed inputs on a frozen clock with the built-in PDF fonts (no HarfBuzz), so the bytes
// are stable. A diff means a document already handed to a client would render differently: regenerate
// deliberately with UPDATE_GOLDEN=1 and say why in the PR.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {freezeClock} from '../support/property.mjs';

freezeClock();
const I = await import('../../lib/invoice.ts');
const G = await import('../../lib/invoice-gst.ts');
const RV = await import('../../lib/receipt-voucher.ts');
const CN = await import('../../lib/credit-note.ts');
const MS = await import('../../lib/msmed.ts');
const D = await import('../../lib/dispute.ts');

const golden = (name, value) => {
  const file = new URL(`./${name}`, import.meta.url);
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
  if (process.env.UPDATE_GOLDEN === '1' || !existsSync(file)) writeFileSync(file, text);
  assert.equal(text, readFileSync(file, 'utf8'), `${name} changed; run with UPDATE_GOLDEN=1 only if intended`);
};
const pdfFacts = bytes => ({sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length});
const pdfText = bytes => Buffer.from(bytes).toString('latin1').replace(/\\([()])/g, '$1');

const seller = {name: 'Ada Studio', address: '12 MG Road, Chennai', tax_id: '33ABCDE1234F1Z5', payment_details: 'UPI ada@okbank'};
const intra = {seller_state: '33', sac: '998314', lut_arn: '', client_gstin: '33AAACK1234F1Z5', client_state: '33', client_address: '4 Anna Salai, Chennai'};
const project = {id: 'golden-project-0001', title: 'Packaging redesign', version: 1};

test('golden: receipt voucher RV-0001 for a ₹5,900 deposit (CGST 450 / SGST 450)', () => {
  // @covers H11
  const c = RV.receiptVoucherContent({seq: 1, issued: '2026-10-09', received: '2026-10-08', amount: 5900, currency: 'INR', seller: {...seller, state: '33'}, client: {name: 'Kaveri Foods', email: 'ops@kaveri.test'}, project, tax_label: 'GST', tax_pct: 18, gst: intra, payment: {ledger_seq: 2, method: 'Bank transfer', reference: 'UTR998877'}});
  const bytes = RV.renderReceiptVoucherPdf(c);
  assert.equal(pdfFacts(RV.renderReceiptVoucherPdf(c)).sha256, pdfFacts(bytes).sha256, 'deterministic');
  const text = pdfText(bytes);
  for (const s of ['RECEIPT VOUCHER', 'RV-0001', 'GSTIN: 33ABCDE1234F1Z5', 'CGST (9%)', 'SGST (9%)', 'Rs.450.00', 'Rs.5,000.00', 'Rs.5,900.00', 'UTR998877']) assert.ok(text.includes(s), 'voucher states ' + s);
  golden('ws-03-receipt-voucher.golden.json', {content: c, pdf: pdfFacts(bytes)});
});

test('golden: credit note CN-0001 cancelling a ₹38,350.60 intra-state invoice', () => {
  // @covers H12
  const inv = I.invoiceContent({number: 'AS-0007', issued: '2026-10-09', due_days: 15, description: '', amount: 32500.50, includes_tax: false, seller, client: {name: 'Kaveri Foods', email: 'ops@kaveri.test'}, project, currency: 'INR', tax_label: 'GST', tax_pct: 18, agreed_total: 38350.60, paid: 0, payment_terms: 'Net 15', gst: intra});
  assert.equal(inv.total, 38350.60);
  const c = CN.creditNoteContent({seq: 1, issued: '2026-10-11', reason: 'Order cancelled by the client before work started', invoice_seq: 7, invoice: inv, live: inv.breakdown.total, live_taxable: inv.breakdown.taxable, amount: null});
  assert.equal(c.full, true);
  assert.deepEqual(c.breakdown, inv.breakdown);
  const bytes = CN.renderCreditNotePdf(c);
  const text = pdfText(bytes);
  for (const s of ['CREDIT NOTE', 'CN-0001', 'AS-0007', 'Order cancelled by the client before work started', 'CGST (9%)', 'Rs.2,925.05', 'Rs.38,350.60']) assert.ok(text.includes(s), 'credit note states ' + s);
  golden('ws-03-credit-note.golden.json', {content: c, pdf: pdfFacts(bytes)});
});

/**
 * An independent, plain-arithmetic version of s.16 for the CA worksheet: compound with monthly rests
 * on the same day of the month as the first day of interest; within a month, simple daily interest at
 * 3 × the Bank Rate in force each day / 365; balance rounded to the paisa at each rest.
 */
function handInterest(principal, from, paid, rateOn) {
  let balance = principal, start = from;
  const rows = [];
  const day = 86400_000;
  for (let k = 1; start < paid; k++) {
    const d = new Date(from + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + k);
    const rest = d.toISOString().slice(0, 10);
    const end = rest < paid ? rest : paid;
    let factor = 0;
    for (let t = Date.parse(start + 'T00:00:00Z'); t < Date.parse(end + 'T00:00:00Z'); t += day) factor += 3 * rateOn(new Date(t).toISOString().slice(0, 10)) / 100 / 365;
    const interest = Math.round(balance * factor * 100) / 100;
    rows.push({from: start, to: end, opening: balance, interest});
    balance = Math.round((balance + interest) * 100) / 100;
    start = end;
  }
  return {rows, interest: Math.round((balance - principal) * 100) / 100, total: balance};
}

test('golden: MSMED s.16 interest on ₹1,00,000 due 2026-08-01, paid 2026-12-01 (16.5% → 17.25% p.a., monthly rests)', () => {
  // @covers SF-07
  // Due (last day to pay) 2026-08-01, so interest runs from 2026-08-02 (s.16: "from the date immediately
  // following the date agreed upon"). Bank Rate 5.50% until 6 Oct 2026, 5.75% from 7 Oct 2026.
  const args = {principal: 10000000, interest_from: '2026-08-02', paid_on: '2026-12-01'};
  const perPeriod = MS.msmedInterest({...args, rate_basis: 'per_period'});
  const onDue = MS.msmedInterest({...args, rate_basis: 'on_due_date'});
  assert.equal(perPeriod.covered, true);
  assert.deepEqual([...new Set(perPeriod.periods.flatMap(p => p.rates.map(r => r.rate_pa)))], [16.5, 17.25]);
  assert.deepEqual([...new Set(onDue.periods.flatMap(p => p.rates.map(r => r.rate_pa)))], [16.5]);
  // The hand computation agrees to the paisa, period by period.
  const hand = handInterest(100000, args.interest_from, args.paid_on, d => (MS.bankRateOn(d).rate));
  assert.deepEqual(perPeriod.periods.map(p => [p.from, p.to, p.opening / 100, p.interest / 100]), hand.rows.map(r => [r.from, r.to, r.opening, r.interest]));
  assert.equal(perPeriod.interest / 100, hand.interest);
  const handFixed = handInterest(100000, args.interest_from, args.paid_on, () => 5.5);
  assert.equal(onDue.interest / 100, handFixed.interest);
  golden('ws-03-msmed-interest.golden.json', {inputs: {...args, bank_rate_table: MS.RBI_BANK_RATE}, per_period: perPeriod, on_due_date: onDue});
  // The CA worksheet committed alongside (one row per rate segment), from the same computation.
  golden('ws-03-msmed-interest.worksheet.csv', MS.interestCsv(perPeriod));
  golden('ws-03-msmed-interest-on-due-date.worksheet.csv', MS.interestCsv(onDue));
});

test('golden: consumer evidence pack manifest (Consumer Protection Act 2019, e-Daakhil)', () => {
  // @covers SF-24
  const manifest = D.consumerPackManifest(['site-2026-09-01.jpg', 'site-2026-09-15.jpg']);
  assert.deepEqual(manifest.slice(0, 3).map(m => m.name), ['summary.txt', 'scope.json', 'acceptance/']);
  const summary = D.consumerSummary({title: 'Kitchen renovation', vendor: 'Ada Interiors', homeowner: 'Meera Rao', agreed_on: '2026-08-01T10:00:00Z', currency_total: '₹4,72,000.00', paid: '₹2,36,000.00', balance: '₹2,36,000.00',
    change_orders: [{title: 'Granite upgrade', status: 'approved', amount: '+₹23,600.00'}], payments: [{date: '2026-08-01', amount: '₹1,18,000.00', method: 'UPI', reference: 'UTR111'}, {date: '2026-09-01', amount: '₹1,18,000.00', method: 'Bank transfer', reference: 'UTR222'}],
    inspections: [{date: '2026-09-15', what: 'Plumbing rough-in signed off'}], photos: 2, generated: '2026-10-07T09:00:00Z'});
  assert.match(summary, /https:\/\/edaakhil\.nic\.in/);
  golden('ws-03-consumer-manifest.golden.json', {manifest, summary});
});

test('golden: MSMED pack files and the Samadhaan field sheet', () => {
  // @covers SF-07
  const sheet = D.samadhaanFieldSheet({
    supplier: {name: 'Ada Studio', address: '12 MG Road, Chennai', gstin: '33ABCDE1234F1Z5', udyam_number: 'UDYAM-TN-02-0012345', category: 'micro', registered_on: '2026-06-01', email: 'ada@example.test'},
    buyer: {name: 'Kaveri Foods', email: 'ops@kaveri.test', gstin: '33AAACK1234F1Z5', address: '4 Anna Salai, Chennai', state: 'Tamil Nadu'},
    project: {id: 'golden-project-0001', title: 'Packaging redesign', agreement_date: '2026-07-01'},
    acceptance: {day: '2026-07-17', basis: 'accepted', delivered_on: '2026-07-15'}, pay_by: '2026-08-01', agreed_days: 15, rate_basis: 'per_period',
    invoices: [{number: 'AS-0001', issued: '2026-07-15', amount: '₹1,00,000.00', received: '₹0.00', outstanding: '₹1,00,000.00', interest: '₹5,580.33'}],
    totals: {outstanding: '₹1,00,000.00', interest: '₹5,580.33', claimed: '₹1,05,580.33'}, warnings: [], generated: '2026-10-07T09:00:00Z',
  });
  assert.match(sheet, /UDYAM-TN-02-0012345/);
  assert.match(sheet, /Buyer type \(Central\/State\/PSU\/Private\)\s+\(not on the record: fill in\)/);
  golden('ws-03-msmed-pack.golden.json', {files: D.MSMED_PACK_FILES, field_sheet: sheet});
});

test('golden: §9.3 GST figures at invoice level', () => {
  // @covers M1
  const cases = {
    '25000 + 18% intra': G.gstFromExclusive(2500000, 18, 'intra'),
    '100 inclusive intra': G.gstFromInclusive(10000, 18, 'intra'),
    '101 inclusive intra': G.gstFromInclusive(10100, 18, 'intra'),
    '32500.50 + 18% single': G.gstFromExclusive(3250050, 18, 'single'),
    '32500.50 + 18% inter': G.gstFromExclusive(3250050, 18, 'inter'),
    '32500.50 + 18% intra': G.gstFromExclusive(3250050, 18, 'intra'),
  };
  golden('ws-03-gst.golden.json', cases);
});
