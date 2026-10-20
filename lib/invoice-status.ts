// Which invoices the money received covers, and which are overdue. Dependency-free so the daily
// reminder job (scripts/send-reminders.mjs) can import it directly.
//
// WS-03 (M10): allocate() is the one allocation function. The statement, the invoice statuses, the
// client page and the reminders read it. Money is integer minor units. The rules:
//   1. A payment that was an advance (it has a receipt voucher) covers its receipt voucher first.
//   2. Everything else, plus any advance left over, is applied to live invoices oldest first (by
//      issue date, then number): first each invoice's cash part (its live total less the TDS the
//      client is expected to deduct), then, with anything still left, the TDS parts (a client who
//      did not deduct TDS pays the whole invoice).
//   3. Refunds reduce the latest allocations first; nothing is ever negative.
//   4. A TDS credit (certificate recorded) covers that invoice's TDS part.
//   5. A credit note reduces the invoice's live total; a fully credited invoice is cancelled.
// invoiceStatuses() below is the pre-WS-03 rule (decimal amounts, one baseline) kept for the reminder
// job until it switches to allocate() (change request to WS-06).

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
export function invoiceReminderDue(s: Pick<InvoiceStatus, 'overdue'> & {status?: string}, sent: string[], every: number, now: number, max = 3) {
  // WS-03 (H19): an invoice paid net of TDS is not chased; the TDS part is the deductor's to deposit.
  if (s.status === 'paid_net_of_tds' || s.status === 'tds_credited' || s.status === 'cancelled') return false;
  if (!s.overdue || sent.length >= max) return false;
  const last = sent.length ? Math.max(...sent.map(t => Date.parse(t))) : 0;
  return now - last >= every * 86400_000 - 3600_000; // an hour of slack for the cron's start time
}

// ---- WS-03 allocation (minor units) -------------------------------------------------------------

export type AllocInvoice = {
  seq: number; issued: string; due: string;
  /** Payable total of the invoice as issued (after any advance adjusted on it), minor units. */
  total: number;
  /** Credit notes against it, minor units (total incl. tax). */
  credited: number;
  /** TDS the client is expected to deduct, minor units (0 when none was set). */
  tds: number;
  /** Pre-WS-03 snapshots: money received before this invoice that the old rule excluded. */
  paid_before?: number;
};
export type AllocReceiptVoucher = {seq: number; payment_seq: number; total: number};
/** A money movement on the record: positive received, negative refunded. `seq` is the ledger entry. */
export type AllocPayment = {seq: number; amount: number; date: string};
export type AllocTdsCredit = {invoice_seq: number; amount: number};
export type InvoiceAllocStatus = 'paid' | 'paid_net_of_tds' | 'tds_credited' | 'part' | 'open' | 'cancelled';
export type InvoiceAlloc = {
  seq: number; live: number; covered: number; tds_expected: number; tds_credited: number;
  /** Still owed on the invoice in all (live − covered − TDS credited). */
  open: number;
  /** What the client still has to pay in cash (excludes the TDS part they deduct); what reminders chase. */
  net_open: number;
  status: InvoiceAllocStatus; overdue: boolean; days_overdue: number;
  /** N4: the payment (ledger seq and date) whose money completed the invoice's cash part, when it is fully covered. */
  settled_by?: {seq: number; date: string};
};
export type Allocation = {
  invoices: InvoiceAlloc[];
  receipt_vouchers: {seq: number; covered: number}[];
  received: number; refunded: number;
  /** Applied to invoices and receipt vouchers. */
  applied: number;
  /** Received and not applied to anything (an excess, or money awaiting an invoice). Never negative. */
  unapplied: number;
};

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400_000);

export function allocate(input: {payments: AllocPayment[]; invoices: AllocInvoice[]; receiptVouchers?: AllocReceiptVoucher[]; tdsCredits?: AllocTdsCredit[]; today: string}): Allocation {
  const rvs = input.receiptVouchers ?? [];
  const received = input.payments.filter(p => p.amount > 0).reduce((s, p) => s + p.amount, 0);
  const refunded = input.payments.filter(p => p.amount < 0).reduce((s, p) => s - p.amount, 0);
  // 1. Advances cover their receipt vouchers.
  const rvCovered = new Map<number, number>();
  let pool = 0;
  // N4: the free pool as ordered chunks (one per payment), so an invoice can name the payment that settled it.
  // The chunks always add up to `pool`; they never change any amount below.
  const chunks: {seq: number; date: string; amount: number}[] = [];
  for (const p of [...input.payments].sort((a, b) => a.seq - b.seq)) {
    if (p.amount <= 0) continue;
    const rv = rvs.find(r => r.payment_seq === p.seq);
    let free = p.amount;
    if (rv) { const c = Math.min(rv.total, p.amount); rvCovered.set(rv.seq, (rvCovered.get(rv.seq) ?? 0) + c); free = p.amount - c; }
    pool += free;
    if (free > 0) chunks.push({seq: p.seq, date: p.date, amount: free});
  }
  const takeLast = (n: number) => { while (n > 0 && chunks.length) { const c = chunks[chunks.length - 1], t = Math.min(c.amount, n); c.amount -= t; n -= t; if (!c.amount) chunks.pop(); } };
  /** Consumes `n` from the oldest chunks; returns the payment whose money was used last (null when nothing was taken). */
  const takeFirst = (n: number): {seq: number; date: string} | null => {
    let last: {seq: number; date: string} | null = null;
    while (n > 0 && chunks.length) { const c = chunks[0], t = Math.min(c.amount, n); c.amount -= t; n -= t; last = {seq: c.seq, date: c.date}; if (!c.amount) chunks.shift(); }
    return last;
  };
  // 3. Refunds come out of the latest allocations: the free pool first (its last use), then receipt vouchers newest first.
  let refund = refunded;
  const fromPool = Math.min(pool, refund); pool -= fromPool; refund -= fromPool; takeLast(fromPool);
  for (const rv of [...rvs].sort((a, b) => b.seq - a.seq)) {
    if (refund <= 0) break;
    const c = rvCovered.get(rv.seq) ?? 0, take = Math.min(c, refund);
    rvCovered.set(rv.seq, c - take); refund -= take;
  }
  // Pre-WS-03 rule: money received before the first legacy invoice is not counted against invoices.
  const sorted = [...input.invoices].sort((a, b) => (a.issued < b.issued ? -1 : a.issued > b.issued ? 1 : a.seq - b.seq));
  const legacyBefore = sorted.find(i => i.paid_before !== undefined)?.paid_before ?? 0;
  const excluded = Math.min(pool, Math.max(0, legacyBefore));
  pool -= excluded; takeFirst(excluded);
  // 2. FIFO: cash parts first, then TDS parts. 4. TDS credits.
  const credits = new Map<number, number>();
  for (const c of input.tdsCredits ?? []) credits.set(c.invoice_seq, (credits.get(c.invoice_seq) ?? 0) + c.amount);
  const state = sorted.map(i => {
    const live = Math.max(0, i.total - i.credited);
    const tds = live > 0 ? Math.min(i.tds, live) : 0;
    const tds_credited = Math.min(tds, credits.get(i.seq) ?? 0);
    return {i, live, tds, tds_credited, covered: 0, settled_by: null as {seq: number; date: string} | null};
  });
  for (const s of state) {
    const want = Math.max(0, s.live - s.tds); const c = Math.min(want, pool); s.covered += c; pool -= c;
    const last = takeFirst(c);
    if (want > 0 && c === want && last) s.settled_by = last;
  }
  for (const s of state) { const want = Math.max(0, s.live - s.covered - s.tds_credited); const c = Math.min(want, pool); s.covered += c; pool -= c; takeFirst(c); }
  const invoices = state.map(({i, live, tds, tds_credited, covered, settled_by}): InvoiceAlloc => {
    const open = Math.max(0, live - covered - tds_credited);
    const net_open = Math.max(0, live - tds - covered);
    let status: InvoiceAllocStatus;
    if (live === 0 && i.credited > 0) status = 'cancelled';
    else if (open === 0) status = tds > 0 && tds_credited >= tds && covered < live ? 'tds_credited' : 'paid';
    else if (tds > 0 && net_open === 0) status = 'paid_net_of_tds';
    else status = covered > 0 ? 'part' : 'open';
    const days = daysBetween(i.due, input.today);
    const overdue = net_open > 0 && days > 0;
    return {seq: i.seq, live, covered, tds_expected: tds, tds_credited, open, net_open, status, overdue, days_overdue: overdue ? days : 0, ...(net_open === 0 && settled_by ? {settled_by} : {})};
  });
  const rvOut = rvs.map(r => ({seq: r.seq, covered: rvCovered.get(r.seq) ?? 0}));
  const applied = invoices.reduce((s, i) => s + i.covered, 0) + rvOut.reduce((s, r) => s + r.covered, 0);
  return {invoices: invoices.sort((a, b) => a.seq - b.seq), receipt_vouchers: rvOut, received, refunded, applied, unapplied: Math.max(0, received - refunded - applied)};
}
