import {db} from './server';
import {defaultRetentionDays} from './settings';

// Retention for client network data: after N days, the IP address and browser user agent stored
// with client decisions (versions.decision_context) and client ledger entries (ledger_entries.context)
// become "redacted". Everything signed stays untouched, so receipts and the hash chain still verify.
// Runs opportunistically for an owner (on their project list and when they save settings) and for
// every owner from scripts/redact-expired.mjs (suitable for a daily cron).

export async function redactExpired(owner: string, days: number | null, now = Date.now()) {
  if (!days) return {versions: 0, entries: 0};
  const cutoff = new Date(now - days * 86400_000).toISOString(), at = new Date(now).toISOString();
  const patch = `(decision_context::jsonb || jsonb_build_object('ip','redacted','user_agent','redacted','redacted_at',?::text))::text`;
  const database = db();
  const [v, e] = await database.batch([
    database.prepare(`UPDATE versions SET decision_context=${patch} WHERE project_id IN (SELECT id FROM projects WHERE owner=?) AND decided IS NOT NULL AND decided < ? AND decision_context IS NOT NULL AND decision_context LIKE '{%' AND coalesce(decision_context::jsonb->>'ip','redacted') <> 'redacted'`).bind(at, owner, cutoff),
    database.prepare(`UPDATE ledger_entries SET context=${patch.replaceAll('decision_context', 'context')} WHERE project_id IN (SELECT id FROM projects WHERE owner=?) AND created < ? AND context IS NOT NULL AND context LIKE '{%' AND coalesce(context::jsonb->>'ip','redacted') <> 'redacted'`).bind(at, owner, cutoff),
  ], {lock: 'scopeflow:owner:' + owner, redact: true});
  return {versions: v.meta.changes, entries: e.meta.changes};
}

/** The owner's effective retention: their own setting, else the server default. */
export async function retentionDays(owner: string) {
  const row = await db().prepare('SELECT context_retention_days FROM account_settings WHERE owner=?').bind(owner).first<{context_retention_days: number | null}>();
  return row?.context_retention_days ?? defaultRetentionDays();
}
export async function applyRetention(owner: string) { return redactExpired(owner, await retentionDays(owner)); }
