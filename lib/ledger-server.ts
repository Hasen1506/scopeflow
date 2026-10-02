import {db} from './server';
import type {Scope} from './scope';
import {anchorHash, computeAgreement, entryHash, sha256, GENESIS, type EntryKind, type LedgerEntry} from './ledger';

export const LEDGER_LIMIT = 200;
type VersionRow = {id: string; project_id: string; version: number; token: string; revoked: number; content: string; status: string; signer: string | null; decided: string | null};
type EntryRow = {seq: number; kind: EntryKind; baseline_version: number; actor: 'owner' | 'client'; payload: string; prev_hash: string; hash: string; created: string};

export class LedgerConflict extends Error {}

async function toEntry(row: EntryRow, hide: boolean): Promise<LedgerEntry> {
  const payload = JSON.parse(row.payload);
  const hidden = hide && row.kind === 'goodwill' && payload.visible === false;
  return {seq: row.seq, kind: row.kind, baseline_version: row.baseline_version, actor: row.actor, created: row.created, payload: hidden ? null : payload, payload_hash: await sha256(row.payload), prev_hash: row.prev_hash, hash: row.hash};
}
function anchorOf(v: VersionRow) {
  return anchorHash({project_id: v.project_id, version: v.version, content: JSON.parse(v.content), signer: v.signer, decided: v.decided});
}

/**
 * Everything needed to show or extend a project's ledger. The baseline is the latest
 * version when it is approved; otherwise the ledger is read-only history.
 */
export async function loadLedger(projectId: string, {forClient = false} = {}) {
  const database = db();
  const [versions, rows] = await Promise.all([
    database.prepare('SELECT v.* FROM versions v JOIN projects p ON p.id=v.project_id WHERE v.project_id=? AND (v.version=p.latest OR v.version IN (SELECT DISTINCT baseline_version FROM ledger_entries WHERE project_id=?)) ORDER BY v.version').bind(projectId, projectId).all<VersionRow>(),
    database.prepare('SELECT seq,kind,baseline_version,actor,payload,prev_hash,hash,created FROM ledger_entries WHERE project_id=? ORDER BY seq').bind(projectId).all<EntryRow>(),
  ]);
  const latest = versions.results.at(-1) ?? null;
  const baseline = latest && latest.status === 'approved' ? latest : null;
  const anchors: Record<number, string> = {};
  for (const v of versions.results) if (v.status === 'approved') anchors[v.version] = await anchorOf(v);
  const entries = await Promise.all(rows.results.map(r => toEntry(r, forClient)));
  const content = baseline ? JSON.parse(baseline.content) as Scope : null;
  const current = baseline ? entries.filter(e => e.baseline_version === baseline.version) : [];
  return {
    baseline, content, anchors, entries,
    agreement: baseline && content ? computeAgreement(content, baseline.version, current) : null,
    head: rows.results.at(-1)?.hash ?? GENESIS,
  };
}

/**
 * Appends one entry. The INSERT only succeeds while `baseline` is still the latest,
 * approved version (and, for clients, its review link is live), so a concurrent
 * revision or revocation cannot slip an entry onto a stale agreement.
 */
export async function appendEntry(opts: {baseline: VersionRow; kind: EntryKind; payload: unknown; actor: 'owner' | 'client'; ref?: string | null}) {
  const database = db();
  const {baseline, kind, actor} = opts;
  const last = await database.prepare('SELECT seq,hash,(SELECT COUNT(*) FROM ledger_entries WHERE project_id=?) AS n FROM ledger_entries WHERE project_id=? ORDER BY seq DESC LIMIT 1').bind(baseline.project_id, baseline.project_id).first<{seq: number; hash: string; n: number}>();
  if ((last?.n ?? 0) >= LEDGER_LIMIT) throw new LedgerConflict(`The beta supports ${LEDGER_LIMIT} ledger entries per project.`);
  const payload = JSON.stringify(opts.payload);
  const entry = {seq: (last?.seq ?? 0) + 1, kind, baseline_version: baseline.version, actor, created: new Date().toISOString(), payload_hash: await sha256(payload), prev_hash: last?.hash ?? GENESIS};
  const hash = await entryHash(entry, await anchorOf(baseline));
  try {
    const result = await database.prepare(
      `INSERT INTO ledger_entries (id,project_id,seq,kind,baseline_version,actor,payload,ref,prev_hash,hash,created)
       SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (
         SELECT 1 FROM projects p JOIN versions v ON v.project_id=p.id AND v.version=p.latest
         WHERE p.id=? AND v.version=? AND v.status='approved'${actor === 'client' ? ' AND v.revoked=0 AND v.token=?' : ''})`,
    ).bind(crypto.randomUUID(), baseline.project_id, entry.seq, kind, entry.baseline_version, actor, payload, opts.ref ?? null, entry.prev_hash, hash, entry.created,
      baseline.project_id, baseline.version, ...(actor === 'client' ? [baseline.token] : [])).run();
    if (!result.meta.changes) throw new LedgerConflict('The agreement changed. Reload before trying again.');
  } catch (e) {
    if (String(e).includes('UNIQUE')) throw new LedgerConflict(opts.ref?.startsWith('settle:') ? 'This change order has already been settled.' : 'The ledger changed at the same time. Reload and try again.');
    throw e;
  }
  return {...entry, payload: opts.payload, hash} as LedgerEntry;
}
