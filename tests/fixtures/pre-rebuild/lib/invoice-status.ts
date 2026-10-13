// Which invoices the money received covers, and which are overdue. Dependency-free so the daily
// reminder job (scripts/send-reminders.mjs) can import it directly.
//
// Payments are applied to invoices in number order. Money received before the first invoice was
// issued (for example a deposit paid on signature) is not counted against invoices: each invoice
// snapshot records what had been received before it (`paid_before`).

export type InvoiceFigures = {seq: number; total: number; due: string; paid_before: number};
export type InvoiceStatus = {seq: number; covered: number; open: number; status: 'paid' | 'part' | 'open'; overdue: boolean; days_overdue: number};

const round2 = (n: number) => Math.round(n * 100) / 100;
export function invoiceStatuses(invoices: InvoiceFigures[], paid: number, today: string): InvoiceStatus[] {
  const sorted = [...invoices].sort((a, b) => a.seq - b.seq);
  let left = round2(paid - (sorted[0]?.paid_before ?? 0));
  return sorted.map(i => {
    const covered = round2(Math.min(i.total, Math.max(0, left)));
    left = round2(left - covered);
    const open = round2(i.total - covered);
    const days = Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(i.due + 'T00:00:00Z')) / 86400_000);
    const overdue = open > 0.005 && days > 0;
    return {seq: i.seq, covered, open, status: open <= 0.005 ? 'paid' : covered > 0 ? 'part' : 'open', overdue, days_overdue: overdue ? days : 0};
  });
}

/** Whether an overdue invoice should get an automatic reminder today: every `every` days, at most `max` in all. */
export function invoiceReminderDue(s: InvoiceStatus, sent: string[], every: number, now: number, max = 3) {
  if (!s.overdue || sent.length >= max) return false;
  const last = sent.length ? Math.max(...sent.map(t => Date.parse(t))) : 0;
  return now - last >= every * 86400_000 - 3600_000; // an hour of slack for the cron's start time
}
