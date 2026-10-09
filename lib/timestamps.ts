import {db} from './server';
import {requestTimestamp, tsaConfig, TsaError} from './tsa';

export type StoredTimestamp = {subject: string; digest: string; tsa: string; gen_time: string; token: string};

/**
 * Asks the configured RFC 3161 authority to timestamp `digest` (a record fingerprint) and stores the
 * token. Best effort: without SCOPEFLOW_TSA_URL, or when the authority fails, nothing is stored and
 * the record is unaffected. Returns the stored row, or null.
 */
export async function timestampRecord(project_id: string, version: number, subject: string, digest: string): Promise<StoredTimestamp | null> {
  const config = tsaConfig();
  if (!config || !/^[0-9a-f]{64}$/.test(digest)) return null;
  const existing = await db().prepare('SELECT subject,digest,tsa,gen_time,token FROM timestamps WHERE project_id=? AND subject=? AND digest=?').bind(project_id, subject, digest).first<StoredTimestamp>();
  if (existing) return existing;
  try {
    const t = await requestTimestamp(digest, config);
    const row = {subject, digest, tsa: t.tsa ?? t.tsa_url, gen_time: t.gen_time, token: Buffer.from(t.token).toString('base64')};
    await db().prepare('INSERT INTO timestamps (id,project_id,version,subject,digest,tsa,token,gen_time,created) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT (project_id,subject,digest) DO NOTHING')
      .bind(crypto.randomUUID(), project_id, version, subject, digest, row.tsa, row.token, row.gen_time, new Date().toISOString()).run();
    return row;
  } catch (e) {
    console.warn('Scopeflow timestamp failed', e instanceof TsaError ? e.message : String(e));
    return null;
  }
}

export async function timestampsFor(project_id: string, version: number): Promise<StoredTimestamp[]> {
  return (await db().prepare('SELECT subject,digest,tsa,gen_time,token FROM timestamps WHERE project_id=? AND version=? ORDER BY gen_time').bind(project_id, version).all<StoredTimestamp>()).results;
}
