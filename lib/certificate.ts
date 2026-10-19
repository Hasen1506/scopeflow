import {PdfDocument, wrap, type Font} from './pdf';
import {stamp} from './time';

// A one-page approval certificate: the evidence trail of one client decision.
// It is not an Aadhaar eSign, DocuSign or Zoho Sign envelope. The decision receipt
// (lib/receipt.ts) is the full document; this is the short record a freelancer can download.

export type CertificateModel = {
  project_id: string;
  title: string;
  client: string;
  version: number;
  status: string;
  signer: string;
  decided: string;
  time_zone: string;
  ip: string;
  browser: string;
  content_sha256: string;
  seal_status: string;
  seal_kid: string | null;
  statement: string;
  /** Masked destination when a one-time code was checked, otherwise null. */
  otp: string | null;
};

const MARGIN = 48;
export function renderApprovalCertificate(m: CertificateModel): Uint8Array {
  const doc = new PdfDocument({info: {Title: `Scopeflow approval certificate: ${m.title} v${m.version}`, Producer: 'Scopeflow', Subject: `sha256 ${m.content_sha256}`}});
  const W = doc.width - MARGIN * 2;
  let y = doc.height - MARGIN;
  doc.addPage();
  const need = (h: number) => { if (y - h < 56) { doc.addPage(); y = doc.height - MARGIN; } };
  const para = (text: string, {size = 10, font = 'regular' as Font, gray = 0, gap = 4} = {}) => {
    for (const line of wrap(text, W, size, font)) { need(size + 3); doc.text(MARGIN, y - size, line, {size, font, gray}); y -= size + 3; }
    y -= gap;
  };
  const row = (k: string, v: string) => {
    const lines = wrap(v || '—', W - 140, 9, 'regular');
    need(lines.length * 12 + 4);
    doc.text(MARGIN, y - 9, k, {size: 9, gray: 0.4});
    lines.forEach((line, i) => doc.text(MARGIN + 140, y - 9 - i * 12, line, {size: 9}));
    y -= lines.length * 12 + 4;
  };

  doc.text(MARGIN, y - 10, 'SCOPEFLOW · APPROVAL CERTIFICATE', {size: 9, font: 'bold', gray: 0.35});
  y -= 28;
  para(m.title, {size: 16, font: 'bold', gap: 2});
  para(`Prepared for ${m.client} · version ${m.version} · ${m.status}`, {size: 10, gray: 0.35, gap: 8});
  para(m.statement, {size: 10, gap: 8});

  row('Typed name', m.signer);
  row('Time', `${stamp(m.decided, m.time_zone)} (${m.time_zone})`);
  row('IP address', m.ip);
  row('Browser', m.browser);
  row('Content hash', m.content_sha256);
  row('Seal', m.seal_kid ? `${m.seal_status} · key ${m.seal_kid}` : m.seal_status);
  row('One-time code', m.otp ?? 'No one-time code was required for this decision.');

  y -= 8;
  para('This certificate records the decision stored by Scopeflow. It is not an Aadhaar eSign, DocuSign or Zoho Sign signature. The content hash is SHA-256 of the canonical scope. The seal is Scopeflow’s Ed25519 signature over the decision.', {size: 8, gray: 0.4, gap: 2});
  doc.text(MARGIN, 28, `Scopeflow approval certificate · ${m.project_id} · version ${m.version}`, {size: 7, gray: 0.45});
  return doc.toBytes();
}
