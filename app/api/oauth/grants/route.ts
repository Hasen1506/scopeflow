import {getUser} from '@/lib/auth/server';
import {db, json, safeOrigin, failure} from '@/lib/server';
import {listGrants, revokeFamily} from '@/lib/oauth';
export const dynamic = 'force-dynamic';
// M24: connected apps, one entry per grant (each consent), with the domain the app returns to,
// whether that domain is verified, its scopes, when it was connected and last used. Browser session only.
export async function GET(request: Request) {
  try {
    if (request.headers.has('authorization')) return json({error: 'Sign in on the Scopeflow website.'}, 401);
    const user = await getUser({fresh: false}); if (!user) return json({error: 'Sign in to manage connected apps.'}, 401);
    const grants = await listGrants(user.userId);
    // `apps` keeps the earlier shape (one name per entry) for older clients of this endpoint.
    return json({grants, apps: grants.map(g => ({name: g.name, tokens: 1}))});
  } catch (e) { return failure(e); }
}
// DELETE ?grant=<id> disconnects one grant; without it every connected app is disconnected.
export async function DELETE(request: Request) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    if (request.headers.has('authorization')) return json({error: 'Sign in on the Scopeflow website.'}, 401);
    const user = await getUser(); if (!user) return json({error: 'Sign in to manage connected apps.'}, 401);
    const grant = new URL(request.url).searchParams.get('grant');
    if (grant !== null) {
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(grant)) return json({error: 'Unknown connection.'}, 404);
      if (!await revokeFamily(grant, 'user', user.userId)) return json({error: 'This connection was not found or is already disconnected.'}, 404);
      return json({disconnected: true, grant});
    }
    const now = new Date().toISOString();
    await db().batch([
      db().prepare('DELETE FROM oauth_tokens WHERE owner=?').bind(user.userId),
      db().prepare('DELETE FROM oauth_codes WHERE owner=?').bind(user.userId),
      db().prepare("UPDATE scopeflow.oauth_grants SET revoked=?, revoked_reason='user' WHERE owner=? AND revoked IS NULL").bind(now, user.userId),
    ]);
    return json({disconnected: true});
  } catch (e) { return failure(e); }
}
