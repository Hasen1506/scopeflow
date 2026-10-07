import {db, json, ownerAuth, body, safeOrigin, allowWrite, failure} from '@/lib/server';
import {templateContent, toView, updateTemplateSchema, type TemplateRow} from '@/lib/template-store';
type Ctx = {params: Promise<{id: string}>};
// PR D: edit or delete one of your own templates. Built-in starters are read-only: save a copy instead.
async function access(request: Request, ctx: Ctx) {
  if (!safeOrigin(request)) return {error: json({error: 'Origin not allowed.'}, 403)};
  const auth = await ownerAuth(request);
  if (!auth) return {error: json({error: 'Sign in to manage templates.'}, 401)};
  if (!auth.scopes.includes('scopes:write')) return {error: json({error: 'This credential cannot change templates.'}, 403)};
  const {id} = await ctx.params;
  if (id.startsWith('builtin:')) return {error: json({error: 'Built-in templates cannot be changed. Save your edited draft as a new template instead.', code: 'builtin'}, 409)};
  if (!/^tpl_[a-f0-9]{16}$/.test(id)) return {error: json({error: 'Template not found.'}, 404)};
  if (!await allowWrite('owner:' + auth.user)) return {error: json({error: 'Write limit reached. Try again in a minute.'}, 429)};
  return {user: auth.user, id};
}
export async function PUT(request: Request, ctx: Ctx) {
  try {
    const a = await access(request, ctx);
    if (a.error) return a.error;
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const input = updateTemplateSchema.safeParse(raw);
    if (!input.success) return json({error: 'Provide a new name (2–80 characters) or content.'}, 400);
    const sets: string[] = [], values: string[] = [];
    if (input.data.name !== undefined) { sets.push('name=?'); values.push(input.data.name); }
    if (input.data.content !== undefined) {
      const content = templateContent(input.data.content);
      if ('error' in content) return json({error: content.error}, 400);
      sets.push('content=?'); values.push(JSON.stringify(content.content));
    }
    const row = await db().prepare(`UPDATE templates SET ${sets.join(',')},updated=? WHERE id=? AND owner=? RETURNING *`).bind(...values, new Date().toISOString(), a.id, a.user).first<TemplateRow>();
    return row ? json({template: toView(row)}) : json({error: 'Template not found.'}, 404);
  } catch (e) { return failure(e); }
}
export async function DELETE(request: Request, ctx: Ctx) {
  try {
    const a = await access(request, ctx);
    if (a.error) return a.error;
    const r = await db().prepare('DELETE FROM templates WHERE id=? AND owner=?').bind(a.id, a.user).run();
    return r.meta.changes ? json({deleted: true, id: a.id}) : json({error: 'Template not found.'}, 404);
  } catch (e) { return failure(e); }
}
