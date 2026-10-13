import {db, json, ownerAuth, failure} from '@/lib/server';
import {publicUrl} from '@/lib/origin';
import {EncryptionUnavailable, partnerConfig} from '@/lib/payment-accounts';
import {saveAccount} from '@/lib/payment-accounts-server';
import {RazorpayError, exchangeCode} from '@/lib/razorpay';

// Razorpay sends the owner back here after they approve ScopeFlow on their own account. The state
// must be one this owner started in the last ten minutes (single use); the code is exchanged for the
// account's tokens, which are sealed at rest. The account is then active: orders and refunds use
// its access token and money settles to the freelancer.
const back = (request: Request, q: string) => new Response(null, {status: 302, headers: {Location: publicUrl(request, '/payments?' + q), 'Cache-Control': 'no-store'}});
export async function GET(request: Request) {
  try {
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in to connect a Razorpay account.'}, 401);
    const partner = partnerConfig();
    if (!partner) return json({error: 'Connecting with Razorpay is not available yet.', code: 'oauth_unavailable'}, 409);
    const url = new URL(request.url), code = url.searchParams.get('code') ?? '', state = url.searchParams.get('state') ?? '';
    if (url.searchParams.get('error')) return back(request, 'razorpay=denied');
    const since = new Date(Date.now() - 600_000).toISOString();
    const used = await db().prepare("UPDATE scopeflow.payment_oauth_states SET used=? WHERE state=? AND owner=? AND provider='razorpay' AND used IS NULL AND created>=? RETURNING state").bind(new Date().toISOString(), state, auth.user, since).first();
    if (!used || !/^[A-Za-z0-9._~-]{4,2000}$/.test(code)) return json({error: 'This connection link expired. Start again from Payments settings.', code: 'oauth_state'}, 400);
    try {
      const t = await exchangeCode(partner, code, publicUrl(request, '/api/payment-accounts/razorpay/callback'));
      const a = await saveAccount(auth.user, 'razorpay_oauth', {razorpay_account_id: t.razorpay_account_id, public_token: t.public_token, token_expires: t.expires_at, mode: t.mode, has_webhook_secret: !!partner.webhookSecret}, {access_token: t.access_token, refresh_token: t.refresh_token ?? undefined});
      if (url.searchParams.get('format') === 'json') return json({account: {id: a.id, kind: a.kind, status: a.status, public: a.public}}, 201);
      return back(request, 'razorpay=connected');
    } catch (e) {
      if (e instanceof RazorpayError) return back(request, 'razorpay=failed');
      if (e instanceof EncryptionUnavailable) return json({error: 'Payment accounts cannot be stored on this server yet (encryption key missing).', code: 'encryption_unavailable'}, 503);
      throw e;
    }
  } catch (e) { return failure(e); }
}
