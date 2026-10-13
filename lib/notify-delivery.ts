import type {NotifyEvent, NotifyPayload} from './contracts';
import {db} from './server';
import {configuredOrigin} from './origin';
import {loadLedger} from './ledger-server';
import {loadBrand} from './brand-server';
import {totals} from './money';
import {formatMoney, type Scope} from './scope';
import {accountClosedEmail, brandEmail, changeOrderEmail, contactChangedEmail, cosignInviteEmail, invoiceIssuedEmail, invoiceReminderEmail, ownerAlertEmail, unsubscribeHeaders, type SignatureEmail} from './mail';
import {MailCapError, retryDue, sendViaOutbox} from './mail-outbox';
import type {MailClass} from './mail-router';
import {shareMessage, waLink, type ShareKind} from './whatsapp-share';
import {unsubscribeUrl} from './unsubscribe';
import {NOTIFY_EVENTS, OPTIONAL_CLIENT_EVENTS, type NotifyOutcome} from './notify';

// Delivery for notify() (owner: WS-06; H18, SF-13). lib/notify.ts loads this lazily. notify(event, payload) is the one way any workstream
// tells a client or an owner that something happened. Email goes through the outbox and the mail
// router (lib/mail-outbox.ts); the owner also gets a prefilled wa.me link to share the same news on
// WhatsApp themselves (ScopeFlow never messages a client on WhatsApp).
//
// Client notices for change orders, invoices and payment reminders respect the project's
// `notify_client` switch (default on). Required notices (contact changed, countersign invitation,
// account closed) are always sent. Every call is idempotent per (event, project, ref): a dedupe
// key on the outbox row means a retried call or a second trigger never emails twice.
//
// Change orders and invoices are also queued by database triggers (migration 0021), whatever
// route wrote them (owner UI, API, MCP), and drained by drainNotifyEvents() from the project's
// notifications route and the reminders cron.

const CLASS: Record<NotifyEvent, MailClass> = {
  co_proposed: 'transactional', invoice_issued: 'transactional', payment_reminder: 'bulk', contact_changed_old_address: 'auth',
  cosign_invite: 'transactional', payment_claim: 'transactional', payment_alert: 'transactional', account_closed_client_notice: 'transactional',
};
const OWNER_EVENTS: readonly NotifyEvent[] = ['payment_claim', 'payment_alert'];


type ProjectRow = {id: string; owner: string; latest: number; client_email: string | null; client_phone: string | null; notify_client: boolean; content: string; token: string; status: string};
async function projectOf(id: string) {
  return db().prepare(`SELECT p.id,p.owner,p.latest,p.client_email,p.client_phone,p.notify_client,v.content,v.token,v.status FROM projects p JOIN versions v ON v.project_id=p.id AND v.version=p.latest WHERE p.id=?`).bind(id).first<ProjectRow>();
}
async function senderOf(owner: string) {
  const [profile, contact, brand] = await Promise.all([
    db().prepare('SELECT business_name,reply_to FROM business_profiles WHERE owner=?').bind(owner).first<{business_name: string | null; reply_to: string | null}>(),
    db().prepare('SELECT email,email_verified FROM scopeflow.owner_contacts WHERE owner=?').bind(owner).first<{email: string; email_verified: boolean}>(),
    loadBrand(owner),
  ]);
  const verified = !!contact?.email_verified;
  const seller = profile?.business_name?.trim() || '';
  // M19: "<Business> via ScopeFlow" only once the owner's own address is verified.
  return {seller, fromName: verified && seller ? seller : null, replyTo: profile?.reply_to || (verified ? contact!.email : null), ownerEmail: contact?.email ?? null, brand};
}
const origin = () => configuredOrigin() ?? 'http://localhost:5173';
const str = (v: unknown, max = 400) => typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' ? String(v) : '';

type Rendered = {to: string; message: SignatureEmail; share?: {kind: ShareKind; values: Parameters<typeof shareMessage>[1]; phone: string | null; lang?: string}; ref: string; headers?: Record<string, string>; replyTo?: string | null};

async function render(event: NotifyEvent, payload: NotifyPayload, project: ProjectRow | null, sender: Awaited<ReturnType<typeof senderOf>>): Promise<Rendered | {skip: string}> {
  const data = payload.data ?? {};
  const content = project ? JSON.parse(project.content) as Scope : null;
  const reviewUrl = project ? `${origin()}/review/${project.token}` : '';
  const clientTo = payload.to ?? project?.client_email ?? null;
  if (event === 'co_proposed') {
    if (!project || !content) return {skip: 'project_not_found'};
    const seq = Number(data.seq);
    const ledger = await loadLedger(project.id);
    const co = ledger.agreement?.change_orders.find(c => c.seq === seq);
    if (!co || !ledger.content) return {skip: 'change_order_not_found'};
    if (co.status !== 'proposed') return {skip: 'change_order_decided'};
    if (!clientTo) return {skip: 'no_client_email'};
    const base = ledger.content;
    const t = totals(base, co.fee_delta);
    const amount = formatMoney(t.total, ledger.agreement!.currency);
    const taxNote = t.tax_pct ? `incl. ${t.tax_label} ${t.tax_pct}%` : t.fee ? 'no tax added' : 'no fee change';
    const message = changeOrderEmail({title: base.title, client: base.client, seller: sender.seller, seq, coTitle: co.title, amount, taxNote, reviewUrl});
    return {to: clientTo, message, ref: String(seq), share: {kind: 'change_order', phone: project.client_phone, lang: base.language, values: {client: base.client, title: base.title, seq, co_title: co.title, amount, link: reviewUrl, seller: sender.seller}}};
  }
  if (event === 'invoice_issued' || event === 'payment_reminder') {
    if (!project || !content) return {skip: 'project_not_found'};
    if (!clientTo) return {skip: 'no_client_email'};
    const seq = Number(data.seq);
    const inv = Number.isInteger(seq) ? await db().prepare('SELECT number,amount,currency,content FROM invoices WHERE project_id=? AND seq=?').bind(project.id, seq).first<{number: string; amount: number; currency: string; content: string}>() : null;
    const ic = inv ? JSON.parse(inv.content) as {due?: string} : {};
    const number = inv?.number ?? str(data.number, 40), amount = inv ? formatMoney(Number(data.open ?? inv.amount), inv.currency) : str(data.amount, 60), due = ic.due ?? str(data.due, 40);
    if (!number) return {skip: 'invoice_not_found'};
    if (event === 'invoice_issued') {
      return {to: clientTo, ref: String(seq || number), message: invoiceIssuedEmail({title: content.title, client: content.client, seller: sender.seller, number, amount, due, reviewUrl}),
        share: {kind: 'invoice', phone: project.client_phone, lang: content.language, values: {client: content.client, title: content.title, number, amount, due, link: reviewUrl, seller: sender.seller}}};
    }
    const days = Number(data.days) || 0;
    return {to: clientTo, ref: `${seq || number}:${str(data.n ?? data.sent ?? 1, 6)}`, headers: unsubscribeHeaders(unsubscribeUrl(clientTo, origin())),
      message: invoiceReminderEmail({title: content.title, client: content.client, number, amount, due, days, reviewUrl, seller: sender.seller}),
      share: {kind: 'reminder', phone: project.client_phone, lang: content.language, values: {client: content.client, title: content.title, number, amount, link: reviewUrl, seller: sender.seller}}};
  }
  if (event === 'contact_changed_old_address') {
    if (!payload.to) return {skip: 'no_recipient'};
    if (!payload.to.includes('@')) return {skip: 'not_email'};
    return {to: payload.to, replyTo: /^[^\s@]+@[^\s@]+$/.test(str(data.reply_to, 254)) ? str(data.reply_to, 254) : null, ref: str(data.ref ?? data.at ?? new Date().toISOString().slice(0, 16), 80), message: contactChangedEmail({title: content?.title ?? str(data.title, 160), client: content?.client ?? str(data.client, 120), seller: sender.seller, toMasked: str(data.to_masked, 80), date: str(data.date ?? (typeof data.at === 'string' ? data.at.slice(0, 10) : new Date().toISOString().slice(0, 10)), 40)})};
  }
  if (event === 'cosign_invite') {
    const link = str(data.link ?? data.url, 600);
    if (!payload.to || !/^https?:\/\//.test(link)) return {skip: 'no_recipient_or_link'};
    if (!payload.to.includes('@')) return {skip: 'not_email'};
    return {to: payload.to, ref: str(data.role_id ?? data.role ?? 'role', 40) + ':' + str(data.version ?? project?.latest ?? '', 6), message: cosignInviteEmail({title: content?.title ?? str(data.title, 160), role: str(data.role, 60) || 'countersigner', seller: sender.seller, reviewUrl: link})};
  }
  if (event === 'account_closed_client_notice') {
    if (!project || !content || !clientTo) return {skip: 'no_client_email'};
    return {to: clientTo, ref: 'closed', message: accountClosedEmail({title: content.title, client: content.client, seller: sender.seller, reviewUrl})};
  }
  // payment_claim, payment_alert: to the owner.
  const to = payload.to ?? sender.ownerEmail;
  if (!to) return {skip: 'no_owner_email'};
  return {to, ref: str(data.ref ?? data.id ?? data.seq ?? new Date().toISOString().slice(0, 13), 80), message: ownerAlertEmail({kind: event, title: content?.title ?? str(data.title, 160) ?? 'your project', detail: str(data.detail, 400), workspaceUrl: `${origin()}/${project ? '?project=' + encodeURIComponent(project.id) : ''}`})};
}

/** Delivers one event. Never throws for delivery problems: the outcome says what happened. */
export async function deliverNotify(event: NotifyEvent, payload: NotifyPayload = {}): Promise<NotifyOutcome> {
  if (!NOTIFY_EVENTS.includes(event)) return {event, delivered: false, channel: 'log', status: 'skipped', reason: 'unknown_event'};
  const project = payload.project_id ? await projectOf(payload.project_id) : null;
  if (payload.project_id && !project) return {event, delivered: false, channel: 'log', status: 'skipped', reason: 'project_not_found'};
  const owner = project?.owner ?? payload.owner ?? null;
  if (!owner) return {event, delivered: false, channel: 'log', status: 'skipped', reason: 'no_owner'};
  if (project && OPTIONAL_CLIENT_EVENTS.includes(event) && project.notify_client === false) return {event, delivered: false, channel: 'log', status: 'skipped', reason: 'notify_client_off'};
  const sender = await senderOf(owner);
  const r = await render(event, payload, project, sender);
  if ('skip' in r) return {event, delivered: false, channel: 'log', status: 'skipped', reason: r.skip};
  const brand = sender.brand && {name: sender.brand.name, color: sender.brand.color, logoUrl: sender.brand.logoHash ? `${origin()}/api/brand/${sender.brand.logoHash}` : null};
  const whatsapp = r.share ? waLink(r.share.phone, shareMessage(r.share.kind, r.share.values, r.share.lang)) : undefined;
  try {
    const row = await sendViaOutbox({owner, project_id: project?.id ?? null, event, cls: CLASS[event], to: r.to, message: OWNER_EVENTS.includes(event) ? r.message : brandEmail(r.message, brand),
      headers: r.headers ?? null, fromName: OWNER_EVENTS.includes(event) ? null : sender.fromName, replyTo: OWNER_EVENTS.includes(event) ? null : (r.replyTo ?? sender.replyTo),
      dedupeKey: `${event}:${project?.id ?? owner}:${r.ref}`, uncapped: event === 'contact_changed_old_address' || OWNER_EVENTS.includes(event)});
    const delivered = row.status === 'sent' || row.status === 'dev_log';
    console.info(`[scopeflow:notify] ${event}${project ? ' project ' + project.id : ''}: ${row.status}`);
    return {event, delivered, channel: 'email', provider: row.provider ?? undefined, status: row.status as NotifyOutcome['status'], outbox_id: row.id, duplicate: row.duplicate, ...(whatsapp ? {whatsapp} : {})};
  } catch (e) {
    if (e instanceof MailCapError) return {event, delivered: false, channel: 'log', status: 'capped', reason: e.code, ...(whatsapp ? {whatsapp} : {})};
    console.error('[scopeflow:notify] failed', event, e instanceof Error ? e.message : 'unknown');
    return {event, delivered: false, channel: 'log', status: 'failed', reason: 'error', ...(whatsapp ? {whatsapp} : {})};
  }
}

/** Sends the change-order and invoice notices the database triggers queued (one project, or all). */
export async function drainNotifyEvents({projectId, limit = 20}: {projectId?: string; limit?: number} = {}) {
  const rows = projectId
    ? await db().prepare("SELECT id,event,project_id,ref FROM scopeflow.notify_events WHERE status='pending' AND project_id=? ORDER BY id LIMIT ?").bind(projectId, limit).all<{id: number; event: NotifyEvent; project_id: string; ref: string}>()
    : await db().prepare("SELECT id,event,project_id,ref FROM scopeflow.notify_events WHERE status='pending' ORDER BY id LIMIT ?").bind(limit).all<{id: number; event: NotifyEvent; project_id: string; ref: string}>();
  const out: NotifyOutcome[] = [];
  for (const e of rows.results) {
    const claimed = await db().prepare("UPDATE scopeflow.notify_events SET status='done', processed=? WHERE id=? AND status='pending' RETURNING id").bind(new Date().toISOString(), e.id).first();
    if (!claimed) continue;
    const outcome = await deliverNotify(e.event, {project_id: e.project_id, data: {seq: Number(e.ref)}});
    if (outcome.status === 'skipped' || outcome.status === 'failed') await db().prepare('UPDATE scopeflow.notify_events SET status=? WHERE id=?').bind(outcome.status, e.id).run();
    out.push(outcome);
  }
  if (!projectId) await retryDue();
  return out;
}
