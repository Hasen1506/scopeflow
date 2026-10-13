import {db} from './server';
import {activePlan} from './plans';
import type {SignatureEmail} from './mail';
import {parseRoutes, providerConfigs, retryDelayMs, routeMail, sharedBreaker, type MailClass} from './mail-router';

// The mail outbox (SF-19, M19; WS-06). Every email ScopeFlow sends on an owner's behalf is one row
// in scopeflow.mail_outbox: rendered once, checked against the suppression list and the anti-abuse
// caps, sent through the mail router (failover between providers) and retried from the row.
//
// Caps (M19): per owner per UTC day (plan-based, default 50, SCOPEFLOW_LIMIT_MAIL_PER_DAY) and
// per recipient per owner per day (3, SCOPEFLOW_LIMIT_MAIL_PER_RECIPIENT). `auth` mail (codes) is
// metered by WS-02 instead and is not counted here.
// Without any provider configured, rows stay `no_provider` (the UI offers mailto/WhatsApp), except
// in local dev mode (SCOPEFLOW_OTP_DEV=1 on a localhost APP_URL) where they are recorded as
// `dev_log`: rendered and kept, never sent. Tests read the outbox as the mail double.

type Env = Record<string, string | undefined>;
const PLAN_DAILY: Record<string, number> = {beta: 50, free: 50, solo: 200};
export function ownerDailyCap(env: Env = process.env) {
  const n = Number(env.SCOPEFLOW_LIMIT_MAIL_PER_DAY);
  return Number.isInteger(n) && n >= 1 && n <= 100000 ? n : PLAN_DAILY[activePlan(env).id] ?? 50;
}
export function recipientDailyCap(env: Env = process.env) {
  const n = Number(env.SCOPEFLOW_LIMIT_MAIL_PER_RECIPIENT);
  return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : 3;
}
export function mailDevMode(env: Env = process.env) {
  if (env.SCOPEFLOW_OTP_DEV !== '1') return false;
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.APP_URL ?? '').hostname); } catch { return false; }
}

export class MailCapError extends Error {
  code: 'daily_cap' | 'recipient_cap'; retryAfter: number;
  constructor(code: 'daily_cap' | 'recipient_cap', message: string, retryAfter: number) { super(message); this.code = code; this.retryAfter = retryAfter; }
}
const dayStart = (now = Date.now()) => new Date(Math.floor(now / 86400_000) * 86400_000).toISOString();
const secondsToMidnight = (now = Date.now()) => Math.max(60, Math.ceil(((Math.floor(now / 86400_000) + 1) * 86400_000 - now) / 1000));
const COUNTED = "status IN ('queued','sent','dev_log','failed')";

/** Throws MailCapError when `owner` may not send another email today (to `recipient`). */
export async function checkCaps(owner: string, recipient: string, env: Env = process.env) {
  const since = dayStart();
  const row = await db().prepare(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE recipient=?)::int AS to_recipient FROM scopeflow.mail_outbox WHERE owner=? AND class<>'auth' AND created>=? AND ${COUNTED}`)
    .bind(recipient.toLowerCase(), owner, since).first<{total: number; to_recipient: number}>();
  const cap = ownerDailyCap(env), per = recipientDailyCap(env);
  if ((row?.total ?? 0) >= cap) throw new MailCapError('daily_cap', `You have sent ${cap} emails today, the daily limit for your plan. Share the link on WhatsApp or copy it instead; the limit resets at midnight UTC.`, secondsToMidnight());
  if ((row?.to_recipient ?? 0) >= per) throw new MailCapError('recipient_cap', `This client has already had ${per} emails from you today. Share the link on WhatsApp or copy it instead.`, secondsToMidnight());
}

/** Has `owner` ever emailed an address at `domain` through ScopeFlow? (New-domain confirmation, M19.) */
export async function knownDomain(owner: string, domain: string) {
  const row = await db().prepare(`SELECT 1 AS ok FROM scopeflow.mail_outbox WHERE owner=? AND recipient_domain=? AND status IN ('sent','dev_log') LIMIT 1`).bind(owner, domain.toLowerCase()).first<{ok: number}>();
  return !!row;
}

/** Suppressed addresses: hard bounces and complaints block every class; unsubscribes block bulk only. */
export async function suppression(address: string): Promise<string | null> {
  const row = await db().prepare('SELECT reason FROM scopeflow.mail_suppressions WHERE address=?').bind(address.toLowerCase()).first<{reason: string}>();
  return row?.reason ?? null;
}
export const blocks = (reason: string | null, cls: MailClass) => !!reason && (reason !== 'unsubscribed' || cls === 'bulk');
export async function suppress(address: string, reason: 'hard_bounce' | 'complaint' | 'unsubscribed' | 'manual', provider: string | null) {
  const a = address.trim().toLowerCase();
  if (!a.includes('@') || a.length > 254) return false;
  // A bounce or complaint upgrades an unsubscribe; nothing downgrades a bounce.
  await db().prepare(`INSERT INTO scopeflow.mail_suppressions AS s (address,reason,provider,created) VALUES (?,?,?,?) ON CONFLICT (address) DO UPDATE SET reason=excluded.reason, provider=excluded.provider, created=excluded.created WHERE s.reason='unsubscribed' AND excluded.reason<>'unsubscribed'`)
    .bind(a, reason, provider, new Date().toISOString()).run();
  return true;
}

export type OutboxInput = {
  owner: string | null; project_id: string | null; event: string; cls: MailClass; to: string; message: SignatureEmail;
  headers?: Record<string, string> | null; fromName?: string | null; replyTo?: string | null; dedupeKey?: string | null;
  /** Skip the per-owner caps (system mail such as codes and notices to an old address). */
  uncapped?: boolean;
};
export type OutboxRow = {id: string; status: string; provider: string | null; provider_message_id: string | null; attempts: number; last_error: string | null; recipient: string; event: string; created: string; sent: string | null};

/** Inserts the message (once per dedupe key) and tries to deliver it now. Returns the row. */
export async function sendViaOutbox(input: OutboxInput, env: Env = process.env): Promise<OutboxRow & {duplicate: boolean}> {
  const to = input.to.trim().toLowerCase();
  if (input.dedupeKey) {
    const existing = await db().prepare('SELECT id,status,provider,provider_message_id,attempts,last_error,recipient,event,created,sent FROM scopeflow.mail_outbox WHERE dedupe_key=?').bind(input.dedupeKey).first<OutboxRow>();
    if (existing) return {...existing, duplicate: true};
  }
  if (!input.uncapped && input.owner && input.cls !== 'auth') await checkCaps(input.owner, to, env);
  const id = crypto.randomUUID(), now = new Date().toISOString();
  const inserted = await db().prepare(`INSERT INTO scopeflow.mail_outbox (id,owner,project_id,event,class,recipient,recipient_domain,subject,body_text,body_html,headers,from_name,reply_to,dedupe_key,status,created)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'queued',?) ON CONFLICT DO NOTHING RETURNING id`)
    .bind(id, input.owner, input.project_id, input.event, input.cls, to, to.split('@')[1] ?? '', input.message.subject, input.message.text, input.message.html,
      input.headers ? JSON.stringify(input.headers) : null, input.fromName ?? null, input.replyTo ?? null, input.dedupeKey ?? null, now).first<{id: string}>();
  if (!inserted) {
    const existing = await db().prepare('SELECT id,status,provider,provider_message_id,attempts,last_error,recipient,event,created,sent FROM scopeflow.mail_outbox WHERE dedupe_key=?').bind(input.dedupeKey ?? '').first<OutboxRow>();
    if (existing) return {...existing, duplicate: true};
  }
  return {...await deliver(id, env), duplicate: false};
}

type StoredRow = OutboxRow & {class: MailClass; subject: string; body_text: string; body_html: string; headers: string | null; from_name: string | null; reply_to: string | null};
/** Delivers (or retries) one queued row. */
export async function deliver(id: string, env: Env = process.env): Promise<OutboxRow> {
  const row = await db().prepare("SELECT * FROM scopeflow.mail_outbox WHERE id=? AND status='queued'").bind(id).first<StoredRow>();
  if (!row) return (await db().prepare('SELECT id,status,provider,provider_message_id,attempts,last_error,recipient,event,created,sent FROM scopeflow.mail_outbox WHERE id=?').bind(id).first<OutboxRow>())!;
  const finish = async (status: string, fields: {provider?: string | null; message_id?: string | null; error?: string | null; next?: string | null; attempts?: number}) => {
    const sent = status === 'sent' || status === 'dev_log' ? new Date().toISOString() : null;
    return (await db().prepare(`UPDATE scopeflow.mail_outbox SET status=?, provider=?, provider_message_id=?, last_error=?, next_attempt=?, attempts=?, sent=? WHERE id=? RETURNING id,status,provider,provider_message_id,attempts,last_error,recipient,event,created,sent`)
      .bind(status, fields.provider ?? null, fields.message_id ?? null, fields.error ?? null, fields.next ?? null, fields.attempts ?? row.attempts, sent, id).first<OutboxRow>())!;
  };
  const reason = await suppression(row.recipient);
  if (blocks(reason, row.class)) return finish('suppressed', {error: `The address is on the suppression list (${reason}).`});
  const configs = providerConfigs(env);
  const result = await routeMail({cls: row.class, to: row.recipient, message: {subject: row.subject, text: row.body_text, html: row.body_html}, configs, routes: parseRoutes(env.SCOPEFLOW_MAIL_ROUTES), breaker: sharedBreaker,
    idempotencyKey: `scopeflow-outbox-${row.id}`, fromName: row.from_name, replyTo: row.reply_to, headers: row.headers ? JSON.parse(row.headers) as Record<string, string> : null});
  const attempts = row.attempts + 1;
  if (result.status === 'sent') return finish('sent', {provider: result.provider, message_id: result.id, attempts});
  if (result.status === 'no_provider') {
    if (mailDevMode(env)) {
      console.info(`[scopeflow:mail-dev] ${row.event} to ${row.recipient.replace(/^(.).*@/, '$1***@')} recorded, not sent (dev mode)`);
      return finish('dev_log', {provider: 'dev_log', attempts});
    }
    return finish('no_provider', {error: result.error, attempts});
  }
  if (result.status === 'refused') return finish('refused', {provider: result.provider, error: result.error, attempts});
  const delay = retryDelayMs(attempts);
  return delay === null ? finish('failed', {error: result.error, attempts}) : finish('queued', {error: result.error, next: new Date(Date.now() + delay).toISOString(), attempts});
}

/** Retries rows whose next attempt is due (cron and the notifications route). */
export async function retryDue(limit = 25, env: Env = process.env) {
  const rows = await db().prepare("SELECT id FROM scopeflow.mail_outbox WHERE status='queued' AND (next_attempt IS NULL OR next_attempt<=?) ORDER BY created LIMIT ?").bind(new Date().toISOString(), limit).all<{id: string}>();
  const out: OutboxRow[] = [];
  for (const r of rows.results) out.push(await deliver(r.id, env));
  return out;
}

/** Clears stored bodies 30 days after delivery (the row and its status stay for the caps and the UI). */
export async function pruneBodies(days = 30) {
  return db().prepare("UPDATE scopeflow.mail_outbox SET subject=NULL, body_text=NULL, body_html=NULL WHERE status<>'queued' AND created<? AND body_text IS NOT NULL").bind(new Date(Date.now() - days * 86400_000).toISOString()).run();
}
