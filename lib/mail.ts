import {createHash, createHmac} from 'node:crypto';
import {z} from 'zod';

// Optional transactional email for "Send for signature", one-time codes and reminders.
//
// Set SCOPEFLOW_MAIL_FROM (a verified sender such as "Scopeflow <scopes@yourdomain.com>") and one
// provider's credentials:
//   Resend    RESEND_API_KEY
//   Postmark  POSTMARK_SERVER_TOKEN (optional POSTMARK_MESSAGE_STREAM, default "outbound")
//   SES       SCOPEFLOW_SES_ACCESS_KEY_ID, SCOPEFLOW_SES_SECRET_ACCESS_KEY, SCOPEFLOW_SES_REGION
//             (optional SCOPEFLOW_SES_SESSION_TOKEN); the SES v2 API, signed with AWS Signature V4
// SCOPEFLOW_MAIL_PROVIDER (resend | postmark | ses) picks one when several are set; otherwise the
// first configured in that order is used. Without a provider nothing is emailed: the workspace falls
// back to copying the link or opening the owner's own mail app through a mailto: link.
// SCOPEFLOW_MAIL_REPLY_TO is optional; SCOPEFLOW_MAIL_API_URL replaces the provider's base URL
// (used by the test suites' local stub).

export const clientEmailSchema = z.union([z.literal(''), z.string().trim().toLowerCase().max(254).email('Enter a valid client email address')]);

export const MAIL_PROVIDERS = ['resend', 'postmark', 'ses'] as const;
export type MailProvider = typeof MAIL_PROVIDERS[number];
export type MailConfig = {provider: MailProvider; apiKey: string; from: string; replyTo: string | null; apiUrl: string | null;
  /** SES only. */ secretKey?: string; region?: string; sessionToken?: string | null; /** Postmark only. */ stream?: string};

type MailEnv = Record<string, string | undefined>;
function providerConfig(provider: MailProvider, env: MailEnv): Pick<MailConfig, 'apiKey' | 'secretKey' | 'region' | 'sessionToken' | 'stream'> | null {
  const v = (k: string) => env[k]?.trim() || '';
  if (provider === 'resend') return v('RESEND_API_KEY') ? {apiKey: v('RESEND_API_KEY')} : null;
  if (provider === 'postmark') return v('POSTMARK_SERVER_TOKEN') ? {apiKey: v('POSTMARK_SERVER_TOKEN'), stream: v('POSTMARK_MESSAGE_STREAM') || 'outbound'} : null;
  const region = v('SCOPEFLOW_SES_REGION');
  if (!v('SCOPEFLOW_SES_ACCESS_KEY_ID') || !v('SCOPEFLOW_SES_SECRET_ACCESS_KEY') || !/^[a-z]{2}(-[a-z]+)+-\d$/.test(region)) return null;
  return {apiKey: v('SCOPEFLOW_SES_ACCESS_KEY_ID'), secretKey: v('SCOPEFLOW_SES_SECRET_ACCESS_KEY'), region, sessionToken: v('SCOPEFLOW_SES_SESSION_TOKEN') || null};
}

/** The configured provider, or null when email delivery is not set up. */
export function mailConfig(env: MailEnv = process.env): MailConfig | null {
  const from = env.SCOPEFLOW_MAIL_FROM?.trim();
  if (!from) return null;
  const chosen = env.SCOPEFLOW_MAIL_PROVIDER?.trim().toLowerCase();
  const candidates = chosen ? MAIL_PROVIDERS.filter(p => p === chosen) : MAIL_PROVIDERS;
  for (const provider of candidates) {
    const creds = providerConfig(provider, env);
    if (creds) return {provider, ...creds, from, replyTo: env.SCOPEFLOW_MAIL_REPLY_TO?.trim() || null, apiUrl: env.SCOPEFLOW_MAIL_API_URL?.trim().replace(/\/+$/, '') || null};
  }
  return null;
}
export const mailConfigured = (env?: Record<string, string | undefined>) => mailConfig(env) !== null;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]!));
// Header-safe single line: no CR/LF so a title can never inject headers into the subject.
const oneLine = (value: string, max: number) => value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);

export type SignatureEmail = {subject: string; text: string; html: string};

export type EmailTemplate = {subject?: string; body?: string};
/** Fills {client} {title} {version} {link} in owner-written wording. */
export function fillTemplate(template: string, values: {client: string; title: string; version: number; link: string}) {
  return template.replace(/\{(client|title|version|link)\}/g, (_, k: keyof typeof values) => String(values[k]));
}

/** The message sent to the client. Pure, so it is unit tested. Owner wording (account settings) replaces the defaults. */
export function signatureEmail({title, client, version, reviewUrl, template}: {title: string; client: string; version: number; reviewUrl: string; template?: EmailTemplate}): SignatureEmail {
  const t = oneLine(title, 160), c = oneLine(client, 120);
  if (template?.subject || template?.body) {
    const values = {client: c, title: t, version, link: reviewUrl};
    const subject = template.subject ? oneLine(fillTemplate(template.subject, {...values, link: ''}), 200) : `Please review and approve: ${t} (version ${version})`;
    const body = template.body ? fillTemplate(template.body, values) : null;
    if (body) {
      const text = body + '\n\nSent with Scopeflow';
      const html = body.split(/\n{2,}/).map(p => `<p>${escapeHtml(p).replaceAll(escapeHtml(reviewUrl), `<a href="${escapeHtml(reviewUrl)}">${escapeHtml(reviewUrl)}</a>`).replace(/\n/g, '<br>')}</p>`).join('') + '<p style="color:#666;font-size:13px">Sent with Scopeflow</p>';
      return {subject, text, html};
    }
    return {...signatureEmail({title, client, version, reviewUrl}), subject};
  }
  const subject = `Please review and approve: ${t} (version ${version})`;
  const text = [
    `Hi ${c},`,
    '',
    `The scope of work "${t}" (version ${version}) is ready for your review.`,
    'Open the link below to read it and approve it or request changes:',
    '',
    reviewUrl,
    '',
    'The link is private to you. Please do not forward it.',
    '',
    'Sent with Scopeflow',
  ].join('\n');
  const html = `<p>Hi ${escapeHtml(c)},</p><p>The scope of work <strong>${escapeHtml(t)}</strong> (version ${version}) is ready for your review. Open the link below to read it and approve it or request changes.</p><p><a href="${escapeHtml(reviewUrl)}">Review the scope</a></p><p style="color:#666;font-size:13px">This link is private to you. Please do not forward it.<br>Sent with Scopeflow</p>`;
  return {subject, text, html};
}

export const MAX_REMINDERS = 3;
export const REMINDER_GAP_HOURS = 24;
export type SendState = {last_sent: string | null; sent_version: number | null; reminders: number};
/** Why a reminder for `version` cannot go out now, or null. At most one email a day, and MAX_REMINDERS per version. Pure. */
export function reminderBlock(state: SendState, version: number, now = Date.now()): {code: 'recently_sent' | 'reminder_limit'; error: string} | null {
  if (state.sent_version !== version) return null;
  if ((state.reminders ?? 0) >= MAX_REMINDERS) return {code: 'reminder_limit', error: `You have already sent ${MAX_REMINDERS} reminders for version ${version}. Contact your client directly, or revise the scope if it needs to change.`};
  const last = state.last_sent ? Date.parse(state.last_sent) : NaN;
  if (Number.isFinite(last) && now - last < REMINDER_GAP_HOURS * 3600_000) {
    const hours = Math.max(1, Math.ceil((last + REMINDER_GAP_HOURS * 3600_000 - now) / 3600_000));
    return {code: 'recently_sent', error: `Your client was emailed about version ${version} less than a day ago. You can send a reminder in about ${hours} hour${hours === 1 ? '' : 's'}.`};
  }
  return null;
}

/**
 * Whether the daily job should send an automatic reminder: the owner turned it on (auto_days), the
 * scope has waited that long since it was saved or last emailed, and the manual limits allow it. Pure.
 */
export function autoReminderDue(p: SendState & {version: number; created: string; auto_days: number | null}, now = Date.now()) {
  if (!p.auto_days || reminderBlock(p, p.version, now)) return false;
  const since = Date.parse(p.sent_version === p.version && p.last_sent ? p.last_sent : p.created);
  return Number.isFinite(since) && now - since >= p.auto_days * 86400_000;
}

/** A gentle reminder for a scope still waiting for a decision. Always Scopeflow's own wording. Pure. */
export function reminderEmail({title, client, version, reviewUrl, days}: {title: string; client: string; version: number; reviewUrl: string; days: number}): SignatureEmail {
  const t = oneLine(title, 160), c = oneLine(client, 120);
  const waiting = days >= 2 ? `has been waiting for your review for ${days} days` : 'is still waiting for your review';
  const subject = `Reminder: please review ${t} (version ${version})`;
  const text = [
    `Hi ${c},`,
    '',
    `A quick reminder: the scope of work "${t}" (version ${version}) ${waiting}.`,
    'Open the link below to approve it, or use Request changes on the same page to say what should change:',
    '',
    reviewUrl,
    '',
    'The link is private to you. Please do not forward it.',
    '',
    'Sent with Scopeflow',
  ].join('\n');
  const html = `<p>Hi ${escapeHtml(c)},</p><p>A quick reminder: the scope of work <strong>${escapeHtml(t)}</strong> (version ${version}) ${waiting}. Approve it, or use Request changes on the same page to say what should change.</p><p><a href="${escapeHtml(reviewUrl)}">Review the scope</a></p><p style="color:#666;font-size:13px">This link is private to you. Please do not forward it.<br>Sent with Scopeflow</p>`;
  return {subject, text, html};
}

/** Payment reminder for an overdue invoice (daily job). Amounts arrive formatted; the link opens the review page with the invoice PDF. */
export function invoiceReminderEmail({title, client, number, amount, due, days, reviewUrl, seller}: {title: string; client: string; number: string; amount: string; due: string; days: number; reviewUrl: string; seller: string}): SignatureEmail {
  const t = oneLine(title, 160), c = oneLine(client, 120), n = oneLine(number, 40), s = oneLine(seller, 120);
  const subject = `Payment reminder: invoice ${n} for ${t}`;
  const late = `${days} day${days === 1 ? '' : 's'}`;
  const text = [
    `Hi ${c},`,
    '',
    `Invoice ${n} for "${t}" was due on ${due} and ${amount} is still open (${late} overdue).`,
    'The invoice PDF and the statement of payments are on your review page:',
    '',
    reviewUrl,
    '',
    'If you have already paid, thank you: please reply with the payment reference so it can be recorded.',
    '',
    `${s ? s + ' · ' : ''}Sent with Scopeflow`,
  ].join('\n');
  const html = `<p>Hi ${escapeHtml(c)},</p><p>Invoice <strong>${escapeHtml(n)}</strong> for <strong>${escapeHtml(t)}</strong> was due on ${escapeHtml(due)} and <strong>${escapeHtml(amount)}</strong> is still open (${late} overdue).</p><p><a href="${escapeHtml(reviewUrl)}">Open the invoice and statement</a></p><p>If you have already paid, thank you: please reply with the payment reference so it can be recorded.</p><p style="color:#666;font-size:13px">${s ? escapeHtml(s) + ' · ' : ''}Sent with Scopeflow</p>`;
  return {subject, text, html};
}

export type EmailBrand = {name: string; color: string | null; logoUrl: string | null; replyTo?: string | null};
/** The message with the owner's brand on top: their logo (or business name) over an accent rule. Pure. */
export function brandEmail(message: SignatureEmail, brand: EmailBrand | null | undefined): SignatureEmail {
  if (!brand || (!brand.logoUrl && !brand.color && !brand.name)) return message;
  const color = /^#[0-9a-f]{6}$/i.test(brand.color ?? '') ? brand.color! : '#d0d7de';
  const name = escapeHtml(oneLine(brand.name, 80));
  const mark = brand.logoUrl ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${name || 'Logo'}" height="40" style="height:40px;max-width:200px;display:block;border:0">` : name ? `<strong style="font-size:16px">${name}</strong>` : '';
  return {...message, html: `<div style="border-top:4px solid ${color};padding-top:12px;margin-bottom:16px">${mark}</div>${message.html}`};
}

/** mailto: fallback that opens the owner's own mail app with the message filled in. */
export function mailtoLink(to: string, message: Pick<SignatureEmail, 'subject' | 'text'>) {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(message.subject)}&body=${encodeURIComponent(message.text)}`;
}

export class MailError extends Error {}

/** "Name via Scopeflow <scopes@…>": the owner's business name as the display name, keeping the verified address. */
export function brandedFrom(from: string, name: string | null | undefined) {
  const display = (name ?? '').replace(/[\r\n\t"<>\\]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!display) return from;
  const address = from.match(/<([^<>]+)>\s*$/)?.[1] ?? from;
  const product = from.match(/^\s*"?([^"<]+?)"?\s*</)?.[1]?.trim() || 'Scopeflow';
  return `"${display} via ${product}" <${address}>`;
}

const sha256Hex = (data: string) => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest();
/**
 * AWS Signature Version 4 for a request with a JSON (or empty) body. Returns the headers to send:
 * x-amz-date, Authorization and (with a session token) x-amz-security-token. Pure.
 */
export function sigV4({method, url, headers, body, accessKey, secretKey, region, service, sessionToken, now = new Date()}: {method: string; url: string; headers: Record<string, string>; body: string; accessKey: string; secretKey: string; region: string; service: string; sessionToken?: string | null; now?: Date}) {
  const u = new URL(url);
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''), day = amzDate.slice(0, 8);
  const all: Record<string, string> = {...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')])), host: u.host, 'x-amz-date': amzDate, ...(sessionToken ? {'x-amz-security-token': sessionToken} : {})};
  const names = Object.keys(all).sort();
  const enc = (x: string) => encodeURIComponent(x).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const query = [...u.searchParams].map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1).map(([k, v]) => `${k}=${v}`).join('&');
  const path = u.pathname.split('/').map(seg => enc(decodeURIComponent(seg))).join('/') || '/';
  const canonical = [method.toUpperCase(), path, query, names.map(n => `${n}:${all[n]}\n`).join(''), names.join(';'), sha256Hex(body)].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac('AWS4' + secretKey, day), region), service), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return {'x-amz-date': amzDate, ...(sessionToken ? {'x-amz-security-token': sessionToken} : {}), Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`};
}

export type MailRequest = {url: string; headers: Record<string, string>; body: string};
/** The provider HTTP request for one message. Pure (given `now`), so each provider's shape is unit tested. */
export function mailRequest(config: MailConfig, to: string, message: SignatureEmail, {idempotencyKey, fromName, replyTo, now}: {idempotencyKey?: string; fromName?: string | null; replyTo?: string | null; now?: Date} = {}): MailRequest {
  const from = brandedFrom(config.from, fromName), reply = replyTo || config.replyTo;
  if (config.provider === 'postmark') {
    const body = JSON.stringify({From: from, To: to, Subject: message.subject, TextBody: message.text, HtmlBody: message.html, MessageStream: config.stream ?? 'outbound', ...(reply ? {ReplyTo: reply} : {}), ...(idempotencyKey ? {Metadata: {idempotency_key: idempotencyKey.slice(0, 80)}} : {})});
    return {url: (config.apiUrl ?? 'https://api.postmarkapp.com') + '/email', headers: {Accept: 'application/json', 'Content-Type': 'application/json', 'X-Postmark-Server-Token': config.apiKey}, body};
  }
  if (config.provider === 'ses') {
    const url = (config.apiUrl ?? `https://email.${config.region}.amazonaws.com`) + '/v2/email/outbound-emails';
    const body = JSON.stringify({FromEmailAddress: from, Destination: {ToAddresses: [to]}, ...(reply ? {ReplyToAddresses: [reply]} : {}), Content: {Simple: {Subject: {Data: message.subject, Charset: 'UTF-8'}, Body: {Text: {Data: message.text, Charset: 'UTF-8'}, Html: {Data: message.html, Charset: 'UTF-8'}}}}});
    const headers = {'Content-Type': 'application/json'};
    return {url, headers: {...headers, ...sigV4({method: 'POST', url, headers, body, accessKey: config.apiKey, secretKey: config.secretKey!, region: config.region!, service: 'ses', sessionToken: config.sessionToken, now})}, body};
  }
  return {url: (config.apiUrl ?? 'https://api.resend.com') + '/emails', headers: {Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', ...(idempotencyKey ? {'Idempotency-Key': idempotencyKey} : {})},
    body: JSON.stringify({from, to: [to], subject: message.subject, text: message.text, html: message.html, ...(reply ? {reply_to: reply} : {})})};
}

/** Sends through the configured provider. Throws MailError with a safe message when the provider refuses. */
export async function sendMail(config: MailConfig, to: string, message: SignatureEmail, idempotencyKey?: string, options: {fromName?: string | null; replyTo?: string | null; fetchImpl?: typeof fetch} = {}) {
  const request = mailRequest(config, to, message, {idempotencyKey, fromName: options.fromName, replyTo: options.replyTo});
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(request.url, {method: 'POST', headers: request.headers, body: request.body, signal: AbortSignal.timeout(10000)});
  } catch {
    throw new MailError('The email provider could not be reached.');
  }
  const data = await response.json().catch(() => ({})) as {id?: string; MessageID?: string; MessageId?: string; message?: string; Message?: string};
  const refusal = data.message ?? data.Message;
  if (!response.ok || (config.provider === 'postmark' && (data as {ErrorCode?: number}).ErrorCode)) throw new MailError(`The email provider refused the message${refusal ? `: ${oneLine(String(refusal), 200)}` : '.'}`);
  const id = data.id ?? data.MessageID ?? data.MessageId;
  return {id: typeof id === 'string' ? id : null};
}
