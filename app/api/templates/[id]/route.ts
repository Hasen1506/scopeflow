import {db, json, body, failure} from '@/lib/server';
import {templateAccess as access} from '@/lib/template-server';
import {TEMPLATE_REVISIONS_KEPT, templateContent, toView, updateTemplateSchema, type TemplateRow} from '@/lib/template-store';
type Ctx = {params: Promise<{id: string}>};
// PR D: edit or delete one of your own templates. Built-in starters are read-only: save a copy instead.
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
    if (input.data.tags !== undefined) { sets.push('tags=?'); values.push(JSON.stringify(input.data.tags)); }
    // Versioning: a change to the name or content keeps the previous revision (the last
    // TEMPLATE_REVISIONS_KEPT) and bumps the counter; tags alone do not make a revision.
    const revises = input.data.name !== undefined || input.data.content !== undefined;
    const database = db(), now = new Date().toISOString();
    const statements = revises ? [
      database.prepare('INSERT INTO template_revisions (template_id,revision,name,content,created) SELECT id,revision,name,content,updated FROM templates WHERE id=? AND owner=? ON CONFLICT DO NOTHING').bind(a.id, a.user),
      database.prepare('DELETE FROM template_revisions WHERE template_id=? AND revision <= (SELECT revision FROM templates WHERE id=? AND owner=?) - ?').bind(a.id, a.id, a.user, TEMPLATE_REVISIONS_KEPT),
    ] : [];
    const results = await database.batch([...statements, database.prepare(`UPDATE templates SET ${sets.join(',')}${revises ? ',revision=revision+1' : ''},updated=? WHERE id=? AND owner=? RETURNING *`).bind(...values, now, a.id, a.user)], {lock: 'scopeflow:owner:' + a.user});
    const row = (results[results.length - 1].results[0] ?? null) as TemplateRow | null;
    return row ? json({template: toView(row)}) : json({error: 'Template not found.'}, 404);
  } catch (e) { return failure(e); }
}

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    const a = await access(request, ctx);
    if (a.error) return a.error;
    const r = (await db().batch([db().prepare('DELETE FROM template_revisions WHERE template_id IN (SELECT id FROM templates WHERE id=? AND owner=?)').bind(a.id, a.user), db().prepare('DELETE FROM templates WHERE id=? AND owner=?').bind(a.id, a.user)]))[1];
    return r.meta.changes ? json({deleted: true, id: a.id}) : json({error: 'Template not found.'}, 404);
  } catch (e) { return failure(e); }
}
