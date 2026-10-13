import {json, ownerAuth, failure} from '@/lib/server';
import {accountById, razorpayFor, stripeFor} from '@/lib/payment-accounts-server';
import {RazorpayError, razorpaySettlements} from '@/lib/razorpay';
import {StripeError, stripePayouts} from '@/lib/stripe';
type Ctx = {params: Promise<{id: string}>};

// Read-only settlement view (C3): what the provider paid out to the freelancer's own bank account
// from their own Razorpay (settlements) or Stripe (payouts) account. ScopeFlow holds nothing.
export async function GET(request: Request, ctx: Ctx) {
  try {
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in or provide a valid API token.'}, 401);
    const {id} = await ctx.params;
    const account = await accountById(id);
    if (!account || account.owner !== auth.user) return json({error: 'Payment account not found.'}, 404);
    try {
      if (account.kind === 'stripe_keys') { const d = await stripeFor(id); return json({provider: 'stripe', payouts: d ? await stripePayouts(d.config) : []}); }
      if (account.kind === 'razorpay_keys' || account.kind === 'razorpay_oauth') { const d = await razorpayFor(id); return json({provider: 'razorpay', settlements: d ? await razorpaySettlements(d.credential) : []}); }
    } catch (e) { if (e instanceof RazorpayError || e instanceof StripeError) return json({error: e.message, code: 'provider_error'}, 502); throw e; }
    return json({error: 'This account has no settlements to show (UPI payments arrive in your bank directly).', code: 'no_settlements'}, 409);
  } catch (e) { return failure(e); }
}
