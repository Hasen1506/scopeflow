import {db, json, ownerAuth, failure} from '@/lib/server';

// Payment problems for the owner to look at (H6, H8, M20, H14, L4): money the record could not
// take yet, excess or short captures (with a ready refund request for an excess), refunds issued
// but not yet recorded, stale orders. Unresolved ones by default; ?status=all for all.
export async function GET(request: Request) {
  try {
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in or provide a valid API token.'}, 401);
    const all = new URL(request.url).searchParams.get('status') === 'all';
    const rows = await db().prepare(`SELECT id,project_id,kind,detail,created,resolved_at FROM scopeflow.payment_alerts WHERE owner=?${all ? '' : ' AND resolved_at IS NULL'} ORDER BY created DESC LIMIT 200`).bind(auth.user).all<{id: string; project_id: string | null; kind: string; detail: string; created: string; resolved_at: string | null}>();
    return json({alerts: rows.results.map(r => ({...r, detail: JSON.parse(r.detail)}))});
  } catch (e) { return failure(e); }
}
