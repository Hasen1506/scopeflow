import {db, json, allowRead, failure, ipKey} from '@/lib/server';
import {StripeError, stripeSessionPaid} from '@/lib/stripe';
import {stripeFor} from '@/lib/payment-accounts-server';
import {PaymentRecordError, recordPaidPayment} from '@/lib/payment-record';

// L5: where /payment-return sends a client back from Stripe Checkout, in any tab or in-app
// browser (no sessionStorage). The success URL carries Stripe's session id and an opaque reference
// stored with the order (never the review token); together they identify the order. The session is
// looked up on the account that created it and, when paid, recorded at once. Answers with the
// review token so the page can return the client to their review link.
export async function GET(request: Request) {
  try {
    if (!await allowRead('pay-return:' + await ipKey(request), 60)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const url = new URL(request.url), sessionId = url.searchParams.get('session_id') ?? '', ref = url.searchParams.get('ref') ?? '';
    if (!/^cs_[A-Za-z0-9_]{6,200}$/.test(sessionId) || !/^[a-f0-9]{32}$/.test(ref)) return json({error: 'This payment link is not valid.'}, 404);
    const order = await db().prepare("SELECT project_id,version,account_id,status FROM payments WHERE provider='stripe' AND order_id=? AND return_ref=?").bind(sessionId, ref).first<{project_id: string; version: number; account_id: string | null; status: string}>();
    if (!order) return json({error: 'This payment link is not valid.'}, 404);
    let paid = order.status === 'paid', pending = false;
    if (!paid) {
      const dest = await stripeFor(order.account_id);
      try {
        const session = dest ? await stripeSessionPaid(dest.config, sessionId) : null;
        if (session) { await recordPaidPayment(session, 'stripe_return', {provider: 'stripe', accept: o => o.account_id === order.account_id}); paid = true; }
        else pending = true;
      } catch (e) {
        if (!(e instanceof StripeError) && !(e instanceof PaymentRecordError)) throw e;
        pending = true;
      }
    }
    // The client goes back to the current agreement's link when it is approved, else to the paid version's.
    const link = await db().prepare("SELECT v.token FROM versions v JOIN projects p ON p.id=v.project_id WHERE v.project_id=? AND v.revoked=0 AND (v.version=p.latest AND v.status='approved' OR v.version=?) ORDER BY v.version DESC LIMIT 1").bind(order.project_id, order.version).first<{token: string}>();
    return json({paid, pending, token: link?.token ?? null});
  } catch (e) { return failure(e); }
}
