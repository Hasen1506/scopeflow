import {z} from 'zod';
import {db, json, body, safeOrigin, allowWrite, failure} from '@/lib/server';
import {RazorpayError, fetchPayment, verifyPaymentSignature} from '@/lib/razorpay';
import {razorpayFor} from '@/lib/payment-accounts-server';
import {PaymentRecordError, recordPaidPayment} from '@/lib/payment-record';
type Ctx = {params: Promise<{token: string}>};
const input = z.object({razorpay_order_id: z.string().regex(/^order_[A-Za-z0-9]{6,40}$/), razorpay_payment_id: z.string().regex(/^pay_[A-Za-z0-9]{6,40}$/), razorpay_signature: z.string().regex(/^[a-f0-9]{64}$/i)}).strict();

// H7: called by the Razorpay Checkout handler on the client page with what Checkout returns. The
// signature (HMAC of "order_id|payment_id" with the key secret of the account that created the
// order) proves the pair came from Razorpay; the payment is then looked up on that account to
// confirm it was captured for that order and for how much, and recorded at once (idempotent with
// the webhook, which then finds it recorded). The webhook and the reconcile job stay as the second
// and third lines of defence.
export async function POST(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const {token} = await ctx.params;
    if (!/^[a-f0-9]{64}$/.test(token)) return json({error: 'This review link was not found.'}, 404);
    const version = await db().prepare('SELECT id,project_id FROM versions WHERE token=? AND revoked=0').bind(token).first<{id: string; project_id: string}>();
    if (!version) return json({error: 'This review link was not found.'}, 404);
    if (!await allowWrite('verify:' + version.id, 20)) return json({error: 'Too many attempts. Try again in a minute.'}, 429);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const parsed = input.safeParse(raw);
    if (!parsed.success) return json({error: 'Provide razorpay_order_id, razorpay_payment_id and razorpay_signature.'}, 400);
    const {razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature} = parsed.data;
    const order = await db().prepare("SELECT account_id FROM payments WHERE provider='razorpay' AND order_id=? AND project_id=?").bind(orderId, version.project_id).first<{account_id: string | null}>();
    if (!order) return json({error: 'Payment not found.'}, 404);
    const dest = await razorpayFor(order.account_id);
    if (!dest?.signatureSecret) return json({error: 'This payment cannot be confirmed here; it appears once Razorpay confirms it.', code: 'pending', pending: true}, 202);
    if (!verifyPaymentSignature(orderId, paymentId, signature, dest.signatureSecret)) return json({error: 'The payment confirmation did not verify.', code: 'bad_signature'}, 400);
    let payment;
    try { payment = await fetchPayment(dest.credential, paymentId); }
    catch (e) { if (e instanceof RazorpayError) return json({pending: true, note: 'Razorpay could not be reached; the payment appears once it confirms it.'}, 202); throw e; }
    if (payment.order_id !== orderId) return json({error: 'The payment confirmation did not verify.', code: 'bad_signature'}, 400);
    if (!payment.paid) return json({pending: true, status: payment.status, note: 'The payment is not captured yet; it appears once Razorpay confirms it.'}, 202);
    try {
      const result = await recordPaidPayment(payment.paid, 'razorpay_checkout', {provider: 'razorpay', accept: o => o.account_id === order.account_id});
      return json(result);
    } catch (e) {
      if (e instanceof PaymentRecordError) return json({pending: true, note: 'The payment is confirmed; it appears on the record shortly.'}, 202);
      throw e;
    }
  } catch (e) { return failure(e); }
}
