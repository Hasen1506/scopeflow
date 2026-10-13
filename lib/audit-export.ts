// SF-25: the Enterprise audit export. One signed JSONL (or CSV) file with every decision,
// ledger entry, countersignature, contact change, access (review-link opens) and admin event of
// an account for a date range, plus each project's state (head hash, retention, legal hold,
// closed-account tombstone). The first line describes the export; the last line seals it: the
// SHA-256 of every line before it, signed with the record key (Ed25519, verify with
// /api/signing-key). Each decision carries its /api/verify link.
// buildAuditExport() is pure (rows in, lines out); loadAuditRows() reads the database.

export const AUDIT_FORMAT = 'scopeflow-audit-v1';
export const auditSealMessage = (sha256: string) => `${AUDIT_FORMAT}:${sha256}`;

export type DecisionRow = {project_id: string; version: number; status: string; signer: string | null; decided: string; signature: string | null; anchor: string};
export type EntryRow = {project_id: string; seq: number; kind: string; baseline_version: number; actor: string; created: string; prev_hash: string; hash: string; signature: string | null; payload: string};
export type CosignRow = {project_id: string; version: number; cosigner_id: string; role: string; signer: string; signed: string; signature: string | null};
export type AccessRow = {project_id: string; version: number; first_viewed: string; last_viewed: string; views: number};
export type AdminRow = {id: string; kind: string; detail: string; actor: string; created: string};
export type ContactRow = {project_id: string; at: string; detail: Record<string, unknown>};
export type ProjectRow = {id: string; title: string; created: string; archived: string | null; legal_hold: boolean; legal_hold_reason: string | null; legal_hold_set: string | null; retention_days: number | null; owner_deleted: string | null; retain_until: string | null};
export type AuditRows = {decisions: DecisionRow[]; entries: EntryRow[]; cosigns: CosignRow[]; access: AccessRow[]; admin: AdminRow[]; contacts: ContactRow[]; projects: ProjectRow[]};
export type AuditMeta = {owner_ref: string; from: string; to: string; generated: string; account_retention_days: number | null; mode: string; key_id: string | null};

export type AuditRecord =
  | {type: 'export'; format: typeof AUDIT_FORMAT; owner_ref: string; from: string; to: string; generated: string; mode: string; account_retention_days: number | null; key_id: string | null; counts: Record<string, number>}
  | {type: 'project'; project_id: string; title: string; created: string; archived: string | null; legal_hold: boolean; legal_hold_reason: string | null; legal_hold_set: string | null; retention_days: number | null; effective_retention_days: number | null; closed_account: boolean; owner_deleted: string | null; retain_until: string | null; ledger_head: string; ledger_count: number}
  | {type: 'decision'; project_id: string; version: number; status: string; signer: string | null; at: string; anchor: string; signature: string | null; verify: string}
  | {type: 'ledger_entry'; project_id: string; seq: number; kind: string; baseline_version: number; actor: string; at: string; prev_hash: string; hash: string; signature: string | null; payload: unknown}
  | {type: 'cosign'; project_id: string; version: number; cosigner_id: string; role: string; signer: string; at: string; signature: string | null}
  | {type: 'contact_change'; project_id: string; at: string; detail: Record<string, unknown>}
  | {type: 'access'; project_id: string; version: number; at: string; first_viewed: string; views: number}
  | {type: 'admin'; id: string; kind: string; actor: string; at: string; detail: unknown}
  | {type: 'seal'; format: typeof AUDIT_FORMAT; lines: number; sha256: string; signature: string | null; key_id: string | null};

const GENESIS = '0'.repeat(64);
const inRange = (at: string, from: string, to: string) => at >= from && at < to;
const parse = (s: string) => { try { return JSON.parse(s); } catch { return s; } };

/** The export as records (pure). `sha256` and `sign` are injected so tests are deterministic. */
export function buildAuditExport(rows: AuditRows, meta: AuditMeta, sha256: (s: string) => string, sign: (message: string) => string | null): AuditRecord[] {
  const r = (at: string) => inRange(at, meta.from, meta.to);
  const byProject = new Map<string, EntryRow[]>();
  for (const e of [...rows.entries].sort((a, b) => a.seq - b.seq)) byProject.set(e.project_id, [...(byProject.get(e.project_id) ?? []), e]);
  const body: AuditRecord[] = [
    ...rows.projects.map(p => ({type: 'project' as const, project_id: p.id, title: p.title, created: p.created, archived: p.archived, legal_hold: !!p.legal_hold, legal_hold_reason: p.legal_hold_reason, legal_hold_set: p.legal_hold_set,
      retention_days: p.retention_days, effective_retention_days: p.retention_days ?? meta.account_retention_days, closed_account: !!p.owner_deleted, owner_deleted: p.owner_deleted, retain_until: p.retain_until,
      ledger_head: byProject.get(p.id)?.at(-1)?.hash ?? GENESIS, ledger_count: byProject.get(p.id)?.length ?? 0})),
    ...rows.decisions.filter(d => r(d.decided)).map(d => ({type: 'decision' as const, project_id: d.project_id, version: d.version, status: d.status, signer: d.signer, at: d.decided, anchor: d.anchor, signature: d.signature,
      verify: `/api/verify?p=${encodeURIComponent(d.project_id)}&v=${d.version}&a=${d.anchor}`})),
    ...rows.entries.filter(e => r(e.created)).map(e => ({type: 'ledger_entry' as const, project_id: e.project_id, seq: e.seq, kind: e.kind, baseline_version: e.baseline_version, actor: e.actor, at: e.created, prev_hash: e.prev_hash, hash: e.hash, signature: e.signature, payload: parse(e.payload)})),
    ...rows.cosigns.filter(c => r(c.signed)).map(c => ({type: 'cosign' as const, project_id: c.project_id, version: c.version, cosigner_id: c.cosigner_id, role: c.role, signer: c.signer, at: c.signed, signature: c.signature})),
    ...rows.contacts.filter(c => r(c.at)).map(c => ({type: 'contact_change' as const, project_id: c.project_id, at: c.at, detail: c.detail})),
    ...rows.access.filter(a => r(a.last_viewed)).map(a => ({type: 'access' as const, project_id: a.project_id, version: a.version, at: a.last_viewed, first_viewed: a.first_viewed, views: a.views})),
    ...rows.admin.filter(a => r(a.created)).map(a => ({type: 'admin' as const, id: a.id, kind: a.kind, actor: a.actor, at: a.created, detail: parse(a.detail)})),
  ];
  const counts: Record<string, number> = {};
  for (const x of body) counts[x.type] = (counts[x.type] ?? 0) + 1;
  const head: AuditRecord = {type: 'export', format: AUDIT_FORMAT, owner_ref: meta.owner_ref, from: meta.from, to: meta.to, generated: meta.generated, mode: meta.mode, account_retention_days: meta.account_retention_days, key_id: meta.key_id, counts};
  const lines = [head, ...body];
  const digest = sha256(lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  return [...lines, {type: 'seal', format: AUDIT_FORMAT, lines: lines.length, sha256: digest, signature: sign(auditSealMessage(digest)), key_id: meta.key_id}];
}
export const toJsonl = (records: AuditRecord[]) => records.map(r => JSON.stringify(r)).join('\n') + '\n';
/** Verifies a JSONL export's seal digest (the signature is checked with the public key separately). */
export function sealDigestMatches(jsonl: string, sha256: (s: string) => string) {
  const lines = jsonl.trimEnd().split('\n'), seal = JSON.parse(lines.at(-1)!) as {type: string; sha256: string; lines: number};
  return seal.type === 'seal' && seal.lines === lines.length - 1 && sha256(lines.slice(0, -1).join('\n') + '\n') === seal.sha256;
}

export const CSV_COLUMNS = ['type', 'project_id', 'version', 'seq', 'kind', 'actor', 'at', 'status', 'hash', 'signature', 'detail'] as const;
const cell = (v: unknown) => { const s = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v); return /[",\n\r]/.test(s) || /^[=+\-@\t]/.test(s) ? `"${(/^[=+\-@\t]/.test(s) ? "'" : '') + s.replaceAll('"', '""')}"` : s; };
/** CSV view of the same records (one row each; record-specific fields in `detail` as JSON). Formula-injection safe. */
export function toCsv(records: AuditRecord[]) {
  const rows = records.map(rec => {
    const x = rec as Record<string, unknown>;
    const {type, project_id, version, seq, kind, actor, at, status, hash, signature, ...rest} = x;
    return [type, project_id, version, seq, kind, actor, at ?? x.generated ?? x.created, status, hash ?? x.sha256 ?? x.anchor ?? x.ledger_head, signature, rest].map(cell).join(',');
  });
  return CSV_COLUMNS.join(',') + '\r\n' + rows.join('\r\n') + '\r\n';
}
