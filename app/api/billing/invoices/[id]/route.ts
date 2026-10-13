import {db, json, ownerAuth, allowRead, failure} from '@/lib/server';
// One of ScopeFlow's own invoices to this account (the subscription GST invoice), as JSON. The
// printable copy is /plans/invoices/<id>.
type Ctx = {params: Promise<{id: string}>};
export async function GET(request: Request, ctx: Ctx) {
  try {
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in or provide a valid API token.'}, 401);
    if (!await allowRead('owner:' + auth.user)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const {id} = await ctx.params;
    if (!/^[0-9a-f-]{36}$/.test(id)) return json({error: 'Invoice not found.'}, 404);
    const row = await db().prepare('SELECT content FROM scopeflow.billing_invoices WHERE id=? AND owner=?').bind(id, auth.user).first<{content: string}>();
    if (!row) return json({error: 'Invoice not found.'}, 404);
    return json({invoice: {id, ...JSON.parse(row.content)}});
  } catch (e) { return failure(e); }
}
