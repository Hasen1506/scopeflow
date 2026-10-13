import {randomBytes, timingSafeEqual} from 'node:crypto';

// Email forwarding into the radar. Each project can get a private address,
// scope-<token>@SCOPEFLOW_INBOUND_DOMAIN. Point the mail provider's inbound webhook (Postmark
// inbound, or any service that posts {from, to, subject, text}) at POST /api/inbound/email with
// SCOPEFLOW_INBOUND_SECRET as a bearer token or the basic-auth password. A forwarded client email
// is matched to its project by the address, run through the radar and kept for the owner. Nothing
// is sent to anyone and nothing is recorded on the ledger. Pure apart from the token generator.
// WS-06 (L7): only the envelope recipient selects the project (never To/Cc), only senders on the
// project's allow-list (client, cosigners, owner, released senders) reach the radar inbox, and mail
// the provider marks as failing SPF/DKIM/DMARC is quarantined for the owner to release or dismiss.

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

export type AuthVerdicts = {spf: string | null; dkim: string | null; dmarc: string | null};
export type InboundMail = {recipients: string[]; /** Envelope recipients only (RCPT TO), L7. */ envelope: string[]; from: string; subject: string; text: string; messageId: string | null; auth: AuthVerdicts};
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
  const envelopeRaw = r.OriginalRecipient ?? r.envelope_to ?? (r.envelope as {to?: unknown} | undefined)?.to ?? (r.receipt as {recipients?: unknown} | undefined)?.recipients ?? r.recipient;
  const envelope = [...new Set(addresses(envelopeRaw))];
  const recipients = [...new Set([...addresses(r.ToFull ?? r.To ?? r.to), ...addresses(r.CcFull ?? r.Cc ?? r.cc), ...envelope])];
  const text = str(r.TextBody ?? r.text).trim() || htmlText(str(r.HtmlBody ?? r.html));
  if (!recipients.length || !text) return null;
  const from = addresses(r.FromFull ?? r.From ?? r.from)[0] ?? '';
  const id = str(r.MessageID ?? r.message_id ?? r.messageId).trim();
  return {recipients, envelope, from, subject: str(r.Subject ?? r.subject).replace(/[\r\n]+/g, ' ').trim().slice(0, 300), text, messageId: id ? id.slice(0, 200) : null, auth: authVerdicts(r)};
}

// ---- WS-06: L7 hardening ------------------------------------------------------------------------
const verdict = (v: unknown) => { const m = /\b(pass|fail|softfail|neutral|none|temperror|permerror|policy)\b/i.exec(String(v ?? '')); return m ? m[1].toLowerCase() : null; };
/**
 * SPF/DKIM/DMARC verdicts from the inbound provider: Postmark's Headers (Received-SPF,
 * Authentication-Results), SES receiving (receipt.spfVerdict/dkimVerdict/dmarcVerdict.status) or
 * generic {spf, dkim, dmarc} fields. Null where the provider gave none.
 */
export function authVerdicts(r: Record<string, unknown>): AuthVerdicts {
  const out: AuthVerdicts = {spf: verdict(r.spf), dkim: verdict(r.dkim), dmarc: verdict(r.dmarc)};
  const receipt = r.receipt as Record<string, {status?: unknown}> | undefined;
  if (receipt) { out.spf ??= verdict(receipt.spfVerdict?.status); out.dkim ??= verdict(receipt.dkimVerdict?.status); out.dmarc ??= verdict(receipt.dmarcVerdict?.status); }
  const headers = Array.isArray(r.Headers) ? r.Headers as {Name?: unknown; Value?: unknown}[] : [];
  for (const h of headers) {
    const name = String(h?.Name ?? '').toLowerCase(), value = String(h?.Value ?? '');
    if (name === 'received-spf') out.spf ??= verdict(value);
    if (name === 'authentication-results' || name === 'arc-authentication-results') {
      out.spf ??= verdict(/\bspf=(\w+)/i.exec(value)?.[1]);
      out.dkim ??= verdict(/\bdkim=(\w+)/i.exec(value)?.[1]);
      out.dmarc ??= verdict(/\bdmarc=(\w+)/i.exec(value)?.[1]);
    }
  }
  return out;
}
/** "fail" when the provider says the sender is forged (SPF or DMARC fail without a DKIM pass, or a DKIM fail without an SPF pass). */
export function authOutcome(a: AuthVerdicts): 'pass' | 'fail' | 'unknown' {
  if (a.dmarc === 'fail' && a.dkim !== 'pass') return 'fail';
  if ((a.spf === 'fail' || a.spf === 'softfail') && a.dkim !== 'pass') return 'fail';
  if (a.dkim === 'fail' && a.spf !== 'pass') return 'fail';
  return a.spf === 'pass' || a.dkim === 'pass' ? 'pass' : 'unknown';
}
/** Lower-cased addresses that may feed the radar inbox for a project. */
export function allowList(...lists: (string | null | undefined | (string | null | undefined)[])[]) {
  return [...new Set(lists.flat().map(a => (a ?? '').trim().toLowerCase()).filter(a => /^[^\s@]+@[^\s@]+$/.test(a)))];
}
/** Emails named in a cosigner list (WS-02 adds addresses to roles; older lists have none). */
export function cosignerEmails(raw: string | null | undefined): string[] {
  try { const list = JSON.parse(raw ?? '[]'); return Array.isArray(list) ? list.map(c => typeof c?.email === 'string' ? c.email : '').filter(Boolean) : []; } catch { return []; }
}

/** The project token from the first recipient at the inbound domain (pass the envelope recipients, L7). */
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
