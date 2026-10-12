import {timingSafeEqual} from 'node:crypto';
import {db, json, failure} from '@/lib/server';
import {capturedPayment, RazorpayError, razorpayRefunds} from '@/lib/razorpay';
import {StripeError, stripeRefunds, stripeSessionPaid} from '@/lib/stripe';
import {razorpayFor, raiseAlert, stripeFor} from '@/lib/payment-accounts-server';
import {drainInbox, finalizeRefund, PaymentRecordError, recordPaidPayment, REFUND_COLUMNS, type PendingRefund, type RecordResult} from '@/lib/payment-record';
import {operatorRazorpay, operatorStripe} from '@/lib/payment-accounts';

// Payment reconciliation for Razorpay and Stripe (daily job, scripts/reconcile-payments.mjs), the
// third line of defence after the webhook and the Checkout verify route / return page:
//  0. stored webhook events that were never processed are processed again (M21);
//  1. orders marked paid whose ledger entry (or excess flag) is missing get it appended (H6);
//  2. refunds reserved or issued but not on the record are finalised (H9/H14): an 'issued' row is
//     appended; a 'pending' one is looked up at the provider by its request key;
//  3. unpaid orders of the last 90 days are looked up, NEWEST first, at most 200 per run, through
//     the account that created them; a persisted cursor makes the next run continue where this one
//     stopped (L4). Unpaid orders older than 90 days are flagged once for manual review.
// Authorized with SCOPEFLOW_CRON_SECRET as a bearer token; without that secret the route is off.
const MAX_LOOKUPS = 200, WINDOW_DAYS = 90, BACKOFF_HOURS = 6;
const CURSOR = 'reconcile:orders';

function authorized(request: Request) {
  const secret = process.env.SCOPEFLOW_CRON_SECRET?.trim();
  if (!secret) return null;
  const given = Buffer.from((request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')), want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}
type OpenOrder = {id: string; provider: 'razorpay' | 'stripe'; order_id: string; account_id: string | null; created: string};

export async function POST(request: Request) {
  try {
    const ok = authorized(request);
    if (ok === null) return json({error: 'Reconciliation is not configured (SCOPEFLOW_CRON_SECRET).', code: 'cron_disabled'}, 503);
    if (!ok) return json({error: 'Not authorized.'}, 401);
    const database = db();
    const results: (RecordResult & {order_id: string})[] = [];
    const record = async (paid: Parameters<typeof recordPaidPayment>[0], channel: Parameters<typeof recordPaidPayment>[1], opts: Parameters<typeof recordPaidPayment>[2]) => {
      try { results.push({order_id: paid.order_id, ...await recordPaidPayment(paid, channel, opts)}); }
      catch (e) { if (!(e instanceof PaymentRecordError)) throw e; results.push({order_id: paid.order_id, recorded: false, ledger: false, note: e.message}); }
    };
    // 0. The webhook inbox.
    const inbox = await drainInbox();
    // 1. Paid orders without their ledger entry, or an excess payment without its flag.
    const missing = await database.prepare(`SELECT p.provider,p.order_id,p.payment_id,p.amount_minor,p.received_minor,p.currency,p.account_id FROM payments p WHERE p.provider IN ('razorpay','stripe') AND p.status='paid' AND p.payment_id IS NOT NULL
      AND (NOT EXISTS (SELECT 1 FROM ledger_entries l WHERE l.project_id=p.project_id AND l.ref='payment:'||p.order_id)
        OR (p.outcome='excess' AND NOT EXISTS (SELECT 1 FROM ledger_entries l WHERE l.project_id=p.project_id AND l.ref='excess:'||p.order_id)))`).all<{provider: 'razorpay' | 'stripe'; order_id: string; payment_id: string; amount_minor: number | string; received_minor: number | string | null; currency: string; account_id: string | null}>();
    for (const m of missing.results) await record({event_id: null, order_id: m.order_id, payment_id: m.payment_id, amount_minor: Number(m.received_minor ?? m.amount_minor), currency: m.currency}, m.provider === 'stripe' ? 'stripe_reconcile' : 'razorpay_reconcile', {ensureLedger: true, provider: m.provider});
    // 2. Refunds not yet on the record.
    const refunds: {request_id: string; status: string; seq?: number | null}[] = [];
    const open = await database.prepare(`SELECT ${REFUND_COLUMNS} FROM scopeflow.refunds_pending WHERE status IN ('pending','issued') ORDER BY created LIMIT 200`).all<PendingRefund>();
    for (const p of open.results) {
      try {
        if (p.status === 'pending') {
          // Ask the provider whether the refund was made (a crash between the call and the update).
          const age = Date.now() - Date.parse(p.created);
          if (age < 120_000) { refunds.push({request_id: p.request_id, status: 'pending'}); continue; }
          let found: string | null = null;
          if (p.provider === 'stripe') { const d = await stripeFor(p.account_id); if (d) found = (await stripeRefunds(d.config, p.payment_id)).find(r => r.request === p.idem_key)?.id ?? null; }
          else { const d = await razorpayFor(p.account_id); if (d) found = (await razorpayRefunds(d.credential, p.payment_id)).find(r => r.request === p.idem_key)?.id ?? null; }
          if (!found) {
            if (age > 24 * 3600_000) { await database.prepare("UPDATE scopeflow.refunds_pending SET status='failed',error='not made at the provider',updated=? WHERE id=?").bind(new Date().toISOString(), p.id).run(); refunds.push({request_id: p.request_id, status: 'failed'}); }
            else refunds.push({request_id: p.request_id, status: 'pending'});
            continue;
          }
          await database.prepare("UPDATE scopeflow.refunds_pending SET status='issued',provider_refund_id=?,updated=? WHERE id=?").bind(found, new Date().toISOString(), p.id).run();
          p.status = 'issued'; p.provider_refund_id = found;
        }
        const seq = await finalizeRefund(p);
        refunds.push({request_id: p.request_id, status: seq ? 'recorded' : 'issued', seq});
      } catch (e) {
        if (!(e instanceof RazorpayError) && !(e instanceof StripeError)) {
          await raiseAlert({project_id: p.project_id, kind: 'refund_unrecorded', dedupe: 'refund:' + p.id, detail: {request_id: p.request_id, refund_id: p.provider_refund_id, error: String(e).slice(0, 200)}});
        }
        refunds.push({request_id: p.request_id, status: p.status});
      }
    }
    // 3. Unpaid orders, newest first, resuming from the cursor; each looked up at most every six hours.
    const now = Date.now(), since = new Date(now - WINDOW_DAYS * 86400_000).toISOString(), backoff = new Date(now - BACKOFF_HOURS * 3600_000).toISOString();
    const cursorRow = await database.prepare('SELECT value FROM scopeflow.payment_cursors WHERE name=?').bind(CURSOR).first<{value: string | null}>();
    const cursor = cursorRow?.value ? JSON.parse(cursorRow.value) as {created: string; id: string} : null;
    const batch = await database.prepare(`SELECT id,provider,order_id,account_id,created FROM payments WHERE provider IN ('razorpay','stripe') AND status<>'paid' AND created>=? AND (checked IS NULL OR checked<?)
      ${cursor ? 'AND (created<? OR (created=? AND id<?))' : ''} ORDER BY created DESC, id DESC LIMIT ${MAX_LOOKUPS + 1}`).bind(since, backoff, ...(cursor ? [cursor.created, cursor.created, cursor.id] : [])).all<OpenOrder>();
    const todo = batch.results.slice(0, MAX_LOOKUPS), more = batch.results.length > MAX_LOOKUPS;
    let checked = 0, unreachable = 0;
    for (const o of todo) {
      try {
        let paid = null;
        if (o.provider === 'stripe') { const d = await stripeFor(o.account_id); if (!d) continue; paid = await stripeSessionPaid(d.config, o.order_id); }
        else { const d = await razorpayFor(o.account_id); if (!d) continue; paid = await capturedPayment(d.credential, o.order_id); }
        checked++;
        await database.prepare('UPDATE payments SET checked=? WHERE id=?').bind(new Date().toISOString(), o.id).run();
        if (paid) await record(paid, o.provider === 'stripe' ? 'stripe_reconcile' : 'razorpay_reconcile', {provider: o.provider});
      } catch (e) { if (!(e instanceof RazorpayError) && !(e instanceof StripeError)) throw e; unreachable++; }
    }
    const last = todo.at(-1);
    const next = more && last ? JSON.stringify({created: last.created, id: last.id}) : null;
    await database.prepare('INSERT INTO scopeflow.payment_cursors (name,value,updated) VALUES (?,?,?) ON CONFLICT (name) DO UPDATE SET value=excluded.value,updated=excluded.updated').bind(CURSOR, next, new Date().toISOString()).run();
    // Older than the window and never paid: flagged once for a person to check.
    const stale = await database.prepare("UPDATE payments SET manual_review=? WHERE provider IN ('razorpay','stripe') AND status<>'paid' AND superseded_at IS NULL AND created<? AND manual_review IS NULL RETURNING project_id,order_id").bind(new Date().toISOString(), since).all<{project_id: string; order_id: string}>();
    for (const s of stale.results) await raiseAlert({project_id: s.project_id, kind: 'stale_order', dedupe: 'stale:' + s.order_id, detail: {order_id: s.order_id, note: `Unpaid for more than ${WINDOW_DAYS} days; check it in the provider dashboard.`}});
    const anyAccounts = !!await database.prepare("SELECT 1 AS x FROM scopeflow.payment_accounts WHERE kind<>'upi' LIMIT 1").first();
    return json({repaired: results.filter(r => r.ledger).length, results, inbox: {processed: inbox.filter(i => i.ok).length, failed: inbox.filter(i => !i.ok).length},
      refunds, checked, unreachable, cursor: next ? 'continues' : 'complete', flagged: stale.results.length,
      lookups: anyAccounts || operatorRazorpay() || operatorStripe() ? 'on' : 'off: no payment accounts are connected (and no operator keys for older orders)'});
  } catch (e) { return failure(e); }
}
