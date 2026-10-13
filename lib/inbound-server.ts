import {db} from './server';
import {radarBasis} from './radar-server';
import {embeddingConfig} from './embeddings';
import {scopeRadar} from './radar';
import {allowList, cosignerEmails} from './inbound';

// Server side of email forwarding (WS-06, L7): the project's sender allow-list and storing a
// message in the radar inbox. Used by the inbound webhook and by "Release" on a quarantined message.

/** Client email, cosigner emails, the owner's own addresses and senders the owner released with "always allow". */
export async function projectAllowList(projectId: string) {
  const p = await db().prepare('SELECT owner,client_email,cosigners FROM projects WHERE id=?').bind(projectId).first<{owner: string; client_email: string | null; cosigners: string | null}>();
  if (!p) return [];
  const [contact, profile, extra] = await Promise.all([
    db().prepare('SELECT email FROM scopeflow.owner_contacts WHERE owner=?').bind(p.owner).first<{email: string}>(),
    db().prepare('SELECT reply_to FROM business_profiles WHERE owner=?').bind(p.owner).first<{reply_to: string | null}>(),
    db().prepare('SELECT address FROM scopeflow.inbound_allow WHERE project_id=?').bind(projectId).all<{address: string}>(),
  ]);
  return allowList(p.client_email, cosignerEmails(p.cosigners), contact?.email, profile?.reply_to, extra.results.map(r => r.address));
}

/** Runs the radar (keyword + meaning match; never the paid model) and stores the message for the owner. */
export async function storeInboundMessage(projectId: string, m: {messageId: string | null; sender: string | null; subject: string | null; body: string; received?: string}) {
  const basis = await radarBasis(projectId);
  const radar = basis ? await scopeRadar(m.body, basis.scope, basis.agreement, {embeddings: embeddingConfig()}).catch(() => null) : null;
  const id = crypto.randomUUID();
  const row = await db().prepare('INSERT INTO inbound_messages (id,project_id,message_id,received,sender,subject,body,radar) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING RETURNING id')
    .bind(id, projectId, m.messageId, m.received ?? new Date().toISOString(), m.sender?.slice(0, 254) || null, m.subject || null, m.body, radar ? JSON.stringify({verdict: radar.verdict, covered: radar.covered, engine: radar.engine, citations: radar.citations.map(c => ({id: c.id, kind: c.kind, text: c.text})), reply: radar.reply, basis: basis!.basis}) : null).first<{id: string}>();
  return row?.id ?? null;
}
