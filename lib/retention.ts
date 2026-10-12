import {db} from './server';
import {defaultRetentionDays} from './settings';
import {deleteDraftQuery, expiredDraftsQuery, redactionQueries} from './retention-sql';

// Retention for client network data: after N days (the project's retention_days, else the owner's
// context_retention_days, else the server default) the IP address and browser user agent stored
// with client decisions (versions.decision_context) and client ledger entries
// (ledger_entries.context) become "redacted". Everything signed stays untouched, so receipts and
// the hash chain still verify. Projects on legal hold are skipped. Runs for every owner from
// scripts/redact-expired.mjs (a daily cron), which also expires archived drafts, and for one owner
// when they save a new retention period (M26b, WS-08: reading the project list never writes).

export async function redactExpired(owner: string, now = Date.now()) {
  const q = redactionQueries(owner, defaultRetentionDays(), new Date(now).toISOString());
  const database = db();
  const [v, e] = await database.batch([database.prepare(q.versions[0]).bind(...q.versions[1]), database.prepare(q.entries[0]).bind(...q.entries[1])], {lock: 'scopeflow:owner:' + owner, redact: true});
  return {versions: v.meta.changes, entries: e.meta.changes};
}

/** Deletes one draft project (no client decision, no ledger entry, not on legal hold). True when deleted. */
export async function deleteDraft(id: string, owner: string) {
  // WS-08 (WS-10 C7): the deletion runs inside scopeflow.ws08_delete_draft (SECURITY DEFINER).
  const [sql, params] = deleteDraftQuery(id, owner);
  const row = await db().prepare(sql).bind(...params).first<{deleted: boolean}>();
  return row?.deleted === true;
}

/** Deletes this owner's archived drafts past their draft_expiry_days. Returns how many were deleted. */
export async function expireDrafts(owner: string, now = Date.now()) {
  const [sql, params] = expiredDraftsQuery(owner, new Date(now).toISOString());
  const rows = await db().prepare(sql).bind(...params).all<{id: string; owner: string}>();
  let deleted = 0;
  for (const row of rows.results) if (await deleteDraft(row.id, row.owner).catch(() => false)) deleted++;
  return deleted;
}
