import {db, json, ownerAuth} from './server';
import {fromMinorOf, netDays} from './invoice';
import {cachedPdf, invoicingState, msmedSummary, recordKey, streamPdf, tdsCertificatesPending, unadjustedAdvances, type InvoicingState, type ProjectRow} from './invoice-server';
import {loadLedger} from './ledger-server';
import {brandForProject} from './brand-server';
import {pdfBrand} from './brand';
import {receiptTimeZone} from './receipt-server';
import {renderStatementPdf, statementModel, type StatementBilling} from './statement';

import {TDS_BANNER, TDS_TABLE} from './tds';
import {MSMED_DISCLAIMER} from './msmed';

// WS-03: helpers shared by the invoicing routes (route files may only export handlers).

/** The signed-in owner's project, or an error response. */
export async function projectFor(request: Request, id: string) {
  const auth = await ownerAuth(request);
  if (!auth) return {error: json({error: 'Sign in or provide a valid API token.'}, 401)} as const;
  const row = await db().prepare('SELECT id,owner,archived,client_email,timezone,client_gstin,client_state,client_address FROM projects WHERE id=? AND owner=?').bind(id, auth.user).first<ProjectRow>();
  if (!row) return {error: json({error: 'Project not found.'}, 404)} as const;
  return {auth, row, error: null} as const;
}

const M = (s: InvoicingState, v: number) => fromMinorOf(v, s.currency);
/** The owner's view of a project's invoicing (shared with the panel and the MCP). */
export function invoicingJson(s: InvoicingState, entries: Parameters<typeof tdsCertificatesPending>[1], contract_date: string | null, paymentTerms?: string | null) {
  return {
    invoices: s.views,
    schedule: s.schedule.map(m => ({id: m.id, title: m.title, pct: m.pct, due: m.due, amount: M(s, m.amount), invoiced: M(s, m.invoiced)})),
    change_orders: s.change_orders.map(c => ({...c, total: M(s, c.total), invoiced: M(s, c.invoiced)})),
    net_days: netDays(paymentTerms) ?? null,
    invoiceable: s.cap ? {total: M(s, s.cap.total), gross_total: M(s, s.cap.gross_total), advances: M(s, s.cap.advances), agreement_total: M(s, s.cap.agreement_total), committed: M(s, s.cap.committed)} : null,
    tax: s.agreement ? {rate: s.agreement.rate, label: s.agreement.label, kind: s.agreement.kind} : null,
    receipt_vouchers: s.docs.vouchers.map(v => ({seq: v.seq, number: v.number, kind: v.content.kind, amount: M(s, v.amount), received: v.content.received, issued: v.issued.slice(0, 10), ledger_seq: v.ledger_seq, adjusted: !unadjustedAdvances(s.docs).some(a => a.seq === v.seq)})),
    credit_notes: s.docs.credits.map(c => ({seq: c.seq, number: c.number, invoice_seq: c.invoice_seq, invoice_number: c.content.invoice.number, amount: M(s, c.amount), full: c.content.full, reason: c.content.reason, issued: c.issued.slice(0, 10)})),
    tds: {terms: s.terms.tds, banner: TDS_BANNER, table: TDS_TABLE, pending: tdsCertificatesPending(s.views, entries, s.today), credits: s.docs.tdsCredits.map(c => ({...c, amount: M(s, c.amount)}))},
    msmed: {...msmedSummary({profile: s.msme, contract_date, acceptances: s.docs.acceptances, terms: s.terms, views: s.views, currency: s.currency, today: s.today}), disclaimer: MSMED_DISCLAIMER},
  };
}


// ---- Statement of account (QA-01: cached by record hash, streamed) --------------------------------

/** The statement model's invoicing part (decimals), from the one allocation. */
export function statementBilling(s: InvoicingState): StatementBilling {
  const by = new Map(s.alloc.invoices.map(a => [a.seq, a])), rv = new Map(s.alloc.receipt_vouchers.map(r => [r.seq, r]));
  return {
    invoices: s.docs.invoices.map(i => { const a = by.get(i.row.seq)!; return {number: i.row.number, issued: i.content.issued, total: M(s, a.live), covered: M(s, a.covered), status: a.status, tds: M(s, a.tds_expected), tds_credited: M(s, a.tds_credited), cancelled_by: i.cancelled_by}; }),
    vouchers: s.docs.vouchers.map(v => ({number: v.number, received: v.content.received, amount: M(s, v.amount), covered: M(s, rv.get(v.seq)?.covered ?? 0)})),
    credits: s.docs.credits.map(c => ({number: c.number, invoice: c.content.invoice.number, amount: M(s, c.amount)})),
    tds_credited: M(s, s.alloc.invoices.reduce((t, a) => t + a.tds_credited, 0)), unapplied: M(s, s.alloc.unapplied),
  };
}

/** PDF statement for a project's approved agreement, or a JSON error when nothing is approved yet. */
export async function statementPdf(request: Request, project: ProjectRow, {version}: {version?: number} = {}) {
  const l = await loadLedger(project.id, {forClient: true});
  if (!l.baseline || !l.content || !l.agreement) return json({error: 'There is no approved agreement yet, so there is no statement.', code: 'not_approved'}, 409);
  if (version !== undefined && version !== l.baseline.version) return json({error: 'This link is for a version that is not the current agreement.', code: 'superseded'}, 409);
  const s = await invoicingState(project, l);
  const zone = receiptTimeZone(request, project.timezone), brand = pdfBrand(await brandForProject(project.id));
  const billing = s.docs.invoices.length || s.docs.vouchers.length ? statementBilling(s) : undefined;
  const kind = s.agreement && s.agreement.kind !== 'single' ? s.agreement.kind : undefined;
  // The record hash: ledger head, documents and allocation. Same record, same bytes, served from cache.
  const key = recordKey('statement', project.id, l.baseline.version, l.head, l.entries.length, billing ?? null, kind ?? null, zone, brand, s.today);
  const bytes = await cachedPdf(key, () => renderStatementPdf(statementModel({project_id: project.id, version: l.baseline!.version, content: l.content!, agreement: l.agreement!, entries: l.entries, time_zone: zone, generated: new Date().toISOString(), kind, billing}), brand));
  return streamPdf(bytes, `scopeflow-statement-${project.id.slice(0, 12)}-v${l.baseline.version}.pdf`);
}
