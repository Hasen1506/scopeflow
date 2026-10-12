import type {GstBreakdown, Minor} from './contracts';
import {PdfDocument, textWidth, wrap, type Font} from './pdf';
import {formatMoney} from './currency';
import {formatDay} from './time';
import {rupeesInWords, stateName} from './gst';
import {fromMinorOf, invoiceNumberProblem, taxPlacement, toMinorOf, type InvoiceInput} from './invoice';
import {gstFromInclusive} from './invoice-gst';

// WS-03 (H11): a Receipt Voucher for an advance (deposit) received before the supply is invoiced
// (CGST Rules, rule 50; CGST Act s.31(3)(d)). Tax is charged on the advance at the agreed rate, the
// voucher has its own series (RV-0001 …), and the final tax invoice adjusts it ("Less: advance
// received vide RV-0001"). A seller without a GSTIN gets a plain payment receipt instead (no tax).
// Immutable once issued, like an invoice. Needs CA review: receipt vouchers for advances on services.

export type ReceiptVoucherContent = {
  kind: 'receipt_voucher' | 'payment_receipt';
  number: string; issued: string; received: string;
  seller: {name: string; address: string; tax_id: string; state: string};
  client: {name: string; email: string; gstin: string; address: string};
  project: {id: string; title: string; version: number};
  currency: string;
  /** The advance received, minor units, tax included. */
  amount: Minor;
  breakdown: GstBreakdown | null;
  place_of_supply: string | null;
  sac: string;
  payment: {ledger_seq: number; method: string; reference: string};
  total_in_words: string;
};

export const voucherNumber = (seq: number) => 'RV-' + String(seq).padStart(4, '0');
export const receiptNumber = (seq: number) => 'PR-' + String(seq).padStart(4, '0');

/** The voucher for an advance of `amount` (major units, tax included). Pure. */
export function receiptVoucherContent(input: {
  seq: number; issued: string; received: string; amount: number; currency: string;
  seller: InvoiceInput['seller'] & {state: string}; client: {name: string; email: string};
  project: ReceiptVoucherContent['project']; tax_label: string; tax_pct: number; gst?: InvoiceInput['gst'];
  payment: ReceiptVoucherContent['payment'];
}): ReceiptVoucherContent {
  const amount = toMinorOf(input.amount, input.currency);
  const placement = taxPlacement({gst: input.gst, currency: input.currency, tax_label: input.tax_label, tax_pct: input.tax_pct});
  const registered = !!input.seller.tax_id && placement.gstInvoice;
  const number = registered ? voucherNumber(input.seq) : receiptNumber(input.seq);
  const problem = invoiceNumberProblem(number);
  if (problem) throw new Error(problem);
  return {
    kind: registered ? 'receipt_voucher' : 'payment_receipt', number, issued: input.issued, received: input.received,
    seller: {name: input.seller.name, address: input.seller.address, tax_id: input.seller.tax_id, state: input.seller.state},
    client: {name: input.client.name, email: input.client.email, gstin: input.gst?.client_gstin ?? '', address: input.gst?.client_address ?? ''},
    project: input.project, currency: input.currency, amount,
    breakdown: registered ? gstFromInclusive(amount, input.tax_pct, placement.kind) : null,
    place_of_supply: registered ? placement.pos?.code ?? null : null, sac: input.gst?.sac ?? '',
    payment: input.payment, total_in_words: input.currency === 'INR' ? rupeesInWords(input.amount) : '',
  };
}

const MARGIN = 48;
export function renderReceiptVoucherPdf(c: ReceiptVoucherContent): Uint8Array {
  const doc = new PdfDocument({info: {Title: `${c.kind === 'receipt_voucher' ? 'Receipt voucher' : 'Payment receipt'} ${c.number}`, Producer: 'Scopeflow'}});
  const W = doc.width - MARGIN * 2, mm = (v: number) => formatMoney(fromMinorOf(v, c.currency), c.currency);
  doc.addPage();
  let y = doc.height - MARGIN;
  const lines = (text: string, {size = 9.5, font = 'regular' as Font, gray = 0, x = MARGIN, width = W} = {}) => { for (const l of text ? wrap(text, width, size, font) : []) { doc.text(x, y - size, l, {size, font, gray}); y -= size + 3; } };
  const row = (k: string, v: string, font: Font = 'regular') => { doc.text(MARGIN + W - 260, y - 10, k, {size: 10, font, gray: font === 'bold' ? 0 : 0.3}); doc.text(MARGIN + W - textWidth(v, 10), y - 10, v, {size: 10, font}); y -= 15; };
  doc.text(MARGIN, 28, `${c.number} · ${c.project.title.slice(0, 60)} · prepared with Scopeflow`, {size: 7, gray: 0.45});
  const title = c.kind === 'receipt_voucher' ? 'RECEIPT VOUCHER' : 'PAYMENT RECEIPT';
  doc.text(MARGIN + W - textWidth(title, 18, 'bold'), y - 18, title, {size: 18, font: 'bold'});
  lines(c.seller.name || 'Seller name not set', {size: 14, font: 'bold', width: W / 2});
  lines(c.seller.address, {size: 9, gray: 0.3, width: W / 2});
  if (c.seller.tax_id) lines(`${c.kind === 'receipt_voucher' ? 'GSTIN' : 'Tax ID'}: ${c.seller.tax_id}`, {size: 9, gray: 0.3});
  if (c.kind === 'receipt_voucher' && c.seller.state) lines(`State: ${stateName(c.seller.state)} (${c.seller.state})`, {size: 9, gray: 0.3});
  y -= 8;
  for (const [k, v] of [['Number', c.number], ['Issued', formatDay(c.issued)], ['Advance received on', formatDay(c.received)]] as const) { lines(`${k}: ${v}`, {size: 9.5}); }
  y -= 8;
  doc.text(MARGIN, y - 8, 'RECEIVED FROM', {size: 8, font: 'bold', gray: 0.35}); y -= 14;
  lines(c.client.name, {size: 10.5, font: 'bold'});
  if (c.client.address) lines(c.client.address, {size: 9, gray: 0.3});
  if (c.client.gstin) lines(`GSTIN: ${c.client.gstin}`, {size: 9, gray: 0.3});
  if (c.place_of_supply) lines(`Place of supply: ${stateName(c.place_of_supply)}${c.place_of_supply === '96' ? '' : ` (${c.place_of_supply})`} · Reverse charge: No`, {size: 9, gray: 0.3});
  y -= 12;
  lines(`Advance for ${c.project.title} (approved scope, version ${c.project.version})${c.sac ? ` · SAC ${c.sac}` : ''}. Payment: ${c.payment.method}${c.payment.reference ? `, ref. ${c.payment.reference}` : ''} (record entry ${c.payment.ledger_seq}).`, {size: 9.5});
  y -= 6;
  const b = c.breakdown;
  if (b) {
    row('Taxable value of the advance', mm(b.taxable));
    for (const h of b.heads) row(`${h.name} (${Math.round(h.rate * 1000) / 1000}%)`, mm(h.amount));
    if (b.round_off) row('Round off', (b.round_off > 0 ? '+' : '-') + mm(Math.abs(b.round_off)));
  }
  row('Amount received', mm(c.amount), 'bold');
  if (c.total_in_words) lines(`Amount in words: ${c.total_in_words}`, {size: 8.5, gray: 0.3});
  y -= 10;
  lines(c.kind === 'receipt_voucher'
    ? 'Receipt voucher under rule 50 of the CGST Rules, 2017 for an advance received before the supply. The tax invoice for the supply will adjust this advance and charge tax only on the remainder.'
    : 'Payment receipt for an advance. The seller is not registered for GST, so no tax is charged on this receipt. This is not a tax invoice.', {size: 8.5, gray: 0.35});
  if (c.kind === 'receipt_voucher') { y -= 18; lines(`For ${c.seller.name}`, {x: MARGIN + W / 2, width: W / 2}); y -= 22; lines('Authorised signatory', {x: MARGIN + W / 2, width: W / 2, size: 8.5, gray: 0.4}); }
  return doc.toBytes();
}
