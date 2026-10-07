import {db, json, failure} from '@/lib/server';
import {fromMinorUnits, paidEvent, verifyWebhookSignature, webhookSecret} from '@/lib/razorpay';
import {appendEntry, loadLedger, LedgerConflict} from '@/lib/ledger-server';

// PR F: Razorpay webhook (payment.captured / order.paid). The signature over the raw body is
// verified first; the order and amount must match a stored order; the payment is recorded once
// (row update is conditional) and appended to the project's hash-chained, signed ledger.
// Unknown or irrelevant events get 200 so Razorpay does not retry them forever.
export async function POST(request: Request) {
  try {
    const secret = webhookSecret();
    if (!secret) return json({error: 'Payments webhook is not configured (RAZORPAY_WEBHOOK_SECRET).', code: 'payments_disabled'}, 503);
    const raw = await request.text();
    if (raw.length > 100_000) return json({error: 'Payload too large.'}, 413);
    if (!verifyWebhookSignature(raw, request.headers.get('x-razorpay-signature'), secret)) return json({error: 'Invalid signature.'}, 400);
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return json({error: 'Invalid JSON.'}, 400); }
    const event = paidEvent(payload, request.headers.get('x-razorpay-event-id'));
    if (!event) return json({ignored: 'event'});
    const order = await db().prepare("SELECT id,project_id,version,amount_minor,currency,status FROM payments WHERE provider='razorpay' AND order_id=?").bind(event.order_id).first<{id: string; project_id: string; version: number; amount_minor: number | string; currency: string; status: string}>();
    if (!order) return json({ignored: 'unknown_order'});
    if (Number(order.amount_minor) !== event.amount_minor || order.currency !== event.currency) {
      console.warn('Scopeflow payment amount mismatch', JSON.stringify({order_id: event.order_id, expected: Number(order.amount_minor), got: event.amount_minor}));
      return json({ignored: 'amount_mismatch'});
    }
    const now = new Date().toISOString();
    const marked = await db().prepare("UPDATE payments SET status='paid',payment_id=?,event_id=?,paid_at=? WHERE id=? AND status<>'paid' RETURNING id").bind(event.payment_id, event.event_id, now, order.id).first();
    if (!marked) return json({recorded: false, duplicate: true});
    // Append to the ledger when the paid version is still the approved baseline.
    const ledger = await loadLedger(order.project_id);
    if (!ledger.baseline || ledger.baseline.version !== order.version) return json({recorded: true, ledger: false});
    try {
      const entry = await appendEntry({baseline: ledger.baseline, expectedHead: ledger.head, kind: 'payment', actor: 'client', ref: 'payment:' + event.order_id,
        payload: {provider: 'razorpay', purpose: 'deposit', order_id: event.order_id, payment_id: event.payment_id, amount: fromMinorUnits(event.amount_minor, event.currency), currency: event.currency},
        context: {channel: 'razorpay_webhook', event_id: event.event_id}});
      return json({recorded: true, ledger: true, seq: entry.seq});
    } catch (e) {
      if (e instanceof LedgerConflict) return json({recorded: true, ledger: false, note: e.message});
      throw e;
    }
  } catch (e) { return failure(e); }
}
