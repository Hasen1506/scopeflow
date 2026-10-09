import {z} from 'zod';
import {db, json, ownerAuth, body, safeOrigin, allowWrite, allowRead, failure} from '@/lib/server';
import {inboundAddress, inboundConfig} from '@/lib/inbound';
type Ctx = {params: Promise<{id: string}>};
type Row = {id: string; received: string; sender: string | null; subject: string | null; body: string; radar: string | null; status: string};
// Client emails forwarded to the project's inbound address, newest first, with the radar's first read.
export async function GET(request: Request, ctx: Ctx) {
  try {
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in or provide a valid API token.'}, 401);
    if (!await allowRead('owner:' + auth.user)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const {id} = await ctx.params;
    const project = await db().prepare('SELECT inbound_token FROM projects WHERE id=? AND owner=?').bind(id, auth.user).first<{inbound_token: string | null}>();
    if (!project) return json({error: 'Project not found.'}, 404);
    const rows = await db().prepare("SELECT id,received,sender,subject,body,radar,status FROM inbound_messages WHERE project_id=? AND status<>'dismissed' ORDER BY received DESC LIMIT 50").bind(id).all<Row>();
    return json({configured: !!inboundConfig(), address: inboundAddress(project.inbound_token), messages: rows.results.map(r => ({...r, radar: r.radar ? JSON.parse(r.radar) : null}))});
  } catch (e) { return failure(e); }
}
const patch = z.object({message_id: z.string().uuid(), status: z.enum(['new', 'dismissed', 'done'])}).strict();
export async function PATCH(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in or provide a valid API token.'}, 401);
    if (!auth.scopes.includes('scopes:write')) return json({error: 'This credential cannot change projects.'}, 403);
    if (!await allowWrite('owner:' + auth.user)) return json({error: 'Write limit reached. Try again in a minute.'}, 429);
    const {id} = await ctx.params;
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const input = patch.safeParse(raw);
    if (!input.success) return json({error: 'Provide message_id and a status of new, dismissed or done.'}, 400);
    const r = await db().prepare('UPDATE inbound_messages SET status=? WHERE id=? AND project_id IN (SELECT id FROM projects WHERE id=? AND owner=?)').bind(input.data.status, input.data.message_id, id, auth.user).run();
    if (!r.meta.changes) return json({error: 'Message not found.'}, 404);
    return json({id: input.data.message_id, status: input.data.status});
  } catch (e) { return failure(e); }
}
