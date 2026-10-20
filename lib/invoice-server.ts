import {createHash, randomUUID} from 'node:crypto';
import {maybeSignPdf} from './pades';
import {getConnection} from '@/db/connection.mjs';
import {paymentsOf, entryKindEnabled, type LedgerEntry, type PaymentLine} from './ledger';
import {allocate, type Allocation, type InvoiceAlloc, type InvoiceAllocStatus} from './invoice-status';
import {coDisplay, fromMinorOf, invoiceGross, isAdvanceOf, toMinorOf, taxPlacement, type InvoiceContent, type Invoiceable} from './invoice';
import {gstFromExclusive, type HeadKind} from './invoice-gst';
import {agreementTotals} from './agreement-totals';
import {schedule, totals} from './money';
import {gstinState} from './gst';
import {profileFromRow, type Profile, type ProfileRow} from './profile';
import {receiptVoucherContent} from './receipt-voucher';
import {certificateDueFor, tdsQuarter, type Tds} from './tds';
import {acceptanceDay, msmedApplies, msmedDueDates, msmedInterest, msmedWarnings, msmeProfileSchema, type MsmeProfile, type RateBasis} from './msmed';
import {ensurePdfFonts} from './pdf-fonts';
import {zoneOrUtc} from './time';
import type {Scope} from './scope';

// WS-03 server side of invoicing: one read of every invoicing document of a project (invoices,
// credit notes, receipt vouchers, TDS credits, acceptance), the C2 cap (invoiceable), the single
// allocation (allocate) and the views built from them. Writes that must be ordered (a new invoice,
// credit note or receipt voucher) run in one transaction holding the project row lock
// (SELECT … FOR UPDATE), so two parallel requests can never both pass the cap.

// QA-01: load fonts and HarfBuzz when the first invoicing route module loads, not on the first PDF.
void ensurePdfFonts();

export type InvoiceView = {
  seq: number; number: string; version: number; amount: number; currency: string; issued: string; due: string; description: string; tax_invoice: boolean; milestone: string | null;
  covered: number;
  /** What the client still has to pay in cash (the TDS part they deduct is excluded). */
  open: number;
  status: InvoiceAllocStatus; overdue: boolean; days_overdue: number;
  // WS-03
  change_order: number | null; credited: number; cancelled_by: string[];
  tds: {amount: number; net_receivable: number; label: string; rate_pct: number; credited: number} | null;
  /** Still owed in all, the TDS part included until its certificate is recorded. */
  open_with_tds: number;
  advance_adjusted: string[];
};

/** Today's date in the project's time zone (YYYY-MM-DD). */
export const todayIn = (timezone: string | null) => new Intl.DateTimeFormat('en-CA', {timeZone: zoneOrUtc(timezone), year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());

export {cancelled, computeInvoiceable, invoicedFor, unadjustedAdvances} from './invoice-cap';
export type {AcceptanceDoc, CreditDoc, Docs, InvoiceDoc, InvoiceRow, TdsCreditDoc, VoucherDoc} from './invoice-cap';
import {computeInvoiceable, invoicedFor, type AcceptanceDoc, type CreditDoc, type Docs, type InvoiceDoc, type InvoiceRow, type VoucherDoc} from './invoice-cap';

// ---- SQL ----------------------------------------------------------------------------------------
type Row = Record<string, unknown>;
export type Sql = {unsafe(query: string, values?: unknown[]): Promise<Row[]>};
const conn = () => getConnection() as unknown as Sql & {begin<T>(fn: (tx: Sql) => Promise<T>): Promise<T>};
/** Runs `fn` in one transaction holding the project's row lock (C2, H11, H12: no two writers pass the cap at once). */
export function withProjectLock<T>(projectId: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return conn().begin(async tx => {
    await tx.unsafe('SELECT id FROM scopeflow.projects WHERE id=$1 FOR UPDATE', [projectId]);
    return fn(tx);
  });
}
/** Serializes an owner's document series (CN, RV) inside a transaction. */
export const lockOwnerSeries = (tx: Sql, owner: string, series: string) => tx.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`scopeflow:ws03:${series}:${owner}`]);
export const readSql = (): Sql => conn();

// ---- Loading ------------------------------------------------------------------------------------
export async function loadDocs(sql: Sql, projectId: string): Promise<Docs> {
  const [inv, cn, rv, tds, acc] = await Promise.all([
    sql.unsafe('SELECT id,seq,number,version,amount,currency,issued,content,tds_minor,gross_minor FROM scopeflow.invoices WHERE project_id=$1 ORDER BY seq', [projectId]),
    sql.unsafe('SELECT seq,number,invoice_seq,amount_minor,taxable_minor,issued,content FROM scopeflow.credit_notes WHERE project_id=$1 ORDER BY seq', [projectId]),
    sql.unsafe('SELECT seq,number,ledger_seq,amount_minor,taxable_minor,issued,content FROM scopeflow.receipt_vouchers WHERE project_id=$1 ORDER BY seq', [projectId]),
    sql.unsafe('SELECT invoice_seq,amount_minor,certificate_no,form,quarter,received FROM scopeflow.tds_credits WHERE project_id=$1 ORDER BY created', [projectId]),
    sql.unsafe('SELECT milestone_id,delivered_on,accepted_on,objection_on,objection_removed_on,evidence,created FROM scopeflow.delivery_acceptances WHERE project_id=$1 ORDER BY created', [projectId]),
  ]);
  const credits: CreditDoc[] = cn.map(r => ({seq: Number(r.seq), number: String(r.number), invoice_seq: Number(r.invoice_seq), amount: Number(r.amount_minor), taxable: Number(r.taxable_minor), issued: String(r.issued), content: JSON.parse(String(r.content))}));
  const invoices: InvoiceDoc[] = inv.map(r => {
    const row = r as unknown as InvoiceRow, content = JSON.parse(row.content) as InvoiceContent;
    const g = invoiceGross(content), mine = credits.filter(c => c.invoice_seq === row.seq);
    const total = content.breakdown?.total ?? toMinorOf(content.total, content.currency);
    return {row, content, total, gross: g.total, gross_taxable: g.taxable, credited: mine.reduce((s, c) => s + c.amount, 0), credited_taxable: mine.reduce((s, c) => s + c.taxable, 0), cancelled_by: mine.filter(c => c.content.full).map(c => c.number), legacy: !content.breakdown};
  });
  return {
    invoices, credits,
    vouchers: rv.map(r => ({seq: Number(r.seq), number: String(r.number), ledger_seq: Number(r.ledger_seq), amount: Number(r.amount_minor), taxable: Number(r.taxable_minor), issued: String(r.issued), content: JSON.parse(String(r.content))})),
    tdsCredits: tds.map(r => ({invoice_seq: Number(r.invoice_seq), amount: Number(r.amount_minor), certificate_no: String(r.certificate_no), form: String(r.form), quarter: String(r.quarter), received: String(r.received)})),
    acceptances: acc.map(r => ({milestone_id: (r.milestone_id as string | null) ?? null, delivered_on: String(r.delivered_on), accepted_on: (r.accepted_on as string | null) ?? null, objection_on: (r.objection_on as string | null) ?? null, objection_removed_on: (r.objection_removed_on as string | null) ?? null, evidence: String(r.evidence ?? ''), created: String(r.created)})),
  };
}

// ---- Agreement and the cap (C2) -------------------------------------------------------------------
export type ProjectBilling = {client_gstin: string | null; client_state: string | null; client_address: string | null};
export type AgreementMoney = {currency: string; fee: number; rate: number; label: string; kind: HeadKind; total: number; taxable: number};
export const gstContext = (profile: Profile, project: ProjectBilling) => ({seller_state: profile.gst_state || gstinState(profile.tax_id), sac: profile.sac_code, lut_arn: profile.lut_arn, client_gstin: project.client_gstin ?? '', client_state: project.client_state ?? '', client_address: project.client_address ?? ''});

/** The agreement in minor units with the project's head logic (single head, or CGST+SGST / IGST), plan §9.3. */
export function agreementMoney(content: Scope, entries: LedgerEntry[], version: number, profile: Profile, project: ProjectBilling): AgreementMoney {
  const t = agreementTotals(content, entries.filter(e => e.baseline_version === version));
  const rate = content.tax_pct ?? 0, label = content.tax_label || 'Tax';
  const {kind} = taxPlacement({gst: gstContext(profile, project), currency: content.currency, tax_label: label, tax_pct: rate});
  const b = gstFromExclusive(t.fee, rate, kind);
  return {currency: content.currency, fee: t.fee, rate, label, kind, total: b.total, taxable: t.fee};
}

/** What the project's ledger says was received or refunded, across every baseline (plan §6.4). */
export const moneyLines = (entries: LedgerEntry[]): PaymentLine[] => paymentsOf(entries).lines;

/** M10: the one allocation, from the documents and the ledger. Pure. */
export function allocationOf(docs: Docs, entries: LedgerEntry[], currency: string, today: string): Allocation {
  return allocate({
    payments: moneyLines(entries).map(l => ({seq: l.seq, amount: toMinorOf(l.amount, currency), date: l.received})),
    invoices: docs.invoices.map(i => ({seq: i.row.seq, issued: i.content.issued, due: i.content.due, total: i.total, credited: i.credited, tds: i.content.tds?.amount ?? 0, ...(i.legacy ? {paid_before: toMinorOf(i.content.agreement.paid_before, i.content.currency)} : {})})),
    receiptVouchers: docs.vouchers.map(v => ({seq: v.seq, payment_seq: v.ledger_seq, total: v.amount})),
    tdsCredits: docs.tdsCredits,
    today,
  });
}

export function viewsOf(docs: Docs, alloc: Allocation): InvoiceView[] {
  const by = new Map<number, InvoiceAlloc>(alloc.invoices.map(a => [a.seq, a]));
  return docs.invoices.map(i => {
    const c = i.content, a = by.get(i.row.seq)!, M = (v: number) => fromMinorOf(v, c.currency);
    return {
      seq: i.row.seq, number: i.row.number, version: i.row.version, amount: i.row.amount, currency: i.row.currency, issued: c.issued, due: c.due, description: c.line.description, tax_invoice: !!c.gst, milestone: c.milestone?.id ?? null,
      covered: M(a.covered), open: M(a.net_open), status: a.status, overdue: a.overdue, days_overdue: a.days_overdue,
      change_order: c.change_order?.seq ?? null, credited: M(i.credited), cancelled_by: i.cancelled_by,
      tds: c.tds ? {amount: M(c.tds.amount), net_receivable: M(c.tds.net_receivable), label: c.tds.label, rate_pct: c.tds.rate_pct, credited: M(a.tds_credited)} : null,
      open_with_tds: M(a.open), advance_adjusted: (c.advance?.vouchers ?? []).map(v => v.number),
    };
  }).sort((a, b) => a.seq - b.seq);
}

/** Invoices of a project with what the payments on the record cover (pure; `rows` alone, for tests and legacy callers). */
export function invoiceViews(rows: InvoiceRow[], entries: LedgerEntry[], today: string): InvoiceView[] {
  if (!rows.length) return [];
  const docs: Docs = {invoices: rows.map(row => { const content = JSON.parse(row.content) as InvoiceContent, g = invoiceGross(content); return {row, content, total: content.breakdown?.total ?? toMinorOf(content.total, content.currency), gross: g.total, gross_taxable: g.taxable, credited: 0, credited_taxable: 0, cancelled_by: [], legacy: !content.breakdown}; }), vouchers: [], credits: [], tdsCredits: [], acceptances: []};
  return viewsOf(docs, allocationOf(docs, entries, rows[0].currency, today));
}

/** The invoices a client can see through a review link: those for that link's approved version, allocated project-wide. */
export async function clientInvoices(projectId: string, version: number, entries: LedgerEntry[], timezone: string | null) {
  const docs = await loadDocs(readSql(), projectId);
  if (!docs.invoices.length) return [];
  return viewsOf(docs, allocationOf(docs, entries, docs.invoices[0].row.currency, todayIn(timezone))).filter(v => v.version === version);
}

// ---- Profile and project ------------------------------------------------------------------------
export async function loadProfile(sql: Sql, owner: string): Promise<{profile: Profile; raw: Row | null}> {
  const [raw] = await sql.unsafe('SELECT * FROM scopeflow.business_profiles WHERE owner=$1', [owner]);
  return {profile: profileFromRow((raw ?? null) as ProfileRow | null), raw: raw ?? null};
}
/** Udyam details: WS-08's profile columns when present, else WS-03's msme_profiles row. */
export async function loadMsmeProfile(sql: Sql, owner: string, raw: Row | null = null): Promise<MsmeProfile | null> {
  if (raw && raw.udyam_number) {
    const p = msmeProfileSchema.safeParse({udyam_number: raw.udyam_number, registered_on: raw.udyam_registered_on ?? raw.udyam_date, category: raw.msme_category ?? raw.udyam_category});
    if (p.success) return p.data;
  }
  const [r] = await sql.unsafe('SELECT udyam_number,registered_on,category FROM scopeflow.msme_profiles WHERE owner=$1', [owner]);
  return r ? {udyam_number: String(r.udyam_number), registered_on: String(r.registered_on), category: r.category as MsmeProfile['category']} : null;
}
export type Terms = {tds: Tds | null; msmed_agreed_days: number | null; msmed_rate_basis: RateBasis};
export async function loadTerms(sql: Sql, projectId: string, content: Scope | null): Promise<Terms> {
  const [r] = await sql.unsafe('SELECT tds,msmed_agreed_days,msmed_rate_basis FROM scopeflow.invoice_terms WHERE project_id=$1', [projectId]);
  const tds = r?.tds ? JSON.parse(String(r.tds)) as Tds : (content?.tds as Tds | undefined) ?? null;
  return {tds, msmed_agreed_days: r?.msmed_agreed_days != null ? Number(r.msmed_agreed_days) : content?.msmed?.agreed_days ?? null, msmed_rate_basis: (r?.msmed_rate_basis as RateBasis) ?? 'on_due_date'};
}

// ---- M9: the frozen milestone schedule --------------------------------------------------------
export type FrozenMilestone = {id: string; title: string; pct: number; due: string; amount: number};
/**
 * The payment schedule of a baseline in minor units, frozen at its approval: shares of the baseline's
 * own total (approved change orders never move them; they are billed as their own lines). Written once
 * per (project, version) and read back thereafter.
 */
export async function frozenSchedule(sql: Sql, projectId: string, version: number, content: Scope): Promise<FrozenMilestone[]> {
  if (!content.milestones?.length) return [];
  const [hit] = await sql.unsafe('SELECT schedule FROM scopeflow.milestone_schedules WHERE project_id=$1 AND version=$2', [projectId, version]);
  if (hit) return JSON.parse(String(hit.schedule));
  const lines = schedule(content, totals(content).total).map(l => ({id: l.id, title: l.title, pct: l.pct, due: l.due, amount: toMinorOf(l.amount, content.currency)}));
  await sql.unsafe('INSERT INTO scopeflow.milestone_schedules (project_id,version,currency,schedule,created) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [projectId, version, content.currency, JSON.stringify(lines), new Date().toISOString()]);
  return lines;
}

// ---- H11: receipt vouchers for advances --------------------------------------------------------
export type VoucherContext = {owner: string; projectId: string; version: number; content: Scope; entries: LedgerEntry[]; profile: Profile; project: ProjectBilling & {client_email: string | null; timezone?: string | null}; agreement: AgreementMoney};
/**
 * Issues a receipt voucher (or plain payment receipt) for every advance on the record that has none:
 * an online deposit, a payment recorded as a deposit/advance, or money received before the project's
 * first invoice. Projects with invoices issued before WS-03 keep the old rule and get none. Must run
 * inside withProjectLock. Returns the vouchers issued.
 */
export async function ensureReceiptVouchers(tx: Sql, ctx: VoucherContext, only?: number): Promise<VoucherDoc[]> {
  if (!ctx.profile.business_name) return [];
  let docs = await loadDocs(tx, ctx.projectId);
  if (docs.invoices.some(i => i.legacy)) return [];
  const have = new Set(docs.vouchers.map(v => v.ledger_seq));
  const firstInvoice = docs.invoices.map(i => i.row.issued).sort()[0] ?? null;
  const issued: VoucherDoc[] = [];
  for (const line of moneyLines(ctx.entries)) {
    if (line.amount <= 0 || have.has(line.seq) || (only !== undefined && line.seq !== only)) continue;
    if (only === undefined && !isAdvanceOf(line, firstInvoice)) continue;
    const cap = computeInvoiceable(ctx.agreement, docs);
    const amount = Math.min(toMinorOf(line.amount, ctx.content.currency), cap.total);
    // Money beyond what is left to invoice is an excess (WS-04), not an advance.
    if (amount <= 0) continue;
    await lockOwnerSeries(tx, ctx.owner, 'rv');
    const [n] = await tx.unsafe('SELECT coalesce(max(seq),0)+1 AS seq FROM scopeflow.receipt_vouchers WHERE owner=$1', [ctx.owner]);
    const seq = Number(n.seq), today = todayIn(ctx.project.timezone ?? null); // the project's date (IST), not UTC
    const content = receiptVoucherContent({
      seq, issued: today, received: line.received, amount: fromMinorOf(amount, ctx.content.currency), currency: ctx.content.currency,
      seller: {name: ctx.profile.business_name, address: ctx.profile.business_address, tax_id: ctx.profile.tax_id, payment_details: ctx.profile.payment_details, state: ctx.profile.gst_state || gstinState(ctx.profile.tax_id)},
      client: {name: ctx.content.client, email: ctx.project.client_email ?? ''}, project: {id: ctx.projectId, title: ctx.content.title, version: ctx.version},
      tax_label: ctx.agreement.label, tax_pct: ctx.agreement.rate, gst: gstContext(ctx.profile, ctx.project),
      payment: {ledger_seq: line.seq, method: line.method, reference: line.reference},
    });
    await tx.unsafe('INSERT INTO scopeflow.receipt_vouchers (id,owner,project_id,seq,number,ledger_seq,amount_minor,taxable_minor,currency,issued,content) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING',
      [randomUUID(), ctx.owner, ctx.projectId, seq, content.number, line.seq, amount, content.breakdown?.taxable ?? amount, ctx.content.currency, new Date().toISOString(), JSON.stringify(content)]);
    docs = await loadDocs(tx, ctx.projectId);
    const v = docs.vouchers.find(x => x.ledger_seq === line.seq);
    if (v) issued.push(v);
    have.add(line.seq);
  }
  return issued;
}

// ---- SF-07: MSMED ---------------------------------------------------------------------------------
export type MsmedSummary = {
  applies: boolean; profile: MsmeProfile | null; warnings: {code: string; message: string}[];
  acceptance: {day: string | null; basis: string; delivered_on: string | null; evidence: string} | null;
  pay_by: string | null; interest_from: string | null; agreed_days: number | null; rate_basis: RateBasis;
  invoices: {seq: number; number: string; principal: number; interest: number; text: string}[];
  interest_total: number;
};
/** MSMED position of a project today: acceptance, due dates, warnings, and s.16 interest per overdue invoice. */
export function msmedSummary(p: {profile: MsmeProfile | null; contract_date: string | null; acceptances: AcceptanceDoc[]; terms: Terms; views: InvoiceView[]; currency: string; today: string}): MsmedSummary {
  const latest = p.acceptances.filter(a => !a.milestone_id).at(-1) ?? p.acceptances.at(-1) ?? null;
  const acc = latest ? acceptanceDay(latest, p.today) : null;
  const dates = acc?.day ? msmedDueDates(acc.day, p.terms.msmed_agreed_days) : null;
  const applies = msmedApplies(p.profile);
  const out: MsmedSummary['invoices'] = [];
  let covered = true;
  if (applies && dates && p.today > dates.pay_by) {
    for (const v of p.views) {
      if (!(v.open > 0) || v.status === 'cancelled') continue;
      const r = msmedInterest({principal: toMinorOf(v.open, p.currency), interest_from: dates.interest_from, paid_on: p.today, rate_basis: p.terms.msmed_rate_basis});
      covered &&= r.covered;
      const interest = fromMinorOf(r.interest, p.currency);
      out.push({seq: v.seq, number: v.number, principal: v.open, interest, text: `Interest under MSMED s.16: ${new Intl.NumberFormat('en-IN', {style: 'currency', currency: p.currency}).format(interest)} (estimate — confirm with your CA)`});
    }
  }
  return {
    applies, profile: p.profile, warnings: msmedWarnings({profile: p.profile, contract_date: p.contract_date, agreed_days: p.terms.msmed_agreed_days, covered}),
    acceptance: latest ? {day: acc?.day ?? null, basis: acc?.basis ?? 'pending', delivered_on: latest.delivered_on, evidence: latest.evidence} : null,
    pay_by: dates?.pay_by ?? null, interest_from: dates?.interest_from ?? null, agreed_days: p.terms.msmed_agreed_days, rate_basis: p.terms.msmed_rate_basis,
    invoices: out, interest_total: Math.round(out.reduce((s, i) => s + i.interest, 0) * 100) / 100,
  };
}

/** H19: invoices paid net of TDS whose certificate is past due (for the owner's quarterly reminder). */
export function tdsCertificatesPending(views: InvoiceView[], entries: LedgerEntry[], today: string) {
  const lines = moneyLines(entries).filter(l => l.amount > 0);
  return views.filter(v => v.status === 'paid_net_of_tds').map(v => {
    const paidOn = lines.filter(l => l.received >= v.issued).at(-1)?.received ?? v.issued;
    return {seq: v.seq, number: v.number, amount: v.tds ? v.tds.amount - v.tds.credited : 0, quarter: tdsQuarter(paidOn), certificate_due: certificateDueFor(paidOn), overdue: today > certificateDueFor(paidOn)};
  }).filter(x => x.amount > 0);
}

/** Mirrors a WS-03 fact to the signed ledger once WS-05 enables the kind (tds_credit, delivery_accepted). */
export function ledgerKindReady(kind: 'tds_credit' | 'delivery_accepted') { return entryKindEnabled(kind); }

// ---- The whole invoicing state of a project ------------------------------------------------------
type Ledger = {baseline: {id: string; version: number; decided?: string | null} | null; content: Scope | null; entries: LedgerEntry[]; agreement: {change_orders: {seq: number; title: string; fee_delta: number; status: string; [k: string]: unknown}[]} | null};
export type ProjectRow = ProjectBilling & {id: string; owner: string; client_email: string | null; timezone: string | null; archived?: string | null};
export type InvoicingState = {
  docs: Docs; alloc: Allocation; views: InvoiceView[]; agreement: AgreementMoney | null; cap: Invoiceable | null;
  schedule: (FrozenMilestone & {invoiced: number})[]; change_orders: {seq: number; title: string; fee_delta: number; display: string; total: number; invoiced: number; milestone_id: string | null}[];
  terms: Terms; profile: Profile; msme: MsmeProfile | null; today: string; currency: string;
};
/**
 * Loads and derives everything about a project's invoicing. With `issueVouchers`, it first issues any
 * receipt vouchers due (inside the project lock). `tx` reuses an open transaction.
 */
export async function invoicingState(project: ProjectRow, l: Ledger, {tx, issueVouchers = false}: {tx?: Sql; issueVouchers?: boolean} = {}): Promise<InvoicingState> {
  const run = async (sql: Sql) => {
    const {profile, raw} = await loadProfile(sql, project.owner);
    const content = l.baseline ? l.content : null;
    const agreement = content && l.baseline ? agreementMoney(content, l.entries, l.baseline.version, profile, project) : null;
    if (issueVouchers && content && agreement && l.baseline) await ensureReceiptVouchers(sql, {owner: project.owner, projectId: project.id, version: l.baseline.version, content, entries: l.entries, profile, project, agreement});
    const docs = await loadDocs(sql, project.id);
    const currency = content?.currency ?? docs.invoices[0]?.row.currency ?? 'INR';
    const today = todayIn(project.timezone);
    const alloc = allocationOf(docs, l.entries, currency, today);
    const views = viewsOf(docs, alloc);
    const cap = agreement ? computeInvoiceable(agreement, docs) : null;
    const frozen = content && l.baseline ? await frozenSchedule(sql, project.id, l.baseline.version, content) : [];
    const version = l.baseline?.version;
    const schedule = frozen.map(m => ({...m, invoiced: invoicedFor(docs, (c, r) => r.version === version && c.milestone?.id === m.id)}));
    const change_orders = (l.agreement?.change_orders ?? []).filter(c => c.status === 'approved' && c.fee_delta !== 0 && agreement).map(c => {
      const rate = typeof c.tax_pct === 'number' ? c.tax_pct : agreement!.rate;
      const b = gstFromExclusive(toMinorOf(Math.abs(c.fee_delta), currency), rate, agreement!.kind);
      return {seq: c.seq, title: c.title, fee_delta: c.fee_delta, display: coDisplay(c.fee_delta, rate, agreement!.label, currency, agreement!.kind).text, total: c.fee_delta > 0 ? b.total : -b.total, invoiced: invoicedFor(docs, cc => cc.change_order?.seq === c.seq), milestone_id: typeof c.milestone_id === 'string' ? c.milestone_id : null};
    });
    const terms = await loadTerms(sql, project.id, content);
    const msme = await loadMsmeProfile(sql, project.owner, raw);
    return {docs, alloc, views, agreement, cap, schedule, change_orders, terms, profile, msme, today, currency};
  };
  if (tx) return run(tx);
  if (issueVouchers) return withProjectLock(project.id, run);
  return run(readSql());
}

/** The C2 cap for a project, for WS-04 checkout and WS-10 MCP: what can still be invoiced, in minor units. */
export async function invoiceable(project: ProjectRow, l: Ledger): Promise<Invoiceable | null> {
  return (await invoicingState(project, l)).cap;
}

// ---- QA-01: PDF responses ------------------------------------------------------------------------
const pdfCache = new Map<string, {bytes: Uint8Array; at: number}>();
const PDF_TTL = 10 * 60_000, PDF_MAX = 64;
/** Stable cache key for a record: SHA-256 of its JSON. */
export const recordKey = (...parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
/**
 * A rendered (and, when configured, PAdES-signed) PDF for a record, cached by the record's hash for ten
 * minutes: repeated downloads skip layout, font embedding and signing. Issued documents never change,
 * so their key is their content; statements key on the ledger head and documents.
 */
export async function cachedPdf(key: string, render: () => Uint8Array | Promise<Uint8Array>): Promise<Uint8Array> {
  const hit = pdfCache.get(key);
  if (hit && Date.now() - hit.at < PDF_TTL) { pdfCache.delete(key); pdfCache.set(key, hit); return hit.bytes; }
  await ensurePdfFonts();
  const bytes = await maybeSignPdf(await render());
  pdfCache.set(key, {bytes, at: Date.now()});
  while (pdfCache.size > PDF_MAX) pdfCache.delete(pdfCache.keys().next().value!);
  return bytes;
}
/** Streams a PDF in 64 KB chunks (the client starts receiving before the whole body is copied). */
export function streamPdf(bytes: Uint8Array, filename: string) {
  let at = 0;
  const body = new ReadableStream<Uint8Array>({pull(c) { if (at >= bytes.length) { c.close(); return; } c.enqueue(bytes.subarray(at, at + 65536)); at += 65536; }});
  return new Response(body, {status: 200, headers: {
    'Content-Type': 'application/pdf', 'Content-Length': String(bytes.length),
    'Content-Disposition': `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '-')}"`,
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
  }});
}
