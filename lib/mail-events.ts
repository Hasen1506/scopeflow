import {createHmac, timingSafeEqual} from 'node:crypto';

// Provider bounce and complaint webhooks (SF-19, M19; WS-06), parsed into one shape that feeds the
// shared suppression list. Pure: signature checks and payload parsing, unit tested.
//   resend    Svix-signed (RESEND_WEBHOOK_SECRET, "whsec_…"): email.bounced, email.complained
//   postmark  basic auth with SCOPEFLOW_MAIL_WEBHOOK_SECRET as the password: Bounce, SpamComplaint
//   ses       SNS HTTPS subscription with ?token=SCOPEFLOW_SES_WEBHOOK_TOKEN (S11; the deprecated fallback
//             is SCOPEFLOW_MAIL_WEBHOOK_SECRET) (and the topic ARN
//             in SCOPEFLOW_SES_SNS_TOPIC_ARN when set): Bounce (Permanent), Complaint

export type MailEvent = {id: string; reason: 'hard_bounce' | 'complaint'; addresses: string[]};
const eq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** Svix (Resend) signature: HMAC-SHA256 of "<id>.<timestamp>.<body>" with the base64 secret, within 5 minutes. */
export function svixValid(body: string, headers: {id: string | null; timestamp: string | null; signature: string | null}, secret: string, now = Date.now()) {
  if (!headers.id || !headers.timestamp || !headers.signature || !secret) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${headers.id}.${headers.timestamp}.${body}`).digest('base64');
  return headers.signature.split(' ').some(part => { const [v, sig] = part.split(','); return v === 'v1' && !!sig && eq(sig, expected); });
}
export function svixSign(body: string, id: string, timestamp: number, secret: string) {
  return 'v1,' + createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64')).update(`${id}.${timestamp}.${body}`).digest('base64');
}
export function basicPasswordValid(header: string | null, secret: string) {
  const m = /^basic\s+(.+)$/i.exec(header?.trim() ?? '');
  if (!m || !secret) return false;
  const decoded = Buffer.from(m[1], 'base64').toString('utf8');
  return eq(decoded.slice(decoded.indexOf(':') + 1), secret);
}
export const tokenValid = (given: string | null, secret: string) => !!given && !!secret && eq(given, secret);

const list = (v: unknown): string[] => (Array.isArray(v) ? v : [v]).map(x => typeof x === 'string' ? x : (x as {emailAddress?: unknown})?.emailAddress).filter((x): x is string => typeof x === 'string' && x.includes('@')).map(x => (x.match(/<([^<>]+)>/)?.[1] ?? x).trim().toLowerCase());

export function parseResend(raw: unknown, id: string): MailEvent | null {
  const r = raw as {type?: string; data?: {to?: unknown; bounce?: {type?: string}}};
  if (r?.type === 'email.complained') return {id, reason: 'complaint', addresses: list(r.data?.to)};
  // Resend reports permanent bounces as "Permanent"; a transient bounce is not suppressed.
  if (r?.type === 'email.bounced' && !/transient|temporary|soft/i.test(r.data?.bounce?.type ?? '')) return {id, reason: 'hard_bounce', addresses: list(r.data?.to)};
  return null;
}
const POSTMARK_HARD = new Set(['HardBounce', 'BadEmailAddress', 'ManuallyDeactivated', 'Blocked', 'SpamNotification']);
export function parsePostmark(raw: unknown): MailEvent | null {
  const r = raw as {RecordType?: string; Type?: string; Email?: string; ID?: number | string; MessageID?: string};
  const id = String(r?.ID ?? r?.MessageID ?? '') + ':' + (r?.RecordType ?? '');
  if (r?.RecordType === 'SpamComplaint' || r?.Type === 'SpamComplaint') return {id, reason: 'complaint', addresses: list(r.Email)};
  if (r?.RecordType === 'Bounce' && POSTMARK_HARD.has(r.Type ?? '')) return {id, reason: 'hard_bounce', addresses: list(r.Email)};
  return null;
}
export type SnsEnvelope = {Type?: string; MessageId?: string; TopicArn?: string; SubscribeURL?: string; Message?: string};
export function parseSes(envelope: SnsEnvelope): MailEvent | null {
  if (envelope.Type !== 'Notification' || !envelope.Message) return null;
  let m: {notificationType?: string; eventType?: string; bounce?: {bounceType?: string; bouncedRecipients?: unknown}; complaint?: {complainedRecipients?: unknown}};
  try { m = JSON.parse(envelope.Message); } catch { return null; }
  const type = m.notificationType ?? m.eventType;
  if (type === 'Complaint') return {id: envelope.MessageId ?? '', reason: 'complaint', addresses: list(m.complaint?.complainedRecipients)};
  if (type === 'Bounce' && m.bounce?.bounceType === 'Permanent') return {id: envelope.MessageId ?? '', reason: 'hard_bounce', addresses: list(m.bounce?.bouncedRecipients)};
  return null;
}
/** SNS subscription confirmation URLs must be AWS's own HTTPS endpoint. */
export function snsConfirmUrl(url: string | undefined) {
  try { const u = new URL(url ?? ''); return u.protocol === 'https:' && /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(u.hostname) ? u.toString() : null; } catch { return null; }
}
