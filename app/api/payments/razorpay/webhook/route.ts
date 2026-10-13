import {db, json, failure} from '@/lib/server';
import {paidEvent, verifyWebhookSignature, webhookAccountId, webhookSecret} from '@/lib/razorpay';
import {partnerConfig} from '@/lib/payment-accounts';
import {eventIdOf, handleVerifiedEvent} from '@/lib/payment-record';

// Razorpay platform webhook (payment.captured / order.paid), signed with either
//  - RAZORPAY_WEBHOOK_SECRET (ScopeFlow's own Razorpay account): orders created on the operator's
//    keys before payment accounts existed, and Route orders (split to a linked account); or
//  - RAZORPAY_PARTNER_WEBHOOK_SECRET (Technology Partner): events of freelancers' accounts connected
//    by OAuth; Razorpay names the account in `account_id`, and only that account's orders match.
// Freelancers who connected their own API keys point their own webhook at
// /api/payments/razorpay/webhook/<account id> instead. M21: the verified event is stored before
// anything else; 200 only once it is stored; a recording failure answers 500 so Razorpay retries.
export async function POST(request: Request) {
  try {
    const operator = webhookSecret(), partner = partnerConfig()?.webhookSecret ?? null;
    if (!operator && !partner) return json({error: 'Payments webhook is not configured (RAZORPAY_WEBHOOK_SECRET).', code: 'payments_disabled'}, 503);
    const raw = await request.text();
    if (raw.length > 100_000) return json({error: 'Payload too large.'}, 413);
    const signature = request.headers.get('x-razorpay-signature');
    const viaOperator = !!operator && verifyWebhookSignature(raw, signature, operator);
    const viaPartner = !viaOperator && !!partner && verifyWebhookSignature(raw, signature, partner);
    if (!viaOperator && !viaPartner) return json({error: 'Invalid signature.'}, 400);
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return json({error: 'Invalid JSON.'}, 400); }
    const eventId = await eventIdOf(request.headers.get('x-razorpay-event-id'), raw);
    let accountId: string | null = null;
    if (viaPartner) {
      const rzp = webhookAccountId(payload);
      const row = rzp ? await db().prepare("SELECT id FROM scopeflow.payment_accounts WHERE kind='razorpay_oauth' AND public::jsonb->>'razorpay_account_id'=? ORDER BY status='active' DESC, created DESC LIMIT 1").bind(rzp).first<{id: string}>() : null;
      if (!row) return json({ignored: 'unknown_account'});
      accountId = row.id;
    }
    const routeIds = viaOperator ? new Set((await db().prepare("SELECT id FROM scopeflow.payment_accounts WHERE kind='razorpay_route'").all<{id: string}>()).results.map(r => r.id)) : null;
    const accept = viaPartner ? (o: {account_id: string | null}) => o.account_id === accountId : (o: {account_id: string | null}) => o.account_id === null || routeIds!.has(o.account_id);
    const type = String((payload as {event?: unknown})?.event ?? '');
    return await handleVerifiedEvent({provider: 'razorpay', event_id: eventId, account_id: accountId, type, paid: paidEvent(payload, eventId)}, accept);
  } catch (e) { return failure(e); }
}
