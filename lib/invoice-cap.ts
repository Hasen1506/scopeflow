import type {AdvanceAdjusted, InvoiceContent, Invoiceable} from './invoice';
import type {ReceiptVoucherContent} from './receipt-voucher';
import type {CreditNoteContent} from './credit-note';
import type {Acceptance} from './msmed';

// WS-03 (C2, H11, H12): the pure part of the invoicing documents of a project: the loaded documents,
// which invoices are cancelled by credit notes, which advances are still to be adjusted, and the cap
// (invoiceable). No database or server imports, so the property suites and WS-04/WS-10 can use it.

export type InvoiceRow = {id: string; seq: number; number: string; version: number; amount: number; currency: string; issued: string; content: string; tds_minor?: number | null; gross_minor?: number | null};
export type InvoiceDoc = {row: InvoiceRow; content: InvoiceContent; total: number; gross: number; gross_taxable: number; credited: number; credited_taxable: number; cancelled_by: string[]; legacy: boolean};
export type VoucherDoc = {seq: number; number: string; ledger_seq: number; amount: number; taxable: number; issued: string; content: ReceiptVoucherContent};
export type CreditDoc = {seq: number; number: string; invoice_seq: number; amount: number; taxable: number; issued: string; content: CreditNoteContent};
export type TdsCreditDoc = {invoice_seq: number; amount: number; certificate_no: string; form: string; quarter: string; received: string};
export type AcceptanceDoc = Acceptance & {milestone_id: string | null; evidence: string; created: string};
export type Docs = {invoices: InvoiceDoc[]; vouchers: VoucherDoc[]; credits: CreditDoc[]; tdsCredits: TdsCreditDoc[]; acceptances: AcceptanceDoc[]};

/** Receipt-voucher amounts still to be adjusted on an invoice (minor units), oldest first. */
export function unadjustedAdvances(docs: Docs): AdvanceAdjusted[] {
  const used = new Map<number, number>();
  for (const i of docs.invoices) if (!cancelled(i)) for (const v of i.content.advance?.vouchers ?? []) used.set(v.seq, (used.get(v.seq) ?? 0) + v.total);
  const out: AdvanceAdjusted[] = [];
  for (const v of docs.vouchers) {
    if ((used.get(v.seq) ?? 0) >= v.amount) continue;
    const tax = v.amount - v.taxable;
    out.push({seq: v.seq, number: v.number, issued: v.issued.slice(0, 10), taxable: v.taxable, tax, total: v.amount});
  }
  return out;
}

/** A fully credited invoice: it stops counting toward the cap and releases the advances it adjusted. */
export const cancelled = (i: InvoiceDoc) => i.credited > 0 && i.total - i.credited <= 0;

/**
 * C2: agreement total less every live invoice across all baselines (gross: payable plus the advances
 * it adjusted). `total` is also net of advances not yet adjusted (what an ordinary invoice may still
 * cover); `gross_total` includes them (what the invoice that completes the agreement covers). Pure.
 */
export function computeInvoiceable(agreement: {total: number; taxable: number}, docs: Docs): Invoiceable {
  let committed = 0, committed_taxable = 0;
  for (const i of docs.invoices) {
    if (cancelled(i)) continue;
    committed += i.total - i.credited + (i.content.advance?.total ?? 0);
    committed_taxable += Math.max(0, i.gross_taxable - i.credited_taxable);
  }
  let advances = 0, advances_taxable = 0;
  for (const a of unadjustedAdvances(docs)) { advances += a.total; advances_taxable += a.taxable; }
  const gross_total = Math.max(0, agreement.total - committed), gross_taxable = Math.max(0, agreement.taxable - committed_taxable);
  return {agreement_total: agreement.total, agreement_taxable: agreement.taxable, committed: committed + advances, committed_taxable: committed_taxable + advances_taxable,
    total: Math.max(0, gross_total - advances), taxable: Math.max(0, gross_taxable - advances_taxable), gross_total, gross_taxable, advances, advances_taxable};
}

/** Gross (cap-counting) amount of live invoices matching `pick`, minor units. */
export function invoicedFor(docs: Docs, pick: (c: InvoiceContent, row: InvoiceRow) => boolean) {
  return docs.invoices.filter(i => !cancelled(i) && pick(i.content, i.row)).reduce((s, i) => s + i.gross - i.credited, 0);
}
