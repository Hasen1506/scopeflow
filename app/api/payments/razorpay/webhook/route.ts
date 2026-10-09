import {json, failure} from '@/lib/server';
import {paidEvent, verifyWebhookSignature, webhookSecret} from '@/lib/razorpay';
import {recordPaidPayment} from '@/lib/payment-record';

// PR F: Razorpay webhook (payment.captured / order.paid). The signature over the raw body is
// verified first; the order and amount must match a stored order; the payment is recorded once
// (row update is conditional) and appended to the project's hash-chained, signed ledger.
// Unknown or irrelevant events get 200 so Razorpay does not retry them forever.
export async function POST(request: Request) {
  try {
    const secret = webhookSecret();
    if (!secret) return json({error: 'Payments webhook is not configured (RAZORPAY_WEBHOOK_SECRET).', code: 'payments_disabled'}, 503);
    const raw = await request.text();
    if (raw.length > 100_000) return json({error: 'Payload too large.'}, 413);
    if (!verifyWebhookSignature(raw, request.headers.get('x-razorpay-signature'), secret)) return json({error: 'Invalid signature.'}, 400);
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return json({error: 'Invalid JSON.'}, 400); }
    const event = paidEvent(payload, request.headers.get('x-razorpay-event-id'));
    if (!event) return json({ignored: 'event'});
    const result = await recordPaidPayment(event, 'razorpay_webhook');
    if (result.ignored) return json({ignored: result.ignored});
    if (result.duplicate && !result.recorded) return json({recorded: false, duplicate: true});
    return json(result);
  } catch (e) { return failure(e); }
}
