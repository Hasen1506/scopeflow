import {getUser} from '@/lib/auth/server';
import {db, json, safeOrigin, failure} from '@/lib/server';
export const dynamic = 'force-dynamic';
// Disconnect every OAuth-connected app (ChatGPT, Codex, other MCP clients). Browser session only.
export async function GET(request: Request) {
  try {
    if (request.headers.has('authorization')) return json({error: 'Sign in on the Scopeflow website.'}, 401);
    const user = await getUser(); if (!user) return json({error: 'Sign in to manage connected apps.'}, 401);
    const rows = await db().prepare("SELECT c.name, COUNT(*) AS tokens FROM oauth_tokens t LEFT JOIN oauth_clients c ON c.id=t.client_id WHERE t.owner=? AND t.kind='refresh' AND t.expires > ? GROUP BY c.name").bind(user.userId, new Date().toISOString()).all<{name: string | null; tokens: number}>();
    return json({apps: rows.results.map(r => ({name: r.name ?? 'Connected app', tokens: r.tokens}))});
  } catch (e) { return failure(e); }
}
export async function DELETE(request: Request) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    if (request.headers.has('authorization')) return json({error: 'Sign in on the Scopeflow website.'}, 401);
    const user = await getUser(); if (!user) return json({error: 'Sign in to manage connected apps.'}, 401);
    await db().batch([db().prepare('DELETE FROM oauth_tokens WHERE owner=?').bind(user.userId), db().prepare('DELETE FROM oauth_codes WHERE owner=?').bind(user.userId)]);
    return json({disconnected: true});
  } catch (e) { return failure(e); }
}
