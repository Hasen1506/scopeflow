import {json, failure, readText} from '@/lib/server';
import {applyPlanUpdate, stripeBilling, stripeEventToUpdate, verifyStripeSignature} from '@/lib/billing';
// M13: Stripe Billing webhook (non-INR subscriptions) for ScopeFlow's own billing.
export async function POST(request: Request) {
  try {
    const secret = stripeBilling()?.webhookSecret ?? null;
    if (!secret) return json({error: 'Billing webhook is not configured (STRIPE_BILLING_WEBHOOK_SECRET).', code: 'billing_disabled'}, 503);
    const raw = await readText(request, 200_000); // H1: bounded read; over the limit → 413
    if (!verifyStripeSignature(raw, request.headers.get('stripe-signature'), secret)) return json({error: 'Invalid signature.'}, 400);
    let event: {id?: string; type?: string}; try { event = JSON.parse(raw); } catch { return json({error: 'Invalid JSON.'}, 400); }
    const update = stripeEventToUpdate(event);
    if (!update || typeof event.id !== 'string') return json({ignored: 'event'});
    return json(await applyPlanUpdate('stripe', event.id.slice(0, 120), String(event.type), update));
  } catch (e) { return failure(e); }
}
