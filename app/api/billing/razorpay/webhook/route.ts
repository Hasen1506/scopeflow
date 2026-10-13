import {createHash} from 'node:crypto';
import {json, failure, readText} from '@/lib/server';
import {applyPlanUpdate, razorpayEventToUpdate, razorpayWebhookSecret, verifyRazorpaySignature} from '@/lib/billing';
// M13: Razorpay Subscriptions webhook for ScopeFlow's own billing (not client payments; those use
// /api/payments/razorpay/webhook). Signature first, then each event is applied once.
export async function POST(request: Request) {
  try {
    const secret = razorpayWebhookSecret();
    if (!secret) return json({error: 'Billing webhook is not configured (RAZORPAY_BILLING_WEBHOOK_SECRET).', code: 'billing_disabled'}, 503);
    const raw = await readText(request, 100_000); // H1: bounded read; over the limit → 413
    if (!verifyRazorpaySignature(raw, request.headers.get('x-razorpay-signature'), secret)) return json({error: 'Invalid signature.'}, 400);
    let event: {event?: string}; try { event = JSON.parse(raw); } catch { return json({error: 'Invalid JSON.'}, 400); }
    const update = razorpayEventToUpdate(event);
    if (!update) return json({ignored: 'event'});
    const id = request.headers.get('x-razorpay-event-id')?.slice(0, 120) || 'sha256:' + createHash('sha256').update(raw).digest('hex');
    return json(await applyPlanUpdate('razorpay', id, String(event.event), update));
  } catch (e) { return failure(e); }
}
