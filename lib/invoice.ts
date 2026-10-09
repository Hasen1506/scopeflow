import {z} from 'zod';
import {PdfDocument, textWidth, wrap, type Font} from './pdf';
import {formatMoney} from './currency';
import {formatDay} from './time';
import {EXPORT_STATE, gstSplit, isGstLabel, placeOfSupply, rupeesInWords, stateName, type GstSplit} from './gst';

// Numbered invoices for an approved agreement. The invoice is a frozen snapshot (InvoiceContent)
// taken when it is issued: seller details from the business profile, the client, the amount
// requested and its tax split, and dates. The PDF is rendered only from that snapshot, so a
// re-download is always identical even after the profile or the agreement changes.

const round2 = (n: number) => Math.round(n * 100) / 100;

export const invoiceRequestSchema = z.object({
  amount: z.number().finite().positive().max(100000000).optional(),
  description: z.union([z.literal(''), z.string().trim().max(200)]).default(''),
  // Days until due. Without it: the "Net N" in the scope's payment terms, else 15.
  due_days: z.number().int().min(0).max(120).optional(),
  // Invoice a payment milestone of the approved scope: the amount defaults to its share of the total.
  milestone_id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).optional(),
  request_id: z.string().regex(/^[A-Za-z0-9_-]{8,120}$/).optional(),
}).strict().refine(r => r.amount !== undefined || r.milestone_id, {message: 'Give an amount or a milestone to invoice.', path: ['amount']});

/** "Net 30", "net-15", "within 7 days" → the number of days; null when the terms name none. */
export function netDays(terms: string | undefined | null): number | null {
  const m = /\bnet[\s-]*(\d{1,3})\b/i.exec(terms ?? '') ?? /\bwithin\s+(\d{1,3})\s+days\b/i.exec(terms ?? '');
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 120 ? n : null;
}
export type InvoiceRequest = z.infer<typeof invoiceRequestSchema>;

export type InvoiceContent = {
  number: string; issued: string; due: string;
  seller: {name: string; address: string; tax_id: string; payment_details: string};
  client: {name: string; email: string};
  project: {id: string; title: string; version: number};
  currency: string;
  line: {description: string; amount: number};
  tax: {label: string; pct: number; taxable: number; amount: number} | null;
  total: number;
  agreement: {total: number; paid_before: number; balance_before: number; balance_after: number};
  payment_terms: string;
  /** GST tax invoice details (India), when the seller is GST-registered and the tax is GST. */
  gst?: {
    seller_gstin: string; seller_state: string; client_gstin: string; client_address: string;
    place_of_supply: string; place_basis: 'gstin' | 'address' | 'export' | 'supplier'; sac: string; rate: number;
    kind: GstSplit['kind']; cgst: number; sgst: number; igst: number; lut_arn: string; total_in_words: string;
  };
  milestone?: {id: string; title: string; pct: number};
  /** The total in the scope's locked second currency. */
  fx?: {currency: string; rate: number; as_of: string; source: string; total: number};
};

/** Invoice numbers: prefix + the owner's sequence, zero-padded to four digits. */
export const invoiceNumber = (prefix: string, seq: number) => (prefix || 'INV-') + String(seq).padStart(4, '0');
const addDays = (day: string, days: number) => new Date(Date.parse(day + 'T00:00:00Z') + days * 86400_000).toISOString().slice(0, 10);

/**
 * Why an invoice for `amount` cannot be issued, or null. The amount must have at most two decimals
 * and cannot exceed the balance still due (agreed total with tax, less every payment on the record).
 */
export function invoiceProblem(amount: number, balance: number, currency: string): string | null {
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) return 'Use at most two decimals for the amount.';
  if (!(balance > 0)) return 'Nothing is due on this agreement: it is paid in full.';
  if (amount > balance + 0.005) return `The amount is more than the ${formatMoney(balance, currency)} still due.`;
  return null;
}

/** The snapshot for a new invoice. The amount includes tax; the tax part is split out at the agreed rate. Pure. */
export function invoiceContent(input: {
  number: string; issued: string; due_days: number; description: string; amount: number;
  seller: InvoiceContent['seller']; client: InvoiceContent['client']; project: InvoiceContent['project'];
  currency: string; tax_label: string; tax_pct: number; agreed_total: number; paid: number; payment_terms: string;
  gst?: {seller_state: string; sac: string; lut_arn: string; client_gstin: string; client_state: string; client_address: string};
  milestone?: InvoiceContent['milestone'];
  fx?: {currency: string; rate: number; as_of: string; source: string};
}): InvoiceContent {
  const amount = round2(input.amount);
  const taxable = input.tax_pct > 0 ? round2(amount / (1 + input.tax_pct / 100)) : amount;
  const balance_before = round2(Math.max(0, input.agreed_total - input.paid));
  const out: InvoiceContent = {
    number: input.number, issued: input.issued, due: addDays(input.issued, input.due_days),
    seller: input.seller, client: input.client, project: input.project, currency: input.currency,
    line: {description: input.description || `${amount >= balance_before ? 'Balance' : 'Part payment'} for ${input.project.title} (approved scope, version ${input.project.version})`, amount: taxable},
    tax: input.tax_pct > 0 ? {label: input.tax_label || 'Tax', pct: input.tax_pct, taxable, amount: round2(amount - taxable)} : null,
    total: amount,
    agreement: {total: input.agreed_total, paid_before: input.paid, balance_before, balance_after: round2(Math.max(0, balance_before - amount))},
    payment_terms: input.payment_terms,
  };
  if (input.milestone) {
    out.milestone = input.milestone;
    if (!input.description) out.line.description = `${input.milestone.title} (${input.milestone.pct}% milestone) for ${input.project.title}, approved scope version ${input.project.version}`;
  }
  if (input.fx) out.fx = {...input.fx, total: round2(amount * input.fx.rate)};
  const g = input.gst;
  const pos = g?.seller_state ? placeOfSupply({client_gstin: g.client_gstin, client_state: g.client_state, currency: input.currency, seller_state: g.seller_state}) : null;
  // A tax invoice when the tax is GST, or for an export at 0% (zero-rated under a LUT).
  if (g && pos && (isGstLabel(input.tax_label) || (input.tax_pct === 0 && pos.code === EXPORT_STATE))) {
    const split = gstSplit(out.tax?.amount ?? 0, g.seller_state, pos.code);
    out.gst = {
      seller_gstin: input.seller.tax_id, seller_state: g.seller_state, client_gstin: g.client_gstin, client_address: g.client_address,
      place_of_supply: pos.code, place_basis: pos.basis, sac: g.sac, rate: input.tax_pct, kind: split.kind, cgst: split.cgst, sgst: split.sgst, igst: split.igst,
      lut_arn: split.kind === 'export' && split.igst === 0 ? g.lut_arn : '', total_in_words: input.currency === 'INR' ? rupeesInWords(amount) : '',
    };
  }
  return out;
}

const MARGIN = 48;
export function renderInvoicePdf(c: InvoiceContent): Uint8Array {
  const doc = new PdfDocument({info: {Title: `Invoice ${c.number}`, Producer: 'Scopeflow'}});
  const W = doc.width - MARGIN * 2, money = (v: number) => formatMoney(v, c.currency);
  doc.addPage();
  let y = doc.height - MARGIN;
  const lines = (text: string, x: number, width: number, {size = 9.5, font = 'regular' as Font, gray = 0} = {}) => {
    for (const line of text ? wrap(text, width, size, font) : []) { doc.text(x, y - size, line, {size, font, gray}); y -= size + 3; }
  };
  const right = (v: string, yy: number, {size = 10, font = 'regular' as Font} = {}) => doc.text(MARGIN + W - textWidth(v, size), yy, v, {size, font});
  doc.text(MARGIN, 28, `Invoice ${c.number} · ${c.project.title.slice(0, 60)} · prepared with Scopeflow`, {size: 7, gray: 0.45});

  // Seller block (left) and invoice details (right).
  const top = y;
  lines(c.seller.name || 'Seller name not set', MARGIN, W / 2, {size: 14, font: 'bold'});
  lines(c.seller.address, MARGIN, W / 2, {size: 9, gray: 0.3});
  const g = c.gst;
  if (c.seller.tax_id) lines(`${g ? 'GSTIN' : 'Tax ID'}: ${c.seller.tax_id}`, MARGIN, W / 2, {size: 9, gray: 0.3});
  if (g) lines(`State: ${stateName(g.seller_state)} (${g.seller_state})`, MARGIN, W / 2, {size: 9, gray: 0.3});
  const leftEnd = y;
  y = top;
  const title = g ? 'TAX INVOICE' : 'INVOICE';
  doc.text(MARGIN + W - textWidth(title, 18, 'bold'), y - 18, title, {size: 18, font: 'bold'}); y -= 26;
  for (const [k, v] of [['Number', c.number], ['Issued', formatDay(c.issued)], ['Due', formatDay(c.due)]] as const) {
    doc.text(MARGIN + W - 200, y - 9.5, k, {size: 9.5, gray: 0.4}); right(v, y - 9.5, {size: 9.5}); y -= 14;
  }
  y = Math.min(y, leftEnd) - 18;

  doc.text(MARGIN, y - 8, 'BILL TO', {size: 8, font: 'bold', gray: 0.35}); y -= 14;
  lines(c.client.name, MARGIN, W, {size: 10.5, font: 'bold'});
  if (g?.client_address) lines(g.client_address, MARGIN, W / 1.5, {size: 9, gray: 0.3});
  if (g?.client_gstin) lines(`GSTIN: ${g.client_gstin}`, MARGIN, W, {size: 9, gray: 0.3});
  if (c.client.email) lines(c.client.email, MARGIN, W, {size: 9, gray: 0.3});
  if (g) lines(`Place of supply: ${stateName(g.place_of_supply)}${g.place_of_supply === '96' ? '' : ` (${g.place_of_supply})`} · Reverse charge: No`, MARGIN, W, {size: 9, gray: 0.3});
  y -= 16;

  // Line table.
  doc.text(MARGIN, y - 8, 'DESCRIPTION', {size: 8, font: 'bold', gray: 0.35}); right('AMOUNT', y - 8, {size: 8, font: 'bold'}); y -= 13;
  doc.line(MARGIN, y, MARGIN + W, y); y -= 8;
  const descTop = y;
  lines(c.line.description, MARGIN, W - 140, {size: 10});
  if (g?.sac) lines(`SAC ${g.sac}`, MARGIN, W - 140, {size: 8.5, gray: 0.4});
  right(money(c.line.amount), descTop - 10);
  y -= 6; doc.line(MARGIN, y, MARGIN + W, y); y -= 6;
  const total = (k: string, v: string, font: Font = 'regular') => { doc.text(MARGIN + W - 260, y - 10, k, {size: 10, font, gray: font === 'bold' ? 0 : 0.3}); right(v, y - 10, {font}); y -= 15; };
  if (g) {
    total('Taxable value', money(c.tax?.taxable ?? c.total));
    const half = Math.round(g.rate / 2 * 1000) / 1000;
    if (g.kind === 'intra') { total(`CGST (${half}%)`, money(g.cgst)); total(`${['04', '26', '31', '35', '38', '97'].includes(g.seller_state) ? 'UTGST' : 'SGST'} (${half}%)`, money(g.sgst)); }
    else total(`IGST (${g.rate}%)`, money(g.igst));
  } else if (c.tax) { total('Subtotal', money(c.tax.taxable)); total(`${c.tax.label} (${c.tax.pct}%)`, money(c.tax.amount)); }
  total('Total due', money(c.total), 'bold');
  if (c.fx) { doc.text(MARGIN + W - 260, y - 9, `In ${c.fx.currency} at the agreed ${c.fx.rate}`, {size: 8.5, gray: 0.4}); right(formatMoney(c.fx.total, c.fx.currency), y - 9, {size: 8.5}); y -= 13; }
  if (g?.total_in_words) { y -= 2; lines(`Amount in words: ${g.total_in_words}`, MARGIN, W, {size: 8.5, gray: 0.3}); }
  if (g?.kind === 'export') lines(g.lut_arn ? `Supply meant for export under LUT (ARN ${g.lut_arn}) without payment of IGST.` : g.igst > 0 ? 'Supply meant for export on payment of IGST.' : 'Supply meant for export (zero-rated).', MARGIN, W, {size: 8.5, gray: 0.3});
  y -= 12;

  const section = (title: string) => { doc.text(MARGIN, y - 8, title.toUpperCase(), {size: 8, font: 'bold', gray: 0.35}); y -= 13; doc.line(MARGIN, y, MARGIN + W, y); y -= 7; };
  section('Agreement');
  lines(`${c.project.title}, approved scope version ${c.project.version}. Agreed total ${money(c.agreement.total)}; received before this invoice ${money(c.agreement.paid_before)}; still due after it is paid ${money(c.agreement.balance_after)}.`, MARGIN, W, {size: 9, gray: 0.25});
  y -= 6;
  if (c.seller.payment_details) { section('How to pay'); lines(c.seller.payment_details, MARGIN, W, {size: 9.5}); y -= 6; }
  if (c.payment_terms) { section('Payment terms'); lines(c.payment_terms, MARGIN, W, {size: 9.5}); y -= 6; }
  lines(`Please quote ${c.number} with your payment.`, MARGIN, W, {size: 8.5, gray: 0.4});
  if (g) { y -= 18; lines(`For ${c.seller.name}`, MARGIN + W / 2, W / 2, {size: 9.5}); y -= 22; lines('Authorised signatory', MARGIN + W / 2, W / 2, {size: 8.5, gray: 0.4}); }
  return doc.toBytes();
}
