import {json, failure, readText} from '@/lib/server';
import {stripePaidEvent, stripeWebhookSecret, verifyStripeSignature} from '@/lib/stripe';
import {eventIdOf, handleVerifiedEvent} from '@/lib/payment-record';

// Stripe webhook of ScopeFlow's own Stripe account (STRIPE_WEBHOOK_SECRET): only sessions created
// on the operator's key before payment accounts existed match here. Freelancers' own Stripe
// accounts send to /api/payments/stripe/webhook/<account id>. The Stripe-Signature over the raw body
// is verified first (five-minute tolerance); the verified event is stored before anything else
// (M21); 200 only once it is stored; a recording failure answers 500 so Stripe retries.
export async function POST(request: Request) {
  try {
    const secret = stripeWebhookSecret();
    if (!secret) return json({error: 'Stripe webhook is not configured (STRIPE_WEBHOOK_SECRET).', code: 'payments_disabled'}, 503);
    const raw = await readText(request, 200_000); // H1: bounded read; over the limit → 413
    if (!verifyStripeSignature(raw, request.headers.get('stripe-signature'), secret)) return json({error: 'Invalid signature.'}, 400);
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return json({error: 'Invalid JSON.'}, 400); }
    const p = payload as {id?: unknown; type?: unknown};
    const eventId = await eventIdOf(typeof p.id === 'string' ? p.id : null, raw);
    return await handleVerifiedEvent({provider: 'stripe', event_id: eventId, account_id: null, type: String(p.type ?? ''), paid: stripePaidEvent(payload)}, o => o.account_id === null);
  } catch (e) { return failure(e); }
}
