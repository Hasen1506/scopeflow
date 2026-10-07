// Applies client-data retention for every owner (suitable for a daily cron, e.g. a Render Cron Job:
// `node scripts/redact-expired.mjs`). Same rule as lib/retention.ts: after an owner's
// context_retention_days (or SCOPEFLOW_CONTEXT_RETENTION_DAYS for owners without a setting), the
// IP address and user agent stored with client decisions and client ledger entries become "redacted".
import { createConnection } from '../db/connection.mjs';

const fallback = Number(process.env.SCOPEFLOW_CONTEXT_RETENTION_DAYS);
const serverDefault = Number.isInteger(fallback) && fallback >= 1 && fallback <= 3650 ? fallback : null;
const sql = createConnection();
try {
  const owners = await sql`SELECT DISTINCT p.owner, s.context_retention_days FROM scopeflow.projects p LEFT JOIN scopeflow.account_settings s ON s.owner = p.owner`;
  let versions = 0, entries = 0;
  const at = new Date().toISOString();
  for (const {owner, context_retention_days} of owners) {
    const days = context_retention_days ?? serverDefault;
    if (!days) continue;
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
    await sql.begin(async tx => {
      await tx`SELECT set_config('scopeflow.redact', 'on', true)`;
      const v = await tx`UPDATE scopeflow.versions SET decision_context = (decision_context::jsonb || jsonb_build_object('ip','redacted','user_agent','redacted','redacted_at',${at}::text))::text
        WHERE project_id IN (SELECT id FROM scopeflow.projects WHERE owner = ${owner}) AND decided IS NOT NULL AND decided < ${cutoff}
          AND decision_context IS NOT NULL AND decision_context LIKE '{%' AND coalesce(decision_context::jsonb->>'ip','redacted') <> 'redacted'`;
      const e = await tx`UPDATE scopeflow.ledger_entries SET context = (context::jsonb || jsonb_build_object('ip','redacted','user_agent','redacted','redacted_at',${at}::text))::text
        WHERE project_id IN (SELECT id FROM scopeflow.projects WHERE owner = ${owner}) AND created < ${cutoff}
          AND context IS NOT NULL AND context LIKE '{%' AND coalesce(context::jsonb->>'ip','redacted') <> 'redacted'`;
      versions += v.count; entries += e.count;
    });
  }
  console.log(JSON.stringify({redacted_versions: versions, redacted_entries: entries, at}));
} finally { await sql.end(); }
