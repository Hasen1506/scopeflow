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

/** The message sent to the client. Pure, so it is unit tested. */
export function signatureEmail({title, client, version, reviewUrl}: {title: string; client: string; version: number; reviewUrl: string}): SignatureEmail {
  const t = oneLine(title, 160), c = oneLine(client, 120);
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
