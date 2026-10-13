import {z} from 'zod';
import {db, json, ownerAuth, body, safeOrigin, allowWrite, allowRead, failure} from '@/lib/server';
import {inboundAddress, inboundConfig} from '@/lib/inbound';
import {storeInboundMessage} from '@/lib/inbound-server';
import {recordOwnerContact} from '@/lib/owner-contact';
type Ctx = {params: Promise<{id: string}>};
type Row = {id: string; received: string; sender: string | null; subject: string | null; body: string; radar: string | null; status: string};
type Held = {id: string; received: string; sender: string | null; subject: string | null; body: string; reason: string; auth: string | null; message_id: string | null};
// Client emails forwarded to the project's inbound address, newest first, with the radar's first read.
// WS-06 (L7): plus the quarantine, mail from senders outside the project's allow-list or failing
// SPF/DKIM, which the owner can release into the inbox (optionally allowing the sender) or dismiss.
export async function GET(request: Request, ctx: Ctx) {
  try {
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in or provide a valid API token.'}, 401);
    if (!await allowRead('owner:' + auth.user)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const {id} = await ctx.params;
    const project = await db().prepare('SELECT inbound_token FROM projects WHERE id=? AND owner=?').bind(id, auth.user).first<{inbound_token: string | null}>();
    if (!project) return json({error: 'Project not found.'}, 404);
    // The owner's own sign-in address is on every project's allow-list (forwards come from it).
    if (auth.via === 'session') await recordOwnerContact(auth.user);
    const [rows, held] = await Promise.all([
      db().prepare("SELECT id,received,sender,subject,body,radar,status FROM inbound_messages WHERE project_id=? AND status<>'dismissed' ORDER BY received DESC LIMIT 50").bind(id).all<Row>(),
      db().prepare("SELECT id,received,sender,subject,body,reason,auth,message_id FROM scopeflow.inbound_quarantine WHERE project_id=? AND status='held' ORDER BY received DESC LIMIT 50").bind(id).all<Held>(),
    ]);
    return json({configured: !!inboundConfig(), address: inboundAddress(project.inbound_token), messages: rows.results.map(r => ({...r, radar: r.radar ? JSON.parse(r.radar) : null})),
      quarantine: held.results.map(h => ({id: h.id, received: h.received, sender: h.sender, subject: h.subject, body: h.body, reason: h.reason, auth: h.auth ? JSON.parse(h.auth) : null}))});
  } catch (e) { return failure(e); }
}
const patch = z.union([
  z.object({message_id: z.string().uuid(), status: z.enum(['new', 'dismissed', 'done'])}).strict(),
  z.object({quarantine_id: z.string().uuid(), action: z.enum(['release', 'dismiss']), allow_sender: z.boolean().optional()}).strict(),
]);
export async function PATCH(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in or provide a valid API token.'}, 401);
    if (!auth.scopes.includes('scopes:write')) return json({error: 'This credential cannot change projects.'}, 403);
    if (!await allowWrite('owner:' + auth.user)) return json({error: 'Write limit reached. Try again in a minute.'}, 429);
    const {id} = await ctx.params;
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const input = patch.safeParse(raw);
    if (!input.success) return json({error: 'Provide message_id and a status of new, dismissed or done, or quarantine_id and an action of release or dismiss.'}, 400);
    if ('quarantine_id' in input.data) {
      const q = input.data;
      const held = await db().prepare("UPDATE scopeflow.inbound_quarantine SET status=? WHERE id=? AND status='held' AND project_id IN (SELECT id FROM projects WHERE id=? AND owner=?) RETURNING id,received,sender,subject,body,message_id")
        .bind(q.action === 'release' ? 'released' : 'dismissed', q.quarantine_id, id, auth.user).first<Held>();
      if (!held) return json({error: 'Message not found.'}, 404);
      if (q.action === 'dismiss') return json({id: held.id, status: 'dismissed'});
      if (q.allow_sender && held.sender) await db().prepare('INSERT INTO scopeflow.inbound_allow (project_id,address,created) VALUES (?,?,?) ON CONFLICT DO NOTHING').bind(id, held.sender.toLowerCase(), new Date().toISOString()).run();
      const messageId = await storeInboundMessage(id, {messageId: held.message_id, sender: held.sender, subject: held.subject, body: held.body, received: held.received});
      return json({id: held.id, status: 'released', message_id: messageId, sender_allowed: !!(q.allow_sender && held.sender)});
    }
    const r = await db().prepare('UPDATE inbound_messages SET status=? WHERE id=? AND project_id IN (SELECT id FROM projects WHERE id=? AND owner=?)').bind(input.data.status, input.data.message_id, id, auth.user).run();
    if (!r.meta.changes) return json({error: 'Message not found.'}, 404);
    return json({id: input.data.message_id, status: input.data.status});
  } catch (e) { return failure(e); }
}
