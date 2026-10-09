import {z} from 'zod';
import {db, json, body, failure, secret} from '@/lib/server';
import {templateAccess} from '@/lib/template-server';
import {toView, type TemplateRow} from '@/lib/template-store';
type Ctx = {params: Promise<{id: string}>};
// Sharing a template: {share: true} makes (or keeps) a private share link, {share: false} turns it off,
// {rotate: true} replaces it. Anyone with the link sees the template (not who made it) and can add a
// copy to their own library; later edits show up for them only if they import again.
export async function POST(request: Request, ctx: Ctx) {
  try {
    const a = await templateAccess(request, ctx);
    if (a.error) return a.error;
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const input = z.object({share: z.boolean(), rotate: z.boolean().optional()}).strict().safeParse(raw);
    if (!input.success) return json({error: 'Provide share: true or false.'}, 400);
    const token = secret().slice(0, 32);
    const sql = !input.data.share ? 'UPDATE templates SET share_token=NULL WHERE id=? AND owner=? RETURNING *'
      : input.data.rotate ? 'UPDATE templates SET share_token=? WHERE id=? AND owner=? RETURNING *'
      : 'UPDATE templates SET share_token=coalesce(share_token,?) WHERE id=? AND owner=? RETURNING *';
    const row = await (input.data.share ? db().prepare(sql).bind(token, a.id, a.user) : db().prepare(sql).bind(a.id, a.user)).first<TemplateRow>();
    return row ? json({template: toView(row)}) : json({error: 'Template not found.'}, 404);
  } catch (e) { return failure(e); }
}
