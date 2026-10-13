import {z} from 'zod';
import {json, ownerAuth, body, safeOrigin, failure} from '@/lib/server';
import {applyPlanUpdate, localDouble, localDoubleEvents, planRowFor, razorpayEventToUpdate} from '@/lib/billing';
import {isPlanId} from '@/lib/plans';
// The local billing double (localhost only, no provider configured): completes a test checkout
// by replaying Razorpay's subscription.activated and subscription.charged events through the
// same handler the real webhook uses. No money moves. 404 everywhere else.
export async function POST(request: Request) {
  try {
    if (!localDouble()) return json({error: 'Not found.'}, 404);
    if (!safeOrigin(request) || !request.headers.get('origin')) return json({error: 'Origin not allowed.'}, 403);
    const auth = await ownerAuth(request);
    if (!auth || auth.via !== 'session') return json({error: 'Sign in to finish checkout.'}, 401);
    let raw; try { raw = await body(request); } catch { return json({error: 'Provide valid JSON.'}, 400); }
    const p = z.object({subscription: z.string().regex(/^sub_local_[a-f0-9]{14}$/), currency: z.enum(['INR', 'USD']).default('INR')}).strict().safeParse(raw);
    if (!p.success) return json({error: 'Unknown test checkout.'}, 400);
    const row = await planRowFor(auth.user);
    if (!row || row.provider_subscription !== p.data.subscription || !isPlanId(row.plan)) return json({error: 'This test checkout is not yours or has finished.'}, 404);
    const results = [];
    for (const event of localDoubleEvents(p.data.subscription, auth.user, row.plan, row.interval === 'year' ? 'year' : 'month', p.data.currency, Date.now())) {
      results.push(await applyPlanUpdate('razorpay', `local:${p.data.subscription}:${event.event}`, event.event, razorpayEventToUpdate(event)!));
    }
    return json({paid: true, results});
  } catch (e) { return failure(e); }
}
