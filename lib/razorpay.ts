import {createHmac, timingSafeEqual} from 'node:crypto';
import {totals} from './money';

// PR F: deposit on signature through Razorpay (scaffold).
//
// Off unless RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are set (orders + Checkout); webhooks need
// RAZORPAY_WEBHOOK_SECRET. The webhook is the only thing that marks a deposit paid: its
// X-Razorpay-Signature (HMAC-SHA256 of the raw body) is verified in constant time, the order and
// amount must match a stored order, and the payment is appended once to the hash-chained ledger.

type Env = Record<string, string | undefined>;
export type RazorpayConfig = {keyId: string; keySecret: string};

export function razorpayConfig(env: Env = process.env): RazorpayConfig | null {
  const keyId = env.RAZORPAY_KEY_ID?.trim(), keySecret = env.RAZORPAY_KEY_SECRET?.trim();
  return keyId && keySecret ? {keyId, keySecret} : null;
}
export function webhookSecret(env: Env = process.env) { return env.RAZORPAY_WEBHOOK_SECRET?.trim() || null; }
export function paymentsStatus(env: Env = process.env) {
  if (razorpayConfig(env)) return {enabled: true as const, provider: 'razorpay' as const, webhook: !!webhookSecret(env)};
  return {enabled: false as const, provider: null, webhook: !!webhookSecret(env), reason: 'Online payments are not set up on this server (RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are not set).'};
}

/** Amount in the currency's smallest unit (paise for INR, none for JPY), as Razorpay expects. */
export function toMinorUnits(amount: number, currency: string) {
  const digits = new Intl.NumberFormat('en', {style: 'currency', currency}).resolvedOptions().maximumFractionDigits ?? 2;
  return Math.round(amount * 10 ** digits);
}
export function fromMinorUnits(minor: number, currency: string) {
  const digits = new Intl.NumberFormat('en', {style: 'currency', currency}).resolvedOptions().maximumFractionDigits ?? 2;
  return minor / 10 ** digits;
}

/**
 * Deposit due on signature: deposit_pct of the approved fee (plus tax when the scope carries one).
 * One source of truth: the same `totals()` figure the signed scope paper shows the client, so the
 * amount charged is exactly the amount approved (the two used to differ by a cent on some fees).
 */
export function depositAmount(content: {fee: number; deposit_pct?: number; tax_pct?: number}) {
  if (!((content.deposit_pct ?? 0) > 0)) return 0;
  return totals(content).deposit;
}

export class RazorpayError extends Error {}

/** Creates a Razorpay order (POST /v1/orders, basic auth). `fetchImpl` is injectable for tests. */
export async function createOrder(config: RazorpayConfig, order: {amount_minor: number; currency: string; receipt: string; notes: Record<string, string>}, fetchImpl: typeof fetch = fetch) {
  let response: Response;
  try {
    response = await fetchImpl('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {Authorization: 'Basic ' + Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64'), 'Content-Type': 'application/json'},
      body: JSON.stringify({amount: order.amount_minor, currency: order.currency, receipt: order.receipt.slice(0, 40), notes: order.notes}),
      signal: AbortSignal.timeout(10000),
    });
  } catch { throw new RazorpayError('Razorpay could not be reached.'); }
  const data = await response.json().catch(() => ({})) as {id?: string; amount?: number; currency?: string; status?: string; error?: {description?: string}};
  if (!response.ok || typeof data.id !== 'string') throw new RazorpayError(`Razorpay refused the order${data.error?.description ? ': ' + String(data.error.description).slice(0, 200) : '.'}`);
  return {id: data.id, amount: Number(data.amount), currency: String(data.currency), status: String(data.status)};
}

const hmacHex = (secret: string, message: string) => createHmac('sha256', secret).update(message).digest('hex');
function safeEqualHex(a: string, b: string) {
  if (!/^[0-9a-f]+$/i.test(a) || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a.toLowerCase(), 'hex'), Buffer.from(b.toLowerCase(), 'hex'));
}
/** X-Razorpay-Signature check for webhooks: HMAC-SHA256(raw body, webhook secret), hex. */
export function verifyWebhookSignature(rawBody: string, signature: string | null, secret: string) {
  return !!signature && safeEqualHex(signature.trim(), hmacHex(secret, rawBody));
}
/** Checkout handler check: HMAC-SHA256("order_id|payment_id", key secret), hex. */
export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string, keySecret: string) {
  return safeEqualHex(signature, hmacHex(keySecret, `${orderId}|${paymentId}`));
}

export type PaidEvent = {event_id: string | null; order_id: string; payment_id: string; amount_minor: number; currency: string};
/** The paid payment in a payment.captured / order.paid webhook, or null for anything else. */
export function paidEvent(payload: unknown, eventId: string | null): PaidEvent | null {
  const p = payload as {event?: string; payload?: {payment?: {entity?: Record<string, unknown>}}};
  if (!p || (p.event !== 'payment.captured' && p.event !== 'order.paid')) return null;
  const e = p.payload?.payment?.entity;
  if (!e || typeof e.order_id !== 'string' || typeof e.id !== 'string' || typeof e.amount !== 'number' || typeof e.currency !== 'string') return null;
  if (e.status !== undefined && e.status !== 'captured') return null;
  return {event_id: eventId, order_id: e.order_id, payment_id: e.id, amount_minor: e.amount, currency: e.currency};
}
