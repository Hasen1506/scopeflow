import {createHmac, timingSafeEqual} from 'node:crypto';

// Stripe Checkout for clients paying in currencies Razorpay is not set up for (or on servers that
// use Stripe only). Off unless STRIPE_SECRET_KEY is set; the webhook needs STRIPE_WEBHOOK_SECRET.
// Same rules as Razorpay: only the verified webhook (or the reconciliation job asking Stripe)
// marks an order paid, the amount must match the stored order, and the payment is appended once
// to the signed ledger. STRIPE_API_URL replaces https://api.stripe.com (test doubles).
// Payouts to each freelancer (Stripe Connect) need a connected account per freelancer with its
// own KYC, so money goes to the account that owns these keys.

type Env = Record<string, string | undefined>;
export type StripeConfig = {secretKey: string};
export function stripeConfig(env: Env = process.env): StripeConfig | null {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  return secretKey && /^(sk|rk)_(test|live)_/.test(secretKey) ? {secretKey} : null;
}
export const stripeWebhookSecret = (env: Env = process.env) => env.STRIPE_WEBHOOK_SECRET?.trim() || null;
export const stripeApi = (env: Env = process.env) => (env.STRIPE_API_URL?.trim() || 'https://api.stripe.com').replace(/\/$/, '');
export class StripeError extends Error {}

/** application/x-www-form-urlencoded with Stripe's bracket syntax for nested objects. Pure. */
export function stripeForm(value: Record<string, unknown>, prefix = ''): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => parts.push(typeof item === 'object' ? stripeForm(item as Record<string, unknown>, `${key}[${i}]`) : `${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`));
    else if (typeof v === 'object') parts.push(stripeForm(v as Record<string, unknown>, key));
    else parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return parts.filter(Boolean).join('&');
}

async function call<T>(config: StripeConfig, method: 'GET' | 'POST', path: string, form: Record<string, unknown> | null, {fetchImpl = fetch, env = process.env, idempotencyKey}: {fetchImpl?: typeof fetch; env?: Env; idempotencyKey?: string} = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(stripeApi(env) + path, {method, headers: {Authorization: `Bearer ${config.secretKey}`, ...(form ? {'Content-Type': 'application/x-www-form-urlencoded'} : {}), ...(idempotencyKey ? {'Idempotency-Key': idempotencyKey} : {})}, body: form ? stripeForm(form) : undefined, signal: AbortSignal.timeout(15000)});
  } catch { throw new StripeError('Stripe could not be reached. Try again in a moment.'); }
  const data = await response.json().catch(() => ({})) as T & {error?: {message?: string}};
  if (!response.ok) throw new StripeError(`Stripe refused the request${data.error?.message ? `: ${String(data.error.message).slice(0, 200)}` : '.'}`);
  return data;
}

/** A hosted Checkout Session for one fixed amount. Returns its id and the URL to send the client to. */
export async function createCheckoutSession(config: StripeConfig, s: {amount_minor: number; currency: string; name: string; description: string; success_url: string; cancel_url: string; metadata: Record<string, string>; idempotencyKey?: string}, opts: {fetchImpl?: typeof fetch; env?: Env} = {}) {
  const data = await call<{id?: string; url?: string}>(config, 'POST', '/v1/checkout/sessions', {
    mode: 'payment', success_url: s.success_url, cancel_url: s.cancel_url, client_reference_id: s.metadata.project_id,
    line_items: [{quantity: 1, price_data: {currency: s.currency.toLowerCase(), unit_amount: s.amount_minor, product_data: {name: s.name.slice(0, 250), description: s.description.slice(0, 500)}}}],
    metadata: s.metadata, payment_intent_data: {metadata: s.metadata},
  }, {...opts, idempotencyKey: s.idempotencyKey});
  if (typeof data.id !== 'string' || typeof data.url !== 'string') throw new StripeError('Stripe returned no checkout session.');
  return {id: data.id, url: data.url};
}

/** Verifies a Stripe-Signature header (t=…,v1=…) over the raw body, within `toleranceSec`. */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, now = Date.now(), toleranceSec = 300) {
  if (!header) return false;
  const fields = header.split(',').map(p => p.trim().split('=') as [string, string]);
  const t = Number(fields.find(([k]) => k === 't')?.[1]);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex'));
  return fields.filter(([k]) => k === 'v1').some(([, v]) => { const got = Buffer.from(v ?? ''); return got.length === expected.length && timingSafeEqual(got, expected); });
}

export type StripePaid = {event_id: string | null; order_id: string; payment_id: string; amount_minor: number; currency: string};
type Session = {id?: unknown; payment_status?: unknown; payment_intent?: unknown; amount_total?: unknown; currency?: unknown};
const paidSession = (s: Session, eventId: string | null): StripePaid | null =>
  typeof s.id === 'string' && s.payment_status === 'paid' && typeof s.payment_intent === 'string' && Number.isInteger(s.amount_total) && typeof s.currency === 'string'
    ? {event_id: eventId, order_id: s.id, payment_id: s.payment_intent, amount_minor: s.amount_total as number, currency: s.currency.toUpperCase()} : null;

/** A paid Checkout Session from a webhook event (completed, or an async payment that succeeded), else null. */
export function stripePaidEvent(payload: unknown): StripePaid | null {
  const e = payload as {id?: unknown; type?: unknown; data?: {object?: Session}};
  if (!e || (e.type !== 'checkout.session.completed' && e.type !== 'checkout.session.async_payment_succeeded')) return null;
  return paidSession(e.data?.object ?? {}, typeof e.id === 'string' ? e.id : null);
}

/** Asks Stripe whether a Checkout Session was paid (the reconciliation job). */
export async function stripeSessionPaid(config: StripeConfig, sessionId: string, opts: {fetchImpl?: typeof fetch; env?: Env} = {}) {
  return paidSession(await call<Session>(config, 'GET', `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, null, opts), null);
}

/** Refunds part or all of a payment. Returns the Stripe refund id. */
export async function stripeRefund(config: StripeConfig, paymentIntent: string, amount_minor: number, idempotencyKey: string, opts: {fetchImpl?: typeof fetch; env?: Env} = {}) {
  const data = await call<{id?: string; status?: string}>(config, 'POST', '/v1/refunds', {payment_intent: paymentIntent, amount: amount_minor}, {...opts, idempotencyKey});
  if (typeof data.id !== 'string') throw new StripeError('Stripe returned no refund.');
  return {id: data.id, status: data.status ?? 'pending'};
}
