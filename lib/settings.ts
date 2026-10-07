import {z} from 'zod';

// Account settings: retention for client network data, and the owner's own wording for the
// "Send for signature" email and for the clause text pre-filled into new drafts.

export const EMAIL_PLACEHOLDERS = ['{client}', '{title}', '{version}', '{link}'] as const;
const text = (max: number) => z.union([z.literal(''), z.string().trim().max(max)]);
export const settingsSchema = z.object({
  context_retention_days: z.number().int().min(1).max(3650).nullable(),
  email_subject: text(200),
  email_body: text(4000).refine(v => !v || v.includes('{link}'), 'The email body must include {link}, where the review link goes.'),
  default_exclusions: text(3000),
  default_terms: text(3000),
}).strict();
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings: Settings = {context_retention_days: null, email_subject: '', email_body: '', default_exclusions: '', default_terms: ''};
export type SettingsRow = {owner: string; context_retention_days: number | null; email_subject: string | null; email_body: string | null; default_exclusions: string | null; default_terms: string | null; updated: string};
export function fromRow(row: SettingsRow | null): Settings {
  if (!row) return defaultSettings;
  return {context_retention_days: row.context_retention_days ?? null, email_subject: row.email_subject ?? '', email_body: row.email_body ?? '', default_exclusions: row.default_exclusions ?? '', default_terms: row.default_terms ?? ''};
}
/** Server-wide default retention (days) for owners who chose none: SCOPEFLOW_CONTEXT_RETENTION_DAYS, else keep. */
export function defaultRetentionDays(env: Record<string, string | undefined> = process.env) {
  const n = Number(env.SCOPEFLOW_CONTEXT_RETENTION_DAYS);
  return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : null;
}
