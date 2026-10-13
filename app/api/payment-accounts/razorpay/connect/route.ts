import {db, json, ownerAuth, failure} from '@/lib/server';
import {publicUrl} from '@/lib/origin';
import {partnerConfig} from '@/lib/payment-accounts';
import {authorizeUrl} from '@/lib/razorpay';

// SF-20: connect the freelancer's OWN Razorpay account through Razorpay's Technology Partner
// OAuth. Needs ScopeFlow's Partner credentials (RAZORPAY_PARTNER_CLIENT_ID/SECRET, after Razorpay
// approves the Partner account); until then owners connect their API keys instead (BYO keys).
export async function GET(request: Request) {
  try {
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in to connect a Razorpay account.'}, 401);
    const partner = partnerConfig();
    if (!partner) return json({error: 'Connecting with Razorpay is not available yet. Connect your Razorpay API keys instead.', code: 'oauth_unavailable'}, 409);
    const state = Array.from(crypto.getRandomValues(new Uint8Array(24))).map(b => b.toString(16).padStart(2, '0')).join('');
    await db().prepare('INSERT INTO scopeflow.payment_oauth_states (state,owner,provider,created) VALUES (?,?,?,?)').bind(state, auth.user, 'razorpay', new Date().toISOString()).run();
    const location = authorizeUrl(partner, publicUrl(request, '/api/payment-accounts/razorpay/callback'), state);
    if (new URL(request.url).searchParams.get('format') === 'json') return json({url: location});
    return new Response(null, {status: 302, headers: {Location: location, 'Cache-Control': 'no-store'}});
  } catch (e) { return failure(e); }
}
