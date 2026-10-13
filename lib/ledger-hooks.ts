import {db} from './server';
import {appendEntry, LedgerConflict, type AppendAnchor, type SignedEntry} from './ledger-server';
import {isMoneyKind, payloadSchemas, type Actor, type EntryKind, type LedgerEntry} from './ledger';
import {toMinor} from './minor';

// Ledger hooks (owner: WS-05).
//
// appendMoneyEntry() is how payment, refund, tds_credit, excess_payment, payment_claim_confirmed and
// baseline_superseded entries are written (H6): exempt from the plan entry cap, and recorded against
// the CURRENT approved baseline even when the order was created on an older one (the payload keeps
// `order_baseline`). It retries when the ledger moves underneath and is idempotent by `ref`.
//
// onBaselineApproved() is called by the decision route (WS-02) once a version is approved. When the
// approval supersedes an earlier approved version it writes a signed `baseline_superseded` entry
// with the money already on the record, so the carry-forward is on the record (C4, plan §6.4).

type VersionRow = {id: string; project_id: string; version: number; token: string; revoked: number; content: string; status: string; signer: string | null; decided: string | null; signature?: string | null};

export type AppendEntryOptions = {
  /** Any version row of the project: the one the order or payment was created on. Only its project_id and version are used. */
  baseline: Pick<VersionRow, 'project_id' | 'version'> & Partial<VersionRow>;
  /** Ignored: the current head is read on every attempt. Kept so Phase 0 callers compile. */
  expectedHead?: string;
  kind: EntryKind; payload: unknown; actor: Actor; ref?: string | null; context?: unknown;
};
export type MoneyEntryErrorCode = 'not_money_kind' | 'invalid_payload' | 'no_approved_baseline' | 'conflict';
export class MoneyEntryError extends Error {
  readonly code: MoneyEntryErrorCode;
  // No TypeScript parameter properties: tests import this module with Node's type stripping.
  constructor(message: string, code: MoneyEntryErrorCode) { super(message); this.name = 'MoneyEntryError'; this.code = code; }
}
const WITH_ORDER_BASELINE = new Set<string>(['payment', 'refund', 'tds_credit', 'excess_payment']);

async function latestApproved(projectId: string) {
  return db().prepare("SELECT * FROM versions WHERE project_id=? AND status='approved' ORDER BY version DESC LIMIT 1").bind(projectId).first<VersionRow>();
}
async function head(projectId: string) {
  return (await db().prepare('SELECT hash FROM ledger_entries WHERE project_id=? ORDER BY seq DESC LIMIT 1').bind(projectId).first<{hash: string}>())?.hash ?? '0'.repeat(64);
}
async function byRef(projectId: string, ref: string) {
  return db().prepare('SELECT seq,kind,baseline_version,actor,payload,prev_hash,hash,created,signature FROM ledger_entries WHERE project_id=? AND ref=?').bind(projectId, ref).first<{seq: number; kind: EntryKind; baseline_version: number; actor: Actor; payload: string; prev_hash: string; hash: string; created: string; signature: string | null}>();
}

/**
 * H6: records money so it can never be dropped. Returns the entry (or the existing one for a
 * repeated `ref`, with `duplicate: true`). Throws MoneyEntryError when it cannot be recorded, so the
 * caller (WS-04 webhook) answers 500, writes a payment alert and lets the provider retry.
 */
export async function appendMoneyEntry(opts: AppendEntryOptions, {attempts = 5}: {attempts?: number} = {}): Promise<SignedEntry & {duplicate?: boolean; order_baseline?: number}> {
  if (!isMoneyKind(opts.kind)) throw new MoneyEntryError(`${opts.kind} is not a money entry.`, 'not_money_kind');
  const projectId = opts.baseline.project_id;
  const orderBaseline = opts.baseline.version;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (opts.ref) {
      const prior = await byRef(projectId, opts.ref);
      if (prior) return {seq: prior.seq, kind: prior.kind, baseline_version: prior.baseline_version, actor: prior.actor, created: prior.created, payload: JSON.parse(prior.payload), payload_hash: '', prev_hash: prior.prev_hash, hash: prior.hash, signature: prior.signature, duplicate: true};
    }
    const current = await latestApproved(projectId);
    if (!current) throw new MoneyEntryError('The project has no approved version to record money against.', 'no_approved_baseline');
    const base = (opts.payload && typeof opts.payload === 'object' ? opts.payload : {}) as Record<string, unknown>;
    const payload = WITH_ORDER_BASELINE.has(opts.kind) && orderBaseline && orderBaseline !== current.version && base.order_baseline === undefined ? {...base, order_baseline: orderBaseline} : base;
    const parsed = payloadSchemas[opts.kind as keyof typeof payloadSchemas].safeParse(payload);
    if (!parsed.success) throw new MoneyEntryError(parsed.error.issues.map(i => `${i.path.join('.') || opts.kind}: ${i.message}`).join('; '), 'invalid_payload');
    try {
      const anchor: AppendAnchor = 'latest_approved';
      const entry = await appendEntry({baseline: current, expectedHead: await head(projectId), kind: opts.kind, payload: parsed.data, actor: opts.actor, ref: opts.ref, context: opts.context, anchor});
      return {...entry, ...(payload.order_baseline !== undefined ? {order_baseline: payload.order_baseline as number} : {})};
    } catch (e) {
      if (!(e instanceof LedgerConflict)) throw e;
      if (attempt === attempts - 1) throw new MoneyEntryError(e.message, 'conflict');
    }
  }
  throw new MoneyEntryError('The ledger kept changing; the entry was not recorded.', 'conflict');
}

/** The money on a project's record across every baseline, in minor units (C4: money is project-scoped). */
export function moneyOnRecord(entries: Pick<LedgerEntry, 'kind' | 'payload'>[], currency: string) {
  let received = 0, refunded = 0, tds = 0;
  const m = (n: unknown) => toMinor(Number(n) || 0, currency);
  for (const e of entries) {
    const p = e.payload as Record<string, unknown> | null;
    if (!p) continue;
    if (e.kind === 'payment' || e.kind === 'payment_received') received += m(p.amount);
    else if (e.kind === 'payment_claim_confirmed') received += Number(p.amount_minor) || 0;
    else if (e.kind === 'refund') refunded += m(p.amount);
    else if (e.kind === 'tds_credit') tds += Number(p.amount_minor) || 0;
  }
  return {received_minor: received, refunded_minor: refunded, paid_minor: received - refunded, tds_minor: tds};
}

/**
 * Called once version `to` of `project` is approved. `from` is the approved version being replaced
 * (null for the first approval: nothing to carry). Idempotent: a repeated call finds its entry by ref.
 */
export async function onBaselineApproved(project: string, from: number | null, to: number): Promise<void> {
  if (from === null || from >= to) return;
  const version = await db().prepare("SELECT content FROM versions WHERE project_id=? AND version=? AND status='approved'").bind(project, to).first<{content: string}>();
  if (!version) return;
  const currency = (JSON.parse(version.content) as {currency: string}).currency;
  const rows = await db().prepare('SELECT kind,payload FROM ledger_entries WHERE project_id=? ORDER BY seq').bind(project).all<{kind: EntryKind; payload: string}>();
  const entries = rows.results.map(r => ({kind: r.kind, payload: JSON.parse(r.payload)}));
  const invoiced = await db().prepare('SELECT COALESCE(SUM(amount),0) AS total FROM invoices WHERE project_id=? AND currency=?').bind(project, currency).first<{total: number | string}>();
  const money = moneyOnRecord(entries, currency);
  await appendMoneyEntry({
    baseline: {project_id: project, version: to}, kind: 'baseline_superseded', actor: 'system', ref: `superseded:${from}:${to}`,
    payload: {from, to, currency, ...money, invoiced_minor: toMinor(Number(invoiced?.total ?? 0), currency), entries_before: entries.length},
  });
}
