import {z} from 'zod';
import type {GstBreakdown, Minor} from './contracts';
import {PdfDocument, textWidth, wrap, type Font} from './pdf';
import {formatMoney} from './currency';
import {formatDay} from './time';
import {stateName} from './gst';
import {fromMinorOf, invoiceNumberProblem, toMinorOf, type InvoiceContent} from './invoice';
import {gstFromInclusive, taxOf, type HeadKind} from './invoice-gst';

// WS-03 (H12): credit notes (CGST Act s.34; rule 53). Own series (CN-0001 …), immutable once issued,
// always referencing the original invoice, with a reason; full or partial. A fully credited invoice
// is cancelled ("Cancelled by CN-0001") and stops counting toward the invoicing cap (C2).

export const creditNoteRequestSchema = z.object({
  invoice_seq: z.number().int().min(1),
  /** Tax-inclusive amount to credit (major units). Omitted: everything still live on the invoice. */
  amount: z.number().finite().positive().max(100000000).optional(),
  reason: z.string().trim().min(3).max(300),
  request_id: z.string().regex(/^[A-Za-z0-9_-]{8,120}$/).optional(),
}).strict();
export type CreditNoteRequest = z.infer<typeof creditNoteRequestSchema>;

export type CreditNoteContent = {
  number: string; issued: string; reason: string; full: boolean;
  invoice: {seq: number; number: string; issued: string; total: Minor};
  seller: InvoiceContent['seller']; client: InvoiceContent['client']; project: InvoiceContent['project'];
  currency: string;
  /** What is credited, minor units: taxable value, heads and total (tax included). */
  breakdown: GstBreakdown;
  gst: {seller_state: string; client_gstin: string; place_of_supply: string} | null;
};

export const creditNoteNumber = (seq: number) => 'CN-' + String(seq).padStart(4, '0');

/** The head kind of an issued invoice, from its snapshot. */
export function invoiceKind(c: InvoiceContent): HeadKind { return c.gst ? c.gst.kind : 'single'; }
/** The rate of an issued invoice (0 when it carried no tax). */
export const invoiceRate = (c: InvoiceContent) => c.tax?.pct ?? 0;

/**
 * The snapshot of a credit note for `amount` (minor units, tax included) against an invoice whose
 * live total is `live`. A full credit takes exactly the invoice's remaining taxable value and heads, so
 * the two cancel to the paisa; a partial credit is split at the invoice's rate. Pure.
 */
export function creditNoteContent(input: {seq: number; issued: string; reason: string; invoice_seq: number; invoice: InvoiceContent; live: Minor; live_taxable: Minor; amount: Minor | null}): CreditNoteContent {
  const c = input.invoice;
  const number = creditNoteNumber(input.seq);
  const problem = invoiceNumberProblem(number);
  if (problem) throw new Error(problem);
  const full = input.amount === null || input.amount >= input.live;
  let breakdown: GstBreakdown;
  if (full) {
    const b = gstFromInclusive(input.live, invoiceRate(c), invoiceKind(c));
    breakdown = {...b, taxable: input.live_taxable, round_off: input.live - input.live_taxable - taxOf(b)};
  } else breakdown = gstFromInclusive(input.amount!, invoiceRate(c), invoiceKind(c));
  const total = c.breakdown?.total ?? toMinorOf(c.total, c.currency);
  return {
    number, issued: input.issued, reason: input.reason, full,
    invoice: {seq: input.invoice_seq, number: c.number, issued: c.issued, total},
    seller: c.seller, client: c.client, project: c.project, currency: c.currency, breakdown,
    gst: c.gst ? {seller_state: c.gst.seller_state, client_gstin: c.gst.client_gstin, place_of_supply: c.gst.place_of_supply} : null,
  };
}

const MARGIN = 48;
export function renderCreditNotePdf(c: CreditNoteContent): Uint8Array {
  const doc = new PdfDocument({info: {Title: `Credit note ${c.number}`, Producer: 'Scopeflow'}});
  const W = doc.width - MARGIN * 2, mm = (v: number) => formatMoney(fromMinorOf(v, c.currency), c.currency);
  doc.addPage();
  let y = doc.height - MARGIN;
  const lines = (text: string, {size = 9.5, font = 'regular' as Font, gray = 0, width = W} = {}) => { for (const l of text ? wrap(text, width, size, font) : []) { doc.text(MARGIN, y - size, l, {size, font, gray}); y -= size + 3; } };
  const row = (k: string, v: string, font: Font = 'regular') => { doc.text(MARGIN + W - 260, y - 10, k, {size: 10, font, gray: font === 'bold' ? 0 : 0.3}); doc.text(MARGIN + W - textWidth(v, 10), y - 10, v, {size: 10, font}); y -= 15; };
  doc.text(MARGIN, 28, `Credit note ${c.number} · ${c.project.title.slice(0, 60)} · prepared with Scopeflow`, {size: 7, gray: 0.45});
  const title = c.gst ? 'CREDIT NOTE (GST)' : 'CREDIT NOTE';
  doc.text(MARGIN + W - textWidth(title, 18, 'bold'), y - 18, title, {size: 18, font: 'bold'});
  lines(c.seller.name || 'Seller name not set', {size: 14, font: 'bold', width: W / 2});
  lines(c.seller.address, {size: 9, gray: 0.3, width: W / 2});
  if (c.seller.tax_id) lines(`${c.gst ? 'GSTIN' : 'Tax ID'}: ${c.seller.tax_id}`, {size: 9, gray: 0.3});
  if (c.gst) lines(`State: ${stateName(c.gst.seller_state)} (${c.gst.seller_state})`, {size: 9, gray: 0.3});
  y -= 8;
  lines(`Number: ${c.number} · Issued ${formatDay(c.issued)}`, {size: 9.5});
  lines(`Against invoice ${c.invoice.number} dated ${formatDay(c.invoice.issued)} (invoice total ${mm(c.invoice.total)})`, {size: 9.5, font: 'bold'});
  y -= 8;
  doc.text(MARGIN, y - 8, 'ISSUED TO', {size: 8, font: 'bold', gray: 0.35}); y -= 14;
  lines(c.client.name, {size: 10.5, font: 'bold'});
  if (c.gst?.client_gstin) lines(`GSTIN: ${c.gst.client_gstin}`, {size: 9, gray: 0.3});
  if (c.gst) lines(`Place of supply: ${stateName(c.gst.place_of_supply)}`, {size: 9, gray: 0.3});
  y -= 10;
  lines(`Reason: ${c.reason}`, {size: 9.5});
  y -= 6;
  row(c.full ? 'Taxable value credited (full)' : 'Taxable value credited', mm(c.breakdown.taxable));
  for (const h of c.breakdown.heads) row(`${h.name === 'GST' ? 'Tax' : h.name} (${Math.round(h.rate * 1000) / 1000}%)`, mm(h.amount));
  if (c.breakdown.round_off) row('Round off', (c.breakdown.round_off > 0 ? '+' : '-') + mm(Math.abs(c.breakdown.round_off)));
  row('Total credited', mm(c.breakdown.total), 'bold');
  y -= 10;
  lines(c.full ? `This credit note cancels invoice ${c.invoice.number} in full.` : `This credit note reduces invoice ${c.invoice.number} by ${mm(c.breakdown.total)}.`, {size: 9, gray: 0.3});
  lines('Credit notes are numbered in their own series and cannot be edited or deleted once issued.', {size: 8.5, gray: 0.4});
  return doc.toBytes();
}
