import {json, safeOrigin, failure} from '@/lib/server';
import {startCheckout} from '@/lib/checkout-server';
type Ctx = {params: Promise<{token: string; seq: string}>};
// Pay what is still open on one issued invoice online (a partial payment of the balance), from the
// client's review link. Same providers and rules as the deposit (lib/checkout-server.ts).
export async function POST(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const {token, seq} = await ctx.params;
    if (!/^\d{1,9}$/.test(seq)) return json({error: 'Invoice not found.'}, 404);
    return await startCheckout(request, token, {purpose: 'invoice', seq: Number(seq)});
  } catch (e) { return failure(e); }
}
