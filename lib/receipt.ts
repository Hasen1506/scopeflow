import QRCode from 'qrcode';
import {PdfDocument, wrap, type Font} from './pdf';
import {itemsOf, formatMoney, label, type Scope} from './scope';
import {totals} from './money';

// The audit-grade decision receipt: a server-generated PDF of the decided scope with its
// fingerprints, the Ed25519 signature, signer details, timestamps (UTC and a named time
// zone) and a QR code that opens the public /verify page for this exact record.

export type ReceiptModel = {
  project_id: string; version: number; status: string;
  content: Scope; content_sha256: string;
  signer: string | null; decided: string | null; comment: string | null;
  anchor: string; signature: string | null; key: {kid: string; x: string} | null;
  context: {channel?: string; ip?: string; user_agent?: string; owner_session?: boolean; via_api?: boolean; acknowledged?: boolean; identity?: {method?: string; email?: string; verified_at?: string}; identity_signature?: string | null} | null;
  ledger: {head: string; count: number} | null;
  time_zone: string; generated: string; verify_url: string;
};

/** True for an IANA zone name this runtime understands. */
export function validTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en-GB', {timeZone: tz}); return true; } catch { return false; }
}

/** "2026-10-07 09:00:00 UTC" plus the same instant in `tz` with its abbreviation and IANA name. */
export function stamp(iso: string | null, tz: string) {
  if (!iso) return 'not recorded';
  const d = new Date(iso);
  const utc = d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  if (tz === 'UTC' || !validTimeZone(tz)) return utc;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset'}).formatToParts(d).map(p => [p.type, p.value]));
  return `${utc} (${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${parts.timeZoneName}, ${tz})`;
}

/** The public verification URL encoded in the QR code. */
export function verifyUrl(origin: string, project_id: string, version: number, anchor: string) {
  return `${origin.replace(/\/$/, '')}/verify?p=${encodeURIComponent(project_id)}&v=${version}&a=${anchor}`;
}

/** QR modules (true = dark) for `text`, error correction M. */
export function qrMatrix(text: string): boolean[][] {
  const qr = QRCode.create(text, {errorCorrectionLevel: 'M'});
  const size = qr.modules.size, data = qr.modules.data;
  return Array.from({length: size}, (_, r) => Array.from({length: size}, (_, c) => !!data[r * size + c]));
}

const MARGIN = 48;
export function renderReceiptPdf(m: ReceiptModel): Uint8Array {
  const doc = new PdfDocument({info: {Title: `Scopeflow decision receipt: ${m.content.title} v${m.version}`, Producer: 'Scopeflow', Subject: `anchor ${m.anchor}`}});
  const W = doc.width - MARGIN * 2;
  let y = 0;
  const page = () => { doc.addPage(); y = doc.height - MARGIN; footer(); };
  const footer = () => {
    doc.text(MARGIN, 28, `Scopeflow decision receipt · ${m.content.title.slice(0, 60)} · version ${m.version} · fingerprint ${m.anchor.slice(0, 16)}`, {size: 7, gray: 0.45});
  };
  const need = (h: number) => { if (y - h < 60) page(); };
  const para = (text: string, {size = 9.5, font = 'regular' as Font, gray = 0, indent = 0, gap = 3} = {}) => {
    for (const line of wrap(text, W - indent, size, font)) { need(size + 3); doc.text(MARGIN + indent, y - size, line, {size, font, gray}); y -= size + 3; }
    y -= gap;
  };
  const heading = (text: string) => { need(30); y -= 8; doc.text(MARGIN, y - 8, text.toUpperCase(), {size: 8, font: 'bold', gray: 0.35}); y -= 13; doc.line(MARGIN, y, MARGIN + W, y); y -= 7; };
  const row = (k: string, v: string, font: Font = 'regular') => {
    const lines = wrap(v, W - 130, 9, font);
    need(lines.length * 12 + 2);
    doc.text(MARGIN, y - 9, k, {size: 9, gray: 0.4});
    lines.forEach((line, i) => doc.text(MARGIN + 130, y - 9 - i * 12, line, {size: 9, font}));
    y -= lines.length * 12 + 3;
  };

  page();
  doc.text(MARGIN, y - 10, 'SCOPEFLOW · DECISION RECEIPT', {size: 9, font: 'bold', gray: 0.35});
  y -= 30;
  para(m.content.title, {size: 18, font: 'bold', gap: 2});
  para(`Prepared for ${m.content.client} · Version ${m.version} · ${label(m.status)}`, {size: 10.5, gray: 0.3, gap: 6});

  // QR code on the right of the decision block.
  const matrix = qrMatrix(m.verify_url);
  const quiet = 2, qrSize = 112, cell = qrSize / (matrix.length + quiet * 2);
  const qx = MARGIN + W - qrSize, qy = y - qrSize;
  doc.comment(`qr-begin ${matrix.length} ${n2(qx + quiet * cell)} ${n2(qy + qrSize - quiet * cell)} ${n2(cell)}`);
  matrix.forEach((cells, r) => {
    let c = 0;
    while (c < cells.length) {
      if (!cells[c]) { c++; continue; }
      const start = c;
      while (c < cells.length && cells[c]) c++;
      doc.rect(qx + (quiet + start) * cell, qy + qrSize - (quiet + r + 1) * cell, (c - start) * cell, cell);
    }
  });
  doc.comment('qr-end');
  doc.text(qx + 4, qy - 9, 'Scan to verify this record', {size: 7, gray: 0.4});

  const ctx = m.context ?? {};
  const top = y;
  const left = (k: string, v: string) => { doc.text(MARGIN, y - 9, k, {size: 9, gray: 0.4}); for (const [i, line] of wrap(v, W - qrSize - 140, 9).entries()) doc.text(MARGIN + 120, y - 9 - i * 12, line, {size: 9}); y -= Math.max(1, wrap(v, W - qrSize - 140, 9).length) * 12 + 3; };
  left('Decision', label(m.status));
  left('Signer (as typed)', m.signer ?? 'not recorded');
  left('Decided', stamp(m.decided, m.time_zone));
  // Identity evidence (email one-time code) when the project required it.
  if (ctx.identity?.method === 'email_otp') left('Identity check', `Email code verified for ${ctx.identity.email ?? 'the client email'} at ${stamp(ctx.identity.verified_at ?? null, m.time_zone)}`);
  else left('Identity check', 'None: the name was typed by the reviewer');
  left('Acknowledged', ctx.acknowledged ? 'Yes: reviewed this version, fee, deliverables and revisions' : 'Not recorded');
  left('Channel', ctx.channel === 'review_link' ? 'Private review link' : (ctx.channel ?? 'not recorded'));
  if (ctx.ip !== undefined) left('Network address', String(ctx.ip));
  if (ctx.user_agent) left('Browser', String(ctx.user_agent));
  if (ctx.owner_session) left('Warning', 'Submitted from a browser signed in to the creator’s account.');
  y = Math.min(y, top - qrSize - 18);

  heading('Fingerprints and signature');
  row('Content SHA-256', m.content_sha256, 'mono');
  row('Record fingerprint', m.anchor, 'mono');
  row('Signature (Ed25519)', m.signature ?? 'Not signed (signing is not configured on this server)', 'mono');
  if (m.key) row('Public key', `kid ${m.key.kid} · x ${m.key.x}`, 'mono');
  if (ctx.identity_signature) row('Identity signature', ctx.identity_signature, 'mono');
  if (m.ledger) row('Ledger head', `${m.ledger.head} (${m.ledger.count} ${m.ledger.count === 1 ? 'entry' : 'entries'})`, 'mono');
  row('Verify', m.verify_url, 'mono');
  para('The record fingerprint is SHA-256 of "scopeflow-baseline-v1|project|version|content JSON|signer|decided". The signature is Ed25519 over "scopeflow-anchor-v1:" followed by that fingerprint, checkable with the public key published at /api/signing-key.', {size: 7.5, gray: 0.4});

  heading('Scope of work');
  for (const i of itemsOf(m.content)) {
    const qty = i.qty > 1 || i.unit ? ` × ${i.qty}${i.unit ? ' ' + i.unit : ''}` : '';
    const price = i.price != null ? ` · ${formatMoney(i.price, m.content.currency)}` : '';
    para(`• ${i.title}${qty}${price}`, {size: 9.5, gap: 0});
    if (i.acceptance) para(`Done when: ${i.acceptance}`, {size: 8.5, gray: 0.35, indent: 10, gap: 0});
  }
  y -= 4;
  row('Project fee', formatMoney(m.content.fee, m.content.currency));
  const t = totals(m.content);
  if (t.tax_pct > 0) { row(`${t.tax_label} (${t.tax_pct}%)`, formatMoney(t.tax, m.content.currency)); row(`Total with ${t.tax_label}`, formatMoney(t.total, m.content.currency)); }
  if (t.deposit_pct > 0) row(`Deposit on signature (${t.deposit_pct}%)`, formatMoney(t.deposit, m.content.currency));
  if (m.content.payment_terms) row('Payment terms', m.content.payment_terms);
  row('Revision rounds', String(m.content.revisions));
  if (m.content.due) row('Target delivery', m.content.due);
  for (const c of m.content.client_inputs ?? []) row('Client provides', c.title + (c.due ? ` (by ${c.due})` : ''));
  if (m.content.exclusions) { heading('Outside this scope'); para(m.content.exclusions); }
  if (m.content.notes) { heading('Working terms'); para(m.content.notes); }
  if (m.comment) { heading('Reviewer comment'); para(m.comment); }

  heading('About this receipt');
  para(`Generated ${stamp(m.generated, m.time_zone)}. Project ${m.project_id}.`, {size: 8, gray: 0.35});
  para('This is a record of a workflow approval. The signer’s name is self-reported unless an identity check is shown above; it is not a qualified or verified electronic signature. Scan the QR code or open the verify link to check that this record still matches the stored, signed original.', {size: 8, gray: 0.35});
  return doc.toBytes();
}
const n2 = (v: number) => (Math.round(v * 100) / 100).toString();
