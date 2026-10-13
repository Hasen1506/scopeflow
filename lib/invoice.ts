import {z} from 'zod';
import type {GstBreakdown, Minor} from './contracts';
import {PdfDocument, textWidth, wrap, type Font} from './pdf';
import {drawPdfBrand, type PdfBrand} from './brand';
import {formatMoney} from './currency';
import {formatDay} from './time';
import {EXPORT_STATE, gstSplit, isGstLabel, placeOfSupply, rupeesInWords, stateName, type GstSplit} from './gst';
import {exponentOf} from './minor';
import {capTotal, gstFromExclusive, gstFromInclusive, taxOf, type HeadKind} from './invoice-gst';
import {tdsAmount, tdsInputSchema, tdsLabel, TDS_BANNER, type Tds} from './tds';

// Numbered invoices for an approved agreement. The invoice is a frozen snapshot (InvoiceContent)
// taken when it is issued: seller details from the business profile, the client, the amount
// requested and its tax split, and dates. The PDF is rendered only from that snapshot, so a
// re-download is always identical even after the profile or the agreement changes.
//
// WS-03: amounts are computed in integer minor units with the per-head GST engine (lib/invoice-gst.ts,
// plan §9.3). The amount entered is the taxable value by default; `includes_tax: true` says it already
// includes GST. New snapshots carry `breakdown` (minor units) and optionally `advance` (receipt vouchers
// adjusted, GST rule 50), `tds` (expected deduction, plan §9.4) and `change_order`. Snapshots issued
// before WS-03 have none of these and render exactly as before.

const round2 = (n: number) => Math.round(n * 100) / 100;

export const invoiceRequestSchema = z.object({
  amount: z.number().finite().positive().max(100000000).optional(),
  /** WS-03: the amount already includes GST (inclusive entry). Default: the amount is the taxable value. */
  includes_tax: z.boolean().optional(),
  description: z.union([z.literal(''), z.string().trim().max(200)]).default(''),
  // Days until due. Without it: the "Net N" in the scope's payment terms, else 15.
  due_days: z.number().int().min(0).max(120).optional(),
  // Invoice a payment milestone of the approved scope: the amount defaults to its share of the total.
  milestone_id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).optional(),
  /** WS-03 (M9): invoice an approved change order as its own line; the amount defaults to its tax-inclusive total. */
  change_order_seq: z.number().int().min(1).optional(),
  /** WS-03 (H19): TDS the client will deduct on this invoice. null = none; omitted = the project's TDS setting, if any. */
  tds: tdsInputSchema.nullable().optional(),
  /** WS-03 (H11): adjust advances received under receipt vouchers. Default: on the invoice that completes the agreement. */
  adjust_advances: z.boolean().optional(),
  request_id: z.string().regex(/^[A-Za-z0-9_-]{8,120}$/).optional(),
}).strict().refine(r => r.amount !== undefined || r.milestone_id || r.change_order_seq, {message: 'Give an amount, a milestone or a change order to invoice.', path: ['amount']});

/** "Net 30", "net-15", "within 7 days" → the number of days; null when the terms name none. */
export function netDays(terms: string | undefined | null): number | null {
  const m = /\bnet[\s-]*(\d{1,3})\b/i.exec(terms ?? '') ?? /\bwithin\s+(\d{1,3})\s+days\b/i.exec(terms ?? '');
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 120 ? n : null;
}
export type InvoiceRequest = z.infer<typeof invoiceRequestSchema>;

export type AdvanceAdjusted = {seq: number; number: string; issued: string; taxable: Minor; tax: Minor; total: Minor};
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
  // ---- WS-03 (absent on snapshots issued before it) ----
  /** How the amount was entered. */
  entry?: 'exclusive' | 'inclusive';
  /** Full taxable value of the supply on this invoice, before advances (minor units). */
  gross_taxable?: Minor;
  /** GST on what this invoice asks for (after advances), minor units. `total` == breakdown.total in major units. */
  breakdown?: GstBreakdown;
  /** Advances received under receipt vouchers and adjusted on this invoice (GST rule 50). */
  advance?: {vouchers: AdvanceAdjusted[]; taxable: Minor; tax: Minor; total: Minor};
  /** TDS the client is expected to deduct, on the taxable value (minor units). */
  tds?: Tds & {amount: Minor; net_receivable: Minor; label: string};
  /** An approved change order billed on this invoice. */
  change_order?: {seq: number; title: string};
  /** C2 position after this invoice, minor units: agreed total and what is left to invoice. */
  cap?: {agreement_total: Minor; invoiced_before: Minor; left_after: Minor};
};

/** Invoice numbers: prefix + the owner's sequence, zero-padded to four digits. */
export const invoiceNumber = (prefix: string, seq: number) => (prefix || 'INV-') + String(seq).padStart(4, '0');
/** GST rule 46(b): a document number of at most 16 characters. */
export const NUMBER_TOO_LONG = 'Invoice numbers must be 16 characters or fewer';
export function invoiceNumberProblem(number: string): string | null {
  if (number.length > 16) return `${NUMBER_TOO_LONG} (GST rule 46): "${number}" has ${number.length}. Use a shorter invoice prefix.`;
  // Rule 46(b) names "-" and "/" as the special characters; "_" is still accepted because profiles saved
  // before WS-03 may use it (lib/profile.ts allows it). Needs CA review.
  if (!/^[A-Za-z0-9/_-]+$/.test(number)) return 'Invoice numbers may use only letters, digits, "-" and "/" (GST rule 46).';
  return null;
}
/** For the profile form (WS-08): the longest prefix that keeps a 4-digit number within 16 characters is 12. */
export function invoicePrefixProblem(prefix: string): string | null { return prefix ? invoiceNumberProblem(invoiceNumber(prefix, 1)) : null; }

const addDays = (day: string, days: number) => new Date(Date.parse(day + 'T00:00:00Z') + days * 86400_000).toISOString().slice(0, 10);

export const toMinorOf = (amount: number, currency: string): Minor => Math.round(amount * 10 ** exponentOf(currency));
export const fromMinorOf = (minor: Minor, currency: string) => minor / 10 ** exponentOf(currency);

export type Invoiceable = {
  /** Agreement total with tax (baseline + approved change orders), minor units. */
  agreement_total: Minor; agreement_taxable: Minor;
  /** Σ live invoices (gross, i.e. including advances they adjusted) across every baseline, plus unadjusted receipt vouchers. */
  committed: Minor; committed_taxable: Minor;
  /** What can still be invoiced beyond the advances already received, minor units, never negative. */
  total: Minor; taxable: Minor;
  /** What the final invoice may still cover, advances included (they are adjusted on it). */
  gross_total: Minor; gross_taxable: Minor;
  /** Receipt-voucher amounts not yet adjusted on an invoice. */
  advances: Minor; advances_taxable: Minor;
};
export type InvoiceCapProblem = {status: 400 | 409; code: string; error: string; invoiceable?: number};
/**
 * C2: why an invoice of `gross` (minor units, tax included, before advances) cannot be issued, or null.
 * The amount must fit what is still uninvoiced on the agreement (agreed total with tax less every live
 * invoice across all baselines). While advances are waiting on receipt vouchers, an ordinary invoice
 * may only cover what is left beyond them; the invoice that completes the agreement (`final`) covers
 * the advances too and adjusts them.
 */
export function invoiceProblem(gross: GstBreakdown, cap: Invoiceable, currency: string, final = false): InvoiceCapProblem | null {
  const fmt = (v: number) => formatMoney(fromMinorOf(Math.max(0, v), currency), currency);
  if (!(gross.total > 0)) return {status: 400, code: 'invalid_amount', error: 'The amount must be more than zero.'};
  const limit = final ? cap.gross_total : cap.total, limitTaxable = final ? cap.gross_taxable : cap.taxable;
  if (cap.gross_total <= 0) return {status: 409, code: 'exceeds_uninvoiced', error: 'Nothing is left to invoice on this agreement: it has been invoiced in full.', invoiceable: 0};
  // The last invoice may come out a paisa per head above the remainder from per-head rounding; it is capped by a round-off line.
  const last = gross.taxable === limitTaxable && gross.total - limit <= Math.max(1, gross.heads.length);
  if ((gross.total > limit && !last) || gross.taxable > limitTaxable) {
    const error = !final && cap.advances > 0
      ? `Only ${fmt(cap.total)} is left to invoice on this agreement beyond the ${fmt(cap.advances)} already received as an advance. Invoice the whole balance of ${fmt(cap.gross_total)} to adjust the advance on it.`
      : `Only ${fmt(limit)} is left to invoice on this agreement.`;
    return {status: 409, code: 'exceeds_uninvoiced', error, invoiceable: fromMinorOf(Math.max(0, cap.total), currency)};
  }
  return null;
}
/** Decimal amount check (two decimals at most, or none for zero-decimal currencies). */
export function amountProblem(amount: number, currency: string): string | null {
  const e = exponentOf(currency);
  return Math.abs(amount * 10 ** e - Math.round(amount * 10 ** e)) > 1e-6 ? `Use at most ${e} decimal${e === 1 ? '' : 's'} for the amount.` : null;
}

/** M7: a change order's price as the client sees it: "+₹10,000.00 + GST ₹1,800.00 = ₹11,800.00". */
export function coDisplay(fee_delta: number, tax_pct: number, tax_label: string, currency: string, kind: HeadKind = 'single') {
  const minor = toMinorOf(Math.abs(fee_delta), currency);
  const b = gstFromExclusive(minor, tax_pct, kind);
  const m = (v: number) => formatMoney(fromMinorOf(v, currency), currency);
  const sign = fee_delta < 0 ? '−' : '+';
  const label = kind === 'intra' ? 'CGST + SGST' : kind === 'inter' || kind === 'export' ? 'IGST' : (tax_label || 'Tax');
  const total = (fee_delta < 0 ? -1 : 1) * fromMinorOf(b.total, currency);
  if (!(tax_pct > 0)) return {text: `${sign}${m(minor)}`, fee: fee_delta, tax: 0, total: fee_delta};
  return {text: `${sign}${m(minor)} ${sign} ${label} ${m(taxOf(b))} = ${fee_delta < 0 ? '−' : ''}${m(b.total)}`, fee: fee_delta, tax: (fee_delta < 0 ? -1 : 1) * fromMinorOf(taxOf(b), currency), total};
}

export type InvoiceInput = {
  number: string; issued: string; due_days: number; description: string;
  /**
   * The amount entered (major units). `includes_tax: false` = it is the taxable value (the API default);
   * true or omitted = it already includes the tax (how pure callers before WS-03 used this function).
   */
  amount: number; includes_tax?: boolean;
  seller: InvoiceContent['seller']; client: InvoiceContent['client']; project: InvoiceContent['project'];
  currency: string; tax_label: string; tax_pct: number; agreed_total: number; paid: number; payment_terms: string;
  gst?: {seller_state: string; sac: string; lut_arn: string; client_gstin: string; client_state: string; client_address: string};
  milestone?: InvoiceContent['milestone'];
  change_order?: InvoiceContent['change_order'];
  fx?: {currency: string; rate: number; as_of: string; source: string};
  /** WS-03: receipt vouchers to adjust on this invoice (the final one, or when asked), oldest first. */
  advances?: AdvanceAdjusted[];
  tds?: Tds | null;
  /** WS-03 (C2): the cap position before this invoice; the last invoice's total is capped to it. */
  cap?: Invoiceable;
};

/** Where the tax goes for a project: a GST tax invoice (intra/inter/export) or a single head. Pure. */
export function taxPlacement(input: Pick<InvoiceInput, 'gst' | 'currency' | 'tax_label' | 'tax_pct'>): {kind: HeadKind; pos: ReturnType<typeof placeOfSupply> | null; gstInvoice: boolean} {
  const g = input.gst;
  const pos = g?.seller_state ? placeOfSupply({client_gstin: g.client_gstin, client_state: g.client_state, currency: input.currency, seller_state: g.seller_state}) : null;
  const gstInvoice = !!(g && pos && (isGstLabel(input.tax_label) || (input.tax_pct === 0 && pos.code === EXPORT_STATE)));
  if (!gstInvoice || !pos) return {kind: 'single', pos, gstInvoice: false};
  return {kind: gstSplit(1, g!.seller_state, pos.code).kind, pos, gstInvoice: true};
}

/** The gross breakdown (before advances) of an invoice request. Pure. */
export function grossBreakdown(input: Pick<InvoiceInput, 'amount' | 'includes_tax' | 'currency' | 'tax_pct' | 'gst' | 'tax_label'>): GstBreakdown {
  const {kind} = taxPlacement(input);
  const minor = toMinorOf(input.amount, input.currency);
  return input.includes_tax !== false ? gstFromInclusive(minor, input.tax_pct, kind) : gstFromExclusive(minor, input.tax_pct, kind);
}

/** The snapshot for a new invoice. Pure. */
export function invoiceContent(input: InvoiceInput): InvoiceContent {
  const cur = input.currency, M = (v: number) => fromMinorOf(v, cur);
  const placement = taxPlacement(input);
  let gross = grossBreakdown(input);
  if (input.cap) gross = capTotal(gross, input.advances?.length ? input.cap.gross_total : input.cap.total);
  // H11: advances adjusted on this invoice (receipt vouchers, whole). The amount asked for is the value of
  // the supply; tax is charged only on what is left after the advances' taxable value, and the payable
  // total is the gross less what the advances already paid (any paisa difference is an explicit round-off).
  const vouchers: AdvanceAdjusted[] = [...(input.advances ?? [])];
  const adv = {taxable: vouchers.reduce((s, v) => s + v.taxable, 0), tax: vouchers.reduce((s, v) => s + v.tax, 0), total: vouchers.reduce((s, v) => s + v.total, 0)};
  if (adv.taxable > gross.taxable) throw new Error('An invoice cannot adjust more advance than its own value.');
  let breakdown: GstBreakdown = gross;
  if (adv.total > 0) {
    const rest = gstFromExclusive(gross.taxable - adv.taxable, input.tax_pct, placement.kind);
    const target = Math.max(0, gross.total - adv.total);
    breakdown = {...rest, round_off: target - rest.taxable - taxOf(rest), total: target};
  }
  const total = M(breakdown.total), taxable = M(breakdown.taxable), tax = M(taxOf(breakdown));
  const balance_before = round2(Math.max(0, input.agreed_total - input.paid));
  const out: InvoiceContent = {
    number: input.number, issued: input.issued, due: addDays(input.issued, input.due_days),
    seller: input.seller, client: input.client, project: input.project, currency: cur,
    line: {description: input.description || `${(input.cap ? input.cap.gross_total - gross.total <= 0 : total >= balance_before) ? 'Balance' : 'Part payment'} for ${input.project.title} (approved scope, version ${input.project.version})`, amount: M(gross.taxable)},
    tax: input.tax_pct > 0 ? {label: input.tax_label || 'Tax', pct: input.tax_pct, taxable, amount: tax} : null,
    total,
    agreement: {total: input.agreed_total, paid_before: input.paid, balance_before, balance_after: round2(Math.max(0, balance_before - total))},
    payment_terms: input.payment_terms,
    entry: input.includes_tax !== false ? 'inclusive' : 'exclusive',
    gross_taxable: gross.taxable,
    breakdown,
  };
  if (adv.total > 0) out.advance = {vouchers, ...adv};
  if (input.cap) out.cap = {agreement_total: input.cap.agreement_total, invoiced_before: input.cap.committed - input.cap.advances, left_after: Math.max(0, input.cap.gross_total - gross.total)};
  if (input.milestone) {
    out.milestone = input.milestone;
    if (!input.description) out.line.description = `${input.milestone.title} (${input.milestone.pct}% milestone) for ${input.project.title}, approved scope version ${input.project.version}`;
  }
  if (input.change_order) {
    out.change_order = input.change_order;
    if (!input.description) out.line.description = `Change order: ${input.change_order.title} (approved), ${input.project.title}`;
  }
  if (input.fx) out.fx = {...input.fx, total: round2(total * input.fx.rate)};
  if (input.tds && input.tds.rate_pct > 0) {
    const amount = tdsAmount(breakdown.taxable, input.tds.rate_pct, cur);
    out.tds = {...input.tds, amount, net_receivable: Math.max(0, breakdown.total - amount), label: tdsLabel(input.tds, input.issued)};
  }
  const g = input.gst, pos = placement.pos;
  if (g && pos && placement.gstInvoice) {
    const heads = Object.fromEntries(breakdown.heads.map(h => [h.name, M(h.amount)]));
    out.gst = {
      seller_gstin: input.seller.tax_id, seller_state: g.seller_state, client_gstin: g.client_gstin, client_address: g.client_address,
      place_of_supply: pos.code, place_basis: pos.basis, sac: g.sac, rate: input.tax_pct, kind: placement.kind === 'single' || placement.kind === 'none' ? 'inter' : placement.kind,
      cgst: heads.CGST ?? 0, sgst: heads.SGST ?? 0, igst: heads.IGST ?? 0,
      lut_arn: placement.kind === 'export' && !(heads.IGST > 0) ? g.lut_arn : '', total_in_words: cur === 'INR' ? rupeesInWords(total) : '',
    };
  }
  return out;
}

/**
 * H11: whether a payment on the record was an advance (received before the supply was invoiced): an
 * online deposit, a payment the owner recorded as a deposit or advance, or money that arrived before
 * the project's first invoice. `firstInvoice` is that invoice's issue timestamp (ISO), or null.
 */
export function isAdvanceOf(line: {source: string; note: string; reference: string; created: string}, firstInvoice: string | null): boolean {
  if ((line.source === 'razorpay' || line.source === 'stripe') && line.note === 'Deposit') return true;
  if (line.source === 'owner' && /\b(deposit|advance)\b/i.test(`${line.note} ${line.reference}`)) return true;
  if (line.source === 'refund') return false;
  return firstInvoice === null || line.created < firstInvoice;
}

/** What an invoice counts toward the C2 cap: its gross (payable + advances it adjusted), minor units. */
export function invoiceGross(c: InvoiceContent): {total: Minor; taxable: Minor} {
  if (c.breakdown) return {total: c.breakdown.total + (c.advance?.total ?? 0), taxable: c.gross_taxable ?? c.breakdown.taxable};
  const total = toMinorOf(c.total, c.currency);
  return {total, taxable: c.tax ? toMinorOf(c.tax.taxable, c.currency) : total};
}

const MARGIN = 48;
export function renderInvoicePdf(c: InvoiceContent, brand: PdfBrand | null = null, extra: {cancelled_by?: string[]} = {}): Uint8Array {
  const doc = new PdfDocument({info: {Title: `Invoice ${c.number}`, Producer: 'Scopeflow'}});
  const W = doc.width - MARGIN * 2, money = (v: number) => formatMoney(v, c.currency), mm = (v: number) => money(fromMinorOf(v, c.currency));
  doc.addPage();
  let y = doc.height - MARGIN;
  const lines = (text: string, x: number, width: number, {size = 9.5, font = 'regular' as Font, gray = 0} = {}) => {
    for (const line of text ? wrap(text, width, size, font) : []) { doc.text(x, y - size, line, {size, font, gray}); y -= size + 3; }
  };
  const right = (v: string, yy: number, {size = 10, font = 'regular' as Font} = {}) => doc.text(MARGIN + W - textWidth(v, size), yy, v, {size, font});
  doc.text(MARGIN, 28, `Invoice ${c.number} · ${c.project.title.slice(0, 60)} · prepared with Scopeflow`, {size: 7, gray: 0.45});

  y -= drawPdfBrand(doc, brand, {margin: MARGIN, top: y, align: 'left'});
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
  if (extra.cancelled_by?.length) { const t = `Cancelled by ${extra.cancelled_by.join(', ')}`; doc.text(MARGIN + W - textWidth(t, 10, 'bold'), y - 10, t, {size: 10, font: 'bold'}); y -= 16; }
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
  const b = c.breakdown;
  if (b) {
    // WS-03: heads straight from the minor-unit breakdown, advances adjusted, explicit round-off.
    if (c.advance) {
      total('Value of supply', mm(c.gross_taxable ?? b.taxable));
      for (const v of c.advance.vouchers) total(`Less: advance received vide ${v.number}`, '-' + mm(v.taxable));
    }
    if (g || c.tax) total(g ? 'Taxable value' : 'Subtotal', mm(b.taxable));
    const ut = g && ['04', '26', '31', '35', '38', '97'].includes(g.seller_state) ? 'UTGST' : 'SGST';
    for (const h of b.heads) total(`${h.name === 'SGST' ? ut : h.name === 'GST' ? (c.tax?.label ?? 'Tax') : h.name} (${Math.round(h.rate * 1000) / 1000}%)`, mm(h.amount));
    if (b.round_off) total('Round off', (b.round_off > 0 ? '+' : '-') + mm(Math.abs(b.round_off)));
  } else if (g) {
    total('Taxable value', money(c.tax?.taxable ?? c.total));
    const half = Math.round(g.rate / 2 * 1000) / 1000;
    if (g.kind === 'intra') { total(`CGST (${half}%)`, money(g.cgst)); total(`${['04', '26', '31', '35', '38', '97'].includes(g.seller_state) ? 'UTGST' : 'SGST'} (${half}%)`, money(g.sgst)); }
    else total(`IGST (${g.rate}%)`, money(g.igst));
  } else if (c.tax) { total('Subtotal', money(c.tax.taxable)); total(`${c.tax.label} (${c.tax.pct}%)`, money(c.tax.amount)); }
  total('Total due', money(c.total), 'bold');
  if (c.advance) lines(`Advance${c.advance.vouchers.length > 1 ? 's' : ''} already received: ${c.advance.vouchers.map(v => `${v.number} (${mm(v.total)} incl. tax ${mm(v.tax)})`).join(', ')}; tax is charged here only on the remainder.`, MARGIN, W, {size: 8.5, gray: 0.3});
  if (c.tds) { y -= 2; lines(`TDS expected ${mm(c.tds.amount)} (${c.tds.label}, ${c.tds.rate_pct}% of the taxable value); net receivable ${mm(c.tds.net_receivable)}. ${TDS_BANNER}`, MARGIN, W, {size: 8.5, gray: 0.25}); }
  if (c.fx) { doc.text(MARGIN + W - 260, y - 9, `In ${c.fx.currency} at the agreed ${c.fx.rate}`, {size: 8.5, gray: 0.4}); right(formatMoney(c.fx.total, c.fx.currency), y - 9, {size: 8.5}); y -= 13; }
  if (g?.total_in_words) { y -= 2; lines(`Amount in words: ${g.total_in_words}`, MARGIN, W, {size: 8.5, gray: 0.3}); }
  if (g?.kind === 'export') lines(g.lut_arn ? `Supply meant for export under LUT (ARN ${g.lut_arn}) without payment of IGST.` : g.igst > 0 ? 'Supply meant for export on payment of IGST.' : 'Supply meant for export (zero-rated).', MARGIN, W, {size: 8.5, gray: 0.3});
  y -= 12;

  const section = (title: string) => { doc.text(MARGIN, y - 8, title.toUpperCase(), {size: 8, font: 'bold', gray: 0.35}); y -= 13; doc.line(MARGIN, y, MARGIN + W, y); y -= 7; };
  section('Agreement');
  if (c.cap) lines(`${c.project.title}, approved scope version ${c.project.version}. Agreed total ${mm(c.cap.agreement_total)}; invoiced before this invoice ${mm(c.cap.invoiced_before)}; left to invoice after it ${mm(c.cap.left_after)}.`, MARGIN, W, {size: 9, gray: 0.25});
  else lines(`${c.project.title}, approved scope version ${c.project.version}. Agreed total ${money(c.agreement.total)}; received before this invoice ${money(c.agreement.paid_before)}; still due after it is paid ${money(c.agreement.balance_after)}.`, MARGIN, W, {size: 9, gray: 0.25});
  y -= 6;
  if (c.seller.payment_details) { section('How to pay'); lines(c.seller.payment_details, MARGIN, W, {size: 9.5}); y -= 6; }
  if (c.payment_terms) { section('Payment terms'); lines(c.payment_terms, MARGIN, W, {size: 9.5}); y -= 6; }
  lines(`Please quote ${c.number} with your payment.`, MARGIN, W, {size: 8.5, gray: 0.4});
  if (g) { y -= 18; lines(`For ${c.seller.name}`, MARGIN + W / 2, W / 2, {size: 9.5}); y -= 22; lines('Authorised signatory', MARGIN + W / 2, W / 2, {size: 8.5, gray: 0.4}); }
  return doc.toBytes();
}
