import {z} from 'zod';
import {DEFAULT_RETENTION_DAYS, serverRetentionDefault} from './retention-sql';

// Account settings: retention for client network data, automatic expiry of archived drafts, and the owner's own wording for the
// "Send for signature" email and for the clause text pre-filled into new drafts.

export const EMAIL_PLACEHOLDERS = ['{client}', '{title}', '{version}', '{link}'] as const;
const text = (max: number) => z.union([z.literal(''), z.string().trim().max(max)]);
export const settingsSchema = z.object({
  context_retention_days: z.number().int().min(1).max(3650).nullable(),
  email_subject: text(200),
  email_body: text(4000).refine(v => !v || v.includes('{link}'), 'The email body must include {link}, where the review link goes.'),
  default_exclusions: text(3000),
  default_terms: text(3000),
  draft_expiry_days: z.number().int().min(7).max(3650).nullable().default(null),
}).strict();
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings: Settings = {context_retention_days: null, email_subject: '', email_body: '', default_exclusions: '', default_terms: '', draft_expiry_days: null};
export type SettingsRow = {owner: string; context_retention_days: number | null; email_subject: string | null; email_body: string | null; default_exclusions: string | null; default_terms: string | null; draft_expiry_days?: number | null; updated: string};
export function fromRow(row: SettingsRow | null): Settings {
  if (!row) return defaultSettings;
  return {context_retention_days: row.context_retention_days ?? null, email_subject: row.email_subject ?? '', email_body: row.email_body ?? '', default_exclusions: row.default_exclusions ?? '', default_terms: row.default_terms ?? '', draft_expiry_days: row.draft_expiry_days ?? null};
}
/** M32: the founder's default retention for client IP address and browser details, in days. */
export {DEFAULT_RETENTION_DAYS};
/**
 * Server-wide default retention (days) for owners who chose none: SCOPEFLOW_CONTEXT_RETENTION_DAYS
 * (1–3650), else 180 days (M32, founder decision). Set the variable to "keep" to keep client
 * network details until a project is deleted (the pre-WS-08 behaviour).
 */
export function defaultRetentionDays(env: Record<string, string | undefined> = process.env): number | null {
  return serverRetentionDefault(env);
}
/** The retention period that applies to an owner: their own setting, else the server default. */
export function effectiveRetentionDays(settings: Pick<Settings, 'context_retention_days'>, env: Record<string, string | undefined> = process.env) {
  return settings.context_retention_days ?? defaultRetentionDays(env);
}
/**
 * SF-17: rules a mode adds to the settings. Enterprise requires a retention policy of 30–3650
 * days (no "server default"); other modes accept 1–3650 days or the server default. Returns an
 * error message, or null when the settings are allowed.
 */
export function retentionPolicyProblem(settings: Pick<Settings, 'context_retention_days'>, rules: {retention_required: boolean; retention_range: readonly [number, number]}) {
  const d = settings.context_retention_days, [min, max] = rules.retention_range;
  if (d === null) return rules.retention_required ? `Enterprise workspaces need a retention policy: choose ${min} to ${max} days.` : null;
  return d < min || d > max ? `Choose a retention period of ${min} to ${max} days.` : null;
}
