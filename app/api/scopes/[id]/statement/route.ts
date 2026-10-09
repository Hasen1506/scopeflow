import {db, json, ownerAuth, allowRead, failure} from '@/lib/server';
import {statementResponse} from '@/lib/receipt-server';
type Ctx = {params: Promise<{id: string}>};
// The owner's statement of account (agreed total, payments on the record, balance due) as a PDF.
export async function GET(request: Request, ctx: Ctx) {
  try {
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in or provide a valid API token.'}, 401);
    if (!await allowRead('owner:' + auth.user, 60)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const {id} = await ctx.params;
    const project = await db().prepare('SELECT id,timezone FROM projects WHERE id=? AND owner=?').bind(id, auth.user).first<{id: string; timezone: string | null}>();
    if (!project) return json({error: 'Project not found.'}, 404);
    return statementResponse(request, id, {timezone: project.timezone});
  } catch (e) { return failure(e); }
}
