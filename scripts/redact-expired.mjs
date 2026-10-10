// Daily retention job (a Render Cron Job: `node scripts/redact-expired.mjs`). Same rules as
// lib/retention.ts, from the shared SQL in lib/retention-sql.ts:
//  * client network data: after a project's retention_days, else the owner's context_retention_days,
//    else SCOPEFLOW_CONTEXT_RETENTION_DAYS, the IP address and user agent stored with client
//    decisions and client ledger entries become "redacted" (signed fields stay untouched);
//  * archived drafts: with the owner's draft_expiry_days set, archived projects that never got a
//    client decision or ledger entry are deleted that many days after archiving;
//  * unsaved scope drafts kept with the account are removed after 90 days without an edit.
// Projects on legal hold are skipped by both.
import {createConnection} from '../db/connection.mjs';
import {postgresQuery} from '../db/client.ts';
import {draftDeleteQueries, expiredDraftsQuery, redactionQueries, staleUnsavedDraftsQuery} from '../lib/retention-sql.ts';

const fallback = Number(process.env.SCOPEFLOW_CONTEXT_RETENTION_DAYS);
const serverDefault = Number.isInteger(fallback) && fallback >= 1 && fallback <= 3650 ? fallback : null;
const sql = createConnection();
const run = (tx, [text, params]) => tx.unsafe(postgresQuery(text), params);
try {
  const at = new Date().toISOString();
  const q = redactionQueries(null, serverDefault, at);
  const {versions, entries} = await sql.begin(async tx => {
    await tx.unsafe("SELECT set_config('scopeflow.redact', 'on', true)");
    return {versions: (await run(tx, q.versions)).count, entries: (await run(tx, q.entries)).count};
  });
  let drafts = 0;
  for (const {id, owner} of await run(sql, expiredDraftsQuery(null, at))) {
    try {
      const deleted = await sql.begin(async tx => {
        await tx.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['scopeflow:project:' + id]);
        await tx.unsafe("SELECT set_config('scopeflow.allow_delete', 'on', true)");
        let last = 0;
        const steps = draftDeleteQueries(id, owner);
        for (const [i, step] of steps.entries()) { const r = await run(tx, step); if (i === 4) last = r.count; }
        return last > 0;
      });
      if (deleted) drafts++;
    } catch (e) { console.error('Draft expiry skipped a project:', e instanceof Error ? e.message : 'unknown'); }
  }
  const unsaved = (await run(sql, staleUnsavedDraftsQuery(at))).count;
  console.log(JSON.stringify({redacted_versions: versions, redacted_entries: entries, expired_drafts: drafts, stale_unsaved_drafts: unsaved, at}));
} finally { await sql.end(); }
