import {db} from './server';
import {paymentsOf, type LedgerEntry} from './ledger';
import {invoiceStatuses, type InvoiceStatus} from './invoice-status';
import type {InvoiceContent} from './invoice';
import {zoneOrUtc} from './time';

export type InvoiceRow = {id: string; seq: number; number: string; version: number; amount: number; currency: string; issued: string; content: string};
export type InvoiceView = {seq: number; number: string; version: number; amount: number; currency: string; issued: string; due: string; description: string; tax_invoice: boolean; milestone: string | null} & Omit<InvoiceStatus, 'seq'>;

/** Today's date in the project's time zone (YYYY-MM-DD). */
export const todayIn = (timezone: string | null) => new Intl.DateTimeFormat('en-CA', {timeZone: zoneOrUtc(timezone), year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());

/** Invoices of one approved version with what the payments on the record cover. */
export function invoiceViews(rows: InvoiceRow[], entries: LedgerEntry[], today: string): InvoiceView[] {
  const byVersion = new Map<number, InvoiceRow[]>();
  for (const r of rows) byVersion.set(r.version, [...(byVersion.get(r.version) ?? []), r]);
  const out: InvoiceView[] = [];
  for (const [version, list] of byVersion) {
    const contents = new Map(list.map(r => [r.seq, JSON.parse(r.content) as InvoiceContent]));
    const {paid} = paymentsOf(entries.filter(e => e.baseline_version === version));
    const status = new Map(invoiceStatuses(list.map(r => ({seq: r.seq, total: r.amount, due: contents.get(r.seq)!.due, paid_before: contents.get(r.seq)!.agreement.paid_before})), paid, today).map(s => [s.seq, s]));
    for (const r of list) {
      const c = contents.get(r.seq)!, {seq: _seq, ...s} = status.get(r.seq)!;
      void _seq;
      out.push({seq: r.seq, number: r.number, version: r.version, amount: r.amount, currency: r.currency, issued: c.issued, due: c.due, description: c.line.description, tax_invoice: !!c.gst, milestone: c.milestone?.id ?? null, ...s});
    }
  }
  return out.sort((a, b) => a.seq - b.seq);
}

/** The invoices a client can see through a review link: those for that link's approved version. */
export async function clientInvoices(projectId: string, version: number, entries: LedgerEntry[], timezone: string | null) {
  const rows = await db().prepare('SELECT id,seq,number,version,amount,currency,issued,content FROM invoices WHERE project_id=? AND version=? ORDER BY seq').bind(projectId, version).all<InvoiceRow>();
  return invoiceViews(rows.results, entries, todayIn(timezone));
}
