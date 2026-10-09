import {db} from './server';
import {fromMinorUnits, type PaidEvent} from './razorpay';
import {appendEntry, loadLedger, LedgerConflict} from './ledger-server';

export type RecordResult = {recorded: boolean; ledger: boolean; seq?: number; duplicate?: boolean; ignored?: string; note?: string};
type OrderRow = {id: string; project_id: string; version: number; amount_minor: number | string; currency: string; status: string};

/**
 * Records a captured Razorpay payment for a stored order, once: the order row is marked paid
 * (conditionally, so concurrent deliveries record it once) and a `payment` entry is appended to the
 * project's signed ledger as the `system` actor while the paid version is still the approved
 * baseline. `ensureLedger` also appends the entry for an order already marked paid whose entry is
 * missing (a webhook that marked the row but lost the ledger race); the reconciliation job uses it.
 */
export async function recordPaidPayment(event: PaidEvent, channel: 'razorpay_webhook' | 'razorpay_reconcile', {ensureLedger = false} = {}): Promise<RecordResult> {
  const order = await db().prepare("SELECT id,project_id,version,amount_minor,currency,status FROM payments WHERE provider='razorpay' AND order_id=?").bind(event.order_id).first<OrderRow>();
  if (!order) return {recorded: false, ledger: false, ignored: 'unknown_order'};
  if (Number(order.amount_minor) !== event.amount_minor || order.currency !== event.currency) {
    console.warn('Scopeflow payment amount mismatch', JSON.stringify({order_id: event.order_id, expected: Number(order.amount_minor), got: event.amount_minor}));
    return {recorded: false, ledger: false, ignored: 'amount_mismatch'};
  }
  const now = new Date().toISOString();
  const marked = await db().prepare("UPDATE payments SET status='paid',payment_id=?,event_id=?,paid_at=? WHERE id=? AND status<>'paid' RETURNING id").bind(event.payment_id, event.event_id, now, order.id).first();
  const recorded = !!marked;
  if (!recorded && !ensureLedger) return {recorded, ledger: false, duplicate: true};
  const ref = 'payment:' + event.order_id;
  const existing = () => db().prepare('SELECT seq FROM ledger_entries WHERE project_id=? AND ref=?').bind(order.project_id, ref).first<{seq: number}>();
  const already = await existing();
  if (already) return {recorded, ledger: true, seq: already.seq, duplicate: true};
  // Retries when the ledger moved underneath; the next reconciliation run catches anything still missing.
  for (let attempt = 0; attempt < 3; attempt++) {
    const ledger = await loadLedger(order.project_id);
    if (!ledger.baseline || ledger.baseline.version !== order.version) return {recorded, ledger: false};
    try {
      const entry = await appendEntry({baseline: ledger.baseline, expectedHead: ledger.head, kind: 'payment', actor: 'system', ref,
        payload: {provider: 'razorpay', purpose: 'deposit', order_id: event.order_id, payment_id: event.payment_id, amount: fromMinorUnits(event.amount_minor, event.currency), currency: event.currency},
        context: {channel, event_id: event.event_id}});
      return {recorded, ledger: true, seq: entry.seq};
    } catch (e) {
      if (!(e instanceof LedgerConflict)) throw e;
      const row = await existing();
      if (row) return {recorded, ledger: true, seq: row.seq, duplicate: true};
      if (attempt === 2) return {recorded, ledger: false, note: e.message};
    }
  }
  return {recorded, ledger: false};
}
