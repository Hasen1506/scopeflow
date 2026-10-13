import {z} from 'zod';
import {json, ownerAuth, body, safeOrigin, allowWrite, failure} from '@/lib/server';
import {publicUrl} from '@/lib/origin';
import {EncryptionUnavailable, ROUTE_ACCOUNT, RAZORPAY_KEY_ID, STRIPE_KEY, STRIPE_WEBHOOK, chooseRoute, encryptionKey, keyHint, partnerConfig, routeEnabled, type PaymentAccount} from '@/lib/payment-accounts';
import {ownerAccounts, saveAccount} from '@/lib/payment-accounts-server';
import {RazorpayError, checkRazorpayKeys} from '@/lib/razorpay';
import {StripeError, checkStripeKey} from '@/lib/stripe';
import {isValidVpa} from '@/lib/upi';

// The freelancer's own payment accounts (C3, SF-20). GET lists them (no secrets), what each
// currency would use, and the webhook URL each provider account must be pointed at. POST connects
// one: a UPI ID; their own Razorpay API keys (interim until the Technology Partner OAuth is live:
// GET /api/payment-accounts/razorpay/connect); their own Stripe key; or (SCOPEFLOW_ROUTE_ENABLED)
// a Razorpay Route linked account. Secrets are sealed with SCOPEFLOW_ENCRYPTION_KEY.
const upi = z.object({kind: z.literal('upi'), vpa: z.string().trim().max(256), payee_name: z.string().trim().min(2).max(50)}).strict();
const rzKeys = z.object({kind: z.literal('razorpay_keys'), key_id: z.string().trim().regex(RAZORPAY_KEY_ID), key_secret: z.string().trim().min(8).max(200), webhook_secret: z.string().trim().min(8).max(200).optional()}).strict();
const stripeKeys = z.object({kind: z.literal('stripe_keys'), secret_key: z.string().trim().regex(STRIPE_KEY), webhook_secret: z.string().trim().regex(STRIPE_WEBHOOK).optional(), currencies: z.array(z.string().regex(/^[A-Z]{3}$/)).max(40).optional(), include_inr: z.boolean().optional()}).strict();
const route = z.object({kind: z.literal('razorpay_route'), linked_account_id: z.string().trim().regex(ROUTE_ACCOUNT)}).strict();
const input = z.discriminatedUnion('kind', [upi, rzKeys, stripeKeys, route]);

function webhookUrl(request: Request, a: Pick<PaymentAccount, 'id' | 'kind'>) {
  if (a.kind === 'razorpay_keys') return publicUrl(request, `/api/payments/razorpay/webhook/${a.id}`);
  if (a.kind === 'stripe_keys') return publicUrl(request, `/api/payments/stripe/webhook/${a.id}`);
  if (a.kind === 'razorpay_oauth' || a.kind === 'razorpay_route') return publicUrl(request, '/api/payments/razorpay/webhook');
  return null;
}
const view = (request: Request, a: PaymentAccount) => ({id: a.id, kind: a.kind, status: a.status, public: a.public, created: a.created, webhook_url: webhookUrl(request, a)});

export async function GET(request: Request) {
  try {
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in or provide a valid API token.'}, 401);
    const accounts = await ownerAccounts(auth.user, {all: true});
    const active = accounts.filter(a => a.status === 'active');
    let encryption = true;
    try { encryptionKey(); } catch { encryption = false; }
    const routes = Object.fromEntries(['INR', 'USD', 'EUR', 'GBP'].map(c => { const r = chooseRoute(active, c); return [c, {status: r.status, online: r.online ? {provider: r.online.provider, via: r.online.via} : null, upi: !!r.upi, warnings: r.warnings}]; }));
    const warnings = [...new Set(Object.values(routes).flatMap(r => r.warnings))];
    // Misconfigured means one of the owner's own accounts cannot confirm payments (H7); the operator's
    // keys being refused in production (C3) is a warning, not the owner's misconfiguration.
    const misconfigured = Object.values(routes).some(r => r.status === 'misconfigured');
    return json({accounts: accounts.map(a => view(request, a)), routes, readiness: {payments: misconfigured ? 'misconfigured' : active.length ? 'ready' : 'none', warnings, encryption},
      razorpay_oauth: !!partnerConfig(), route_enabled: routeEnabled()});
  } catch (e) { return failure(e); }
}

export async function POST(request: Request) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in or provide a valid API token.'}, 401);
    if (!auth.scopes.includes('scopes:write')) return json({error: 'This credential cannot change payment accounts.'}, 403);
    if (!await allowWrite('owner:' + auth.user, 10)) return json({error: 'Write limit reached. Try again in a minute.'}, 429);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const parsed = input.safeParse(raw);
    if (!parsed.success) return json({error: 'Check the account details.', fields: Object.fromEntries(parsed.error.issues.map(i => [i.path.join('.') || 'kind', i.message]))}, 400);
    const d = parsed.data;
    try {
      if (d.kind === 'upi') {
        if (!isValidVpa(d.vpa)) return json({error: 'Enter a UPI ID like name@bank.', fields: {vpa: 'Enter a UPI ID like name@bank.'}}, 400);
        return json({account: view(request, await saveAccount(auth.user, 'upi', {vpa: d.vpa.trim(), payee_name: d.payee_name}, null))}, 201);
      }
      if (d.kind === 'razorpay_keys') {
        try { await checkRazorpayKeys({keyId: d.key_id, keySecret: d.key_secret}); }
        catch (e) { if (e instanceof RazorpayError) return json({error: e.status === 401 ? 'Razorpay did not accept these keys.' : e.message, code: 'provider_refused'}, 400); throw e; }
        const a = await saveAccount(auth.user, 'razorpay_keys', {key_id: d.key_id, mode: d.key_id.startsWith('rzp_live_') ? 'live' : 'test', has_webhook_secret: !!d.webhook_secret}, {key_secret: d.key_secret, webhook_secret: d.webhook_secret});
        return json({account: view(request, a), ...(d.webhook_secret ? {} : {warning: 'Add the webhook secret so payments can be confirmed; until then online payment stays off.'})}, 201);
      }
      if (d.kind === 'stripe_keys') {
        try { await checkStripeKey({secretKey: d.secret_key}); }
        catch (e) { if (e instanceof StripeError) return json({error: 'Stripe did not accept this key.', code: 'provider_refused'}, 400); throw e; }
        const a = await saveAccount(auth.user, 'stripe_keys', {key_hint: keyHint(d.secret_key), mode: d.secret_key.includes('_live_') ? 'live' : 'test', currencies: d.currencies ?? [], include_inr: !!d.include_inr, has_webhook_secret: !!d.webhook_secret}, {secret_key: d.secret_key, webhook_secret: d.webhook_secret});
        return json({account: view(request, a), ...(d.webhook_secret ? {} : {warning: 'Add the webhook signing secret so payments can be confirmed; until then online payment stays off.'})}, 201);
      }
      if (!routeEnabled()) return json({error: 'Route is not available on this server yet.', code: 'route_disabled'}, 409);
      return json({account: view(request, await saveAccount(auth.user, 'razorpay_route', {linked_account_id: d.linked_account_id}, null))}, 201);
    } catch (e) {
      if (e instanceof EncryptionUnavailable) return json({error: 'Payment accounts cannot be stored on this server yet (encryption key missing).', code: 'encryption_unavailable'}, 503);
      throw e;
    }
  } catch (e) { return failure(e); }
}
