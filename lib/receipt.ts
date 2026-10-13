import QRCode from 'qrcode';
import {PdfDocument, wrap, type Font} from './pdf';
import {drawPdfBrand, type PdfBrand} from './brand';
import {itemsOf, formatMoney, label, type Scope} from './scope';
import {fxLine, schedule, totals} from './money';
import {formatDay, stamp} from './time';
import type {PaymentLine} from './ledger';
import {acceptanceWording, codeLine, evidenceStatement, evidenceWording, fingerprintWording, maskAddress, type SealStatus} from './evidence';

// The audit-grade decision receipt: a server-generated PDF of the decided scope with its
// fingerprints, the Ed25519 signature, signer details, timestamps (UTC and a named time
// zone) and a QR code that opens the public /verify page for this exact record.

export type ReceiptModel = {
  project_id: string; version: number; status: string;
  content: Scope; content_sha256: string;
  signer: string | null; decided: string | null; comment: string | null;
  anchor: string; signature: string | null; key: {kid: string; x: string} | null;
  context: {channel?: string; ip?: string; user_agent?: string; owner_session?: boolean; via_api?: boolean; acknowledged?: boolean; identity?: {method?: string; email?: string; phone?: string; verified_at?: string}; identity_signature?: string | null} | null;
  ledger: {head: string; count: number} | null;
  /** Payments on the signed record of this version (Razorpay deposits and payments the creator recorded). */
  payments?: PaymentLine[];
  /** Countersignatures on this version, each Ed25519 over the anchor and its own details. */
  cosigns?: {role: string; signer: string; signed: string; signature: string | null; verified_to?: string | null}[];
  /** C1/C5/§6.1: the seal check and what the record proves. Absent in older callers: wording is then derived from `signature`. */
  seal?: SealStatus;
  /** When the client contact the code went to was put on file (C5: "on file since"). */
  contact_since?: string | null;
  /** SF-15: an Aadhaar eSign through a provider, when the record has one. */
  esign?: {provider: string; signed_sha256: string; completed: string | null} | null;
  /** RFC 3161 timestamps from an independent authority over this version's fingerprints. */
  timestamps?: {subject: string; digest: string; tsa: string; gen_time: string}[];
  time_zone: string; generated: string; verify_url: string;
};

export {validTimeZone, stamp} from './time';

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
export function renderReceiptPdf(m: ReceiptModel, brand: PdfBrand | null = null): Uint8Array {
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
  const branded = drawPdfBrand(doc, brand, {margin: MARGIN, top: y});
  doc.text(MARGIN, y - 10, brand?.name ? `${brand.name.toUpperCase().slice(0, 50)} · DECISION RECEIPT` : 'SCOPEFLOW · DECISION RECEIPT', {size: 9, font: 'bold', gray: 0.35});
  y -= Math.max(30, branded);
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
  // Identity evidence (one-time code) when the project required it: the masked address only (C5).
  const since = ctx.identity ? ((ctx as {contact_since?: string | null}).contact_since ?? m.contact_since ?? null) : null;
  const masked = ctx.identity?.method === 'email_otp' ? maskAddress('email', ctx.identity.email ?? '') : ctx.identity?.method === 'sms_otp' || ctx.identity?.method === 'whatsapp_otp' ? maskAddress('sms', ctx.identity.phone ?? '') : null;
  if (ctx.identity?.method === 'email_otp') left('Identity check', `Email ${codeLine(masked!, since, m.time_zone)} at ${stamp(ctx.identity.verified_at ?? null, m.time_zone)}`);
  else if (masked) left('Identity check', `${ctx.identity!.method === 'sms_otp' ? 'SMS' : 'WhatsApp'} ${codeLine(masked, since, m.time_zone)} at ${stamp(ctx.identity!.verified_at ?? null, m.time_zone)}`);
  else left('Identity check', 'None: the name was typed by the reviewer');
  left('What this proves', evidenceStatement({decision: m.status, code_to: masked, on_file_since: since, owner_session: !!ctx.owner_session, time_zone: m.time_zone, plain: true}));
  left('Acceptance', acceptanceWording({esign: m.esign ? {provider: m.esign.provider} : null}));
  left('Acknowledged', ctx.acknowledged ? 'Yes: reviewed this version, fee, deliverables and revisions' : 'Not recorded');
  left('Channel', ctx.channel === 'review_link' ? 'Private review link' : (ctx.channel ?? 'not recorded'));
  if (ctx.ip !== undefined) left('Network address', String(ctx.ip));
  if (ctx.user_agent) left('Browser', String(ctx.user_agent));
  if (ctx.owner_session) left('Warning', 'Submitted from a browser signed in to the creator’s account.');
  y = Math.min(y, top - qrSize - 18);

  heading('Fingerprints and signature');
  const seal: SealStatus = m.seal ?? (m.signature ? 'dedicated' : 'unsigned');
  row('Seal', evidenceWording(seal, {kid: m.key?.kid ?? m.signature?.split('.')[0] ?? null, at: m.decided ? stamp(m.decided, m.time_zone) : null, verifyUrl: m.verify_url, doc: {esign: m.esign ? {provider: m.esign.provider} : null}}));
  row('Content SHA-256', m.content_sha256, 'mono');
  para(fingerprintWording(m.content_sha256.slice(0, 16) + '…'), {size: 7.5, gray: 0.4});
  row('Record fingerprint', m.anchor, 'mono');
  row('Signed (Ed25519)', m.signature ?? 'Not sealed (sealing was not configured when this was saved)', 'mono');
  if (m.key) row('Public key', `kid ${m.key.kid} · x ${m.key.x}`, 'mono');
  if (ctx.identity_signature) row('Identity signature', ctx.identity_signature, 'mono');
  for (const c of m.cosigns ?? []) row('Countersignature', `${c.role}: ${c.signer}${c.verified_to ? ` (${codeLine(c.verified_to)})` : ''} · ${stamp(c.signed, m.time_zone)} · signature ${c.signature ?? 'not sealed'}`, 'mono');
  if (m.esign) row('Aadhaar eSign', `Digitally signed PDF from ${m.esign.provider}${m.esign.completed ? ` at ${stamp(m.esign.completed, m.time_zone)}` : ''} · SHA-256 ${m.esign.signed_sha256}`, 'mono');
  for (const t of m.timestamps ?? []) row('RFC 3161 timestamp', `${t.subject === 'decision' ? 'Decision' : t.subject.startsWith('cosign:') ? 'Countersignature' : 'Record'} timestamped ${stamp(t.gen_time, m.time_zone)} by ${t.tsa} over ${t.digest}`, 'mono');
  if (m.ledger) row('Ledger head', `${m.ledger.head} (${m.ledger.count} ${m.ledger.count === 1 ? 'entry' : 'entries'})`, 'mono');
  row('Verify', m.verify_url, 'mono');
  para('The record fingerprint is SHA-256 of "scopeflow-baseline-v1|project|version|content JSON|signer|decided". The signature is Ed25519 over "scopeflow-anchor-v1:" followed by that fingerprint, checkable with the public key published at /api/signing-key.', {size: 7.5, gray: 0.4});
  if (m.cosigns?.length) para('A countersignature is Ed25519 over "scopeflow-cosign-v1:" + record fingerprint + ":" + SHA-256 of the JSON {cosigner_id, role, signer, signed}; it adds to the approval and never changes it.', {size: 7.5, gray: 0.4});

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
  for (const l of schedule(m.content, t.total)) row(`Milestone: ${l.title} (${l.pct}%)`, `${formatMoney(l.amount, m.content.currency)}${l.due ? ` · due ${l.due}` : ''}`);
  if (m.content.fx) row(`In ${m.content.fx.currency}`, fxLine(m.content, t.total));
  if (m.content.payment_terms) row('Payment terms', m.content.payment_terms);
  row('Revision rounds', String(m.content.revisions));
  if (m.content.revision_bank) { const b = m.content.revision_bank; row(b.unit === 'hours' ? 'Revision hours' : 'Revision budget', `${b.unit === 'hours' ? b.amount + ' hours' : formatMoney(b.amount, m.content.currency)}${b.overage_rate ? ` · then ${formatMoney(b.overage_rate, m.content.currency)} per hour` : ''}`); }
  if (m.content.due) row('Target delivery', m.content.due);
  for (const c of m.content.client_inputs ?? []) row('Client provides', c.title + (c.due ? ` (by ${c.due})` : ''));
  if (m.payments?.length) {
    heading('Payments on the record');
    for (const p of m.payments) row(formatDay(p.received), `${formatMoney(p.amount, m.content.currency)} · ${p.source === 'razorpay' || p.source === 'stripe' ? `${p.note} paid through ${p.method} (payment ${p.reference})` : p.source === 'refund' ? `${p.method}${p.reference ? ` · ref. ${p.reference}` : ''}` : `${p.method}${p.reference ? ` · ref. ${p.reference}` : ''} · recorded by the creator`} · entry ${p.seq}`);
    const paid = Math.round(m.payments.reduce((s, p) => s + p.amount, 0) * 100) / 100;
    row('Received in total', formatMoney(paid, m.content.currency), 'bold');
  }
  if (m.content.exclusions) { heading('Outside this scope'); para(m.content.exclusions); }
  if (m.content.notes) { heading('Working terms'); para(m.content.notes); }
  if (m.comment) { heading('Reviewer comment'); para(m.comment); }

  heading('About this receipt');
  para(`Generated ${stamp(m.generated, m.time_zone)}. Project ${m.project_id}.`, {size: 8, gray: 0.35});
  para(`This is a record of ${m.esign ? 'an Aadhaar eSign through ' + m.esign.provider : 'an electronic acceptance (typed name + click)'}, recorded and sealed by ScopeFlow. The signer’s name is self-reported unless an identity check is shown above, and a code shows only that the person approving could read messages sent to that address. Scan the QR code or open the verify link to check that this record still matches the stored, sealed original.`, {size: 8, gray: 0.35});
  return doc.toBytes();
}
const n2 = (v: number) => (Math.round(v * 100) / 100).toString();
