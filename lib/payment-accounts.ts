import {createCipheriv, createDecipheriv, hkdfSync, randomBytes} from 'node:crypto';

// Payment routing without custody (C3, SF-20; IMPLEMENTATION_PLAN §11). Pure: no database.
//
// Every online charge names a destination the FREELANCER owns, so client money settles to the
// freelancer and never to ScopeFlow (RBI PA Master Direction: a sole proprietorship cannot collect
// and pass on other people's money):
//   upi            the freelancer's UPI ID: QR / intent, paid bank to bank (INR only)
//   razorpay_oauth the freelancer's own Razorpay account connected through Razorpay's Technology
//                  Partner OAuth (orders are created with that account's access token)
//   razorpay_keys  interim: the freelancer's own Razorpay API keys, sealed at rest
//   stripe_keys    the freelancer's own Stripe account (secret or restricted key), mainly for
//                  export clients paying in other currencies
//   razorpay_route a Razorpay Route linked account (split settlement through ScopeFlow's own
//                  Razorpay account). Only when SCOPEFLOW_ROUTE_ENABLED=1, which needs ScopeFlow's
//                  turnover above Rs 40 lakh and Razorpay's payer-payee declaration.
// The operator's own keys (RAZORPAY_KEY_ID/SECRET, STRIPE_SECRET_KEY) are refused for client
// charges in production unless SCOPEFLOW_ALLOW_OPERATOR_COLLECTION=1 (test and dev only); they
// stay for ScopeFlow's own subscription billing and for refunds/lookups of payments they took.

type Env = Record<string, string | undefined>;
export const ACCOUNT_KINDS = ['upi', 'razorpay_keys', 'razorpay_oauth', 'razorpay_route', 'stripe_keys'] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];
export type AccountPublic = {
  vpa?: string; payee_name?: string;
  key_id?: string; mode?: 'test' | 'live';
  razorpay_account_id?: string; public_token?: string; token_expires?: string;
  linked_account_id?: string;
  key_hint?: string; currencies?: string[]; include_inr?: boolean;
  has_webhook_secret?: boolean;
};
export type AccountSecret = {key_secret?: string; access_token?: string; refresh_token?: string; secret_key?: string; webhook_secret?: string};
export type PaymentAccount = {id: string; owner: string; kind: AccountKind; status: 'active' | 'disconnected'; public: AccountPublic; created: string; updated: string};

export type OnlineVia = 'oauth' | 'keys' | 'route' | 'operator';
export type OnlineRoute = {provider: 'razorpay' | 'stripe'; via: OnlineVia; account_id: string | null};
export type RouteStatus = 'ready' | 'upi_only' | 'misconfigured' | 'operator_refused' | 'none';
export type PaymentRoute = {
  upi: {account_id: string; vpa: string; payee_name: string} | null;
  online: OnlineRoute | null;
  status: RouteStatus;
  /** Server-side problems an owner or operator should fix (never shown to clients). */
  warnings: string[];
};

const on = (v: string | undefined) => v?.trim() === '1' || v?.trim()?.toLowerCase() === 'true';
export const routeEnabled = (env: Env = process.env) => on(env.SCOPEFLOW_ROUTE_ENABLED);
/** Whether the operator's own keys may take a CLIENT's money (never in production unless explicitly allowed). */
export function operatorCollectionAllowed(env: Env = process.env) {
  return on(env.SCOPEFLOW_ALLOW_OPERATOR_COLLECTION) || env.NODE_ENV !== 'production';
}
export const operatorRazorpay = (env: Env = process.env) => !!(env.RAZORPAY_KEY_ID?.trim() && env.RAZORPAY_KEY_SECRET?.trim());
export const operatorStripe = (env: Env = process.env) => /^(sk|rk)_(test|live)_/.test(env.STRIPE_SECRET_KEY?.trim() ?? '');
const operatorStripeCurrencies = (env: Env) => (env.STRIPE_CURRENCIES ?? '').split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
/** Razorpay Technology Partner credentials (OAuth connect). */
export function partnerConfig(env: Env = process.env) {
  const clientId = env.RAZORPAY_PARTNER_CLIENT_ID?.trim(), clientSecret = env.RAZORPAY_PARTNER_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? {clientId, clientSecret, webhookSecret: env.RAZORPAY_PARTNER_WEBHOOK_SECRET?.trim() || null} : null;
}

/** Whether a Stripe BYO account takes `currency`: its list when set, else every currency except INR (unless include_inr). */
export function stripeTakes(a: Pick<PaymentAccount, 'public'>, currency: string) {
  const list = (a.public.currencies ?? []).map(c => c.toUpperCase());
  if (list.length) return list.includes(currency);
  return currency !== 'INR' || !!a.public.include_inr;
}

/**
 * Where a client payment in `currency` goes, given the owner's accounts. Pure. The order of
 * preference: the freelancer's own Razorpay (OAuth, then keys) for INR and their own Stripe for
 * other currencies, then the other own account, then Route (flag), then the operator's keys only
 * when operatorCollectionAllowed(). A Razorpay destination without a webhook secret is skipped as
 * misconfigured (H7): a payment it took could never be confirmed.
 */
export function chooseRoute(accounts: Pick<PaymentAccount, 'id' | 'kind' | 'status' | 'public'>[], currency: string, env: Env = process.env): PaymentRoute {
  const active = accounts.filter(a => a.status === 'active');
  const find = (k: AccountKind) => active.find(a => a.kind === k);
  const warnings: string[] = [];
  const upiAccount = find('upi');
  const upi = currency === 'INR' && upiAccount?.public.vpa ? {account_id: upiAccount.id, vpa: upiAccount.public.vpa, payee_name: upiAccount.public.payee_name ?? ''} : null;
  const partner = partnerConfig(env);
  const candidates: (() => OnlineRoute | null)[] = [];
  const oauth = () => {
    const a = find('razorpay_oauth');
    if (!a) return null;
    if (!partner) { warnings.push('Razorpay OAuth account connected but RAZORPAY_PARTNER_CLIENT_ID/SECRET are not set.'); return null; }
    if (!a.public.has_webhook_secret && !partner.webhookSecret) { warnings.push('Razorpay account connected without a webhook secret (RAZORPAY_PARTNER_WEBHOOK_SECRET): payments could not be confirmed.'); return null; }
    return {provider: 'razorpay' as const, via: 'oauth' as const, account_id: a.id};
  };
  const keys = () => {
    const a = find('razorpay_keys');
    if (!a) return null;
    if (!a.public.has_webhook_secret) { warnings.push('Razorpay keys connected without a webhook secret: payments could not be confirmed.'); return null; }
    return {provider: 'razorpay' as const, via: 'keys' as const, account_id: a.id};
  };
  const stripe = () => {
    const a = find('stripe_keys');
    if (!a || !stripeTakes(a, currency)) return null;
    if (!a.public.has_webhook_secret) { warnings.push('Stripe account connected without a webhook signing secret: payments could not be confirmed.'); return null; }
    return {provider: 'stripe' as const, via: 'keys' as const, account_id: a.id};
  };
  const route = () => {
    if (currency !== 'INR' || !routeEnabled(env)) return null;
    const a = find('razorpay_route');
    if (!a?.public.linked_account_id) return null;
    if (!operatorRazorpay(env) || !env.RAZORPAY_WEBHOOK_SECRET?.trim()) { warnings.push('Route is on but ScopeFlow’s Razorpay keys or webhook secret are missing.'); return null; }
    return {provider: 'razorpay' as const, via: 'route' as const, account_id: a.id};
  };
  if (currency === 'INR') candidates.push(oauth, keys, stripe, route); else candidates.push(stripe, oauth, keys);
  for (const c of candidates) { const r = c(); if (r) return {upi, online: r, status: 'ready', warnings}; }
  // An own account that exists but cannot confirm payments is the owner's to fix (H7): misconfigured.
  const ownProblem = warnings.length > 0;
  // The operator's own keys: never for client money in production (C3).
  const opProvider = currency === 'INR'
    ? (operatorRazorpay(env) ? 'razorpay' : operatorStripe(env) && (!operatorStripeCurrencies(env).length || operatorStripeCurrencies(env).includes(currency)) ? 'stripe' : null)
    : (operatorStripe(env) && (!operatorStripeCurrencies(env).length || operatorStripeCurrencies(env).includes(currency)) ? 'stripe' : operatorRazorpay(env) ? 'razorpay' : null);
  if (opProvider) {
    if (!operatorCollectionAllowed(env)) {
      warnings.push('The operator’s own payment keys are refused for client payments in production (set up the freelancer’s own account).');
      return {upi, online: null, status: upi ? 'upi_only' : ownProblem ? 'misconfigured' : 'operator_refused', warnings};
    }
    const hook = opProvider === 'razorpay' ? env.RAZORPAY_WEBHOOK_SECRET?.trim() : env.STRIPE_WEBHOOK_SECRET?.trim();
    if (opProvider === 'razorpay' && !hook) {
      warnings.push('RAZORPAY_KEY_ID/SECRET are set but RAZORPAY_WEBHOOK_SECRET is not: payments could not be confirmed.');
      return {upi, online: null, status: upi ? 'upi_only' : 'misconfigured', warnings};
    }
    return {upi, online: {provider: opProvider, via: 'operator', account_id: null}, status: 'ready', warnings};
  }
  return {upi, online: null, status: upi ? 'upi_only' : warnings.length ? 'misconfigured' : 'none', warnings};
}

// ---------------------------------------------------------------------------
// Sealing secrets at rest (AES-256-GCM). SCOPEFLOW_ENCRYPTION_KEY is 32 bytes, base64. On a local
// server (APP_URL on localhost) a key is derived from SCOPEFLOW_SIGNING_SECRET so tests and dev
// work without one; anywhere else a missing key refuses to store secrets.
// ---------------------------------------------------------------------------

export class EncryptionUnavailable extends Error {}
const LOCAL = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/?$/;
export function encryptionKey(env: Env = process.env): Buffer {
  const raw = env.SCOPEFLOW_ENCRYPTION_KEY?.trim();
  if (raw) {
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new EncryptionUnavailable('SCOPEFLOW_ENCRYPTION_KEY must be 32 bytes, base64.');
    return key;
  }
  if (LOCAL.test(env.APP_URL?.trim() ?? '')) return Buffer.from(hkdfSync('sha256', env.SCOPEFLOW_SIGNING_SECRET || 'scopeflow-local-only', 'scopeflow', 'payment-accounts-v1', 32));
  throw new EncryptionUnavailable('Set SCOPEFLOW_ENCRYPTION_KEY to store payment account secrets.');
}
export function sealSecret(value: AccountSecret, env: Env = process.env): string {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(env), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return 'v1.' + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url');
}
export function openSecret(sealed: string | null | undefined, env: Env = process.env): AccountSecret {
  if (!sealed) return {};
  if (!sealed.startsWith('v1.')) throw new EncryptionUnavailable('Unknown secret format.');
  const raw = Buffer.from(sealed.slice(3), 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(env), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')) as AccountSecret;
}

/** Key formats accepted for BYO accounts (checked before any provider call). */
export const RAZORPAY_KEY_ID = /^rzp_(test|live)_[A-Za-z0-9]{6,40}$/;
export const STRIPE_KEY = /^(sk|rk)_(test|live)_[A-Za-z0-9_]{6,200}$/;
export const STRIPE_WEBHOOK = /^whsec_[A-Za-z0-9_]{6,200}$/;
export const ROUTE_ACCOUNT = /^acc_[A-Za-z0-9]{6,40}$/;
/** Shows a key as prefix…last four. */
export const keyHint = (key: string) => key.length > 12 ? `${key.slice(0, key.indexOf('_', 3) + 1)}…${key.slice(-4)}` : '…';
