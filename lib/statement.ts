import {PdfDocument, textWidth, wrap, type Font} from './pdf';
import {paymentsOf, type Agreement, type LedgerEntry, type PaymentLine} from './ledger';
import {totals} from './money';
import {formatMoney, type Scope} from './scope';
import {formatDay, stamp} from './time';

// Statement of account for an approved project: what the agreement says is owed (the current
// fee after approved change orders, plus tax), every payment on the signed record (Razorpay
// deposits and payments the owner recorded) and the balance still due. Built only from the
// ledger, so the owner's and the client's copies always match. Deterministic like the receipt.

export type StatementModel = {
  project_id: string; version: number;
  title: string; client: string; currency: string;
  fee_base: number; fee: number; tax_label: string; tax_pct: number; tax: number; total: number;
  deposit_pct: number; deposit: number;
  payment_terms: string | null; pending_change_orders: number;
  lines: PaymentLine[]; paid: number; balance: number; overpaid: number;
  head: string | null; entries: number;
  time_zone: string; generated: string;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The statement for the approved baseline `content` (version `version`) and its ledger entries. Pure. */
export function statementModel({project_id, version, content, agreement, entries, time_zone = 'UTC', generated}: {project_id: string; version: number; content: Scope; agreement: Agreement; entries: LedgerEntry[]; time_zone?: string; generated: string}): StatementModel {
  const own = entries.filter(e => e.baseline_version === version);
  const t = totals(content, agreement.fee), signed = totals(content);
  const {lines, paid} = paymentsOf(own);
  return {
    project_id, version, title: content.title, client: content.client, currency: agreement.currency,
    fee_base: agreement.fee_base, fee: agreement.fee, tax_label: t.tax_label, tax_pct: t.tax_pct, tax: t.tax, total: t.total,
    deposit_pct: signed.deposit_pct, deposit: signed.deposit,
    payment_terms: content.payment_terms ?? null, pending_change_orders: agreement.pending,
    lines, paid, balance: round2(Math.max(0, t.total - paid)), overpaid: round2(Math.max(0, paid - t.total)),
    head: own.at(-1)?.hash ?? null, entries: own.length,
    time_zone, generated,
  };
}

const MARGIN = 48;
export function renderStatementPdf(m: StatementModel): Uint8Array {
  const doc = new PdfDocument({info: {Title: `Scopeflow statement: ${m.title} v${m.version}`, Producer: 'Scopeflow'}});
  const W = doc.width - MARGIN * 2;
  const money = (v: number) => formatMoney(v, m.currency);
  let y = 0;
  const page = () => { doc.addPage(); y = doc.height - MARGIN; doc.text(MARGIN, 28, `Scopeflow statement · ${m.title.slice(0, 60)} · version ${m.version} · ${m.project_id}`, {size: 7, gray: 0.45}); };
  const need = (h: number) => { if (y - h < 60) page(); };
  const para = (text: string, {size = 9.5, font = 'regular' as Font, gray = 0, gap = 3} = {}) => {
    for (const line of wrap(text, W, size, font)) { need(size + 3); doc.text(MARGIN, y - size, line, {size, font, gray}); y -= size + 3; }
    y -= gap;
  };
  const heading = (text: string) => { need(30); y -= 8; doc.text(MARGIN, y - 8, text.toUpperCase(), {size: 8, font: 'bold', gray: 0.35}); y -= 13; doc.line(MARGIN, y, MARGIN + W, y); y -= 7; };
  /** Label on the left, amount right-aligned. */
  const amount = (k: string, v: string, {font = 'regular' as Font, note = ''} = {}) => {
    const labels = wrap(k, W - 130, 10, font);
    need(labels.length * 13 + 14);
    labels.forEach((line, i) => doc.text(MARGIN, y - 10 - i * 13, line, {size: 10, font, gray: font === 'bold' ? 0 : 0.25}));
    // Amounts are digits and separators, which have the same advance in Helvetica and Helvetica-Bold.
    doc.text(MARGIN + W - textWidth(v, 10), y - 10, v, {size: 10, font});
    y -= labels.length * 13 + 1;
    if (note) { doc.text(MARGIN, y - 8, note, {size: 8, gray: 0.45}); y -= 12; }
  };

  page();
  doc.text(MARGIN, y - 10, 'SCOPEFLOW · STATEMENT OF ACCOUNT', {size: 9, font: 'bold', gray: 0.35});
  y -= 30;
  para(m.title, {size: 18, font: 'bold', gap: 2});
  para(`Prepared for ${m.client} · Approved version ${m.version} · Issued ${stamp(m.generated, m.time_zone)}`, {size: 10, gray: 0.3, gap: 6});

  heading('What is owed');
  amount('Agreed fee', money(m.fee), {note: m.fee !== m.fee_base ? `Approved at ${money(m.fee_base)}; changed by approved change orders.` : ''});
  if (m.tax_pct > 0) amount(`${m.tax_label} (${m.tax_pct}%)`, money(m.tax));
  amount(m.tax_pct > 0 ? `Total with ${m.tax_label}` : 'Total', money(m.total), {font: 'bold'});
  if (m.deposit_pct > 0) amount(`Deposit on signature (${m.deposit_pct}%)`, money(m.deposit), {note: m.paid >= m.deposit ? 'Covered by the payments below.' : 'Part of the total above, due on signature.'});
  if (m.pending_change_orders > 0) para(`${m.pending_change_orders} change order${m.pending_change_orders > 1 ? 's are' : ' is'} awaiting the client's approval and not included above.`, {size: 8.5, gray: 0.4});

  heading('Payments received');
  if (!m.lines.length) para('No payments are on the record yet.', {size: 9.5, gray: 0.35});
  for (const l of m.lines) {
    const detail = [l.method, l.reference ? `ref. ${l.reference}` : '', l.source === 'owner' ? l.note : 'Confirmed by Razorpay'].filter(Boolean).join(' · ');
    amount(`${formatDay(l.received)} · ${detail}`, money(l.amount), {note: `Record entry ${l.seq}${l.source === 'owner' ? ', recorded by the creator' : ''}`});
  }
  y -= 2; doc.line(MARGIN, y, MARGIN + W, y); y -= 6;
  amount('Total received', money(m.paid));
  amount(m.overpaid > 0 ? 'Received above the total' : 'Balance due', money(m.overpaid > 0 ? m.overpaid : m.balance), {font: 'bold', note: m.balance === 0 && m.overpaid === 0 ? 'Paid in full.' : ''});

  if (m.payment_terms) { heading('Payment terms'); para(m.payment_terms); }

  heading('About this statement');
  if (m.head) para(`Built from the signed record of this project: ${m.entries} ${m.entries === 1 ? 'entry' : 'entries'}, latest entry fingerprint ${m.head}.`, {size: 8, gray: 0.35});
  para('Payments marked "recorded by the creator" were entered by the creator after the money arrived outside Scopeflow; Scopeflow did not handle that money. This statement is not a tax invoice.', {size: 8, gray: 0.35});
  return doc.toBytes();
}

