import {json, failure} from '@/lib/server';
import {stripePaidEvent, stripeWebhookSecret, verifyStripeSignature} from '@/lib/stripe';
import {recordPaidPayment} from '@/lib/payment-record';

// Stripe webhook (checkout.session.completed / checkout.session.async_payment_succeeded). The
// Stripe-Signature over the raw body is verified first (five-minute tolerance); the session and
// amount must match a stored order; the payment is recorded once and appended to the signed ledger.
// Other events get 200 so Stripe does not retry them.
export async function POST(request: Request) {
  try {
    const secret = stripeWebhookSecret();
    if (!secret) return json({error: 'Stripe webhook is not configured (STRIPE_WEBHOOK_SECRET).', code: 'payments_disabled'}, 503);
    const raw = await request.text();
    if (raw.length > 200_000) return json({error: 'Payload too large.'}, 413);
    if (!verifyStripeSignature(raw, request.headers.get('stripe-signature'), secret)) return json({error: 'Invalid signature.'}, 400);
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return json({error: 'Invalid JSON.'}, 400); }
    const event = stripePaidEvent(payload);
    if (!event) return json({ignored: 'event'});
    const result = await recordPaidPayment(event, 'stripe_webhook', {provider: 'stripe'});
    if (result.ignored) return json({ignored: result.ignored});
    if (result.duplicate && !result.recorded) return json({recorded: false, duplicate: true});
    return json(result);
  } catch (e) { return failure(e); }
}
