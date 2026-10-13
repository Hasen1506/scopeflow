import {db, json, allowWrite, failure} from '@/lib/server';
import {parseWebhook, validSignature, type InboundWa} from '@/lib/whatsapp';
import {appSecret, sendWa} from '@/lib/wa-outbox';
import {captureUrl, createCapture, ownerProjects, pickProject, type CaptureView} from '@/lib/capture';
import {formatMoney} from '@/lib/scope';
export const runtime = 'nodejs';

// Forward-to-bot on ScopeFlow's own WhatsApp number (SF-04, WS-06). The owner links their phone in
// settings (one-time code); then a client message they forward to the bot is matched to a project
// (by name, or by recent activity, or the bot asks "Which project?" with a list), checked by the
// radar, and answered with the verdict, the clause it rests on and a link to the prefilled change
// order. Replies go only to the linked owner who wrote, inside WhatsApp's service window: the bot
// never messages a client. Unsigned or wrongly signed requests are refused (401). A number that
// is not linked gets a short onboarding reply and nothing is stored; a number that belongs to a
// client on any project gets no reply at all.
//
// GET is Meta's subscription check (hub.verify_token = WHATSAPP_VERIFY_TOKEN).

const MAX = 128 * 1024;
const VERDICT: Record<string, string> = {in_scope: 'Covered by the agreement', out_of_scope: 'Not covered: this needs a change order', revision: 'A revision round', ambiguous: 'Unclear: check it yourself'};
const ONBOARDING = 'Hi! This is the Scopeflow bot. To check client requests here, link this number first: open Scopeflow → Account → WhatsApp and enter the code we send you. Scopeflow never messages your clients.';
const HELP = 'Forward a client’s message here and I’ll check it against the agreement and draft a change order if it’s extra work. Send UNLINK to disconnect this number.';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = process.env.WHATSAPP_VERIFY_TOKEN?.trim();
  if (!token) return json({error: 'The WhatsApp bot is not configured on this server.'}, 503);
  if (url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === token) {
    return new Response(url.searchParams.get('hub.challenge') ?? '', {status: 200, headers: {'Content-Type': 'text/plain', 'Cache-Control': 'no-store'}});
  }
  return json({error: 'Verification failed.'}, 403);
}

function verdictReply(title: string, radar: NonNullable<CaptureView['radar']>, link: string) {
  const lines = [`📋 ${title}`, `Radar: ${VERDICT[radar.verdict] ?? radar.verdict}`];
  for (const c of radar.citations.slice(0, 2)) lines.push(`Clause ${c.id}: ${c.text}`.slice(0, 300));
  const co = radar.change_order;
  if (co) {
    const fee = typeof co.fee_delta === 'number' && co.fee_delta ? ` · ${formatMoney(co.fee_delta, radar.currency)}${radar.tax_pct ? ` + ${radar.tax_label} ${radar.tax_pct}%` : ''}` : '';
    lines.push('', `Draft change order: “${co.title}”${fee}`, `Review and propose it: ${link}`);
  } else lines.push('', `Details: ${link}`);
  if (radar.reply) lines.push('', 'Suggested reply to your client:', radar.reply.slice(0, 600));
  return lines.join('\n');
}

async function handle(m: InboundWa): Promise<{kind: string; to: string; status?: string}> {
  const link = await db().prepare('SELECT owner FROM scopeflow.wa_links WHERE phone=?').bind(m.from).first<{owner: string}>();
  if (!link) {
    // Never answer a client: a number on file as a client contact gets no reply.
    const client = await db().prepare('SELECT 1 AS ok FROM projects WHERE client_phone=? LIMIT 1').bind(m.from).first();
    if (client) return {kind: 'ignored_client', to: m.from};
    const sent = await sendWa(null, m.from, 'onboarding', {type: 'text', text: ONBOARDING}, {store: false});
    return {kind: 'onboarding', to: m.from, status: sent.status};
  }
  const owner = link.owner;
  const fresh = await db().prepare('INSERT INTO scopeflow.wa_seen (message_id,created) VALUES (?,?) ON CONFLICT DO NOTHING RETURNING message_id').bind(m.id, new Date().toISOString()).first();
  if (!fresh) return {kind: 'duplicate', to: m.from};
  const reply = async (text: string) => ({kind: 'reply', to: m.from, status: (await sendWa(owner, m.from, 'reply', {type: 'text', text})).status});
  if (m.kind === 'audio') return reply('Voice notes are not transcribed yet. Forward the client’s text message, or type what they asked for.');
  if (m.kind === 'other') return reply('I can only read text messages for now. ' + HELP);
  if (m.kind === 'text' && /^\s*(help|\?)\s*$/i.test(m.text)) return reply(HELP);
  if (m.kind === 'text' && /^\s*unlink\s*$/i.test(m.text)) {
    await db().prepare('DELETE FROM scopeflow.wa_links WHERE owner=?').bind(owner).run();
    await db().prepare('DELETE FROM scopeflow.wa_pending WHERE owner=?').bind(owner).run();
    return reply('This number is unlinked from Scopeflow. Link it again from Account → WhatsApp at any time.');
  }
  let text = m.text, projectId: string | null = null;
  if (m.kind === 'choice') {
    const pending = await db().prepare('DELETE FROM scopeflow.wa_pending WHERE owner=? RETURNING text').bind(owner).first<{text: string}>();
    const chosen = /^p:(.+)$/.exec(m.choice ?? '')?.[1] ?? null;
    if (!pending || !chosen) return reply('That choice has expired. Forward the client’s message again.');
    text = pending.text; projectId = chosen;
  }
  if (text.trim().length < 5) return reply(HELP);
  const projects = await ownerProjects(owner);
  if (!projects.length) return reply('You have no open projects in Scopeflow yet. Create one, then forward the client’s message again.');
  if (projectId && !projects.some(p => p.id === projectId)) return reply('That project is not open any more. Forward the client’s message again.');
  projectId ??= pickProject(text, projects);
  if (!projectId) {
    await db().prepare('INSERT INTO scopeflow.wa_pending (owner,text,created) VALUES (?,?,?) ON CONFLICT (owner) DO UPDATE SET text=excluded.text, created=excluded.created').bind(owner, text.slice(0, 4000), new Date().toISOString()).run();
    const status = (await sendWa(owner, m.from, 'reply', {type: 'list', body: `Which project is this about?\n${projects.map((p, i) => `${i + 1}) ${p.title}`).join('\n')}`.slice(0, 1024), button: 'Choose project', rows: projects.map(p => ({id: 'p:' + p.id, title: p.title, description: p.client}))})).status;
    return {kind: 'ask_project', to: m.from, status};
  }
  const capture = await createCapture(owner, {source: 'whatsapp', text, projectId});
  const title = projects.find(p => p.id === projectId)!.title;
  if (!capture.radar) return reply('I could not read that project’s agreement. Open Scopeflow to check it.');
  return reply(verdictReply(title, capture.radar, captureUrl(capture.id)));
}

export async function POST(request: Request) {
  try {
    const secret = appSecret();
    if (!secret) return json({error: 'The WhatsApp bot is not configured on this server.', code: 'whatsapp_disabled'}, 503);
    if (Number(request.headers.get('content-length') || 0) > MAX) return json({error: 'Payload too large.'}, 413);
    const raw = await request.text();
    if (raw.length > MAX) return json({error: 'Payload too large.'}, 413);
    if (!validSignature(raw, request.headers.get('x-hub-signature-256'), secret)) return json({error: 'Invalid signature.'}, 401);
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return json({error: 'Provide the webhook payload as JSON.'}, 400); }
    const results = [];
    for (const m of parseWebhook(payload)) {
      if (!await allowWrite('wa:' + m.from, 20)) { results.push({kind: 'rate_limited', to: m.from}); continue; }
      results.push(await handle(m));
    }
    // Always 200 for a signed delivery, so Meta does not retry what was handled.
    return json({received: results.length, results: results.map(r => ({kind: r.kind, status: r.status ?? null}))});
  } catch (e) { return failure(e); }
}
