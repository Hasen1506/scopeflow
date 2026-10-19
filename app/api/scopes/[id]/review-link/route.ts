import {z} from 'zod';
import {getUser} from '@/lib/auth/server';
import {db, json, body, safeOrigin, allowWrite, secret, failure} from '@/lib/server';
import {teamPowers, workspaceUser} from '@/lib/team';
import {markSent, setLinkIssued} from '@/lib/review-link';
type Ctx = {params: Promise<{id: string}>};

// Review-link actions for one version (§6.3, H4, H5, H2):
//   revoke  pending version: the link stops working (404).
//           decided version: "stop new actions": the link keeps showing the record, ledger,
//           invoices, receipt and statement read-only; no new change orders, payments or cosigns.
//   rotate  a new token. Pending: the old token stops working. Decided: the old token stays a
//           read-only alias, so the client keeps their copy. Restarts that version's expiry only.
//   shared  the creator copied or shared the link (copy button, WhatsApp): marks the version sent,
//           which locks the client contact (C5) and freezes its countersigning roles (M17).
export async function POST(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const user = await getUser();
    if (!user) return json({error: 'Sign in to manage review links.'}, 401);
    const ws = await workspaceUser(request, {user: user.userId, via: 'session', scopes: ['scopes:read', 'scopes:write']});
    if (!teamPowers(ws.role).issueLinks) return json({error: 'Your role cannot create or change share links.', code: 'role'}, 403);
    const {id} = await ctx.params;
    const project = await db().prepare('SELECT id FROM projects WHERE id=? AND owner=? AND owner_deleted IS NULL').bind(id, ws.user).first();
    if (!project) return json({error: 'Project not found.'}, 404);
    const data = z.object({version: z.number().int().min(1), action: z.enum(['revoke', 'rotate', 'shared']), via: z.enum(['copy', 'whatsapp', 'share']).optional()}).strict().safeParse(await body(request));
    if (!data.success) return json({error: 'Choose a version and link action.'}, 400);
    if (!await allowWrite('owner:' + ws.user)) return json({error: 'Try again in a minute.'}, 429);
    const {version, action} = data.data;
    const v = await db().prepare('SELECT token,status FROM versions WHERE project_id=? AND version=?').bind(id, version).first<{token: string; status: string}>();
    if (!v) return json({error: 'Version not found.'}, 404);
    const decided = v.status !== 'pending';
    const now = new Date().toISOString();
    if (action === 'shared') {
      await markSent(id, version, data.data.via ?? 'copy', now);
      return json({shared: true, version});
    }
    if (action === 'revoke') {
      await db().prepare('UPDATE versions SET revoked=1 WHERE project_id=? AND version=?').bind(id, version).run();
      return json({revoked: true, readonly: decided, ...(decided ? {note: 'The client keeps their copy: the link shows the record read-only.'} : {})});
    }
    const token = secret();
    if (decided) await db().prepare('INSERT INTO scopeflow.version_link_aliases (token,project_id,version,reason,created) VALUES (?,?,?,?,?) ON CONFLICT (token) DO NOTHING').bind(v.token, id, version, 'rotated', now).run();
    const result = await db().prepare('UPDATE versions SET token=?,revoked=0 WHERE project_id=? AND version=? AND token=?').bind(token, id, version, v.token).run();
    if (!result.meta.changes) return json({error: 'The link changed at the same time. Reload and try again.', code: 'conflict'}, 409);
    // H5: a replaced link starts a new expiry period for this version only (lib/link.ts).
    await setLinkIssued(id, version, now);
    return json({revoked: false, review_path: '/review/' + token, ...(decided ? {old_link: 'read_only'} : {})});
  } catch (e) {
    if (e instanceof SyntaxError || e instanceof Error && /Input too large|Missing body/.test(e.message)) return json({error: 'Provide valid JSON under 24 KB.'}, 400);
    if (String(e).includes('closed this account')) return json({error: 'This account is closed; the project is read-only.', code: 'account_closed'}, 409);
    return failure(e);
  }
}
