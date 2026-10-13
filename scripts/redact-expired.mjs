// Daily retention job (a Render Cron Job: `node scripts/redact-expired.mjs`). Same rules as
// lib/retention.ts, from the shared SQL in lib/retention-sql.ts:
//  * client network data: after a project's retention_days, else the owner's context_retention_days,
//    else SCOPEFLOW_CONTEXT_RETENTION_DAYS, the IP address and user agent stored with client
//    decisions and client ledger entries become "redacted" (signed fields stay untouched);
//  * archived drafts: with the owner's draft_expiry_days set, archived projects that never got a
//    client decision or ledger entry are deleted that many days after archiving;
//  * unsaved scope drafts kept with the account are removed after 90 days without an edit;
//  * H10 (WS-08): projects of closed accounts (tombstones) are purged after their retain_until.
// Projects on legal hold are skipped by all of them. M32/M26b: this job is where redaction runs;
// reading the project list never redacts. Default retention: 180 days (SCOPEFLOW_CONTEXT_RETENTION_DAYS).
import {createConnection} from '../db/connection.mjs';
import {postgresQuery} from '../db/client.ts';
import {deleteDraftQuery, expiredDraftsQuery, expiredTombstonesQuery, purgeTombstoneQuery, redactionQueries, serverRetentionDefault, staleUnsavedDraftsQuery} from '../lib/retention-sql.ts';

const serverDefault = serverRetentionDefault(process.env);
const sql = createConnection();
const run = (tx, [text, params]) => tx.unsafe(postgresQuery(text), params);
try {
  const at = new Date().toISOString();
  const q = redactionQueries(null, serverDefault, at);
  const {versions, entries} = await sql.begin(async tx => {
    await tx.unsafe("SELECT set_config('scopeflow.redact', 'on', true)");
    return {versions: (await run(tx, q.versions)).count, entries: (await run(tx, q.entries)).count};
  });
  // Deletions run inside SECURITY DEFINER functions (migration 0022a); this job never sets the bypass.
  let drafts = 0;
  for (const {id, owner} of await run(sql, expiredDraftsQuery(null, at))) {
    try { if ((await run(sql, deleteDraftQuery(id, owner)))[0]?.deleted === true) drafts++; }
    catch (e) { console.error('Draft expiry skipped a project:', e instanceof Error ? e.message : 'unknown'); }
  }
  const unsaved = (await run(sql, staleUnsavedDraftsQuery(at))).count;
  let purged = 0;
  for (const {id} of await run(sql, expiredTombstonesQuery(at))) {
    try { if ((await run(sql, purgeTombstoneQuery(id, at)))[0]?.purged === true) purged++; }
    catch (e) { console.error('Closed-account purge skipped a project:', e instanceof Error ? e.message : 'unknown'); }
  }
  console.log(JSON.stringify({redacted_versions: versions, redacted_entries: entries, expired_drafts: drafts, stale_unsaved_drafts: unsaved, purged_closed_projects: purged, server_default_retention_days: serverDefault, at}));
} finally { await sql.end(); }
