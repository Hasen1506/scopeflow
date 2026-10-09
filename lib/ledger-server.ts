import {db} from './server';
import type {Scope} from './scope';
import {anchorHash, computeAgreement, entryHash, sha256, GENESIS, type Actor, type EntryKind, type LedgerEntry} from './ledger';
import {anchorMessage, entryMessage, signRecord, verifyRecord, publicSigningKey, type SignatureState} from './signing';

import {limits} from './plans';
type VersionRow = {id: string; project_id: string; version: number; token: string; revoked: number; content: string; status: string; signer: string | null; decided: string | null; signature?: string | null};
type EntryRow = {seq: number; kind: EntryKind; baseline_version: number; actor: Actor; payload: string; prev_hash: string; hash: string; created: string; signature?: string | null};
export type SignedEntry = LedgerEntry & {signature: string | null};

export class LedgerConflict extends Error {}

async function toEntry(row: EntryRow, hide: boolean): Promise<SignedEntry> {
  const payload = JSON.parse(row.payload);
  const hidden = hide && row.kind === 'goodwill' && payload.visible === false;
  return {seq: row.seq, kind: row.kind, baseline_version: row.baseline_version, actor: row.actor, created: row.created, payload: hidden ? null : payload, payload_hash: await sha256(row.payload), prev_hash: row.prev_hash, hash: row.hash, signature: row.signature ?? null};
}
export function anchorOf(v: Pick<VersionRow, 'project_id' | 'version' | 'content' | 'signer' | 'decided'>) {
  return anchorHash({project_id: v.project_id, version: v.version, content: JSON.parse(v.content), signer: v.signer, decided: v.decided});
}

/** Combined verdict for a set of signature states: any invalid wins, then unsigned. */
export function sealState(states: SignatureState[]): SignatureState {
  if (states.includes('invalid')) return 'invalid';
  if (states.includes('unsigned')) return 'unsigned';
  return 'valid';
}

/**
 * Everything needed to show or extend a project's ledger. The baseline is the latest
 * version when it is approved; otherwise the ledger is read-only history.
 */
export async function loadLedger(projectId: string, {forClient = false} = {}) {
  const database = db();
  // One REPEATABLE READ snapshot; no lock (SF-05).
  const [versions, rows] = await database.batch<Record<string, unknown>>([
    database.prepare('SELECT v.* FROM versions v JOIN projects p ON p.id=v.project_id WHERE v.project_id=? AND (v.version=p.latest OR v.version IN (SELECT DISTINCT baseline_version FROM ledger_entries WHERE project_id=?)) ORDER BY v.version').bind(projectId, projectId),
    database.prepare('SELECT seq,kind,baseline_version,actor,payload,prev_hash,hash,created,signature FROM ledger_entries WHERE project_id=? ORDER BY seq').bind(projectId),
  ]);
  const versionRows = versions.results as unknown as VersionRow[], entryRows = rows.results as unknown as EntryRow[];
  const latest = versionRows.at(-1) ?? null;
  const baseline = latest && latest.status === 'approved' ? latest : null;
  const anchors: Record<number, string> = {};
  const anchorSignatures: Record<number, string | null> = {};
  const anchorStates: Record<number, SignatureState> = {};
  for (const v of versionRows) if (v.status === 'approved') {
    anchors[v.version] = await anchorOf(v);
    anchorSignatures[v.version] = v.signature ?? null;
    anchorStates[v.version] = verifyRecord(anchorMessage(anchors[v.version]), v.signature);
  }
  const entries = await Promise.all(entryRows.map(r => toEntry(r, forClient)));
  const entryStates = entries.map(e => verifyRecord(entryMessage(e.hash), e.signature));
  const content = baseline ? JSON.parse(baseline.content) as Scope : null;
  const current = baseline ? entries.filter(e => e.baseline_version === baseline.version) : [];
  return {
    baseline, content, anchors, entries,
    // SF-04: server-side verdict on the signatures; the chain alone can be recomputed by anyone with DB access.
    seal: {state: sealState([...Object.values(anchorStates), ...entryStates]), anchors: anchorStates, entries: entryStates},
    signatures: {anchors: anchorSignatures, key: publicSigningKey()},
    agreement: baseline && content ? computeAgreement(content, baseline.version, current) : null,
    head: entryRows.at(-1)?.hash ?? GENESIS,
  };
}

/**
 * Appends one entry. The INSERT only succeeds while `baseline` is still the latest,
 * approved version (and, for clients, its review link is live), so a concurrent
 * revision or revocation cannot slip an entry onto a stale agreement. The write is
 * serialized per project only (SF-05) and the entry hash is signed (SF-04).
 */
export async function appendEntry(opts: {baseline: VersionRow; expectedHead: string; kind: EntryKind; payload: unknown; actor: Actor; ref?: string | null; context?: unknown}) {
  const database = db();
  const {baseline, kind, actor} = opts;
  const last = await database.prepare('SELECT seq,hash,(SELECT COUNT(*) FROM ledger_entries WHERE project_id=?) AS n FROM ledger_entries WHERE project_id=? ORDER BY seq DESC LIMIT 1').bind(baseline.project_id, baseline.project_id).first<{seq: number; hash: string; n: number}>();
  if ((last?.hash ?? GENESIS) !== opts.expectedHead) throw new LedgerConflict('The ledger changed. Reload before trying again.');
  const cap = limits().ledger_entries;
  if ((last?.n ?? 0) >= cap) throw new LedgerConflict(`Your plan supports ${cap} ledger entries per project.`);
  const payload = JSON.stringify(opts.payload);
  const entry = {seq: (last?.seq ?? 0) + 1, kind, baseline_version: baseline.version, actor, created: new Date().toISOString(), payload_hash: await sha256(payload), prev_hash: last?.hash ?? GENESIS};
  const hash = await entryHash(entry, await anchorOf(baseline));
  const signature = signRecord(entryMessage(hash));
  try {
    const statement = database.prepare(
      `INSERT INTO ledger_entries (id,project_id,seq,kind,baseline_version,actor,payload,ref,prev_hash,hash,created,signature,context)
       SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (
         SELECT 1 FROM projects p JOIN versions v ON v.project_id=p.id AND v.version=p.latest
         WHERE p.id=? AND v.version=? AND v.status='approved'${actor === 'client' ? ' AND v.revoked=0 AND v.token=?' : ''})
       AND COALESCE((SELECT hash FROM ledger_entries WHERE project_id=? ORDER BY seq DESC LIMIT 1),?)=?`,
    ).bind(crypto.randomUUID(), baseline.project_id, entry.seq, kind, entry.baseline_version, actor, payload, opts.ref ?? null, entry.prev_hash, hash, entry.created, signature, opts.context === undefined ? null : JSON.stringify(opts.context),
      baseline.project_id, baseline.version, ...(actor === 'client' ? [baseline.token] : []), baseline.project_id, GENESIS, opts.expectedHead);
    const result = await ('lock' in statement && typeof statement.lock === 'function' ? statement.lock('scopeflow:project:' + baseline.project_id) : statement).run();
    if (!result.meta.changes) throw new LedgerConflict('The agreement changed. Reload before trying again.');
  } catch (e) {
    if (String(e).includes('UNIQUE')) throw new LedgerConflict(opts.ref?.startsWith('settle:') ? 'This change order has already been settled.' : 'The ledger changed at the same time. Reload and try again.');
    throw e;
  }
  return {...entry, payload: opts.payload, hash, signature} as SignedEntry;
}
