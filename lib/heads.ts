// C7: the daily signed head digest. For a UTC date D it lists, for every project with a ledger, the
// last entry recorded up to the end of D (seq and hash), keyed by a hash of the project id so the
// list reveals nothing about who the projects belong to. The digest (SHA-256 over the sorted lines)
// is signed with the record key and, when SCOPEFLOW_TSA_URL is set, timestamped by an RFC 3161
// authority. A client that saves its project's head and the published digest can later show that
// the ledger it is shown today still extends what was published then: rewriting history would
// need a new signature over an old date, and the TSA token pins the old one in time.
import {createHash} from 'node:crypto';
import {db} from '@/lib/server';
import {signRecord, publicSigningKey, verifyRecord} from '@/lib/signing';
import {requestTimestamp, tsaConfig, TsaError} from '@/lib/tsa';

export const headsMessage = (date: string, digest: string) => `scopeflow-heads-v1:${date}:${digest}`;
export const projectKey = (projectId: string) => createHash('sha256').update('scopeflow-project:' + projectId).digest('hex').slice(0, 32);
// An impossible date (2026-13-01) is Invalid Date, whose toISOString() throws, so check the time first.
export const isDate = (value: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const t = Date.parse(value + 'T00:00:00Z'); return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value; };
/** A date is final (publishable) once it has ended in UTC. */
export const isFinal = (date: string, now = Date.now()) => Date.parse(date + 'T00:00:00Z') + 86400_000 <= now;

export type Head = {p: string; seq: number; hash: string};
export function digestOf(heads: Head[]) {
  const lines = [...heads].sort((a, b) => (a.p < b.p ? -1 : a.p > b.p ? 1 : 0)).map(h => `${h.p} ${h.seq} ${h.hash}`);
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

export async function computeHeads(date: string): Promise<Head[]> {
  const end = new Date(Date.parse(date + 'T00:00:00Z') + 86400_000).toISOString();
  const rows = await db().prepare("SELECT DISTINCT ON (project_id) project_id, seq, hash FROM ledger_entries WHERE created < ? AND created LIKE '____-__-__T%' ORDER BY project_id, seq DESC").bind(end).all<{project_id: string; seq: number; hash: string}>();
  return rows.results.map(r => ({p: projectKey(r.project_id), seq: Number(r.seq), hash: r.hash}));
}

export type HeadDigest = {date: string; digest: string; projects: number; heads: Head[]; kid: string | null; signature: string | null; tsa: string | null; tsa_token: string | null; tsa_gen_time: string | null; published: boolean};

type Row = {date: string; digest: string; heads: string; projects: number; kid: string | null; signature: string | null; tsa: string | null; tsa_token: string | null; tsa_gen_time: string | null};
const fromRow = (r: Row): HeadDigest => ({date: r.date, digest: r.digest, projects: Number(r.projects), heads: JSON.parse(r.heads), kid: r.kid, signature: r.signature, tsa: r.tsa, tsa_token: r.tsa_token, tsa_gen_time: r.tsa_gen_time, published: true});

export async function storedDigest(date: string) {
  const r = await db().prepare('SELECT date,digest,heads,projects,kid,signature,tsa,tsa_token,tsa_gen_time FROM scopeflow.head_digests WHERE date=?').bind(date).first<Row>();
  return r ? fromRow(r) : null;
}

/** The digest for `date` as it would be published now (signed, not stored, no timestamp). */
export async function previewDigest(date: string): Promise<HeadDigest> {
  const heads = await computeHeads(date);
  const digest = digestOf(heads);
  const signature = signRecord(headsMessage(date, digest));
  return {date, digest, projects: heads.length, heads, kid: signature ? publicSigningKey()!.kid : null, signature, tsa: null, tsa_token: null, tsa_gen_time: null, published: false};
}

/** Publishes `date` once (the cron job): stores the signed digest and attaches an RFC 3161 token. Idempotent. */
export async function publishDigest(date: string): Promise<HeadDigest> {
  let row = await storedDigest(date);
  if (!row) {
    const d = await previewDigest(date);
    await db().prepare('INSERT INTO scopeflow.head_digests (date,digest,heads,projects,kid,signature,created) VALUES (?,?,?,?,?,?,?) ON CONFLICT (date) DO NOTHING')
      .bind(date, d.digest, JSON.stringify(d.heads), d.projects, d.kid, d.signature, new Date().toISOString()).run();
    row = (await storedDigest(date))!;
  }
  if (!row.tsa_token && tsaConfig()) {
    try {
      const t = await requestTimestamp(row.digest);
      const token = Buffer.from(t.token).toString('base64');
      await db().prepare('UPDATE scopeflow.head_digests SET tsa=?, tsa_token=?, tsa_gen_time=? WHERE date=? AND tsa_token IS NULL').bind(t.tsa ?? t.tsa_url, token, t.gen_time, date).run();
      row = (await storedDigest(date))!;
    } catch (e) {
      console.warn('Scopeflow head digest timestamp failed', e instanceof TsaError ? e.message : String(e));
    }
  }
  return row;
}

export function verifyDigest(d: Pick<HeadDigest, 'date' | 'digest' | 'signature'>) { return verifyRecord(headsMessage(d.date, d.digest), d.signature); }
