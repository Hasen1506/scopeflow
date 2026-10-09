// Retention rules as SQL, shared by the app (lib/retention.ts, one owner at a time) and the daily
// job (scripts/redact-expired.mjs, every owner). No imports, so the script can load this file.
//
// Client network data: a project's retention_days, else the owner's context_retention_days, else
// the server default (SCOPEFLOW_CONTEXT_RETENTION_DAYS). After that many days the IP address and
// user agent stored with client decisions and client ledger entries become "redacted"; every signed
// field stays as it is. A project on legal hold is never redacted.
//
// Archived drafts: with the owner's draft_expiry_days set, an archived project that never got a
// client decision or ledger entry is deleted that many days after it was archived, unless it is
// on legal hold. Queries use positional ? parameters (lib/server's convention).

type Param = string | number | boolean | null;
const days = 'coalesce(p.retention_days, s.context_retention_days, ?::int)';
const redactPatch = (column: string) => `(${column}::jsonb || jsonb_build_object('ip','redacted','user_agent','redacted','redacted_at',?::text))::text`;
const notRedacted = (column: string) => `${column} IS NOT NULL AND ${column} LIKE '{%' AND coalesce(${column}::jsonb->>'ip','redacted') <> 'redacted'`;

/** [sql, params] for both redaction updates. `owner` limits them to one owner; null runs for everyone. */
export function redactionQueries(owner: string | null, serverDefault: number | null, now: string): {versions: [string, Param[]]; entries: [string, Param[]]} {
  const scope = owner ? ' AND p.owner=?' : '';
  const where = (time: string) => `NOT p.legal_hold${scope} AND ${days} IS NOT NULL AND ${time}::timestamptz < ?::timestamptz - make_interval(days => ${days})`;
  const params = [now, ...(owner ? [owner] : []), serverDefault, now, serverDefault];
  return {
    versions: [`UPDATE versions v SET decision_context=${redactPatch('v.decision_context')} FROM projects p LEFT JOIN account_settings s ON s.owner=p.owner WHERE p.id=v.project_id AND ${where('v.decided')} AND v.decided IS NOT NULL AND ${notRedacted('v.decision_context')}`, params],
    entries: [`UPDATE ledger_entries e SET context=${redactPatch('e.context')} FROM projects p LEFT JOIN account_settings s ON s.owner=p.owner WHERE p.id=e.project_id AND ${where('e.created')} AND ${notRedacted('e.context')}`, params],
  };
}

/** Archived drafts past the owner's expiry: [sql, params] returning project id and owner. */
export function expiredDraftsQuery(owner: string | null, now: string): [string, Param[]] {
  return [`SELECT p.id, p.owner FROM projects p JOIN account_settings s ON s.owner=p.owner WHERE s.draft_expiry_days IS NOT NULL AND p.archived IS NOT NULL AND NOT p.legal_hold${owner ? ' AND p.owner=?' : ''}
    AND p.archived::timestamptz < ?::timestamptz - make_interval(days => s.draft_expiry_days)
    AND NOT EXISTS (SELECT 1 FROM versions x WHERE x.project_id=p.id AND x.status<>'pending')
    AND NOT EXISTS (SELECT 1 FROM ledger_entries x WHERE x.project_id=p.id) ORDER BY p.archived LIMIT 500`, [...(owner ? [owner] : []), now]];
}

/**
 * Deleting one draft project, in order, inside one transaction with the 'drafts' bypass (the
 * immutability triggers still refuse anything but pending versions). Every statement re-checks
 * that the project has no client evidence and is not on legal hold, so a decision or a hold that
 * lands first wins. The last statement deletes the project; zero changes there means it was kept.
 */
export function draftDeleteQueries(id: string, owner: string): [string, Param[]][] {
  const draft = `EXISTS (SELECT 1 FROM projects WHERE id=? AND owner=? AND NOT legal_hold) AND NOT EXISTS (SELECT 1 FROM versions WHERE project_id=? AND status<>'pending') AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE project_id=?)`;
  const guard = [id, owner, id, id];
  return [
    ['SELECT id FROM versions WHERE project_id=? AND project_id IN (SELECT id FROM projects WHERE owner=?) FOR UPDATE', [id, owner]],
    ["DELETE FROM rate_limits WHERE id IN (SELECT 'review:'||v.id FROM versions v JOIN projects p ON p.id=v.project_id WHERE p.id=? AND p.owner=?)", [id, owner]],
    [`DELETE FROM inbound_messages WHERE project_id=? AND ${draft}`, [id, ...guard]],
    [`DELETE FROM versions WHERE project_id=? AND status='pending' AND ${draft}`, [id, ...guard]],
    ['DELETE FROM projects WHERE id=? AND owner=? AND NOT legal_hold AND NOT EXISTS (SELECT 1 FROM versions WHERE project_id=?)', [id, owner, id]],
    ['DELETE FROM review_views WHERE project_id=? AND NOT EXISTS (SELECT 1 FROM projects WHERE id=?)', [id, id]],
  ];
}
