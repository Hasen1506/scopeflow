import {db, json, allowWrite, failure} from '@/lib/server';
import {clientMessage, inboundAuthorized, inboundConfig, parseInbound, tokenFrom} from '@/lib/inbound';
import {radarBasis} from '@/lib/radar-server';
import {embeddingConfig} from '@/lib/embeddings';
import {scopeRadar} from '@/lib/radar';
export const runtime = 'nodejs';
// Email forwarding into the radar (lib/inbound.ts). The mail provider's inbound webhook posts each
// email sent to scope-<token>@SCOPEFLOW_INBOUND_DOMAIN here. The forwarded client message is checked
// with the keyword radar (and the meaning match when embeddings are configured; the AI radar runs
// only when the owner asks, so unsolicited mail never spends model calls) and stored for the owner.
// Unknown addresses are accepted and dropped (200), so the provider does not retry them.
const MAX = 256 * 1024;
export async function POST(request: Request) {
  try {
    const config = inboundConfig();
    if (!config) return json({error: 'Email forwarding is not configured on this server.', code: 'inbound_disabled'}, 503);
    if (!inboundAuthorized(request.headers.get('authorization'), config.secret)) return json({error: 'Unauthorized.'}, 401, {'WWW-Authenticate': 'Basic realm="scopeflow-inbound"'});
    if (Number(request.headers.get('content-length') || 0) > MAX) return json({error: 'Message too large.'}, 413);
    const text = await request.text();
    if (text.length > MAX) return json({error: 'Message too large.'}, 413);
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return json({error: 'Provide the inbound email as JSON.'}, 400); }
    const mail = parseInbound(raw);
    if (!mail) return json({error: 'The email has no recipient or no text.'}, 400);
    const token = tokenFrom(mail.recipients, config.domain);
    const project = token ? await db().prepare('SELECT id FROM projects WHERE inbound_token=? AND archived IS NULL').bind(token).first<{id: string}>() : null;
    if (!project) return json({accepted: false, reason: 'unknown_address'});
    if (!await allowWrite('inbound:' + project.id, 30)) return json({error: 'Too many forwarded emails for this project. Try again in a minute.'}, 429);
    const message = clientMessage(mail.text);
    if (message.length < 5) return json({accepted: false, reason: 'empty'});
    if (mail.messageId) {
      const seen = await db().prepare('SELECT id FROM inbound_messages WHERE project_id=? AND message_id=?').bind(project.id, mail.messageId).first<{id: string}>();
      if (seen) return json({accepted: true, id: seen.id, duplicate: true});
    }
    const basis = await radarBasis(project.id);
    const radar = basis ? await scopeRadar(message, basis.scope, basis.agreement, {embeddings: embeddingConfig()}).catch(() => null) : null;
    const id = crypto.randomUUID();
    await db().prepare('INSERT INTO inbound_messages (id,project_id,message_id,received,sender,subject,body,radar) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING')
      .bind(id, project.id, mail.messageId, new Date().toISOString(), mail.from.slice(0, 254) || null, mail.subject || null, message, radar ? JSON.stringify({verdict: radar.verdict, covered: radar.covered, engine: radar.engine, citations: radar.citations.map(c => ({id: c.id, kind: c.kind, text: c.text})), reply: radar.reply, basis: basis!.basis}) : null).run();
    return json({accepted: true, id}, 201);
  } catch (e) { return failure(e); }
}
