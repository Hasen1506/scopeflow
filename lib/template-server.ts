import {json, ownerAuth, safeOrigin, allowWrite} from './server';

type Ctx = {params: Promise<{id: string}>};
// Shared by the /api/templates/[id] routes: origin, sign-in, write scope, id shape and rate limit.
export async function templateAccess(request: Request, ctx: Ctx) {
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
