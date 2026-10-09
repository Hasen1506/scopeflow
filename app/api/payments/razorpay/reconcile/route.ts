import {timingSafeEqual} from 'node:crypto';
import {db, json, failure} from '@/lib/server';
import {capturedPayment, razorpayConfig, RazorpayError} from '@/lib/razorpay';
import {recordPaidPayment, type RecordResult} from '@/lib/payment-record';
import {StripeError, stripeConfig, stripeSessionPaid} from '@/lib/stripe';

// Payment reconciliation for Razorpay and Stripe (daily job, scripts/reconcile-payments.mjs). Webhooks can be lost or
// arrive while the ledger is busy; this catches both:
//  1. orders marked paid whose ledger entry is missing get it appended;
//  2. unpaid orders from the last 30 days are looked up with Razorpay (needs RAZORPAY_KEY_ID and
//     RAZORPAY_KEY_SECRET) and any captured payment is recorded exactly as the webhook would.
// Authorized with SCOPEFLOW_CRON_SECRET as a bearer token; without that secret the route is off.
const MAX_LOOKUPS = 200;

function authorized(request: Request) {
  const secret = process.env.SCOPEFLOW_CRON_SECRET?.trim();
  if (!secret) return null;
  const given = Buffer.from((request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')), want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

export async function POST(request: Request) {
  try {
    const ok = authorized(request);
    if (ok === null) return json({error: 'Reconciliation is not configured (SCOPEFLOW_CRON_SECRET).', code: 'cron_disabled'}, 503);
    if (!ok) return json({error: 'Not authorized.'}, 401);
    const results: (RecordResult & {order_id: string})[] = [];
    // 1. Paid orders without their ledger entry.
    const missing = await db().prepare(`SELECT p.provider,p.order_id,p.payment_id,p.amount_minor,p.currency FROM payments p WHERE p.provider IN ('razorpay','stripe') AND p.status='paid' AND p.payment_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM ledger_entries l WHERE l.project_id=p.project_id AND l.ref='payment:'||p.order_id)`).all<{provider: 'razorpay' | 'stripe'; order_id: string; payment_id: string; amount_minor: number | string; currency: string}>();
    for (const m of missing.results) {
      const r = await recordPaidPayment({event_id: null, order_id: m.order_id, payment_id: m.payment_id, amount_minor: Number(m.amount_minor), currency: m.currency}, m.provider === 'stripe' ? 'stripe_reconcile' : 'razorpay_reconcile', {ensureLedger: true, provider: m.provider});
      results.push({order_id: m.order_id, ...r});
    }
    // 2. Unpaid orders, asked about at most once every six hours.
    const config = razorpayConfig();
    let checked = 0, unreachable = 0;
    if (config) {
      const since = new Date(Date.now() - 30 * 86400_000).toISOString(), backoff = new Date(Date.now() - 6 * 3600_000).toISOString();
      const open = await db().prepare(`SELECT id,order_id FROM payments WHERE provider='razorpay' AND status<>'paid' AND created>=? AND (checked IS NULL OR checked<?) ORDER BY created LIMIT ${MAX_LOOKUPS}`).bind(since, backoff).all<{id: string; order_id: string}>();
      for (const o of open.results) {
        try {
          const paid = await capturedPayment(config, o.order_id);
          checked++;
          await db().prepare('UPDATE payments SET checked=? WHERE id=?').bind(new Date().toISOString(), o.id).run();
          if (paid) results.push({order_id: o.order_id, ...await recordPaidPayment(paid, 'razorpay_reconcile')});
        } catch (e) { if (!(e instanceof RazorpayError)) throw e; unreachable++; }
      }
    }
    // 3. Unpaid Stripe Checkout sessions, the same way.
    const stripe = stripeConfig();
    if (stripe) {
      const since = new Date(Date.now() - 30 * 86400_000).toISOString(), backoff = new Date(Date.now() - 6 * 3600_000).toISOString();
      const open = await db().prepare(`SELECT id,order_id FROM payments WHERE provider='stripe' AND status<>'paid' AND created>=? AND (checked IS NULL OR checked<?) ORDER BY created LIMIT ${MAX_LOOKUPS}`).bind(since, backoff).all<{id: string; order_id: string}>();
      for (const o of open.results) {
        try {
          const paid = await stripeSessionPaid(stripe, o.order_id);
          checked++;
          await db().prepare('UPDATE payments SET checked=? WHERE id=?').bind(new Date().toISOString(), o.id).run();
          if (paid) results.push({order_id: o.order_id, ...await recordPaidPayment(paid, 'stripe_reconcile', {provider: 'stripe'})});
        } catch (e) { if (!(e instanceof StripeError)) throw e; unreachable++; }
      }
    }
    return json({repaired: results.filter(r => r.ledger).length, results, checked, unreachable, lookups: config || stripe ? 'on' : 'off: set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (or STRIPE_SECRET_KEY)'});
  } catch (e) { return failure(e); }
}
