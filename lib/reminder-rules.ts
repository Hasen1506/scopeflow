// Reminder rules for scripts/send-reminders.mjs (WS-06). Pure, so they are unit tested.
//
// TDS (WS-03 owns the invoice statuses and the TDS record; this reads only the invoice snapshot):
// the TDS a client withholds is never chased as unpaid money. An invoice whose open amount is no
// more than its uncredited TDS is "paid net of TDS": it gets no payment reminder, and instead a
// TDS-certificate (Form 16A) reminder at most once per quarter, after the certificate for the
// quarter of deduction is due, at most four in all. A payment reminder for a part-paid invoice
// asks only for the cash part (open minus uncredited TDS).

const round2 = (n: number) => Math.round(n * 100) / 100;

/** TDS expected on an invoice, in major units, from its snapshot: `tds.amount` (WS-03) or rate x taxable value. */
export function tdsExpected(content: unknown): number {
  const c = content as {tds?: {amount?: unknown; rate_pct?: unknown} | null; tax?: {taxable?: unknown}; taxable?: unknown; line?: {amount?: unknown}; total?: unknown} | null;
  const t = c?.tds;
  if (!t) return 0;
  const amount = Number(t.amount);
  if (Number.isFinite(amount) && amount > 0) return round2(amount);
  const rate = Number(t.rate_pct);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 100) return 0;
  const taxable = Number(c?.tax?.taxable ?? c?.taxable ?? c?.line?.amount ?? c?.total ?? 0);
  return Number.isFinite(taxable) && taxable > 0 ? round2(taxable * rate / 100) : 0;
}

export type InvoicePlan = {kind: 'payment'; chase: number} | {kind: 'tds_certificate'; tds: number} | {kind: 'none'};
/**
 * What to remind the client about for one invoice. `open` is what the payments on record leave
 * open (major units), `tds` the TDS expected and `credited` the TDS already matched to a certificate.
 * `status` is WS-03's allocation status when it is available.
 */
export function invoicePlan({open, tds, credited = 0, status}: {open: number; tds: number; credited?: number; status?: string | null}): InvoicePlan {
  if (status === 'paid' || status === 'tds_credited' || status === 'cancelled') return {kind: 'none'};
  const pending = round2(Math.max(0, tds - credited));
  if (open <= 0.005) return {kind: 'none'};
  if (status === 'paid_net_of_tds' || (pending > 0 && open <= pending + 0.005)) return pending > 0 ? {kind: 'tds_certificate', tds: Math.min(pending, round2(open))} : {kind: 'none'};
  return {kind: 'payment', chase: round2(open - pending)};
}

/** The Indian financial-year quarter of a date (YYYY-MM-DD), and when its Form 16A is due. */
export function tdsQuarterOf(date: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return null;
  const y = Number(m[1]), month = Number(m[2]);
  const fyStart = month >= 4 ? y : y - 1;
  const q = month >= 4 && month <= 6 ? 1 : month <= 9 && month >= 7 ? 2 : month >= 10 ? 3 : 4;
  // Form 16A: 15 days after the quarterly TDS return (31 Jul, 31 Oct, 31 Jan, 31 May).
  const certificateDue = q === 1 ? `${fyStart}-08-15` : q === 2 ? `${fyStart}-11-15` : q === 3 ? `${fyStart + 1}-02-15` : `${fyStart + 1}-06-15`;
  const fy = `${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`;
  return {key: `${fy}-Q${q}`, label: `Q${q} FY ${fy}`, certificateDue};
}

export const MAX_TDS_REMINDERS = 4;
/**
 * The quarter key to send a TDS-certificate reminder under today, or null: only once the
 * certificate for the quarter of deduction (the invoice date) is due, once per quarter, at most
 * MAX_TDS_REMINDERS in all. `sentKeys` are the quarter keys already used for this invoice.
 */
export function tdsCertificateReminderKey(issued: string, today: string, sentKeys: readonly string[]): string | null {
  const deducted = tdsQuarterOf(issued), now = tdsQuarterOf(today);
  if (!deducted || !now || today < deducted.certificateDue) return null;
  if (sentKeys.length >= MAX_TDS_REMINDERS || sentKeys.includes(now.key)) return null;
  return now.key;
}
