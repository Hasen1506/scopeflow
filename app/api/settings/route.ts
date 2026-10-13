import {db, json, ownerAuth, body, safeOrigin, allowWrite, allowRead, failure} from '@/lib/server';
import {fromRow, settingsSchema, defaultRetentionDays, effectiveRetentionDays, retentionPolicyProblem, EMAIL_PLACEHOLDERS, type SettingsRow} from '@/lib/settings';
import {expireDrafts, redactExpired} from '@/lib/retention';
import {currentMode, modeDefaults} from '@/lib/mode';
import {auditEvent} from '@/lib/billing';
// Account settings: client-data retention, draft expiry and editable wording (email, default clauses).
// WS-08: the workspace mode adds rules (Enterprise: a retention policy of 30–3650 days is required).
type Row = SettingsRow & {timezone?: string | null; country?: string | null; onboarded?: string | null};
export async function GET(request: Request) {
  try {
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in or provide a valid API token.'}, 401);
    if (!await allowRead('owner:' + auth.user)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const row = await db().prepare('SELECT * FROM account_settings WHERE owner=?').bind(auth.user).first<Row>();
    const mode = await currentMode(auth.user), d = modeDefaults(mode);
    const settings = fromRow(row);
    return json({settings, server_default_retention_days: defaultRetentionDays(), effective_retention_days: effectiveRetentionDays(settings), placeholders: EMAIL_PLACEHOLDERS,
      mode, retention_required: d.retention_required, retention_range: d.retention_range, timezone: row?.timezone ?? null, country: row?.country ?? null, onboarded: row?.onboarded ?? null});
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
    const problem = retentionPolicyProblem(s, modeDefaults(await currentMode(auth.user)));
    if (problem) return json({error: problem, code: 'retention_required'}, 400);
    const before = await db().prepare('SELECT context_retention_days FROM account_settings WHERE owner=?').bind(auth.user).first<{context_retention_days: number | null}>();
    const row = await db().prepare('INSERT INTO account_settings (owner,context_retention_days,email_subject,email_body,default_exclusions,default_terms,draft_expiry_days,updated) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (owner) DO UPDATE SET context_retention_days=excluded.context_retention_days,draft_expiry_days=excluded.draft_expiry_days,email_subject=excluded.email_subject,email_body=excluded.email_body,default_exclusions=excluded.default_exclusions,default_terms=excluded.default_terms,updated=excluded.updated RETURNING *')
      .bind(auth.user, s.context_retention_days, orNull(s.email_subject), orNull(s.email_body), orNull(s.default_exclusions), orNull(s.default_terms), s.draft_expiry_days, now).first<SettingsRow>();
    if ((before?.context_retention_days ?? null) !== s.context_retention_days) await auditEvent(auth.user, 'retention.changed', {from: before?.context_retention_days ?? null, to: s.context_retention_days}, auth.via);
    // Saving a shorter period is an explicit owner action, so it is applied at once (a write, never
    // a read: M26b moved redaction off the project list; the daily job covers everything else).
    const redacted = await redactExpired(auth.user);
    const expired = await expireDrafts(auth.user);
    return json({settings: fromRow(row), redacted, expired_drafts: expired});
  } catch (e) { return failure(e); }
}
