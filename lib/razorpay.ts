import {createHmac, timingSafeEqual} from 'node:crypto';
import {totals} from './money';
import {fromMinor, toMinor} from './minor';
import {chooseRoute, type PaymentRoute} from './payment-accounts';

// Razorpay for client payments, always into the FREELANCER's own Razorpay account (C3):
//  - connected through Razorpay's Technology Partner OAuth: orders, lookups and refunds use that
//    account's access token (Bearer), Checkout uses its public token; or
//  - interim: the freelancer's own API key pair (Basic), sealed at rest (lib/payment-accounts.ts);
//  - Route (flag): ScopeFlow's own keys with a transfer to the freelancer's linked account.
// The operator's RAZORPAY_KEY_ID/SECRET never take a client payment in production
// (lib/payment-accounts.ts operatorCollectionAllowed); they remain for ScopeFlow's own billing and
// for lookups/refunds of payments they took before this change.
// Only a verified webhook, the Checkout handler signature (verify route) or the reconciliation job
// marks a payment paid, and each payment is appended once to the hash-chained ledger.

type Env = Record<string, string | undefined>;
/** Basic auth with an API key pair (the freelancer's own, or the operator's). */
export type RazorpayConfig = {keyId: string; keySecret: string};
/** Bearer auth with a connected account's OAuth access token; `keyId` is its public token for Checkout. */
export type RazorpayOAuthConfig = {accessToken: string; keyId: string};
export type RazorpayCredential = RazorpayConfig | RazorpayOAuthConfig;

/** The operator's own key pair (ScopeFlow's merchant account), or null. */
export function razorpayConfig(env: Env = process.env): RazorpayConfig | null {
  const keyId = env.RAZORPAY_KEY_ID?.trim(), keySecret = env.RAZORPAY_KEY_SECRET?.trim();
  return keyId && keySecret ? {keyId, keySecret} : null;
}
export function webhookSecret(env: Env = process.env) { return env.RAZORPAY_WEBHOOK_SECRET?.trim() || null; }
// `reason` is shown to clients, so it names no server settings; `setup` is for whoever runs the server.
export type OnlineProvider = 'razorpay' | 'stripe';
/**
 * Which provider the operator's own keys would use for `currency` (no freelancer accounts), or
 * null when none may: in production the operator's keys never take client money (C3), and a
 * Razorpay key pair without RAZORPAY_WEBHOOK_SECRET is misconfigured (H7). Pure.
 */
export function providerFor(currency: string | undefined, env: Env = process.env): OnlineProvider | null {
  return chooseRoute([], currency ?? '', env).online?.provider ?? null;
}
const REASON = 'Online payment is not available for this scope.';
const SETUP = 'Connect the freelancer’s own UPI ID, Razorpay or Stripe account (Payments settings). Operator keys (RAZORPAY_KEY_ID/STRIPE_SECRET_KEY) are not used for client payments in production.';
/** What a payment route means for the client page. */
export function routeStatus(route: PaymentRoute) {
  const webhook = !!route.online;
  if (route.online) return {enabled: true as const, provider: route.online.provider, via: route.online.via, webhook, status: route.status};
  return {enabled: false as const, provider: null, via: null, webhook, status: route.status, reason: REASON, setup: SETUP, ...(route.warnings.length ? {warnings: route.warnings} : {})};
}
/** Operator-level status (no freelancer accounts): used where the owner is not known. */
export function paymentsStatus(env: Env = process.env, currency?: string) {
  return routeStatus(chooseRoute([], currency ?? '', env));
}

/** Amount in the currency's smallest unit (paise for INR, none for JPY), as Razorpay expects. */
// M4 (WS-01): the exponent comes from lib/minor.ts (ISO 4217 table: JPY 0, IDR/PKR 2), never Intl.
export function toMinorUnits(amount: number, currency: string) { return toMinor(amount, currency); }
export function fromMinorUnits(minor: number, currency: string) { return fromMinor(minor, currency); }

/**
 * Deposit due on signature: deposit_pct of the approved fee (plus tax when the scope carries one).
 * One source of truth: the same `totals()` figure the signed scope paper shows the client.
 */
export function depositAmount(content: {fee: number; deposit_pct?: number; tax_pct?: number}) {
  if (!((content.deposit_pct ?? 0) > 0)) return 0;
  return totals(content).deposit;
}

export class RazorpayError extends Error {
  /** HTTP status Razorpay answered with (0 when it could not be reached). */
  readonly status: number;
  constructor(message: string, status = 0) { super(message); this.status = status; }
}
/** Razorpay's API origin; RAZORPAY_API_URL overrides it (a test double or a proxy). */
export const razorpayApi = (env: Env = process.env) => (env.RAZORPAY_API_URL?.trim() || 'https://api.razorpay.com').replace(/\/$/, '');
/** Razorpay's OAuth origin; RAZORPAY_OAUTH_URL overrides it (a test double). */
export const razorpayOAuthApi = (env: Env = process.env) => (env.RAZORPAY_OAUTH_URL?.trim() || 'https://auth.razorpay.com').replace(/\/$/, '');
export const checkoutKey = (c: RazorpayCredential) => c.keyId;
function authHeader(c: RazorpayCredential) {
  return 'keySecret' in c ? 'Basic ' + Buffer.from(`${c.keyId}:${c.keySecret}`).toString('base64') : 'Bearer ' + c.accessToken;
}
type CallOptions = {fetchImpl?: typeof fetch; env?: Env; idempotencyKey?: string; timeoutMs?: number};
async function call<T>(c: RazorpayCredential, method: 'GET' | 'POST', path: string, body: unknown, what: string, {fetchImpl = fetch, env = process.env, idempotencyKey, timeoutMs = 10000}: CallOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(razorpayApi(env) + path, {method, headers: {Authorization: authHeader(c), ...(body !== undefined ? {'Content-Type': 'application/json'} : {}), ...(idempotencyKey ? {'X-Razorpay-Idempotency': idempotencyKey} : {})}, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs)});
  } catch { throw new RazorpayError('Razorpay could not be reached.'); }
  const data = await response.json().catch(() => ({})) as T & {error?: {description?: string}};
  if (!response.ok) throw new RazorpayError(`Razorpay refused the ${what}${data.error?.description ? ': ' + String(data.error.description).slice(0, 200) : '.'}`, response.status);
  return data;
}

/** A Route transfer to a linked account, held until released on a milestone (on_hold). */
export type RouteTransfer = {account: string; amount: number; currency: string; on_hold?: boolean; notes?: Record<string, string>};
/** Creates a Razorpay order (POST /v1/orders). `fetchImpl` is injectable for tests. */
export async function createOrder(config: RazorpayCredential, order: {amount_minor: number; currency: string; receipt: string; notes: Record<string, string>; transfers?: RouteTransfer[]}, fetchImpl: typeof fetch = fetch, env: Env = process.env) {
  const data = await call<{id?: string; amount?: number; currency?: string; status?: string}>(config, 'POST', '/v1/orders',
    {amount: order.amount_minor, currency: order.currency, receipt: order.receipt.slice(0, 40), notes: order.notes, ...(order.transfers?.length ? {transfers: order.transfers.map(t => ({...t, on_hold: t.on_hold ? 1 : 0}))} : {})}, 'order', {fetchImpl, env});
  if (typeof data.id !== 'string') throw new RazorpayError('Razorpay returned no order.');
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
  return typeof signature === 'string' && safeEqualHex(signature, hmacHex(keySecret, `${orderId}|${paymentId}`));
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
/** The connected (sub-merchant) account a partner webhook is about, when Razorpay names it. */
export function webhookAccountId(payload: unknown): string | null {
  const id = (payload as {account_id?: unknown} | null)?.account_id;
  return typeof id === 'string' && /^acc_[A-Za-z0-9]+$/.test(id) ? id : null;
}

type PaymentEntity = Record<string, unknown>;
const asPaid = (orderId: string, p: PaymentEntity | undefined): PaidEvent | null =>
  p && p.status === 'captured' && p.order_id === orderId && typeof p.id === 'string' && typeof p.amount === 'number' && typeof p.currency === 'string'
    ? {event_id: null, order_id: orderId, payment_id: p.id, amount_minor: p.amount, currency: p.currency} : null;

/** The captured payment of an order (GET /v1/orders/:id/payments), or null when none is captured. For reconciliation. */
export async function capturedPayment(config: RazorpayCredential, orderId: string, fetchImpl: typeof fetch = fetch, env: Env = process.env): Promise<PaidEvent | null> {
  const data = await call<{items?: PaymentEntity[]}>(config, 'GET', `/v1/orders/${encodeURIComponent(orderId)}/payments`, undefined, 'lookup', {fetchImpl, env});
  if (!Array.isArray(data.items)) throw new RazorpayError('Razorpay refused the lookup.');
  for (const i of data.items) { const paid = asPaid(orderId, i); if (paid) return paid; }
  return null;
}
/** One payment (GET /v1/payments/:id): the Checkout verify route confirms it was captured for its order. */
export async function fetchPayment(config: RazorpayCredential, paymentId: string, fetchImpl: typeof fetch = fetch, env: Env = process.env) {
  const p = await call<PaymentEntity>(config, 'GET', `/v1/payments/${encodeURIComponent(paymentId)}`, undefined, 'lookup', {fetchImpl, env});
  return {status: String(p.status ?? ''), order_id: typeof p.order_id === 'string' ? p.order_id : null, paid: typeof p.order_id === 'string' ? asPaid(p.order_id, p) : null};
}

/**
 * Refunds part or all of a captured payment (POST /v1/payments/:id/refund) with an idempotency key,
 * so a retried request (or a crash and a reconcile) never refunds twice (H9). Returns the refund id.
 */
export async function razorpayRefund(config: RazorpayCredential, paymentId: string, amount_minor: number, receipt: string, fetchImpl: typeof fetch = fetch, env: Env = process.env, idempotencyKey?: string) {
  const data = await call<{id?: string; status?: string}>(config, 'POST', `/v1/payments/${encodeURIComponent(paymentId)}/refund`, {amount: amount_minor, receipt: receipt.slice(0, 40), ...(idempotencyKey ? {notes: {scopeflow_request: idempotencyKey.slice(0, 250)}} : {})}, 'refund', {fetchImpl, env, idempotencyKey, timeoutMs: 15000});
  if (typeof data.id !== 'string') throw new RazorpayError('Razorpay returned no refund.');
  return {id: data.id, status: data.status ?? 'pending'};
}
/** The refunds of a payment (reconcile looks for one carrying our request key). */
export async function razorpayRefunds(config: RazorpayCredential, paymentId: string, fetchImpl: typeof fetch = fetch, env: Env = process.env) {
  const data = await call<{items?: {id?: unknown; amount?: unknown; receipt?: unknown; notes?: {scopeflow_request?: unknown}}[]}>(config, 'GET', `/v1/payments/${encodeURIComponent(paymentId)}/refunds`, undefined, 'lookup', {fetchImpl, env});
  return (data.items ?? []).filter(i => typeof i.id === 'string').map(i => ({id: i.id as string, amount: Number(i.amount), receipt: typeof i.receipt === 'string' ? i.receipt : '', request: typeof i.notes?.scopeflow_request === 'string' ? i.notes.scopeflow_request : null}));
}
/** Settlements to the connected account's bank (read-only view, newest first). */
export async function razorpaySettlements(config: RazorpayCredential, fetchImpl: typeof fetch = fetch, env: Env = process.env) {
  const data = await call<{items?: Record<string, unknown>[]}>(config, 'GET', '/v1/settlements?count=20', undefined, 'lookup', {fetchImpl, env});
  return (data.items ?? []).map(s => ({id: String(s.id ?? ''), amount_minor: Number(s.amount) || 0, fees_minor: Number(s.fees) || 0, tax_minor: Number(s.tax) || 0, status: String(s.status ?? ''), utr: typeof s.utr === 'string' ? s.utr : null, created_at: typeof s.created_at === 'number' ? new Date(s.created_at * 1000).toISOString() : null}));
}
/** Checks a key pair works (GET /v1/orders?count=1) before it is stored. */
export async function checkRazorpayKeys(config: RazorpayConfig, fetchImpl: typeof fetch = fetch, env: Env = process.env) {
  await call(config, 'GET', '/v1/orders?count=1', undefined, 'keys', {fetchImpl, env});
}

// ---- Technology Partner OAuth (SF-20) --------------------------------------------------------------
export type PartnerConfig = {clientId: string; clientSecret: string};
export type OAuthTokens = {access_token: string; refresh_token: string | null; public_token: string; razorpay_account_id: string; expires_at: string; mode: 'test' | 'live'};
/** Where the owner is sent to approve ScopeFlow on their own Razorpay account. */
export function authorizeUrl(p: PartnerConfig, redirectUri: string, state: string, env: Env = process.env) {
  const q = new URLSearchParams({response_type: 'code', client_id: p.clientId, redirect_uri: redirectUri, scope: 'read_write', state});
  return `${razorpayOAuthApi(env)}/authorize?${q}`;
}
async function tokenCall(p: PartnerConfig, body: Record<string, string>, fetchImpl: typeof fetch, env: Env, now: number): Promise<OAuthTokens> {
  let response: Response;
  try {
    response = await fetchImpl(`${razorpayOAuthApi(env)}/token`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({client_id: p.clientId, client_secret: p.clientSecret, ...body}), signal: AbortSignal.timeout(10000)});
  } catch { throw new RazorpayError('Razorpay could not be reached.'); }
  const d = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof d.access_token !== 'string' || typeof d.public_token !== 'string' || typeof d.razorpay_account_id !== 'string') throw new RazorpayError(`Razorpay refused the connection${typeof d.error_description === 'string' ? ': ' + d.error_description.slice(0, 200) : '.'}`, response.status);
  const expires = Number(d.expires_in) > 0 ? Number(d.expires_in) : 90 * 86400;
  return {access_token: d.access_token, refresh_token: typeof d.refresh_token === 'string' ? d.refresh_token : null, public_token: d.public_token, razorpay_account_id: d.razorpay_account_id, expires_at: new Date(now + expires * 1000).toISOString(), mode: /_live_/.test(d.public_token) ? 'live' : 'test'};
}
/** Exchanges the authorization code for the connected account's tokens. */
export function exchangeCode(p: PartnerConfig, code: string, redirectUri: string, fetchImpl: typeof fetch = fetch, env: Env = process.env, now = Date.now()) {
  return tokenCall(p, {grant_type: 'authorization_code', code, redirect_uri: redirectUri, mode: env.RAZORPAY_PARTNER_MODE === 'live' ? 'live' : 'test'}, fetchImpl, env, now);
}
/** A new access token from the refresh token (access tokens expire). */
export function refreshAccessToken(p: PartnerConfig, refreshToken: string, fetchImpl: typeof fetch = fetch, env: Env = process.env, now = Date.now()) {
  return tokenCall(p, {grant_type: 'refresh_token', refresh_token: refreshToken}, fetchImpl, env, now);
}
/** Revokes an access token when the owner disconnects (best effort). */
export async function revokeToken(p: PartnerConfig, token: string, fetchImpl: typeof fetch = fetch, env: Env = process.env) {
  try { await fetchImpl(`${razorpayOAuthApi(env)}/revoke`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({client_id: p.clientId, client_secret: p.clientSecret, token, token_type_hint: 'access_token'}), signal: AbortSignal.timeout(10000)}); } catch { /* best effort */ }
}
