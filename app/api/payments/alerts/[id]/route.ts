import {db, json, ownerAuth, safeOrigin, failure} from '@/lib/server';
type Ctx = {params: Promise<{id: string}>};

// Marks a payment alert as dealt with.
export async function POST(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in or provide a valid API token.'}, 401);
    const {id} = await ctx.params;
    const row = await db().prepare('UPDATE scopeflow.payment_alerts SET resolved_at=? WHERE id=? AND owner=? AND resolved_at IS NULL RETURNING id').bind(new Date().toISOString(), id, auth.user).first();
    return row ? json({resolved: true}) : json({error: 'Alert not found.'}, 404);
  } catch (e) { return failure(e); }
}
