import {z} from 'zod';
import {getUser} from '@/lib/auth/server';
import {db, json, body, safeOrigin, allowWrite, failure} from '@/lib/server';
import {publicUrl} from '@/lib/origin';
import {brandEmail, clientEmailSchema, mailConfig, mailtoLink, sendMail, signatureEmail, reminderEmail, reminderBlock, MailError, MAX_REMINDERS} from '@/lib/mail';
import {loadBrand} from '@/lib/brand-server';
import type {Scope} from '@/lib/scope';
type Ctx = {params: Promise<{id: string}>};

const requestSchema = z.object({
  version: z.number().int().min(1),
  email: clientEmailSchema.optional(),
  reminder: z.boolean().optional(),
}).strict();
type ProjectRow = {latest: number; archived: string | null; client_email: string | null; last_sent: string | null; sent_version: number | null; reminders: number};
const sendState = (p: Pick<ProjectRow, 'last_sent' | 'sent_version' | 'reminders'>) => ({last_sent: p.last_sent ?? null, sent_version: p.sent_version ?? null, reminders: p.reminders ?? 0, max_reminders: MAX_REMINDERS});

// "Send for signature": emails the latest pending version's review link to the client.
// Review links are bearer secrets, so this is limited to the signed-in website owner
// (never an API token or connector), exactly like showing the link (SF-02).
// With {reminder: true} it sends a shorter reminder instead: at most one email a day per version and
// MAX_REMINDERS reminders per version. Only emails the provider accepted are tracked (last_sent).
async function browserUser(request: Request) {
  if (request.headers.has('authorization')) return null;
  return getUser();
}

export async function GET(request: Request, ctx: Ctx) {
  try {
    const user = await browserUser(request);
    if (!user) return json({error: 'Sign in to send review links.'}, 401);
    const {id} = await ctx.params;
    const project = await db().prepare('SELECT client_email,last_sent,sent_version,reminders FROM projects WHERE id=? AND owner=?').bind(id, user.userId).first<ProjectRow>();
    if (!project) return json({error: 'Project not found.'}, 404);
    return json({configured: mailConfig() !== null, client_email: project.client_email ?? '', ...sendState(project)});
  } catch (e) { return failure(e); }
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const user = await browserUser(request);
    if (!user) return json({error: 'Sign in to send review links.'}, 401);
    const {id} = await ctx.params;
    const project = await db().prepare('SELECT latest,archived,client_email,last_sent,sent_version,reminders FROM projects WHERE id=? AND owner=?').bind(id, user.userId).first<ProjectRow>();
    if (!project) return json({error: 'Project not found.'}, 404);
    if (project.archived) return json({error: 'This project is archived. Restore it before sending it for signature.'}, 409);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const input = requestSchema.safeParse(raw);
    if (!input.success) return json({error: input.error.issues.map(i => i.message).join('; ')}, 400);
    if (!await allowWrite('mail:' + user.userId, 10)) return json({error: 'Send limit reached. Try again in a minute.'}, 429);

    const row = await db().prepare('SELECT version,token,revoked,status,content,created FROM versions WHERE project_id=? AND version=?').bind(id, input.data.version).first<{version: number; token: string; revoked: number; status: string; content: string; created: string}>();
    if (!row) return json({error: 'Version not found.'}, 404);
    if (row.version !== project.latest) return json({error: `Version ${project.latest} is the latest. Send that version instead.`}, 409);
    if (row.status !== 'pending') return json({error: 'This version already has a client decision.'}, 409);
    if (row.revoked) return json({error: 'This review link is revoked. Replace the link before sending it.'}, 409);
    const reminder = input.data.reminder === true;
    if (reminder) {
      const blocked = reminderBlock(sendState(project), row.version);
      if (blocked) return json({...blocked, ...sendState(project)}, blocked.code === 'recently_sent' ? 429 : 409);
    }

    const email = input.data.email || project.client_email || '';
    if (!email) return json({error: 'Add the client’s email address first.', code: 'email_required'}, 400);
    if (input.data.email && input.data.email !== project.client_email) {
      await db().prepare('UPDATE projects SET client_email=? WHERE id=? AND owner=?').bind(input.data.email, id, user.userId).run();
    }
    const content = JSON.parse(row.content) as Scope;
    const reviewUrl = publicUrl(request, '/review/' + row.token);
    const wording = await db().prepare('SELECT email_subject,email_body FROM account_settings WHERE owner=?').bind(user.userId).first<{email_subject: string | null; email_body: string | null}>();
    const brand = await loadBrand(user.userId);
    const message = brandEmail(reminder
      ? reminderEmail({title: content.title, client: content.client, version: row.version, reviewUrl, days: Math.floor((Date.now() - Date.parse(row.created)) / 86400_000)})
      : signatureEmail({title: content.title, client: content.client, version: row.version, reviewUrl, template: {subject: wording?.email_subject ?? undefined, body: wording?.email_body ?? undefined}}),
      brand && {name: brand.name, color: brand.color, logoUrl: brand.logoHash ? publicUrl(request, '/api/brand/' + brand.logoHash) : null});
    const fallback = {review_url: reviewUrl, mailto: mailtoLink(email, message)};
    const config = mailConfig();
    if (!config) return json({sent: false, configured: false, reminder, to: email, ...fallback, ...sendState(project)});
    try {
      const result = await sendMail(config, email, message, `scopeflow-${reminder ? 'remind' : 'send'}-${id}-${row.version}-${email}-${Math.floor(Date.now() / 60000)}`.slice(0, 256), {fromName: brand?.name, replyTo: brand?.replyTo});
      const tracked = await db().prepare('UPDATE projects SET last_sent=?, reminders=CASE WHEN ? AND sent_version=? THEN reminders+1 WHEN ? THEN 1 ELSE 0 END, sent_version=? WHERE id=? AND owner=? RETURNING last_sent,sent_version,reminders')
        .bind(new Date().toISOString(), reminder, row.version, reminder, row.version, id, user.userId).first<ProjectRow>();
      return json({sent: true, configured: true, reminder, to: email, provider: config.provider, message_id: result.id, ...sendState(tracked ?? project)});
    } catch (e) {
      if (e instanceof MailError) return json({error: e.message + ' Copy the link or use your mail app instead.', code: 'mail_failed', sent: false, configured: true, to: email, ...fallback}, 502);
      throw e;
    }
  } catch (e) { return failure(e); }
}
