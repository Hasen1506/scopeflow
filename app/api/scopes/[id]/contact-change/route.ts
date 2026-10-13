import {z} from 'zod';
import {appendFileSync} from 'node:fs';
import {db, json, body, safeOrigin, ownerAuth, allowWrite, failure} from '@/lib/server';
import {clientEmailSchema} from '@/lib/mail';
import {contactMessage} from '@/lib/contact';
import {signRecord} from '@/lib/signing';
import {otpDevMode} from '@/lib/otp';
import {notify} from '@/lib/notify';
import {getUser} from '@/lib/auth/server';
import {dayInZone, maskAddress} from '@/lib/evidence';
import {requireFreshSession, signingBlocked, signingUnavailable} from '@/lib/identity';
type Ctx = {params: Promise<{id: string}>};

const input = z.object({
  email: clientEmailSchema.optional(),
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/, 'Enter the phone number in international form, e.g. +919876543210').optional(),
  reason: z.string().trim().min(3, 'Say why the contact changes (the old address is told).').max(300),
  confirm: z.literal(true),
}).strict().refine(x => (x.email !== undefined) !== (x.phone !== undefined), 'Change either the email or the phone, one at a time.');

// C5 (§6.2.3): the only way to change a locked client contact. A freshly signed-in browser session
// only (M16). The OLD address gets a notice, the change is a signed contact_history record shown in
// the client's timeline, and later receipts show the new "on file since" date.
export async function POST(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in required.'}, 401);
    const refused = await requireFreshSession(auth);
    if (refused) return refused;
    const {id} = await ctx.params;
    if (!await allowWrite('owner:' + auth.user)) return json({error: 'Write limit reached. Try again in a minute.'}, 429);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const parsed = input.safeParse(raw);
    if (!parsed.success) return json({error: parsed.error.issues.map(i => i.message).join('; '), code: 'invalid_input'}, 400);
    const p = await db().prepare('SELECT id,client_email,client_phone,require_otp,otp_channel,timezone,(SELECT content FROM versions WHERE project_id=projects.id ORDER BY version DESC LIMIT 1) AS content FROM projects WHERE id=? AND owner=? AND owner_deleted IS NULL').bind(id, auth.user).first<{id: string; client_email: string | null; client_phone: string | null; require_otp: boolean; otp_channel: string | null; timezone: string | null; content: string | null}>();
    if (!p) return json({error: 'Project not found.'}, 404);
    const field = parsed.data.email !== undefined ? 'email' : 'phone';
    const next = (field === 'email' ? parsed.data.email : parsed.data.phone) || null;
    const old = field === 'email' ? p.client_email : p.client_phone;
    if ((next ?? null) === (old ?? null)) return json({error: 'That is already the contact on file.', code: 'unchanged'}, 400);
    if (!next && p.require_otp && (field === 'email') === ((p.otp_channel ?? 'email') === 'email')) return json({error: 'The one-time code is sent there. Turn the identity check off first, or give the new address.', code: 'otp_needs_contact'}, 400);
    if (signingBlocked()) return signingUnavailable();
    const kind = field === 'email' ? 'email' : 'sms';
    const at = new Date().toISOString();
    const record = {project_id: id, field, from_masked: old ? maskAddress(kind, old) : null, to_masked: next ? maskAddress(kind, next) : null, reason: parsed.data.reason, at};
    const signature = signRecord(await contactMessage(record));
    // The notice to the old address (WS-06 delivers notify(); its outcome is kept with the record).
    const owner = await getUser().catch(() => null);
    const title = (() => { try { return (JSON.parse(p.content ?? '{}') as {title?: string}).title ?? 'your project'; } catch { return 'your project'; } })();
    const text = `The contact for ${title} was changed from this address to ${record.to_masked ?? 'none'} on ${dayInZone(at, p.timezone)}. If you didn't expect this, reply to ${owner?.email ?? 'the creator'}.`;
    let notice: {event: string; to: string | null; delivered: boolean; channel: string} = {event: 'contact_changed_old_address', to: record.from_masked, delivered: false, channel: 'none'};
    if (old) {
      const sent = await notify('contact_changed_old_address', {project_id: id, owner: auth.user, to: old, data: {title, field, from_masked: record.from_masked, to_masked: record.to_masked, at, reason: record.reason, reply_to: owner?.email ?? null, text}}).catch(() => null);
      notice = {...notice, delivered: !!sent?.delivered, channel: sent?.channel ?? 'log'};
      // Local/CI only: the mail stub log (the same dev log one-time codes go to), so tests can read the notice.
      // integration: with WS-06's mail router a CI stub provider can report delivered; log the notice in dev mode either way
      if (otpDevMode() && process.env.SCOPEFLOW_OTP_DEV_LOG) { try { appendFileSync(process.env.SCOPEFLOW_OTP_DEV_LOG, JSON.stringify({kind: 'notice', event: 'contact_changed_old_address', project_id: id, to: old, text, at}) + '\n'); } catch { /* dev log only */ } }
    }
    await db().batch([
      db().prepare(`UPDATE projects SET ${field === 'email' ? 'client_email' : 'client_phone'}=?,contact_since=? WHERE id=? AND owner=?`).bind(next, next ? at : null, id, auth.user),
      db().prepare('INSERT INTO scopeflow.contact_history (id,project_id,field,from_masked,to_masked,reason,at,signature,notice) VALUES (?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(), id, field, record.from_masked, record.to_masked, record.reason, at, signature, JSON.stringify(notice)),
    ]);
    return json({changed: true, field, contact_since: next ? at : null, contact_history: {...record, signature}, notice});
  } catch (e) {
    if (String(e).includes('closed this account')) return json({error: 'This account is closed; the project is read-only.', code: 'account_closed'}, 409);
    return failure(e);
  }
}
