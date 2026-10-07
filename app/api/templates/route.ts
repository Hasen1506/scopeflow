import {db, json, ownerAuth, body, safeOrigin, allowWrite, allowRead, failure} from '@/lib/server';
import {TEMPLATE_LIMIT, builtinTemplates, createTemplateSchema, templateContent, toView, type TemplateRow} from '@/lib/template-store';
// PR D: the templates library. GET lists the built-in starters plus the caller's own; POST saves a draft as a template.
export async function GET(request: Request) {
  try {
    const auth = await ownerAuth(request);
    if (!auth) return json({templates: builtinTemplates(), signed_in: false});
    if (!await allowRead('owner:' + auth.user)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const rows = await db().prepare('SELECT * FROM templates WHERE owner=? ORDER BY updated DESC').bind(auth.user).all<TemplateRow>();
    return json({templates: [...builtinTemplates(), ...rows.results.map(toView)], signed_in: true});
  } catch (e) { return failure(e); }
}
export async function POST(request: Request) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in to save templates.'}, 401);
    if (!auth.scopes.includes('scopes:write')) return json({error: 'This credential cannot save templates.'}, 403);
    if (!await allowWrite('owner:' + auth.user)) return json({error: 'Write limit reached. Try again in a minute.'}, 429);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const input = createTemplateSchema.safeParse(raw);
    if (!input.success) return json({error: 'Name the template (2–80 characters) and include its content.'}, 400);
    const content = templateContent(input.data.content);
    if ('error' in content) return json({error: content.error}, 400);
    const id = 'tpl_' + crypto.randomUUID().replaceAll('-', '').slice(0, 16), now = new Date().toISOString();
    const r = await db().prepare('INSERT INTO templates (id,owner,name,content,created,updated) SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM templates WHERE owner=?) < ? RETURNING *').bind(id, auth.user, input.data.name, JSON.stringify(content.content), now, now, auth.user, TEMPLATE_LIMIT).lock('scopeflow:owner:' + auth.user).first<TemplateRow>();
    if (!r) return json({error: `You can keep up to ${TEMPLATE_LIMIT} templates. Delete one first.`}, 429);
    return json({template: toView(r)}, 201);
  } catch (e) { return failure(e); }
}
