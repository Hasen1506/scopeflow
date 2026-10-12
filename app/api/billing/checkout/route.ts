import {z} from 'zod';
import {json, ownerAuth, body, safeOrigin, allowWrite, failure} from '@/lib/server';
import {appOrigin} from '@/lib/origin';
import {BillingError, startCheckout} from '@/lib/billing';
import {PURCHASABLE, type PlanId} from '@/lib/plans';
// M13: start a subscription checkout for a paid plan. Browser sessions only (an API token or
// connector cannot buy a plan). INR → Razorpay Subscriptions; other currencies → Stripe Billing.
const input = z.object({plan: z.enum(PURCHASABLE as unknown as [PlanId, ...PlanId[]]), interval: z.enum(['month', 'year']).default('month'), currency: z.enum(['INR', 'USD']).default('INR')}).strict();
export async function POST(request: Request) {
  try {
    if (!safeOrigin(request) || !request.headers.get('origin')) return json({error: 'Start checkout from the ScopeFlow website.'}, 403);
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in to upgrade.'}, 401);
    if (auth.via !== 'session') return json({error: 'Upgrade from the Plans page in your browser.'}, 403);
    if (!await allowWrite('owner:' + auth.user)) return json({error: 'Write limit reached. Try again in a minute.'}, 429);
    let raw; try { raw = await body(request); } catch { return json({error: 'Provide valid JSON.'}, 400); }
    const p = input.safeParse(raw);
    if (!p.success) return json({error: 'Choose a plan (pro or agency), monthly or yearly, in INR or USD.'}, 400);
    try { return json(await startCheckout(auth.user, p.data.plan, p.data.interval, p.data.currency, appOrigin(request)), 201); }
    catch (e) { if (e instanceof BillingError) return json({error: e.message, code: e.code}, e.status); throw e; }
  } catch (e) { return failure(e); }
}
