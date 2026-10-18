import {z} from 'zod';
import {db, json, ownerAuth, body, safeOrigin, allowWrite, allowRead, failure} from '@/lib/server';
import {publicUrl} from '@/lib/origin';
import {drainNotifyEvents} from '@/lib/notify';
import {markFirstSent} from '@/lib/owner-contact';
import {loadLedger} from '@/lib/ledger-server';
import {totals} from '@/lib/money';
import {formatMoney} from '@/lib/scope';
type Ctx = {params: Promise<{id: string}>};

// Client notifications for one project (H18, SF-13; WS-06). GET sends any change-order or invoice
// notice the database queued for this project (owner UI, API or MCP), then lists what the client
// was told: per change order and invoice, the email status and, for the signed-in owner, what the
// WhatsApp share needs (the review link is a bearer secret, so API tokens never get it).
// PATCH {notify_client} switches the client notices off or on; POST {shared} records that the owner
// shared the link themselves (WhatsApp or copy), which counts as sending it.
type Outbox = {event: string; dedupe_key: string | null; status: string; sent: string | null; created: string};
export async function GET(request: Request, ctx: Ctx) {
  try {
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in or provide a valid API token.'}, 401);
    if (!await allowRead('owner:' + auth.user)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const {id} = await ctx.params;
    const project = await db().prepare('SELECT p.notify_client,p.client_email,p.client_phone,v.token,v.content FROM projects p JOIN versions v ON v.project_id=p.id AND v.version=p.latest WHERE p.id=? AND p.owner=?').bind(id, auth.user).first<{notify_client: boolean; client_email: string | null; client_phone: string | null; token: string; content: string}>();
    if (!project) return json({error: 'Project not found.'}, 404);
    await drainNotifyEvents({projectId: id});
    const [ledger, rows, ownerMail, invoices, pending] = await Promise.all([
      loadLedger(id),
      db().prepare("SELECT event,dedupe_key,status,sent,created FROM scopeflow.mail_outbox WHERE project_id=? AND event IN ('co_proposed','invoice_issued','payment_reminder') ORDER BY created").bind(id).all<Outbox>(),
      db().prepare("SELECT status,subject,created FROM scopeflow.mail_outbox WHERE project_id=? AND event='client_decision' ORDER BY created").bind(id).all<{status: string; subject: string | null; created: string}>(),
      db().prepare('SELECT seq,number,amount,currency,content FROM invoices WHERE project_id=? ORDER BY seq').bind(id).all<{seq: number; number: string; amount: number; currency: string; content: string}>(),
      db().prepare("SELECT event,ref,status FROM scopeflow.notify_events WHERE project_id=?").bind(id).all<{event: string; ref: string; status: string}>(),
    ]);
    const emailFor = (event: string, ref: string) => {
      const row = rows.results.filter(r => r.dedupe_key === `${event}:${id}:${ref}`).at(-1);
      if (row) return {status: row.status, at: row.sent ?? row.created};
      const queued = pending.results.find(p => p.event === event && p.ref === ref);
      return queued ? {status: queued.status === 'skipped' ? 'skipped' : queued.status === 'pending' ? 'queued' : 'not_sent', at: null} : null;
    };
    const browser = auth.via === 'session';
    const content = JSON.parse(project.content) as {title: string; client: string; language?: string};
    const base = ledger.content;
    return json({
      notify_client: project.notify_client !== false, client_email: !!project.client_email,
      share: browser ? {phone: project.client_phone, lang: content.language ?? null, client: content.client, title: content.title, link: publicUrl(request, '/review/' + project.token)} : null,
      change_orders: (ledger.agreement?.change_orders ?? []).map(c => ({seq: c.seq, title: c.title, status: c.status, amount: base ? formatMoney(totals(base, c.fee_delta).total, ledger.agreement!.currency) : null, email: emailFor('co_proposed', String(c.seq))})),
      invoices: invoices.results.map(i => ({seq: i.seq, number: i.number, amount: formatMoney(Number(i.amount), i.currency), due: (JSON.parse(i.content) as {due?: string}).due ?? null, email: emailFor('invoice_issued', String(i.seq))})),
      owner_mail: ownerMail.results.map(r => ({status: r.status, subject: r.subject, created: r.created})),
    });
  } catch (e) { return failure(e); }
}
const patch = z.object({notify_client: z.boolean()}).strict();
const shared = z.object({shared: z.enum(['whatsapp', 'link'])}).strict();
async function access(request: Request, ctx: Ctx) {
  if (!safeOrigin(request)) return {error: json({error: 'Origin not allowed.'}, 403)};
  const auth = await ownerAuth(request);
  if (!auth) return {error: json({error: 'Sign in or provide a valid API token.'}, 401)};
  if (!auth.scopes.includes('scopes:write')) return {error: json({error: 'This credential cannot change projects.'}, 403)};
  if (!await allowWrite('owner:' + auth.user)) return {error: json({error: 'Write limit reached. Try again in a minute.'}, 429)};
  const {id} = await ctx.params;
  const project = await db().prepare('SELECT id FROM projects WHERE id=? AND owner=?').bind(id, auth.user).first();
  if (!project) return {error: json({error: 'Project not found.'}, 404)};
  let raw;
  try { raw = await body(request); } catch { return {error: json({error: 'Provide valid JSON under 24 KB.'}, 400)}; }
  return {id, raw};
}
export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const a = await access(request, ctx);
    if ('error' in a) return a.error;
    const input = patch.safeParse(a.raw);
    if (!input.success) return json({error: 'Provide notify_client: true or false.'}, 400);
    await db().prepare('UPDATE projects SET notify_client=? WHERE id=?').bind(input.data.notify_client, a.id).run();
    return json({notify_client: input.data.notify_client});
  } catch (e) { return failure(e); }
}
export async function POST(request: Request, ctx: Ctx) {
  try {
    const a = await access(request, ctx);
    if ('error' in a) return a.error;
    if (!shared.safeParse(a.raw).success) return json({error: 'Provide shared: whatsapp or link.'}, 400);
    await markFirstSent(a.id);
    return json({recorded: true});
  } catch (e) { return failure(e); }
}
