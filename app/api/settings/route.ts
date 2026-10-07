import {db, json, ownerAuth, body, safeOrigin, allowWrite, allowRead, failure} from '@/lib/server';
import {fromRow, settingsSchema, defaultRetentionDays, EMAIL_PLACEHOLDERS, type SettingsRow} from '@/lib/settings';
import {redactExpired} from '@/lib/retention';
// Account settings: client-data retention and editable wording (email, default clauses).
export async function GET(request: Request) {
  try {
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in or provide a valid API token.'}, 401);
    if (!await allowRead('owner:' + auth.user)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const row = await db().prepare('SELECT * FROM account_settings WHERE owner=?').bind(auth.user).first<SettingsRow>();
    return json({settings: fromRow(row), server_default_retention_days: defaultRetentionDays(), placeholders: EMAIL_PLACEHOLDERS});
  } catch (e) { return failure(e); }
}
export async function PUT(request: Request) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in or provide a valid API token.'}, 401);
    if (!auth.scopes.includes('scopes:write')) return json({error: 'This credential cannot change settings.'}, 403);
    if (!await allowWrite('owner:' + auth.user)) return json({error: 'Write limit reached. Try again in a minute.'}, 429);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const input = settingsSchema.safeParse(raw);
    if (!input.success) return json({error: input.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}, 400);
    const s = input.data, now = new Date().toISOString(), orNull = (v: string) => v || null;
    const row = await db().prepare('INSERT INTO account_settings (owner,context_retention_days,email_subject,email_body,default_exclusions,default_terms,updated) VALUES (?,?,?,?,?,?,?) ON CONFLICT (owner) DO UPDATE SET context_retention_days=excluded.context_retention_days,email_subject=excluded.email_subject,email_body=excluded.email_body,default_exclusions=excluded.default_exclusions,default_terms=excluded.default_terms,updated=excluded.updated RETURNING *')
      .bind(auth.user, s.context_retention_days, orNull(s.email_subject), orNull(s.email_body), orNull(s.default_exclusions), orNull(s.default_terms), now).first<SettingsRow>();
    // Apply a new retention period right away, not only on the next visit.
    const redacted = await redactExpired(auth.user, s.context_retention_days ?? defaultRetentionDays());
    return json({settings: fromRow(row), redacted});
  } catch (e) { return failure(e); }
}
