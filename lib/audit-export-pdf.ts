import {PdfDocument, wrap, type Font} from './pdf';
import type {AuditRecord} from './audit-export';

const MARGIN = 44;
const BOTTOM = 52;

const shortHash = (h: string | null | undefined) =>
  !h ? '—' : h.length > 24 ? `${h.slice(0, 12)}…${h.slice(-8)}` : h;

const summarizeRecord = (rec: AuditRecord): {title: string; meta: string; detail: string} => {
  switch (rec.type) {
    case 'decision':
      return {
        title: `Decision · ${rec.status.replaceAll('_', ' ')} (v${rec.version})`,
        meta: `${rec.at} · project ${rec.project_id} · signer: ${rec.signer || '—'}`,
        detail: `Anchor: ${shortHash(rec.anchor)} · Verify: ${rec.verify}`,
      };
    case 'ledger_entry':
      return {
        title: `Ledger #${rec.seq} · ${rec.kind.replaceAll('_', ' ')} (base v${rec.baseline_version})`,
        meta: `${rec.at} · project ${rec.project_id} · actor: ${rec.actor}`,
        detail: `Hash: ${shortHash(rec.hash)} · Prev: ${shortHash(rec.prev_hash)}`,
      };
    case 'cosign':
      return {
        title: `Countersign · ${rec.role} (v${rec.version})`,
        meta: `${rec.at} · project ${rec.project_id} · signer: ${rec.signer}`,
        detail: `Cosigner ID: ${rec.cosigner_id} · Sig: ${shortHash(rec.signature)}`,
      };
    case 'contact_change':
      return {
        title: 'Contact change',
        meta: `${rec.at} · project ${rec.project_id}`,
        detail: JSON.stringify(rec.detail).slice(0, 180),
      };
    case 'access':
      return {
        title: `Review link viewed (${rec.views} ${rec.views === 1 ? 'view' : 'views'}, v${rec.version})`,
        meta: `Last viewed ${rec.at} · first ${rec.first_viewed} · project ${rec.project_id}`,
        detail: '',
      };
    case 'admin':
      return {
        title: `Admin · ${rec.kind}`,
        meta: `${rec.at} · actor: ${rec.actor} · event ${rec.id}`,
        detail: rec.detail ? JSON.stringify(rec.detail).slice(0, 180) : '',
      };
    default:
      return {title: rec.type, meta: '', detail: ''};
  }
};

/**
 * Renders the signed audit export records into a deterministic, paginated A4 PDF report.
 * Uses the same canonical records as JSONL/CSV and includes the cryptographic seal digest.
 */
export function toAuditPdf(records: AuditRecord[]): Uint8Array {
  const head = records.find((r): r is Extract<AuditRecord, {type: 'export'}> => r.type === 'export');
  const seal = records.find((r): r is Extract<AuditRecord, {type: 'seal'}> => r.type === 'seal');
  const projects = records.filter((r): r is Extract<AuditRecord, {type: 'project'}> => r.type === 'project');
  const events = records
    .filter(r => r.type !== 'export' && r.type !== 'project' && r.type !== 'seal')
    .sort((a, b) => {
      const ta = 'at' in a ? a.at : '';
      const tb = 'at' in b ? b.at : '';
      return ta.localeCompare(tb);
    });

  const rangeLabel = head ? `${head.from} to ${head.to}` : 'All dates';
  const doc = new PdfDocument({
    info: {
      Title: `TermsLock Audit Export (${rangeLabel})`,
      Producer: 'TermsLock',
    },
  });
  const contentW = doc.width - MARGIN * 2;
  let y = 0;
  let pageNum = 0;

  const startPage = () => {
    doc.addPage();
    pageNum += 1;
    y = doc.height - MARGIN;
    doc.text(
      MARGIN,
      26,
      `TermsLock audit export · ${rangeLabel} · owner ${head?.owner_ref ?? '—'} · page ${pageNum}`,
      {size: 7.5, gray: 0.45},
    );
  };

  const ensure = (needed: number) => {
    if (y - needed < BOTTOM) startPage();
  };

  const writeLines = (
    text: string,
    {
      size = 9.5,
      font = 'regular',
      gray = 0.1,
      leading,
      gap = 4,
      indent = 0,
    }: {
      size?: number;
      font?: Font;
      gray?: number;
      leading?: number;
      gap?: number;
      indent?: number;
    } = {},
  ) => {
    const lineHeight = leading ?? size + 3.5;
    const lines = wrap(text, contentW - indent, size, font);
    for (const line of lines) {
      ensure(lineHeight);
      doc.text(MARGIN + indent, y, line, {size, font, gray});
      y -= lineHeight;
    }
    y -= gap;
  };

  const sectionHeading = (title: string) => {
    ensure(28);
    y -= 6;
    doc.line(MARGIN, y + 6, doc.width - MARGIN, y + 6, {width: 0.6, gray: 0.8});
    y -= 8;
    doc.text(MARGIN, y, title.toUpperCase(), {size: 8.5, font: 'bold', gray: 0.35});
    y -= 15;
  };

  startPage();

  // Top cobalt-style accent rule (neutral dark ink for universal print fidelity)
  doc.rect(MARGIN, y + 6, contentW, 2.5, {rgb: [0.12, 0.25, 0.66]});
  y -= 10;

  writeLines('TERMSLOCK · SIGNED AUDIT EXPORT', {size: 8, font: 'bold', gray: 0.35, gap: 4});
  writeLines('Account Audit Trail Report', {size: 18, font: 'bold', gray: 0.05, leading: 22, gap: 6});

  if (head) {
    writeLines(
      `Date window: ${head.from} to ${head.to} (exclusive) · Generated: ${head.generated}`,
      {size: 9, gray: 0.3, gap: 2},
    );
    writeLines(
      `Account ref: ${head.owner_ref} · Mode: ${head.mode} · Account retention: ${head.account_retention_days ? `${head.account_retention_days} days` : 'until deleted'} · Key ID: ${head.key_id ?? 'unsealed'}`,
      {size: 9, gray: 0.3, gap: 8},
    );

    const summaryPairs = [
      `Projects: ${projects.length}`,
      `Decisions: ${head.counts.decision ?? 0}`,
      `Ledger entries: ${head.counts.ledger_entry ?? 0}`,
      `Countersigns: ${head.counts.cosign ?? 0}`,
      `Contact changes: ${head.counts.contact_change ?? 0}`,
      `Review views: ${head.counts.access ?? 0}`,
      `Admin events: ${head.counts.admin ?? 0}`,
    ];
    writeLines(summaryPairs.join('  ·  '), {size: 8.5, font: 'bold', gray: 0.15, gap: 10});
  }

  // Section 1: Projects
  sectionHeading(`Projects (${projects.length})`);
  if (!projects.length) {
    writeLines('No projects on this account.', {size: 9, gray: 0.4, gap: 8});
  } else {
    for (const p of projects) {
      ensure(36);
      const flags = [
        p.archived ? `archived ${p.archived.slice(0, 10)}` : 'active',
        p.legal_hold ? `LEGAL HOLD${p.legal_hold_reason ? ` (${p.legal_hold_reason})` : ''}` : null,
        p.closed_account ? 'closed account' : null,
        p.effective_retention_days ? `retention ${p.effective_retention_days}d` : 'retention: until deleted',
      ]
        .filter(Boolean)
        .join(' · ');
      writeLines(`${p.title || 'Untitled project'}  [${p.project_id}]`, {size: 9.5, font: 'bold', gray: 0.08, gap: 1});
      writeLines(`Created ${p.created} · ${flags}`, {size: 8.5, gray: 0.32, gap: 1, indent: 8});
      writeLines(`Ledger entries: ${p.ledger_count} · Head hash: ${shortHash(p.ledger_head)}`, {
        size: 8,
        font: 'mono',
        gray: 0.38,
        gap: 6,
        indent: 8,
      });
    }
  }

  // Section 2: Chronological Events
  sectionHeading(`Audit Events (${events.length})`);
  if (!events.length) {
    writeLines('No audit events recorded in this date window.', {size: 9, gray: 0.4, gap: 8});
  } else {
    for (const rec of events) {
      const {title, meta, detail} = summarizeRecord(rec);
      ensure(detail ? 36 : 24);
      writeLines(title, {size: 9.5, font: 'bold', gray: 0.08, gap: 1});
      if (meta) writeLines(meta, {size: 8.5, gray: 0.32, gap: detail ? 1 : 5, indent: 8});
      if (detail) writeLines(detail, {size: 8, font: 'mono', gray: 0.38, gap: 5, indent: 8});
    }
  }

  // Section 3: Cryptographic Seal
  sectionHeading('Cryptographic Integrity Seal');
  if (seal) {
    writeLines(`Format: ${seal.format} · Canonical records sealed: ${seal.lines}`, {size: 9, gray: 0.2, gap: 2});
    writeLines(`Canonical SHA-256: ${seal.sha256}`, {size: 8, font: 'mono', gray: 0.15, gap: 2});
    writeLines(
      seal.signature
        ? `Ed25519 Signature (${seal.key_id ?? 'key'}): ${seal.signature}`
        : 'Server Ed25519 signing key was not configured when this report was generated.',
      {size: 8, font: 'mono', gray: 0.25, gap: 4},
    );
    writeLines(
      'Verify the machine-readable stream by exporting Signed JSONL for the same date range and checking against /api/signing-key.',
      {size: 8.5, gray: 0.4, gap: 4},
    );
  } else {
    writeLines('No cryptographic seal present in record list.', {size: 8.5, gray: 0.4, gap: 4});
  }

  return doc.toBytes();
}
