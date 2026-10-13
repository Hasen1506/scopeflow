// What a ScopeFlow record proves, in words (owner: WS-02). Pure and client-safe: the review page,
// the verify page, the PDF receipt and the JSON receipt all use these, so they never disagree.
//
// Plan §6.1 (evidence wording), §6.2 (C5: owner self-approval and client identity), L1, L2, L3,
// QA-03. "Digital signature" is reserved for PAdES / Aadhaar eSign records (L2); everything else is
// "electronic acceptance (typed name + click), recorded and sealed by ScopeFlow".

export type SealStatus = 'dedicated' | 'legacy_key' | 'unsigned' | 'invalid';
export type DocumentSeal = {pades?: boolean; esign?: {provider: string} | null};

/** The canonical form of scope content whose SHA-256 is `content_sha256` (L1). Unchanged since SF-15: the stored key order. */
export function canonical(content: unknown): string { return JSON.stringify(content); }

/** SHA-256 hex of canonical(content), with WebCrypto (browser and Node). */
export async function contentFingerprint(content: unknown): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(content))));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Masked address shown on receipts and the client page (§6.2.6): the first character of the local
 * part and of the domain label plus the TLD ("s***@e***.com"); a phone keeps the country code and
 * the last four digits ("+91 ****4044").
 */
export function maskAddress(channel: 'email' | 'sms' | 'whatsapp' | 'phone', to: string): string {
  const value = String(to ?? '').trim();
  if (channel === 'email') {
    const at = value.lastIndexOf('@');
    if (at < 1) return '***';
    const local = value.slice(0, at), domain = value.slice(at + 1);
    const labels = domain.split('.').filter(Boolean);
    if (!labels.length) return local[0] + '***@***';
    const tld = labels.length > 1 ? '.' + labels[labels.length - 1] : '';
    return `${local[0]}***@${labels[0][0]}***${tld}`;
  }
  const digits = value.replace(/\D/g, '');
  if (digits.length < 5) return '****';
  const country = value.startsWith('+') ? '+' + (digits.length > 10 ? digits.slice(0, digits.length - 10) : digits.slice(0, 1)) + ' ' : '';
  return `${country}****${digits.slice(-4)}`;
}

/** Which seal a record carries, from the signature check (`verifyRecordDetailed`). */
export function sealStatus(check: 'valid' | 'legacy_key' | 'unknown_key' | 'invalid' | 'unsigned' | null | undefined): SealStatus {
  if (check === 'valid') return 'dedicated';
  if (check === 'legacy_key') return 'legacy_key';
  if (check === 'unsigned' || check == null) return 'unsigned';
  return 'invalid';
}

/** Status chip on the client page and the verify page (QA-03, §6.1). */
export function chipWording(status: SealStatus, doc: DocumentSeal = {}): string {
  const base = status === 'dedicated' ? 'Verified · sealed by ScopeFlow'
    : status === 'legacy_key' ? 'Verified · older seal'
    : status === 'unsigned' ? 'Record unchanged · saved before sealing was on'
    : 'Not verified · the seal does not match this record';
  if (status === 'invalid') return base;
  return base + (doc.esign ? ' · Aadhaar eSign' : '') + (doc.pades ? ' · Digitally signed PDF' : '');
}

/** The receipt / statement line for the record's seal (§6.1, C1). */
export function evidenceWording(status: SealStatus, o: {kid?: string | null; at?: string | null; verifyUrl?: string | null; doc?: DocumentSeal} = {}): string {
  const doc = o.doc ?? {};
  const extra = (doc.esign ? ` Aadhaar eSign through ${doc.esign.provider}.` : '') + (doc.pades ? ' The PDF carries a digital signature (PAdES).' : '');
  if (status === 'dedicated') return `Sealed by ScopeFlow (Ed25519, key ${o.kid ?? 'unknown'})${o.at ? ` at ${o.at}` : ''}${o.verifyUrl ? `; check at ${o.verifyUrl}` : ''}.` + extra;
  if (status === 'legacy_key') return `Sealed with an earlier ScopeFlow key (${o.kid ?? 'unknown'}).` + extra;
  if (status === 'unsigned') return 'Recorded by ScopeFlow; not sealed (sealing was not configured when this was saved).' + extra;
  return 'The seal on this record does not verify: treat it as altered.';
}

/** L2: what the acceptance itself is. */
export function acceptanceWording(doc: DocumentSeal = {}): string {
  if (doc.esign) return `Aadhaar eSign (digital signature through ${doc.esign.provider}), recorded and sealed by ScopeFlow`;
  return 'Electronic acceptance (typed name + click), recorded and sealed by ScopeFlow';
}

/** "3 Oct 2026" in a time zone (UTC when the zone is missing or invalid). */
export function dayInZone(iso: string | null | undefined, tz?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  let zone = 'UTC';
  try { if (tz) { new Intl.DateTimeFormat('en-GB', {timeZone: tz}); zone = tz; } } catch { zone = 'UTC'; }
  return new Intl.DateTimeFormat('en-GB', {timeZone: zone, day: 'numeric', month: 'short', year: 'numeric'}).format(d);
}

/** A zone abbreviation people recognise ("IST", "BST", "EDT"), else the offset ("GMT+8"). */
function zoneName(d: Date, zone: string): string {
  const names = ['en-GB', 'en-US', 'en-IN'].map(l => new Intl.DateTimeFormat(l, {timeZone: zone, timeZoneName: 'short'}).formatToParts(d).find(p => p.type === 'timeZoneName')?.value ?? '');
  return names.find(n => n && !/^(GMT|UTC)[+-]/.test(n)) ?? names[0];
}

/** L3: link expiry in the project's zone, "13 Oct 2026, 1:30 am IST". */
export function formatExpiry(iso: string | null | undefined, tz?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  let zone = 'UTC';
  try { if (tz) { new Intl.DateTimeFormat('en-GB', {timeZone: tz}); zone = tz; } } catch { zone = 'UTC'; }
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone: zone, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true}).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute} ${String(p.dayPeriod ?? '').toLowerCase()} ${zoneName(d, zone)}`;
}

export type StatementInput = {
  decision?: string | null;
  /** The masked address the code went to, when a one-time code was used. */
  code_to?: string | null;
  /** When that address was put on file for this client (ISO). */
  on_file_since?: string | null;
  owner_session?: boolean;
  time_zone?: string | null;
  /** Plain text for PDFs (WinAnsi fonts have no ⚠). */
  plain?: boolean;
};

/** The words of `evidence.statement` (§6.2.1). They say what the record proves, and no more. */
export function evidenceStatement(i: StatementInput): string {
  const verb = i.decision === 'changes_requested' ? 'Changes were requested' : i.decision === 'declined' ? 'Declined' : i.decision === 'countersigned' ? 'Countersigned' : 'Approved';
  const since = i.on_file_since ? `, the address on file for this client since ${dayInZone(i.on_file_since, i.time_zone)}` : '';
  let s = i.code_to
    ? `${verb} by whoever held this link, after entering a code sent to ${i.code_to}${since}.`
    : `${verb} by whoever held this link. The name was typed by the person approving.`;
  if (i.code_to) s += ' The name was typed by the person approving.';
  if (i.owner_session) s += (i.plain ? ' Warning: ' : ' ⚠ ') + 'Submitted from a browser signed in to the creator’s account.';
  return s;
}

/** "code verified to s***@e***.com (the address on file since 3 Oct 2026)": the short receipt line. */
export function codeLine(masked: string, since?: string | null, tz?: string | null): string {
  return `code verified to ${masked}${since ? ` (the address on file since ${dayInZone(since, tz)})` : ''}`;
}

/** L1: what the content fingerprint means. */
export function fingerprintWording(sha: string): string {
  return `The page you approved showed content with fingerprint ${sha}.`;
}

/** /verify?p=&v=&a= for a record (LT-09). Relative unless an origin is given. */
export function verifyHref(projectId: string, version: number, anchor: string, origin = ''): string {
  return `${origin.replace(/\/$/, '')}/verify?p=${encodeURIComponent(projectId)}&v=${version}&a=${anchor}`;
}

/** QA-02: what the receipt-check box was given. */
export type ReceiptInput =
  | {kind: 'link'; p: string; v: number; a: string}
  | {kind: 'receipt'; p: string; v: number; a: string}
  | {kind: 'fingerprint'; a: string}
  | {kind: 'invalid'; error: string};
export const NOT_A_RECEIPT = 'That doesn’t look like a ScopeFlow receipt. Paste the receipt JSON, the verify link from the PDF, or its 64- or 16-character fingerprint.';
/** Parses a pasted receipt JSON, verify link or fingerprint; never navigates on anything else. */
export function parseReceiptInput(raw: string): ReceiptInput {
  const text = String(raw ?? '').trim();
  if (!text) return {kind: 'invalid', error: NOT_A_RECEIPT};
  if (text.startsWith('{')) {
    try {
      const j = JSON.parse(text) as {project_id?: unknown; version?: unknown; anchor?: unknown};
      if (typeof j.project_id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(j.project_id) && Number.isInteger(j.version) && typeof j.anchor === 'string' && /^[a-f0-9]{64}$/.test(j.anchor)) return {kind: 'receipt', p: j.project_id, v: j.version as number, a: j.anchor};
    } catch { /* falls through */ }
    return {kind: 'invalid', error: NOT_A_RECEIPT};
  }
  if (/^https?:\/\//i.test(text) || text.startsWith('/verify')) {
    try {
      const u = new URL(text, 'https://scope-flow.tech');
      const p = u.searchParams.get('p') ?? '', v = Number(u.searchParams.get('v')), a = (u.searchParams.get('a') ?? '').toLowerCase();
      if (u.pathname === '/verify' && /^[A-Za-z0-9_-]{1,80}$/.test(p) && Number.isInteger(v) && v > 0 && /^([a-f0-9]{64}|[a-f0-9]{16})$/.test(a)) return {kind: 'link', p, v, a};
    } catch { /* falls through */ }
    return {kind: 'invalid', error: NOT_A_RECEIPT};
  }
  const hex = text.toLowerCase().replace(/\s+/g, '');
  if (/^([a-f0-9]{64}|[a-f0-9]{16})$/.test(hex)) return {kind: 'fingerprint', a: hex};
  return {kind: 'invalid', error: NOT_A_RECEIPT};
}
