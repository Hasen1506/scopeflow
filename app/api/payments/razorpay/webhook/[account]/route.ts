import {json, failure, readText} from '@/lib/server';
import {paidEvent, verifyWebhookSignature} from '@/lib/razorpay';
import {razorpayFor} from '@/lib/payment-accounts-server';
import {eventIdOf, handleVerifiedEvent} from '@/lib/payment-record';
type Ctx = {params: Promise<{account: string}>};

// Webhook of ONE freelancer's own Razorpay account (BYO keys, or an OAuth account with its own
// secret): verified with that account's webhook secret, and only that account's orders match, so
// one freelancer's webhook can never mark another's order paid. Same inbox rules as the platform
// webhook (M21): stored first, 200 only once stored, 500 when recording fails.
export async function POST(request: Request, ctx: Ctx) {
  try {
    const {account} = await ctx.params;
    if (!/^pa_[a-f0-9]{20}$/.test(account)) return json({error: 'Unknown payment account.'}, 404);
    const dest = await razorpayFor(account);
    if (!dest?.account || !dest.webhookSecret) return json({error: 'Unknown payment account.'}, 404);
    const raw = await readText(request, 100_000); // H1: bounded read; over the limit → 413
    if (!verifyWebhookSignature(raw, request.headers.get('x-razorpay-signature'), dest.webhookSecret)) return json({error: 'Invalid signature.'}, 400);
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return json({error: 'Invalid JSON.'}, 400); }
    const eventId = await eventIdOf(request.headers.get('x-razorpay-event-id'), raw);
    const type = String((payload as {event?: unknown})?.event ?? '');
    return await handleVerifiedEvent({provider: 'razorpay', event_id: `${account}:${eventId}`, account_id: account, type, paid: paidEvent(payload, eventId)}, o => o.account_id === account);
  } catch (e) { return failure(e); }
}
