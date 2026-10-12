import {json, failure} from '@/lib/server';
import {stripePaidEvent, verifyStripeSignature} from '@/lib/stripe';
import {stripeFor} from '@/lib/payment-accounts-server';
import {eventIdOf, handleVerifiedEvent} from '@/lib/payment-record';
type Ctx = {params: Promise<{account: string}>};

// Webhook of ONE freelancer's own Stripe account, verified with that account's signing secret; only
// that account's sessions match. Inbox rules as the platform webhook (M21).
export async function POST(request: Request, ctx: Ctx) {
  try {
    const {account} = await ctx.params;
    if (!/^pa_[a-f0-9]{20}$/.test(account)) return json({error: 'Unknown payment account.'}, 404);
    const dest = await stripeFor(account);
    if (!dest?.account || !dest.webhookSecret) return json({error: 'Unknown payment account.'}, 404);
    const raw = await request.text();
    if (raw.length > 200_000) return json({error: 'Payload too large.'}, 413);
    if (!verifyStripeSignature(raw, request.headers.get('stripe-signature'), dest.webhookSecret)) return json({error: 'Invalid signature.'}, 400);
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return json({error: 'Invalid JSON.'}, 400); }
    const p = payload as {id?: unknown; type?: unknown};
    const eventId = await eventIdOf(typeof p.id === 'string' ? p.id : null, raw);
    return await handleVerifiedEvent({provider: 'stripe', event_id: `${account}:${eventId}`, account_id: account, type: String(p.type ?? ''), paid: stripePaidEvent(payload)}, o => o.account_id === account);
  } catch (e) { return failure(e); }
}
