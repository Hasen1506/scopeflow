import {z} from 'zod';
import {db, json, ownerAuth, body, allowRead, failure} from '@/lib/server';
import {templateAccess} from '@/lib/template-server';
import {toView, type TemplateRow} from '@/lib/template-store';
type Ctx = {params: Promise<{id: string}>};
// Template versioning: GET lists the kept earlier revisions; POST {revision} restores one (as a new
// revision, so the history is never rewritten).
export async function GET(request: Request, ctx: Ctx) {
  try {
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in to manage templates.'}, 401);
    if (!await allowRead('owner:' + auth.user)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const {id} = await ctx.params;
    const t = await db().prepare('SELECT revision,name,updated FROM templates WHERE id=? AND owner=?').bind(id, auth.user).first<{revision: number; name: string; updated: string}>();
    if (!t) return json({error: 'Template not found.'}, 404);
    const rows = await db().prepare('SELECT revision,name,created FROM template_revisions WHERE template_id=? ORDER BY revision DESC').bind(id).all<{revision: number; name: string; created: string}>();
    return json({current: {revision: t.revision, name: t.name, saved: t.updated}, revisions: rows.results.map(r => ({revision: r.revision, name: r.name, saved: r.created}))});
  } catch (e) { return failure(e); }
}
export async function POST(request: Request, ctx: Ctx) {
  try {
    const a = await templateAccess(request, ctx);
    if (a.error) return a.error;
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const input = z.object({revision: z.number().int().min(1)}).strict().safeParse(raw);
    if (!input.success) return json({error: 'Provide the revision number to restore.'}, 400);
    const database = db(), now = new Date().toISOString();
    const results = await database.batch([
      database.prepare('INSERT INTO template_revisions (template_id,revision,name,content,created) SELECT id,revision,name,content,updated FROM templates WHERE id=? AND owner=? AND EXISTS (SELECT 1 FROM template_revisions WHERE template_id=? AND revision=?) ON CONFLICT DO NOTHING').bind(a.id, a.user, a.id, input.data.revision),
      database.prepare('UPDATE templates t SET name=r.name,content=r.content,revision=t.revision+1,updated=? FROM template_revisions r WHERE r.template_id=t.id AND r.revision=? AND t.id=? AND t.owner=? RETURNING t.*').bind(now, input.data.revision, a.id, a.user),
    ], {lock: 'scopeflow:owner:' + a.user});
    const row = (results[1].results[0] ?? null) as TemplateRow | null;
    return row ? json({template: toView(row), restored: input.data.revision}) : json({error: 'That revision was not found.'}, 404);
  } catch (e) { return failure(e); }
}
