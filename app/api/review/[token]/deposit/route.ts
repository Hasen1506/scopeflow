import {json, safeOrigin, failure} from '@/lib/server';
import {startCheckout} from '@/lib/checkout-server';
type Ctx = {params: Promise<{token: string}>};
// PR F: start paying the deposit due on an approved version (Razorpay order, or a Stripe Checkout
// URL for currencies Stripe handles; lib/checkout-server.ts). Disabled with an explanation (503,
// payments_disabled) unless a provider is configured.
export async function POST(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    return await startCheckout(request, (await ctx.params).token, {purpose: 'deposit'});
  } catch (e) { return failure(e); }
}
