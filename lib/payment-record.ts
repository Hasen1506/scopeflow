import {db, json} from './server';
import {type OnlineProvider, type PaidEvent} from './razorpay';
import {loadLedger, LedgerConflict} from './ledger-server';
import {appendMoneyEntry} from './ledger-hooks';
import {clientInvoices, todayIn} from './invoice-server';
import {agreementTotals} from './agreement-totals';
import {balanceOpen, classifyCapture, depositOpen, moneyState} from './money-ledger';
import {entryKindEnabled} from './ledger';
import {raiseAlert} from './payment-accounts-server';
import {fromMinor, toMinor} from './minor';
import type {Scope} from './scope';

// Recording money exactly once (H6, H8, H14, M20, M21).

export type RecordResult = {recorded: boolean; ledger: boolean; seq?: number; duplicate?: boolean; ignored?: string; note?: string; outcome?: 'excess' | 'short'; excess_minor?: number; short_minor?: number};
type OrderRow = {id: string; project_id: string; version: number; amount_minor: number | string; currency: string; status: string; purpose: string | null; invoice_seq: number | null; account_id: string | null; superseded_at: string | null; received_minor: number | string | null; outcome: string | null; excess_minor: number | string | null; payment_id: string | null};
export type PaymentChannel = 'razorpay_webhook' | 'razorpay_reconcile' | 'razorpay_checkout' | 'stripe_webhook' | 'stripe_reconcile' | 'stripe_return' | 'inbox';

/** A captured payment the record could not take: the webhook answers 500 so the provider retries (H6). */
export class PaymentRecordError extends Error {}
/** Which orders a caller may record: an account's webhook only its own orders. undefined = any. */
export type OrderFilter = (order: {account_id: string | null}) => boolean;

const ORDER_COLUMNS = 'id,project_id,version,amount_minor,currency,status,purpose,invoice_seq,account_id,superseded_at,received_minor,outcome,excess_minor,payment_id';
const tick = (ms: number) => new Promise(r => setTimeout(r, ms));
/**
 * WS-05's appendMoneyEntry throws MoneyEntryError (by name: it is not exported by the Phase 0
 * ledger-hooks this branch is built on) when money cannot be recorded; Phase 0 throws LedgerConflict.
 */
export const isMoneyEntryError = (e: unknown): e is Error & {code: string} => e instanceof Error && e.name === 'MoneyEntryError';
/** A transient clash with another append: retry. */
const isRetryable = (e: unknown) => e instanceof LedgerConflict || (isMoneyEntryError(e) && e.code === 'conflict');

/**
 * Records a captured online payment for a stored order, once. The order row is marked paid
 * (conditionally, so concurrent deliveries record it once) and a `payment` entry for what was
 * ACTUALLY captured is appended to the project's signed ledger as the `system` actor, against the
 * project's current approved baseline (money is project-scoped, C4). What the capture means for its
 * target is classified against what was open when it arrived (H8, M20):
 *  - more than was open (overpayment, or a capture on an order a newer amount superseded): the
 *    surplus also gets an `excess_payment` entry and the owner an alert with a one-click refund;
 *  - less than the order: the payment carries `expected_minor` and the owner is alerted.
 * Nothing is ever dropped as "ignored" once the order is known. Any failure to record raises an
 * alert and throws PaymentRecordError (webhooks answer 500; reconcile retries).
 * `ensureLedger` (default on, M1) also appends the entry for an order already marked paid whose entry
 * is missing: a retry after a failed ledger write must still reach the ledger (appendPayment is idempotent).
 */
export async function recordPaidPayment(event: PaidEvent, channel: PaymentChannel, {ensureLedger = true, provider = 'razorpay', accept}: {ensureLedger?: boolean; provider?: OnlineProvider; accept?: OrderFilter} = {}): Promise<RecordResult> {
  const database = db();
  const order = await database.prepare(`SELECT ${ORDER_COLUMNS} FROM payments WHERE provider=? AND order_id=?`).bind(provider, event.order_id).first<OrderRow>();
  if (!order) return {recorded: false, ledger: false, ignored: 'unknown_order'};
  if (accept && !accept(order)) return {recorded: false, ledger: false, ignored: 'account_mismatch'};
  const now = new Date().toISOString();
  const marked = await database.prepare("UPDATE payments SET status='paid',payment_id=?,event_id=?,paid_at=?,received_minor=? WHERE id=? AND status<>'paid' RETURNING id").bind(event.payment_id, event.event_id, now, event.amount_minor, order.id).first();
  const recorded = !!marked;
  if (!recorded && !ensureLedger) return {recorded, ledger: false, duplicate: true};
  // The capture that marked the row is the one recorded (a reconcile repair uses the stored values).
  const captured = recorded ? event : {...event, payment_id: order.payment_id ?? event.payment_id, amount_minor: order.received_minor === null ? event.amount_minor : Number(order.received_minor)};
  try {
    return await appendPayment(order, captured, channel, provider, recorded);
  } catch (e) {
    await raiseAlert({project_id: order.project_id, kind: 'payment_unrecorded', dedupe: 'unrecorded:' + provider + ':' + event.order_id,
      detail: {order_id: event.order_id, payment_id: captured.payment_id, amount_minor: captured.amount_minor, currency: captured.currency, reason: e instanceof Error ? e.message.slice(0, 200) : 'unknown'}});
    throw new PaymentRecordError(e instanceof Error ? e.message : 'The payment could not be recorded.');
  }
}

async function appendPayment(order: OrderRow, event: PaidEvent, channel: PaymentChannel, provider: OnlineProvider, recorded: boolean): Promise<RecordResult> {
  const database = db();
  const ref = 'payment:' + event.order_id;
  const existing = () => database.prepare('SELECT seq FROM ledger_entries WHERE project_id=? AND ref=?').bind(order.project_id, ref).first<{seq: number}>();
  const already = await existing();
  if (already) { await ensureExcessEntry(order, event, already.seq, undefined, provider); return {recorded, ledger: true, seq: already.seq, duplicate: true}; }
  const invoice = order.purpose === 'invoice' && order.invoice_seq ? await database.prepare('SELECT number FROM invoices WHERE project_id=? AND seq=?').bind(order.project_id, order.invoice_seq).first<{number: string}>() : null;
  const orderMinor = Number(order.amount_minor), mismatch = orderMinor !== event.amount_minor || order.currency !== event.currency;
  // Retries when the ledger moved underneath (another entry was appended at the same time).
  for (let attempt = 0; attempt < 4; attempt++) {
    const ledger = await loadLedger(order.project_id);
    if (!ledger.baseline || !ledger.content) throw new Error('There is no approved agreement to record the payment on (a new version is out for review).');
    const content = ledger.content as Scope;
    const own = ledger.entries.filter(e => e.baseline_version === ledger.baseline!.version);
    const t = agreementTotals(content, own);
    const state = moneyState(ledger.entries, {baseline_version: ledger.baseline.version, currency: content.currency, total: t.total, deposit: t.deposit});
    let open: number;
    if (order.purpose === 'invoice') {
      const tz = (await database.prepare('SELECT timezone FROM projects WHERE id=?').bind(order.project_id).first<{timezone: string | null}>())?.timezone ?? null;
      const inv = (await clientInvoices(order.project_id, ledger.baseline.version, ledger.entries, tz)).find(i => i.seq === order.invoice_seq);
      // M4: a missing (or no longer listed) invoice has nothing open, so the capture is flagged as excess.
      open = inv ? toMinor(inv.open, content.currency) : 0;
    // A deposit order counts toward the deposit. A legacy order (purpose unset, created before
    // checkout stored it) or one on an agreement without a deposit counts toward the balance.
    } else open = order.purpose === 'deposit' && t.deposit > 0 ? depositOpen(state) : balanceOpen(state, t.total);
    // A capture in another currency than its order cannot be applied: all of it is flagged.
    const cls = order.currency !== event.currency ? {apply_minor: 0, excess_minor: event.amount_minor, short_minor: 0} : classifyCapture({open_minor: open, order_minor: orderMinor, captured_minor: event.amount_minor});
    // M6: sign what the money was applied to (a legacy order or one on an agreement without a deposit is the balance).
    const purpose = order.purpose === 'invoice' ? 'invoice' as const : order.purpose === 'deposit' && t.deposit > 0 ? 'deposit' as const : 'balance' as const;
    const payload = {provider, purpose, order_id: event.order_id, payment_id: event.payment_id, amount: fromMinor(event.amount_minor, event.currency), currency: event.currency,
      ...(invoice ? {invoice_number: invoice.number} : {})};
    let seq: number;
    try {
      seq = (await appendMoneyEntry({baseline: ledger.baseline, expectedHead: ledger.head, kind: 'payment', actor: 'system', ref, payload,
        // M20: what the order asked for rides on the signed entry's context (the payment schema is strict).
        context: {channel, event_id: event.event_id, order_baseline: order.version, ...(mismatch ? {expected_minor: orderMinor, expected_currency: order.currency} : {}), ...(order.account_id ? {account_id: order.account_id} : {})}})).seq;
    } catch (e) {
      if (!isRetryable(e)) throw e;
      const row = await existing();
      if (row) return {recorded, ledger: true, seq: row.seq, duplicate: true};
      if (attempt === 3) throw e;
      await tick(25 * (attempt + 1));
      continue;
    }
    const outcome = cls.excess_minor > 0 ? 'excess' as const : cls.short_minor > 0 ? 'short' as const : null;
    if (outcome || order.superseded_at) await database.prepare('UPDATE payments SET outcome=?,excess_minor=? WHERE id=?').bind(outcome ?? 'superseded', cls.excess_minor || null, order.id).run();
    if (cls.excess_minor > 0) {
      const reason = order.currency !== event.currency ? 'currency_mismatch' as const : order.superseded_at ? 'superseded_order' as const : 'overpaid' as const;
      await raiseAlert({project_id: order.project_id, kind: 'excess_payment', dedupe: 'excess:' + provider + ':' + event.order_id,
        detail: {order_id: event.order_id, payment_id: event.payment_id, payment_seq: seq, captured_minor: event.amount_minor, excess_minor: cls.excess_minor, currency: event.currency, reason,
          refund: {path: `/api/scopes/${order.project_id}/refunds`, body: {payment_seq: seq, amount: fromMinor(cls.excess_minor, event.currency), request_id: 'excess-' + seq}}}});
      await ensureExcessEntry({...order, outcome: 'excess', excess_minor: cls.excess_minor}, event, seq, reason, provider);
    } else if (cls.short_minor > 0) {
      await raiseAlert({project_id: order.project_id, kind: 'short_payment', dedupe: 'short:' + provider + ':' + event.order_id,
        detail: {order_id: event.order_id, payment_id: event.payment_id, payment_seq: seq, captured_minor: event.amount_minor, expected_minor: orderMinor, short_minor: cls.short_minor, currency: event.currency}});
    }
    return {recorded, ledger: true, seq, ...(outcome === 'excess' ? {outcome, excess_minor: cls.excess_minor} : outcome === 'short' ? {outcome, short_minor: cls.short_minor} : {})};
  }
  throw new Error('The ledger was busy.');
}

/** Appends the `excess_payment` flag for a recorded overpayment, once (ref excess:<order>); reconcile repairs a missing one. */
async function ensureExcessEntry(order: Pick<OrderRow, 'project_id' | 'outcome' | 'excess_minor' | 'superseded_at' | 'currency'>, event: PaidEvent, paymentSeq: number, reason?: 'currency_mismatch' | 'superseded_order' | 'overpaid', provider: OnlineProvider = 'razorpay') {
  if (order.outcome !== 'excess' || !(Number(order.excess_minor) > 0)) return;
  // Phase 0 ledgers do not accept the kind yet (WS-05 enables it); the payment row and the alert carry the excess meanwhile.
  if (!entryKindEnabled('excess_payment')) return;
  const database = db(), ref = 'excess:' + event.order_id;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (await database.prepare('SELECT 1 AS x FROM ledger_entries WHERE project_id=? AND ref=?').bind(order.project_id, ref).first()) return;
    const ledger = await loadLedger(order.project_id);
    if (!ledger.baseline) return;
    const why = reason ?? (order.superseded_at ? 'superseded_order' : 'overpaid');
    try {
      await appendMoneyEntry({baseline: ledger.baseline, expectedHead: ledger.head, kind: 'excess_payment', actor: 'system', ref,
        // WS-05 excessPaymentSchema: integer minor units; a currency mismatch is flagged as 'overpaid' with a note.
        payload: {amount_minor: Number(order.excess_minor), currency: event.currency, reason: why === 'currency_mismatch' ? 'overpaid' : why, provider, order_id: event.order_id, payment_id: event.payment_id,
          note: why === 'currency_mismatch' ? `Captured in ${event.currency}, the order was in ${order.currency}.` : ''},
        context: {of_seq: paymentSeq}});
      return;
    } catch (e) {
      // The excess is already on the payment row and in an alert; reconcile retries the flag.
      if (isRetryable(e) && attempt < 3) { await tick(25 * (attempt + 1)); continue; }
      console.warn('Scopeflow excess_payment entry not recorded', JSON.stringify({project: order.project_id, order_id: event.order_id, error: String(e)}));
      return;
    }
  }
}

// ---- Durable webhook inbox (M21) --------------------------------------------------------------------

export type InboxEvent = {provider: OnlineProvider; event_id: string; account_id: string | null; type: string; paid: PaidEvent | null};
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))).map(b => b.toString(16).padStart(2, '0')).join('');
/** The provider's event id, or a fingerprint of the verified body when it sends none. */
export const eventIdOf = async (given: string | null | undefined, raw: string) => given && /^[A-Za-z0-9_.:-]{1,200}$/.test(given) ? given : 'sha256:' + await sha(raw);

/**
 * Stores a verified webhook event before anything else (only what recording needs: no payer
 * details), processes it, and answers. 200 only after the event is durably stored; a processing
 * failure answers 500 (the provider retries, and reconcile re-runs the stored event).
 */
export async function handleVerifiedEvent(e: InboxEvent, accept?: OrderFilter): Promise<Response> {
  const database = db();
  let stored: {id: string; processed_at: string | null} | null;
  try {
    stored = await database.prepare('INSERT INTO scopeflow.payment_events (id,provider,event_id,account_id,payload,received) VALUES (?,?,?,?,?,?) ON CONFLICT (provider,event_id) DO NOTHING RETURNING id,processed_at')
      .bind(crypto.randomUUID(), e.provider, e.event_id, e.account_id, JSON.stringify({type: e.type, paid: e.paid}), new Date().toISOString()).first();
    stored ??= await database.prepare('SELECT id,processed_at FROM scopeflow.payment_events WHERE provider=? AND event_id=?').bind(e.provider, e.event_id).first();
  } catch (err) {
    console.error('Scopeflow webhook event could not be stored', JSON.stringify({provider: e.provider, event_id: e.event_id, error: String(err)}));
    return json({error: 'The event could not be stored. Retry later.', code: 'inbox_unavailable'}, 500);
  }
  if (!stored) return json({error: 'The event could not be stored. Retry later.', code: 'inbox_unavailable'}, 500);
  if (stored.processed_at) return json({recorded: false, duplicate: true});
  try {
    const result = await processEvent(e, accept);
    // M1: an event whose payment is not on the ledger yet stays unprocessed, so reconcile retries it.
    if (notOnLedger(result)) {
      await database.prepare('UPDATE scopeflow.payment_events SET attempts=attempts+1,last_error=? WHERE id=?').bind('payment not on the ledger yet', stored.id).run();
      return json({error: 'The payment was received but could not be recorded yet. It is stored and will be retried.', code: 'record_failed'}, 500);
    }
    await database.prepare('UPDATE scopeflow.payment_events SET processed_at=?,attempts=attempts+1,last_error=NULL WHERE id=?').bind(new Date().toISOString(), stored.id).run();
    if (!result) return json({ignored: 'event'});
    if (result.ignored) return json({ignored: result.ignored});
    if (result.duplicate && !result.recorded) return json({recorded: false, duplicate: true});
    return json(result);
  } catch (err) {
    await database.prepare('UPDATE scopeflow.payment_events SET attempts=attempts+1,last_error=? WHERE id=?').bind(String(err instanceof Error ? err.message : err).slice(0, 500), stored.id).run().catch(() => {});
    return json({error: 'The payment was received but could not be recorded yet. It is stored and will be retried.', code: 'record_failed'}, 500);
  }
}
/** M1: a known order whose payment did not reach the ledger (never stamp its event processed). */
export const notOnLedger = (r: RecordResult | null) => !!r && !r.ignored && r.ledger === false;
async function processEvent(e: InboxEvent, accept?: OrderFilter, ensureLedger = true) {
  if (!e.paid) return null;
  return recordPaidPayment(e.paid, e.provider === 'stripe' ? 'stripe_webhook' : 'razorpay_webhook', {provider: e.provider, accept, ensureLedger});
}
/** Reconcile step: re-processes stored events that were never processed (oldest first). */
export async function drainInbox(limit = 100) {
  const database = db();
  const rows = await database.prepare('SELECT id,provider,event_id,account_id,payload FROM scopeflow.payment_events WHERE processed_at IS NULL AND attempts < 20 ORDER BY received LIMIT ?').bind(limit).all<{id: string; provider: OnlineProvider; event_id: string; account_id: string | null; payload: string}>();
  const out: {event_id: string; ok: boolean; result?: RecordResult | null; error?: string}[] = [];
  for (const r of rows.results) {
    const p = JSON.parse(r.payload) as {type: string; paid: PaidEvent | null};
    try {
      const result = await processEvent({provider: r.provider, event_id: r.event_id, account_id: r.account_id, type: p.type, paid: p.paid}, r.account_id ? (o => o.account_id === r.account_id) : undefined, true);
      if (notOnLedger(result)) throw new Error('payment not on the ledger yet');
      await database.prepare('UPDATE scopeflow.payment_events SET processed_at=?,attempts=attempts+1,last_error=NULL WHERE id=?').bind(new Date().toISOString(), r.id).run();
      out.push({event_id: r.event_id, ok: true, result});
    } catch (err) {
      await database.prepare('UPDATE scopeflow.payment_events SET attempts=attempts+1,last_error=? WHERE id=?').bind(String(err instanceof Error ? err.message : err).slice(0, 500), r.id).run();
      out.push({event_id: r.event_id, ok: false, error: err instanceof Error ? err.message : String(err)});
    }
  }
  return out;
}

// ---- Refund finalisation (H9, H14) -------------------------------------------------------------------

export type PendingRefund = {id: string; project_id: string; request_id: string; payment_seq: number; amount_minor: number | string; currency: string; provider: OnlineProvider; account_id: string | null; payment_id: string; idem_key: string; note: string; status: string; provider_refund_id: string | null; ledger_seq: number | null; created: string};
export const REFUND_COLUMNS = 'id,project_id,request_id,payment_seq,amount_minor,currency,provider,account_id,payment_id,idem_key,note,status,provider_refund_id,ledger_seq,created';

/**
 * Puts a refund the provider has issued on the ledger, once (ref refund-req:<request_id>),
 * against whatever baseline is current when it runs (H14: a baseline change between the provider
 * call and the append no longer loses it). Returns the ledger seq, or null when it must wait
 * (no approved agreement right now); reconcile retries.
 */
export async function finalizeRefund(p: PendingRefund): Promise<number | null> {
  const database = db(), ref = 'refund-req:' + p.request_id;
  const done = async (seq: number) => { await database.prepare("UPDATE scopeflow.refunds_pending SET status='recorded',ledger_seq=?,updated=? WHERE id=?").bind(seq, new Date().toISOString(), p.id).run(); return seq; };
  for (let attempt = 0; attempt < 5; attempt++) {
    const prior = await database.prepare('SELECT seq FROM ledger_entries WHERE project_id=? AND ref=?').bind(p.project_id, ref).first<{seq: number}>();
    if (prior) return done(prior.seq);
    const ledger = await loadLedger(p.project_id);
    if (!ledger.baseline) return null;
    const tz = (await database.prepare('SELECT timezone FROM projects WHERE id=?').bind(p.project_id).first<{timezone: string | null}>())?.timezone ?? null;
    try {
      const entry = await appendMoneyEntry({baseline: ledger.baseline, expectedHead: ledger.head, kind: 'refund', actor: 'owner', ref,
        payload: {amount: fromMinor(Number(p.amount_minor), p.currency), method: p.provider, refunded: todayIn(tz), reference: '', note: p.note, provider_refund_id: p.provider_refund_id!, refund_of: p.payment_seq}});
      return done(entry.seq);
    } catch (e) {
      if (!isRetryable(e) || attempt === 4) throw e;
      await tick(25 * (attempt + 1));
    }
  }
  return null;
}
