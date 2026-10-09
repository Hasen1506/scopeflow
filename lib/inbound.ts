import {randomBytes, timingSafeEqual} from 'node:crypto';

// Email forwarding into the radar. Each project can get a private address,
// scope-<token>@SCOPEFLOW_INBOUND_DOMAIN. Point the mail provider's inbound webhook (Postmark
// inbound, or any service that posts {from, to, subject, text}) at POST /api/inbound/email with
// SCOPEFLOW_INBOUND_SECRET as a bearer token or the basic-auth password. A forwarded client email
// is matched to its project by the address, run through the radar and kept for the owner. Nothing
// is sent to anyone and nothing is recorded on the ledger. Pure apart from the token generator.

type Env = Record<string, string | undefined>;
export function inboundConfig(env: Env = process.env) {
  const domain = env.SCOPEFLOW_INBOUND_DOMAIN?.trim().toLowerCase().replace(/^@/, '');
  const secret = env.SCOPEFLOW_INBOUND_SECRET?.trim();
  return domain && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) && secret && secret.length >= 16 ? {domain, secret} : null;
}
export const inboundToken = () => randomBytes(12).toString('hex');
export function inboundAddress(token: string | null | undefined, env: Env = process.env) {
  const config = inboundConfig(env);
  return token && config ? `scope-${token}@${config.domain}` : null;
}

/** Bearer token or basic-auth password equal to the secret (constant time). */
export function inboundAuthorized(header: string | null, secret: string) {
  if (!header) return false;
  const [scheme, value = ''] = header.trim().split(/\s+/, 2);
  let given = '';
  if (/^bearer$/i.test(scheme)) given = value;
  else if (/^basic$/i.test(scheme)) { const decoded = Buffer.from(value, 'base64').toString('utf8'); given = decoded.slice(decoded.indexOf(':') + 1); }
  const a = Buffer.from(given), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type InboundMail = {recipients: string[]; from: string; subject: string; text: string; messageId: string | null};
const str = (v: unknown) => typeof v === 'string' ? v : '';
const addresses = (v: unknown): string[] => (Array.isArray(v) ? v : [v]).flatMap(x => typeof x === 'string' ? x.split(',') : x && typeof x === 'object' ? [str((x as {Email?: unknown; email?: unknown; address?: unknown}).Email ?? (x as {email?: unknown}).email ?? (x as {address?: unknown}).address)] : []).map(a => (a.match(/<([^<>]+)>/)?.[1] ?? a).trim().toLowerCase()).filter(a => a.includes('@'));

/** Plain text from simple HTML (inbound providers send both; text is preferred). */
export function htmlText(html: string) {
  return html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();
}

/** Postmark's inbound JSON, or a generic {from, to, subject, text, html, message_id}. Null when it has no recipient or body. */
export function parseInbound(raw: unknown): InboundMail | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const recipients = [...new Set([...addresses(r.ToFull ?? r.To ?? r.to), ...addresses(r.CcFull ?? r.Cc ?? r.cc), ...addresses(r.OriginalRecipient ?? r.envelope_to)])];
  const text = str(r.TextBody ?? r.text).trim() || htmlText(str(r.HtmlBody ?? r.html));
  if (!recipients.length || !text) return null;
  const from = addresses(r.FromFull ?? r.From ?? r.from)[0] ?? '';
  const id = str(r.MessageID ?? r.message_id ?? r.messageId).trim();
  return {recipients, from, subject: str(r.Subject ?? r.subject).replace(/[\r\n]+/g, ' ').trim().slice(0, 300), text, messageId: id ? id.slice(0, 200) : null};
}

/** The project token from the first recipient at the inbound domain. */
export function tokenFrom(recipients: string[], domain: string) {
  for (const a of recipients) {
    const m = a.match(/^scope-([a-f0-9]{24})(?:\+[^@]*)?@(.+)$/);
    if (m && m[2] === domain) return m[1];
  }
  return null;
}

const FORWARD_MARK = /^(?:-{2,}\s*Forwarded message\s*-{2,}|Begin forwarded message:|-{2,}\s*Original Message\s*-{2,}|_{5,})\s*$/im;
const HEADER_LINE = /^\s*(?:\*\s*)?(?:From|Sent|Date|To|Cc|Subject|Reply-To)\s*:/i;
/**
 * The client's words in a forwarded email: the part after the forward marker without its header
 * block, unquoted, and without the forwarder's signature. Falls back to the whole text.
 */
export function clientMessage(text: string) {
  let body = text.replace(/\r\n?/g, '\n');
  const mark = body.match(FORWARD_MARK);
  if (mark && mark.index !== undefined) {
    const lines = body.slice(mark.index + mark[0].length).split('\n');
    let i = 0;
    while (i < lines.length && (lines[i].trim() === '' || HEADER_LINE.test(lines[i]))) i++;
    body = lines.slice(i).join('\n');
  }
  const quoted = body.split('\n').filter(l => l.trim());
  if (quoted.length && quoted.every(l => /^\s*>/.test(l))) body = body.split('\n').map(l => l.replace(/^\s*>\s?/, '')).join('\n');
  body = body.split(/\n-- \n/)[0];
  return body.replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);
}
