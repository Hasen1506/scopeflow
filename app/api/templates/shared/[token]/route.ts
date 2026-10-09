import {db, json, ownerAuth, safeOrigin, allowRead, allowWrite, failure, ipKey} from '@/lib/server';
import {TEMPLATE_LIMIT, sharedView, toView, type TemplateRow} from '@/lib/template-store';
type Ctx = {params: Promise<{token: string}>};
const find = (token: string) => /^[a-f0-9]{32}$/.test(token) ? db().prepare('SELECT * FROM templates WHERE share_token=?').bind(token).first<TemplateRow>() : Promise.resolve(null);
// A shared template: GET shows it to anyone with the link; POST (signed in) adds a copy to the caller's library.
export async function GET(request: Request, ctx: Ctx) {
  try {
    if (!await allowRead('template-share:' + await ipKey(request), 60)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const row = await find((await ctx.params).token);
    return row ? json({template: sharedView(row)}) : json({error: 'This template link was not found or is no longer shared.'}, 404);
  } catch (e) { return failure(e); }
}
export async function POST(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in to add this template to your library.'}, 401);
    if (!auth.scopes.includes('scopes:write')) return json({error: 'This credential cannot save templates.'}, 403);
    if (!await allowWrite('owner:' + auth.user)) return json({error: 'Write limit reached. Try again in a minute.'}, 429);
    const row = await find((await ctx.params).token);
    if (!row) return json({error: 'This template link was not found or is no longer shared.'}, 404);
    const id = 'tpl_' + crypto.randomUUID().replaceAll('-', '').slice(0, 16), now = new Date().toISOString();
    const copy = await db().prepare('INSERT INTO templates (id,owner,name,content,tags,origin,created,updated) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM templates WHERE owner=?) < ? RETURNING *')
      .bind(id, auth.user, row.name, row.content, row.tags ?? '[]', `Imported from a shared link (revision ${row.revision ?? 1})`, now, now, auth.user, TEMPLATE_LIMIT).lock('scopeflow:owner:' + auth.user).first<TemplateRow>();
    if (!copy) return json({error: `You can keep up to ${TEMPLATE_LIMIT} templates. Delete one first.`}, 429);
    return json({template: toView(copy)}, 201);
  } catch (e) { return failure(e); }
}
