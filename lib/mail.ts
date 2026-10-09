import {z} from 'zod';

// Optional transactional email for "Send for signature".
//
// Configure both RESEND_API_KEY and SCOPEFLOW_MAIL_FROM (a verified sender such as
// "Scopeflow <scopes@yourdomain.com>") to email review links through Resend. Without
// them nothing is emailed: the workspace falls back to copying the link or opening the
// owner's own mail app through a mailto: link. SCOPEFLOW_MAIL_REPLY_TO is optional.

export const clientEmailSchema = z.union([z.literal(''), z.string().trim().toLowerCase().max(254).email('Enter a valid client email address')]);

export type MailConfig = {apiKey: string; from: string; replyTo: string | null};

/** The configured provider, or null when email delivery is not set up. */
export function mailConfig(env: Record<string, string | undefined> = process.env): MailConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.SCOPEFLOW_MAIL_FROM?.trim();
  if (!apiKey || !from) return null;
  const replyTo = env.SCOPEFLOW_MAIL_REPLY_TO?.trim() || null;
  return {apiKey, from, replyTo};
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

/** mailto: fallback that opens the owner's own mail app with the message filled in. */
export function mailtoLink(to: string, message: Pick<SignatureEmail, 'subject' | 'text'>) {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(message.subject)}&body=${encodeURIComponent(message.text)}`;
}

export class MailError extends Error {}

/** Sends through Resend. Throws MailError with a safe message when the provider refuses. */
export async function sendMail(config: MailConfig, to: string, message: SignatureEmail, idempotencyKey?: string) {
  let response: Response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? {'Idempotency-Key': idempotencyKey} : {}),
      },
      body: JSON.stringify({from: config.from, to: [to], subject: message.subject, text: message.text, html: message.html, ...(config.replyTo ? {reply_to: config.replyTo} : {})}),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new MailError('The email provider could not be reached.');
  }
  const data = await response.json().catch(() => ({})) as {id?: string; message?: string};
  if (!response.ok) throw new MailError(`The email provider refused the message${data.message ? `: ${oneLine(String(data.message), 200)}` : '.'}`);
  return {id: typeof data.id === 'string' ? data.id : null};
}
