import {z} from 'zod';
import {PdfDocument, textWidth, wrap, type Font} from './pdf';
import {formatMoney} from './currency';
import {formatDay} from './time';

// Numbered invoices for an approved agreement. The invoice is a frozen snapshot (InvoiceContent)
// taken when it is issued: seller details from the business profile, the client, the amount
// requested and its tax split, and dates. The PDF is rendered only from that snapshot, so a
// re-download is always identical even after the profile or the agreement changes.

const round2 = (n: number) => Math.round(n * 100) / 100;

export const invoiceRequestSchema = z.object({
  amount: z.number().finite().positive().max(100000000),
  description: z.union([z.literal(''), z.string().trim().max(200)]).default(''),
  due_days: z.number().int().min(0).max(120).default(15),
  request_id: z.string().regex(/^[A-Za-z0-9_-]{8,120}$/).optional(),
}).strict();
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
}): InvoiceContent {
  const amount = round2(input.amount);
  const taxable = input.tax_pct > 0 ? round2(amount / (1 + input.tax_pct / 100)) : amount;
  const balance_before = round2(Math.max(0, input.agreed_total - input.paid));
  return {
    number: input.number, issued: input.issued, due: addDays(input.issued, input.due_days),
    seller: input.seller, client: input.client, project: input.project, currency: input.currency,
    line: {description: input.description || `${amount >= balance_before ? 'Balance' : 'Part payment'} for ${input.project.title} (approved scope, version ${input.project.version})`, amount: taxable},
    tax: input.tax_pct > 0 ? {label: input.tax_label || 'Tax', pct: input.tax_pct, taxable, amount: round2(amount - taxable)} : null,
    total: amount,
    agreement: {total: input.agreed_total, paid_before: input.paid, balance_before, balance_after: round2(Math.max(0, balance_before - amount))},
    payment_terms: input.payment_terms,
  };
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
  if (c.seller.tax_id) lines(`Tax ID: ${c.seller.tax_id}`, MARGIN, W / 2, {size: 9, gray: 0.3});
  const leftEnd = y;
  y = top;
  doc.text(MARGIN + W - textWidth('INVOICE', 18, 'bold'), y - 18, 'INVOICE', {size: 18, font: 'bold'}); y -= 26;
  for (const [k, v] of [['Number', c.number], ['Issued', formatDay(c.issued)], ['Due', formatDay(c.due)]] as const) {
    doc.text(MARGIN + W - 200, y - 9.5, k, {size: 9.5, gray: 0.4}); right(v, y - 9.5, {size: 9.5}); y -= 14;
  }
  y = Math.min(y, leftEnd) - 18;

  doc.text(MARGIN, y - 8, 'BILL TO', {size: 8, font: 'bold', gray: 0.35}); y -= 14;
  lines(c.client.name, MARGIN, W, {size: 10.5, font: 'bold'});
  if (c.client.email) lines(c.client.email, MARGIN, W, {size: 9, gray: 0.3});
  y -= 16;

  // Line table.
  doc.text(MARGIN, y - 8, 'DESCRIPTION', {size: 8, font: 'bold', gray: 0.35}); right('AMOUNT', y - 8, {size: 8, font: 'bold'}); y -= 13;
  doc.line(MARGIN, y, MARGIN + W, y); y -= 8;
  const descTop = y;
  lines(c.line.description, MARGIN, W - 140, {size: 10});
  right(money(c.line.amount), descTop - 10);
  y -= 6; doc.line(MARGIN, y, MARGIN + W, y); y -= 6;
  const total = (k: string, v: string, font: Font = 'regular') => { doc.text(MARGIN + W - 260, y - 10, k, {size: 10, font, gray: font === 'bold' ? 0 : 0.3}); right(v, y - 10, {font}); y -= 15; };
  if (c.tax) { total('Subtotal', money(c.tax.taxable)); total(`${c.tax.label} (${c.tax.pct}%)`, money(c.tax.amount)); }
  total('Total due', money(c.total), 'bold');
  y -= 12;

  const section = (title: string) => { doc.text(MARGIN, y - 8, title.toUpperCase(), {size: 8, font: 'bold', gray: 0.35}); y -= 13; doc.line(MARGIN, y, MARGIN + W, y); y -= 7; };
  section('Agreement');
  lines(`${c.project.title}, approved scope version ${c.project.version}. Agreed total ${money(c.agreement.total)}; received before this invoice ${money(c.agreement.paid_before)}; still due after it is paid ${money(c.agreement.balance_after)}.`, MARGIN, W, {size: 9, gray: 0.25});
  y -= 6;
  if (c.seller.payment_details) { section('How to pay'); lines(c.seller.payment_details, MARGIN, W, {size: 9.5}); y -= 6; }
  if (c.payment_terms) { section('Payment terms'); lines(c.payment_terms, MARGIN, W, {size: 9.5}); y -= 6; }
  lines(`Please quote ${c.number} with your payment.`, MARGIN, W, {size: 8.5, gray: 0.4});
  return doc.toBytes();
}
