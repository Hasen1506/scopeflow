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

/** M32 (founder decision): client IP address and browser details are kept 180 days unless configured. */
export const DEFAULT_RETENTION_DAYS = 180;
/** SCOPEFLOW_CONTEXT_RETENTION_DAYS (1–3650), "keep" (no server default), else 180 days. */
export function serverRetentionDefault(env: Record<string, string | undefined>): number | null {
  const raw = env.SCOPEFLOW_CONTEXT_RETENTION_DAYS?.trim();
  if (raw === 'keep') return null;
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 1 && n <= 3650 ? n : DEFAULT_RETENTION_DAYS;
}
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
 * Deleting one draft project (WS-08, WS-10 C7): one call to the SECURITY DEFINER function
 * scopeflow.ws08_delete_draft (migration 0022a), which takes the project lock, re-checks that the
 * project has no client decision or ledger entry and is not on legal hold (a decision or a hold
 * that lands first wins), and only then deletes. Returns {deleted: boolean}.
 */
export function deleteDraftQuery(id: string, owner: string): [string, Param[]] {
  return ['SELECT scopeflow.ws08_delete_draft(?, ?) AS deleted', [id, owner]];
}

// Unsaved scope drafts kept with the account (the drafts table, one per owner) are removed after
// UNSAVED_DRAFT_DAYS without an edit. The app also ignores older ones until the job runs.
export const UNSAVED_DRAFT_DAYS = 90;
export function unsavedDraftCutoff(now: string) {
  return new Date(Date.parse(now) - UNSAVED_DRAFT_DAYS * 86400_000).toISOString();
}
export function staleUnsavedDraftsQuery(now: string): [string, Param[]] {
  return ['DELETE FROM drafts WHERE updated < ?', [unsavedDraftCutoff(now)]];
}

// ---- H10: account deletion keeps the client's record (tombstones) -------------------------
//
// Deleting an account removes the owner's own data (profile, settings, templates, drafts, API
// and OAuth tokens, forwarded emails, pending versions, plan) and every project that never got a
// client decision, ledger entry, invoice or payment. Projects with client evidence are
// tombstoned: marked owner_deleted, kept read-only (database triggers from migration 0022) until
// retain_until, then purged by the daily retention job unless a legal hold is set. All of it runs
// inside SECURITY DEFINER functions (migration 0022a), never through an app-side bypass.

/** GST records are kept 72 months from the annual-return due date (CGST s.36; CA to confirm). Default: 8 years. */
export const TOMBSTONE_RETENTION_YEARS = 8;
export function tombstoneRetentionYears(env: Record<string, string | undefined>) {
  const n = Number(env.SCOPEFLOW_TOMBSTONE_RETENTION_YEARS);
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : TOMBSTONE_RETENTION_YEARS;
}
export function retainUntil(now: string, years: number) {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString();
}

/**
 * Closes `owner`'s account in one call to scopeflow.ws08_close_account (migration 0022a, SECURITY
 * DEFINER): deletes the owner's own data and every project without client evidence, tombstones
 * the rest until `until`, refuses (raises) under legal hold. Returns {projects_kept}.
 */
export function closeAccountQuery(owner: string, now: string, until: string): [string, Param[]] {
  return ['SELECT scopeflow.ws08_close_account(?, ?, ?) AS projects_kept', [owner, now, until]];
}

/** Tombstoned projects past retain_until and not on legal hold: [sql, params] returning ids. */
export function expiredTombstonesQuery(now: string): [string, Param[]] {
  return ['SELECT id FROM projects WHERE owner_deleted IS NOT NULL AND retain_until IS NOT NULL AND retain_until::timestamptz < ?::timestamptz AND NOT legal_hold ORDER BY retain_until LIMIT 500', [now]];
}
/** Purges one expired tombstoned project through scopeflow.ws08_purge_tombstone. Returns {purged}. */
export function purgeTombstoneQuery(id: string, now: string): [string, Param[]] {
  return ['SELECT scopeflow.ws08_purge_tombstone(?, ?) AS purged', [id, now]];
}
