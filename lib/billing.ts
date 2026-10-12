import {createHash, createHmac, randomUUID, timingSafeEqual} from 'node:crypto';
import {GRACE_DAYS, PLANS, isPlanId, resolvePlan, type Limits, type PlanId, type PlanRow, type PlanState} from './plans';
import {checkGstin} from './gstin';

// ScopeFlow's own subscription billing (M13/SF-12, WS-08). ScopeFlow sells its own service, so
// the operator's billing keys are legitimate here (unlike client payments, C3/WS-04):
//  * INR: Razorpay Subscriptions on ScopeFlow's account (RAZORPAY_BILLING_KEY_ID/_SECRET, a plan
//    id per plan and interval in RAZORPAY_BILLING_PLAN_<PLAN>_<MONTH|YEAR>, webhook secret
//    RAZORPAY_BILLING_WEBHOOK_SECRET). Webhooks subscription.activated / charged / halted /
//    cancelled / completed move the account's plan; charged issues ScopeFlow's GST invoice.
//  * Other currencies: Stripe Billing (STRIPE_BILLING_SECRET_KEY, STRIPE_BILLING_PRICE_<PLAN>_<MONTH|YEAR>,
//    STRIPE_BILLING_WEBHOOK_SECRET).
//  * Local double: on a localhost APP_URL outside Render with neither provider configured, a
//    test checkout (/plans/checkout) stands in for Razorpay and replays Razorpay-shaped events
//    through the same handler, signed with a secret derived from the signing secret. No money
//    moves, and it can never run in production (APP_URL is the public host there).
// Entitlements: limitsFor(owner) / planStateFor(owner) read accounts_plans through resolvePlan().

type Env = Record<string, string | undefined>;
export type Interval = 'month' | 'year';
export type BillingProvider = 'razorpay' | 'stripe';

const str = (v: string | undefined) => v?.trim() || null;
export function razorpayBilling(env: Env = process.env) {
  const keyId = str(env.RAZORPAY_BILLING_KEY_ID), keySecret = str(env.RAZORPAY_BILLING_KEY_SECRET);
  if (!keyId || !keySecret) return null;
  return {keyId, keySecret, webhookSecret: str(env.RAZORPAY_BILLING_WEBHOOK_SECRET), api: (str(env.RAZORPAY_BILLING_API_URL) ?? 'https://api.razorpay.com').replace(/\/$/, ''),
    planId: (plan: PlanId, interval: Interval) => str(env[`RAZORPAY_BILLING_PLAN_${plan.toUpperCase()}_${interval.toUpperCase()}`])};
}
export function stripeBilling(env: Env = process.env) {
  const key = str(env.STRIPE_BILLING_SECRET_KEY);
  if (!key) return null;
  return {key, webhookSecret: str(env.STRIPE_BILLING_WEBHOOK_SECRET), api: (str(env.STRIPE_BILLING_API_URL) ?? 'https://api.stripe.com').replace(/\/$/, ''),
    priceId: (plan: PlanId, interval: Interval) => str(env[`STRIPE_BILLING_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`])};
}
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
/** The local test checkout: localhost APP_URL, not on Render, no billing provider configured. */
export function localDouble(env: Env = process.env) {
  if (razorpayBilling(env) || stripeBilling(env) || env.RENDER) return false;
  try { return LOCAL_HOSTS.has(new URL(env.APP_URL ?? '').hostname); } catch { return false; }
}
/** Webhook secret of the local double, derived from the record-signing (or cookie) secret. */
export function localWebhookSecret(env: Env = process.env) {
  const base = str(env.SCOPEFLOW_SIGNING_SECRET) ?? str(env.NEON_AUTH_COOKIE_SECRET);
  return base ? createHmac('sha256', base).update('scopeflow-billing-local-double-v1').digest('hex') : null;
}
export function razorpayWebhookSecret(env: Env = process.env) {
  return razorpayBilling(env)?.webhookSecret ?? (localDouble(env) ? localWebhookSecret(env) : null);
}
/** What /plans can offer: which provider takes which currency, or why billing is off. */
export function billingStatus(env: Env = process.env) {
  const r = razorpayBilling(env), s = stripeBilling(env), local = localDouble(env);
  return {enabled: !!(r || s || local), local_double: local, razorpay: !!r || local, stripe: !!s,
    reason: r || s || local ? null : 'Paid plans are not on sale on this server yet. Set RAZORPAY_BILLING_KEY_ID and RAZORPAY_BILLING_KEY_SECRET (or STRIPE_BILLING_SECRET_KEY).'};
}
/** INR goes through Razorpay, every other currency through Stripe. Null when that provider is off. */
export function providerFor(currency: string, env: Env = process.env): BillingProvider | null {
  if (localDouble(env)) return 'razorpay';
  if (currency === 'INR') return razorpayBilling(env) ? 'razorpay' : null;
  return stripeBilling(env) ? 'stripe' : null;
}

// ---- Signatures -----------------------------------------------------------------------------
const safeEqualHex = (a: string, b: string) => { const x = Buffer.from(a, 'utf8'), y = Buffer.from(b, 'utf8'); return x.length === y.length && timingSafeEqual(x, y); };
/** Razorpay: X-Razorpay-Signature = hex HMAC-SHA256 of the raw body with the webhook secret. */
export function razorpaySignature(body: string, secret: string) { return createHmac('sha256', secret).update(body).digest('hex'); }
export function verifyRazorpaySignature(body: string, signature: string | null, secret: string | null) {
  return !!(signature && secret) && safeEqualHex(razorpaySignature(body, secret), signature.trim());
}
/** Stripe: Stripe-Signature "t=<unix>,v1=<hex HMAC-SHA256 of `${t}.${body}`>"; 5-minute tolerance. */
export function stripeSignature(body: string, secret: string, t: number) { return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`; }
export function verifyStripeSignature(body: string, header: string | null, secret: string | null, now = Date.now(), toleranceSeconds = 300) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=', 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(now / 1000 - t) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return header.split(',').filter(p => p.startsWith('v1=')).some(p => safeEqualHex(expected, p.slice(3)));
}

// ---- Events → plan updates (pure) -------------------------------------------------------------
export type PlanUpdate = {
  owner: string | null; subscription: string; customer?: string | null; plan: PlanId | null; interval?: Interval | null;
  status: 'active' | 'halted' | 'cancelled' | 'expired' | 'pending' | null;
  period_end?: string | null;
  payment?: {id: string; amount_minor: number; currency: string; period_start?: string | null; period_end?: string | null} | null;
};
const unixIso = (s: unknown) => (typeof s === 'number' && s > 0 ? new Date(s * 1000).toISOString() : null);
const asInterval = (v: unknown): Interval | null => (v === 'month' || v === 'year' ? v : null);
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? v as Obj : {});

/** A Razorpay Subscriptions webhook event as a plan update, or null for events that change nothing. */
export function razorpayEventToUpdate(event: unknown): PlanUpdate | null {
  const e = obj(event), name = String(e.event ?? ''), sub = obj(obj(obj(e.payload).subscription).entity), pay = obj(obj(obj(e.payload).payment).entity);
  if (!name.startsWith('subscription.') || typeof sub.id !== 'string') return null;
  const notes = obj(sub.notes), plan = isPlanId(notes.plan) ? notes.plan : null;
  const base = {owner: typeof notes.owner === 'string' ? notes.owner : null, subscription: sub.id, customer: typeof sub.customer_id === 'string' ? sub.customer_id : null, plan, interval: asInterval(notes.interval), period_end: unixIso(sub.current_end)};
  switch (name) {
    case 'subscription.authenticated': return {...base, status: 'pending'};
    case 'subscription.activated': case 'subscription.resumed': return {...base, status: 'active'};
    case 'subscription.charged': return {...base, status: 'active', payment: typeof pay.id === 'string' && typeof pay.amount === 'number' && pay.amount > 0 ? {id: pay.id, amount_minor: pay.amount, currency: String(pay.currency ?? 'INR').toUpperCase(), period_start: unixIso(sub.current_start), period_end: unixIso(sub.current_end)} : null};
    case 'subscription.pending': return {...base, status: null}; // a retry is under way; keep the plan
    case 'subscription.halted': return {...base, status: 'halted'};
    case 'subscription.cancelled': case 'subscription.completed': return {...base, status: 'cancelled'};
    case 'subscription.paused': return {...base, status: 'halted'};
    default: return null;
  }
}
/** A Stripe Billing webhook event as a plan update, or null. */
export function stripeEventToUpdate(event: unknown): PlanUpdate | null {
  const e = obj(event), type = String(e.type ?? ''), o = obj(obj(e.data).object), meta = obj(o.metadata);
  const plan = isPlanId(meta.plan) ? meta.plan : null, owner = typeof meta.owner === 'string' ? meta.owner : typeof o.client_reference_id === 'string' ? o.client_reference_id : null;
  if (type === 'checkout.session.completed') {
    if (o.mode !== 'subscription' || typeof o.subscription !== 'string') return null;
    return {owner, subscription: o.subscription, customer: typeof o.customer === 'string' ? o.customer : null, plan, interval: asInterval(meta.interval), status: 'active'};
  }
  if (type === 'customer.subscription.created' || type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') {
    if (typeof o.id !== 'string') return null;
    const s = String(o.status ?? ''), status = type.endsWith('deleted') ? 'expired' : s === 'active' || s === 'trialing' ? 'active' : s === 'past_due' || s === 'unpaid' ? 'halted' : s === 'canceled' ? 'cancelled' : s === 'incomplete' ? 'pending' : s === 'incomplete_expired' ? 'expired' : null;
    return {owner, subscription: o.id, customer: typeof o.customer === 'string' ? o.customer : null, plan, interval: asInterval(meta.interval), status, period_end: unixIso(o.current_period_end) ?? unixIso(o.cancel_at)};
  }
  if (type === 'invoice.paid') {
    if (typeof o.subscription !== 'string' || typeof o.id !== 'string' || typeof o.amount_paid !== 'number' || o.amount_paid <= 0) return null;
    const line = obj((obj(o.lines).data as unknown[] | undefined)?.[0]), period = obj(line.period);
    return {owner, subscription: o.subscription, plan, status: 'active', payment: {id: o.id, amount_minor: o.amount_paid, currency: String(o.currency ?? '').toUpperCase(), period_start: unixIso(period.start), period_end: unixIso(period.end)}, period_end: unixIso(period.end)};
  }
  return null;
}
/** The row after applying an update (pure). Halting starts a 7-day grace once; anything else clears it. */
export function nextPlanRow(prev: (PlanRow & {interval?: string | null}) | null, u: PlanUpdate, now: number): PlanRow & {interval: string | null} {
  const status = u.status ?? (prev?.status === 'pending' ? 'active' : prev?.status ?? 'active');
  const grace = status === 'halted' ? (prev?.status === 'halted' && prev.grace_until ? prev.grace_until : new Date(now + GRACE_DAYS * 86400_000).toISOString()) : null;
  return {plan: u.plan ?? prev?.plan ?? 'free', status, period_end: u.period_end ?? prev?.period_end ?? null, grace_until: grace, interval: u.interval ?? prev?.interval ?? null};
}

// ---- ScopeFlow's own GST invoice for a subscription payment (pure) ----------------------------
export type BillingSeller = {name: string; address: string; gstin: string | null; state: string | null; sac: string; lut: string | null};
export function billingSeller(env: Env = process.env): BillingSeller {
  const gstin = str(env.SCOPEFLOW_BILLING_SELLER_GSTIN), g = gstin ? checkGstin(gstin) : null;
  return {name: str(env.SCOPEFLOW_BILLING_SELLER_NAME) ?? 'ScopeFlow', address: str(env.SCOPEFLOW_BILLING_SELLER_ADDRESS) ?? '', gstin: g?.ok ? g.gstin : null, state: g?.ok ? g.state : null, sac: str(env.SCOPEFLOW_BILLING_SAC) ?? '998315', lut: str(env.SCOPEFLOW_BILLING_LUT_ARN)};
}
export type BillingBuyer = {name: string; address: string; gstin: string | null; state: string | null};
export type BillingTax = {kind: 'intra' | 'inter' | 'export' | 'unregistered'; rate: number; taxable_minor: number; cgst_minor: number; sgst_minor: number; igst_minor: number};
export type BillingInvoiceContent = {
  number: string; issued: string; title: 'Tax invoice' | 'Invoice'; seller: BillingSeller; buyer: BillingBuyer;
  plan: string; interval: string | null; period: {start: string | null; end: string | null}; currency: string; total_minor: number; tax: BillingTax;
  provider: BillingProvider; payment: string; notes: string[];
};
/**
 * Prices include GST at 18%. Registered seller: CGST+SGST when the buyer is in the seller's state
 * (or gave no state), IGST across states; a non-INR (foreign) customer is an export of services
 * (zero-rated; under LUT when SCOPEFLOW_BILLING_LUT_ARN is set). Unregistered seller: no GST.
 * All in minor units; the parts always sum to the total.
 */
export function billingTax(total: number, currency: string, seller: Pick<BillingSeller, 'gstin' | 'state'>, buyer: Pick<BillingBuyer, 'state'>, rate = 18): BillingTax {
  const none = {cgst_minor: 0, sgst_minor: 0, igst_minor: 0, rate: 0, taxable_minor: total};
  if (!seller.gstin || !seller.state) return {kind: 'unregistered', ...none};
  if (currency !== 'INR') return {kind: 'export', ...none};
  const taxable = Math.round(total * 100 / (100 + rate)), tax = total - taxable;
  if (!buyer.state || buyer.state === seller.state) { const cgst = Math.floor(tax / 2); return {kind: 'intra', rate, taxable_minor: taxable, cgst_minor: cgst, sgst_minor: tax - cgst, igst_minor: 0}; }
  return {kind: 'inter', rate, taxable_minor: taxable, cgst_minor: 0, sgst_minor: 0, igst_minor: tax};
}
export function billingInvoiceContent(p: {number: string; issued: string; seller: BillingSeller; buyer: BillingBuyer; plan: PlanId; interval: string | null; period: {start: string | null; end: string | null}; currency: string; total_minor: number; provider: BillingProvider; payment: string}): BillingInvoiceContent {
  const tax = billingTax(p.total_minor, p.currency, p.seller, p.buyer);
  const notes = [tax.kind === 'unregistered' ? `${p.seller.name} is not registered for GST; no GST is charged.` : tax.kind === 'export' ? `Export of services: zero-rated supply${p.seller.lut ? ` under LUT ${p.seller.lut}` : ''}. Needs CA review.` : `Prices include GST at ${tax.rate}%. SAC ${p.seller.sac}. Needs CA review.`];
  return {number: p.number, issued: p.issued, title: tax.kind === 'intra' || tax.kind === 'inter' || tax.kind === 'export' ? 'Tax invoice' : 'Invoice', seller: p.seller, buyer: p.buyer, plan: PLANS[p.plan].name, interval: p.interval, period: p.period, currency: p.currency, total_minor: p.total_minor, tax, provider: p.provider, payment: p.payment, notes};
}

// ---- Database ---------------------------------------------------------------------------------
async function database() { return (await import('./server')).db(); }
export type AccountPlanRow = PlanRow & {owner: string; provider: string | null; provider_subscription: string | null; provider_customer: string | null; interval: string | null; updated: string};
export async function planRowFor(owner: string) {
  return (await database()).prepare('SELECT * FROM accounts_plans WHERE owner=?').bind(owner).first<AccountPlanRow>();
}
/** The plan `owner` is entitled to right now (M13). */
export async function planStateFor(owner: string, now = Date.now()): Promise<PlanState> { return resolvePlan(await planRowFor(owner), now); }
/** Per-account limits (M13): the account's subscription, else the server default. */
export async function limitsFor(owner: string, now = Date.now()): Promise<Limits> { return (await planStateFor(owner, now)).plan.limits; }

/** Records an admin event for the audit export (SF-25). Never throws. */
export async function auditEvent(owner: string, kind: string, detail: Record<string, unknown>, actor = 'owner') {
  try { await (await database()).prepare('INSERT INTO audit_events (id,owner,kind,detail,actor,created) VALUES (?,?,?,?,?,?)').bind(randomUUID(), owner, kind, JSON.stringify(detail), actor, new Date().toISOString()).run(); }
  catch { console.error('Scopeflow audit event not recorded:', kind); }
}

export class BillingError extends Error {
  readonly status: number; readonly code: string;
  constructor(message: string, status: number, code: string) { super(message); this.status = status; this.code = code; }
}

/** Starts a subscription checkout. Returns where to send the browser. */
export async function startCheckout(owner: string, plan: PlanId, interval: Interval, currency: string, origin: string, env: Env = process.env) {
  if (!PLANS[plan].purchasable) throw new BillingError('That plan cannot be bought.', 400, 'plan_not_purchasable');
  const provider = providerFor(currency, env);
  if (!provider) throw new BillingError(billingStatus(env).reason ?? `Paying in ${currency} is not available yet; choose INR or USD.`, 409, 'billing_unavailable');
  const db = await database(), now = new Date().toISOString();
  const current = await planRowFor(owner);
  if (current && current.plan === plan && current.status === 'active') throw new BillingError(`You are already on ${PLANS[plan].name}.`, 409, 'already_subscribed');
  let subscription: string, url: string, customer: string | null = null;
  if (localDouble(env)) {
    subscription = 'sub_local_' + randomUUID().replaceAll('-', '').slice(0, 14);
    url = `/plans/checkout?subscription=${subscription}`;
  } else if (provider === 'razorpay') {
    const r = razorpayBilling(env)!, planId = r.planId(plan, interval);
    if (!planId) throw new BillingError(`Set RAZORPAY_BILLING_PLAN_${plan.toUpperCase()}_${interval.toUpperCase()} to sell this plan.`, 409, 'billing_unavailable');
    const res = await fetch(r.api + '/v1/subscriptions', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(r.keyId + ':' + r.keySecret).toString('base64')},
      body: JSON.stringify({plan_id: planId, total_count: interval === 'year' ? 10 : 120, customer_notify: 1, notes: {owner, plan, interval}})});
    const data = await res.json().catch(() => ({})) as {id?: string; short_url?: string};
    if (!res.ok || !data.id || !data.short_url) throw new BillingError('Razorpay did not start the subscription. Try again in a minute.', 502, 'provider_error');
    subscription = data.id; url = data.short_url;
  } else {
    const s = stripeBilling(env)!, price = s.priceId(plan, interval);
    if (!price) throw new BillingError(`Set STRIPE_BILLING_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()} to sell this plan.`, 409, 'billing_unavailable');
    const form = new URLSearchParams({mode: 'subscription', 'line_items[0][price]': price, 'line_items[0][quantity]': '1', client_reference_id: owner, success_url: origin + '/plans?checkout=done', cancel_url: origin + '/plans?checkout=cancelled',
      'metadata[owner]': owner, 'metadata[plan]': plan, 'metadata[interval]': interval, 'subscription_data[metadata][owner]': owner, 'subscription_data[metadata][plan]': plan, 'subscription_data[metadata][interval]': interval});
    const res = await fetch(s.api + '/v1/checkout/sessions', {method: 'POST', headers: {Authorization: 'Bearer ' + s.key, 'Content-Type': 'application/x-www-form-urlencoded'}, body: form});
    const data = await res.json().catch(() => ({})) as {id?: string; url?: string; customer?: string};
    if (!res.ok || !data.id || !data.url) throw new BillingError('Stripe did not start the checkout. Try again in a minute.', 502, 'provider_error');
    subscription = 'cs:' + data.id; url = data.url; customer = data.customer ?? null;
  }
  // A checkout in progress never changes what the account can do (resolvePlan ignores 'pending').
  if (!current || current.status === 'pending' || current.status === 'expired') {
    await db.prepare('INSERT INTO accounts_plans (owner,plan,status,provider,provider_subscription,provider_customer,interval,updated) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (owner) DO UPDATE SET plan=excluded.plan,status=excluded.status,provider=excluded.provider,provider_subscription=excluded.provider_subscription,provider_customer=excluded.provider_customer,interval=excluded.interval,period_end=NULL,grace_until=NULL,updated=excluded.updated')
      .bind(owner, plan, 'pending', provider, subscription, customer, interval, now).run();
  }
  await auditEvent(owner, 'billing.checkout_started', {plan, interval, provider, currency});
  return {provider, url, subscription, local_double: localDouble(env)};
}

/**
 * Applies one verified webhook event once (billing_events dedupes by provider event id). Returns
 * what changed. Issues ScopeFlow's invoice for a payment. Unknown subscriptions are ignored.
 */
export async function applyPlanUpdate(provider: BillingProvider, eventId: string, kind: string, u: PlanUpdate, now = Date.now()) {
  const db = await database(), at = new Date(now).toISOString();
  const row = (u.owner ? await planRowFor(u.owner) : null) ?? await db.prepare('SELECT * FROM accounts_plans WHERE provider=? AND provider_subscription=?').bind(provider, u.subscription).first<AccountPlanRow>();
  const owner = u.owner ?? row?.owner ?? null;
  if (!owner) return {applied: false, reason: 'unknown_subscription'} as const;
  const first = await db.prepare('INSERT INTO billing_events (provider,event_id,owner,kind,received) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING RETURNING event_id').bind(provider, eventId, owner, kind, at).first();
  if (!first) return {applied: false, reason: 'duplicate'} as const;
  const next = nextPlanRow(row, u, now);
  await db.prepare('INSERT INTO accounts_plans (owner,plan,status,period_end,grace_until,provider,provider_customer,provider_subscription,interval,updated) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT (owner) DO UPDATE SET plan=excluded.plan,status=excluded.status,period_end=excluded.period_end,grace_until=excluded.grace_until,provider=excluded.provider,provider_customer=coalesce(excluded.provider_customer,accounts_plans.provider_customer),provider_subscription=excluded.provider_subscription,interval=excluded.interval,updated=excluded.updated')
    .bind(owner, next.plan, next.status, next.period_end, next.grace_until, provider, u.customer ?? null, u.subscription, next.interval, at).run();
  let invoice: string | null = null;
  if (u.payment && isPlanId(next.plan)) invoice = await issueBillingInvoice(owner, provider, next.plan as PlanId, next.interval, u.payment, at);
  await auditEvent(owner, 'billing.' + kind, {plan: next.plan, status: next.status, grace_until: next.grace_until, invoice}, provider);
  return {applied: true, owner, plan: next.plan, status: next.status, grace_until: next.grace_until, invoice} as const;
}

async function issueBillingInvoice(owner: string, provider: BillingProvider, plan: PlanId, interval: string | null, payment: NonNullable<PlanUpdate['payment']>, issued: string) {
  const db = await database();
  const profile = await db.prepare('SELECT business_name,business_address,tax_id,gst_state FROM business_profiles WHERE owner=?').bind(owner).first<{business_name: string | null; business_address: string | null; tax_id: string | null; gst_state: string | null}>();
  const g = profile?.tax_id ? checkGstin(profile.tax_id) : null;
  const buyer: BillingBuyer = {name: profile?.business_name || 'ScopeFlow customer', address: profile?.business_address ?? '', gstin: g?.ok ? g.gstin : null, state: g?.ok ? g.state : profile?.gst_state || null};
  const year = issued.slice(0, 4), id = randomUUID();
  // Numbers are taken and the invoice inserted in one statement under a lock, so they have no gaps.
  const contentFor = (number: string) => JSON.stringify(billingInvoiceContent({number, issued, seller: billingSeller(), buyer, plan, interval, period: {start: payment.period_start ?? null, end: payment.period_end ?? null}, currency: payment.currency, total_minor: payment.amount_minor, provider, payment: payment.id}));
  for (let attempt = 0; attempt < 3; attempt++) {
    const seqRow = await db.prepare('SELECT coalesce(max(seq),0)+1 AS seq FROM billing_invoices').first<{seq: number}>();
    const seq = Number(seqRow?.seq ?? 1), number = `SF-${year}-${String(seq).padStart(5, '0')}`;
    try {
      const r = await db.prepare('INSERT INTO billing_invoices (id,owner,seq,number,provider,provider_payment,amount_minor,currency,issued,content) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT (provider, provider_payment) DO NOTHING RETURNING number')
        .bind(id, owner, seq, number, provider, payment.id, payment.amount_minor, payment.currency, issued, contentFor(number)).lock('scopeflow:billing-invoices').first<{number: string}>();
      return r?.number ?? null;
    } catch (e) { if (!String(e).includes('UNIQUE')) throw e; }
  }
  return null;
}

/** Cancels the account's live subscription at the provider (account deletion). True when nothing is left running. */
export async function cancelSubscription(owner: string, env: Env = process.env) {
  const row = await planRowFor(owner);
  if (!row?.provider_subscription || !['active', 'halted', 'pending'].includes(row.status) || row.provider_subscription.startsWith('sub_local_') || row.provider_subscription.startsWith('cs:')) return true;
  try {
    if (row.provider === 'razorpay') {
      const r = razorpayBilling(env); if (!r) return false;
      const res = await fetch(`${r.api}/v1/subscriptions/${encodeURIComponent(row.provider_subscription)}/cancel`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(r.keyId + ':' + r.keySecret).toString('base64')}, body: JSON.stringify({cancel_at_cycle_end: 0})});
      return res.ok;
    }
    if (row.provider === 'stripe') {
      const s = stripeBilling(env); if (!s) return false;
      const res = await fetch(`${s.api}/v1/subscriptions/${encodeURIComponent(row.provider_subscription)}`, {method: 'DELETE', headers: {Authorization: 'Bearer ' + s.key}});
      return res.ok;
    }
  } catch { return false; }
  return false;
}

/** The local double's events for a test checkout: activated, then charged for one period. */
export function localDoubleEvents(subscription: string, owner: string, plan: PlanId, interval: Interval, currency: string, now: number) {
  const start = Math.floor(now / 1000), end = start + (interval === 'year' ? 365 : 30) * 86400;
  const price = PLANS[plan].price, amount = currency === 'INR' ? (interval === 'year' ? price.INR_year : price.INR) * 100 : (interval === 'year' ? price.USD_year : price.USD) * 100;
  const entity = {id: subscription, entity: 'subscription', status: 'active', current_start: start, current_end: end, notes: {owner, plan, interval}};
  const pay = {id: 'pay_local_' + createHash('sha256').update(subscription + ':' + start).digest('hex').slice(0, 14), entity: 'payment', amount, currency, status: 'captured'};
  return [
    {entity: 'event', event: 'subscription.activated', payload: {subscription: {entity}}, created_at: start},
    {entity: 'event', event: 'subscription.charged', payload: {subscription: {entity}, payment: {entity: pay}}, created_at: start},
  ];
}
