import {db} from './server';
import type {Scope} from './scope';
import {anchorHash, computeAgreement, countsTowardCap, entryHash, sha256, GENESIS, type Actor, type EntryKind, type LedgerEntry} from './ledger';
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

/** Where an appended entry must land: on the latest version while it is approved (every owner and client entry), or (H6, money) on the latest approved version even while a newer version is pending. */
export type AppendAnchor = 'latest' | 'latest_approved';
type NewEntry = {kind: EntryKind; payload: unknown; actor: Actor; ref?: string | null; context?: unknown};

function insertStatement(baseline: VersionRow, e: NewEntry & {seq: number; created: string; prev_hash: string; hash: string; signature: string | null; payloadText: string}, expectedPrev: string, anchor: AppendAnchor) {
  const database = db();
  const where = anchor === 'latest'
    ? `EXISTS (SELECT 1 FROM projects p JOIN versions v ON v.project_id=p.id AND v.version=p.latest
         WHERE p.id=? AND v.version=? AND v.status='approved'${e.actor === 'client' ? ' AND v.revoked=0 AND v.token=?' : ''})`
    : `EXISTS (SELECT 1 FROM versions v WHERE v.project_id=? AND v.version=? AND v.status='approved'
         AND NOT EXISTS (SELECT 1 FROM versions w WHERE w.project_id=v.project_id AND w.status='approved' AND w.version>v.version))`;
  return database.prepare(
    `INSERT INTO ledger_entries (id,project_id,seq,kind,baseline_version,actor,payload,ref,prev_hash,hash,created,signature,context)
     SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${where}
     AND COALESCE((SELECT hash FROM ledger_entries WHERE project_id=? ORDER BY seq DESC LIMIT 1),?)=?`,
  ).bind(crypto.randomUUID(), baseline.project_id, e.seq, e.kind, baseline.version, e.actor, e.payloadText, e.ref ?? null, e.prev_hash, e.hash, e.created, e.signature, e.context === undefined ? null : JSON.stringify(e.context),
    baseline.project_id, baseline.version, ...(anchor === 'latest' && e.actor === 'client' ? [baseline.token] : []), baseline.project_id, GENESIS, expectedPrev);
}

async function capCheck(projectId: string, kinds: {kind: EntryKind; actor: Actor}[], count: number) {
  // H6: the plan cap limits what the owner authors; money and client/system entries are never refused by it.
  if (!kinds.some(k => countsTowardCap(k.kind, k.actor))) return;
  const cap = limits().ledger_entries;
  if (count >= cap) throw new LedgerConflict(`Your plan supports ${cap} ledger entries per project.`);
}

/**
 * Appends one entry. The INSERT only succeeds while `baseline` is still the latest,
 * approved version (and, for clients, its review link is live), so a concurrent
 * revision or revocation cannot slip an entry onto a stale agreement. The write is
 * serialized per project only (SF-05) and the entry hash is signed (SF-04).
 * WS-05: the plan cap applies to owner-authored, non-money kinds only (H6). `lock: false`
 * skips the advisory lock (LT-08 withdraw): the conditional INSERT and the unique (project, seq)
 * constraint keep the chain correct without waiting on other writers.
 */
export async function appendEntry(opts: {baseline: VersionRow; expectedHead: string; kind: EntryKind; payload: unknown; actor: Actor; ref?: string | null; context?: unknown; anchor?: AppendAnchor; lock?: boolean}) {
  const [entry] = await appendEntries({baseline: opts.baseline, expectedHead: opts.expectedHead, anchor: opts.anchor, lock: opts.lock, entries: [{kind: opts.kind, payload: opts.payload, actor: opts.actor, ref: opts.ref, context: opts.context}]});
  return entry;
}

/**
 * Appends several entries in one transaction (LT-08 revise = withdraw + new CO; SF-05 usage +
 * overage CO). Either every entry lands, chained in order, or none does.
 */
export async function appendEntries(opts: {baseline: VersionRow; expectedHead: string; entries: NewEntry[]; anchor?: AppendAnchor; lock?: boolean}) {
  const database = db();
  const {baseline} = opts;
  const anchor = opts.anchor ?? 'latest';
  const last = await database.prepare('SELECT seq,hash,(SELECT COUNT(*) FROM ledger_entries WHERE project_id=?) AS n FROM ledger_entries WHERE project_id=? ORDER BY seq DESC LIMIT 1').bind(baseline.project_id, baseline.project_id).first<{seq: number; hash: string; n: number}>();
  if ((last?.hash ?? GENESIS) !== opts.expectedHead) throw new LedgerConflict('The ledger changed. Reload before trying again.');
  await capCheck(baseline.project_id, opts.entries, Number(last?.n ?? 0));
  const anchorHashValue = await anchorOf(baseline);
  let prev = last?.hash ?? GENESIS, seq = last?.seq ?? 0;
  const built: (SignedEntry & {statement: ReturnType<typeof insertStatement>})[] = [];
  for (const e of opts.entries) {
    const payloadText = JSON.stringify(e.payload);
    const entry = {seq: ++seq, kind: e.kind, baseline_version: baseline.version, actor: e.actor, created: new Date().toISOString(), payload_hash: await sha256(payloadText), prev_hash: prev};
    const hash = await entryHash(entry, anchorHashValue);
    const signature = signRecord(entryMessage(hash));
    built.push({...entry, payload: e.payload, hash, signature, statement: insertStatement(baseline, {...e, ...entry, hash, signature, payloadText}, prev, anchor)});
    prev = hash;
  }
  try {
    const key = 'scopeflow:project:' + baseline.project_id;
    let results: {meta: {changes: number}}[];
    if (built.length === 1) {
      const statement = built[0].statement;
      results = [await (opts.lock !== false && 'lock' in statement && typeof statement.lock === 'function' ? statement.lock(key) : statement).run()];
    } else {
      // Each INSERT checks the head the previous one wrote; a failed condition aborts the transaction.
      // The final guard divides by zero (aborting the whole transaction) unless every entry landed.
      const guard = database.prepare('SELECT 1/(CASE WHEN (SELECT COUNT(*) FROM ledger_entries WHERE project_id=? AND seq>?)=? THEN 1 ELSE 0 END) AS ok').bind(baseline.project_id, last?.seq ?? 0, built.length);
      try {
        results = (await database.batch([...built.map(b => b.statement), guard], {lock: opts.lock === false ? null : key})).slice(0, built.length);
      } catch (e) {
        if (e instanceof Error && 'code' in e && e.code === '22012') throw new LedgerConflict('The agreement changed. Reload before trying again.');
        throw e;
      }
    }
    if (results.some(r => !r.meta.changes)) throw new LedgerConflict('The agreement changed. Reload before trying again.');
  } catch (e) {
    if (String(e).includes('UNIQUE')) throw new LedgerConflict(opts.entries[0]?.ref?.startsWith('settle:') ? 'This change order has already been settled.' : 'The ledger changed at the same time. Reload and try again.');
    throw e;
  }
  return built.map(({statement: _s, ...entry}) => entry as SignedEntry);
}
