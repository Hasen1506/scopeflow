import {z} from 'zod';
import {db, json, ownerAuth, body, safeOrigin, allowWrite, failure} from '@/lib/server';
import {validTimeZone} from '@/lib/time';
import {COUNTRIES} from '@/lib/profile';
import {auditEvent} from '@/lib/billing';
// LT-16/LT-04: the account's own time zone (new projects start in it) and country.
const input = z.object({timezone: z.string().refine(validTimeZone, 'Choose a time zone from the list').optional(), country: z.enum(COUNTRIES.map(c => c.code) as [string, ...string[]]).optional()}).strict()
  .refine(v => v.timezone !== undefined || v.country !== undefined, 'Nothing to change.');
export async function PUT(request: Request) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in or provide a valid API token.'}, 401);
    if (!auth.scopes.includes('scopes:write')) return json({error: 'This credential cannot change settings.'}, 403);
    if (!await allowWrite('owner:' + auth.user)) return json({error: 'Write limit reached. Try again in a minute.'}, 429);
    let raw; try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const p = input.safeParse(raw);
    if (!p.success) return json({error: p.error.issues.map(i => i.message).join('; ')}, 400);
    const row = await db().prepare('INSERT INTO account_settings (owner,timezone,country,updated) VALUES (?,?,?,?) ON CONFLICT (owner) DO UPDATE SET timezone=coalesce(excluded.timezone,account_settings.timezone),country=coalesce(excluded.country,account_settings.country),updated=excluded.updated RETURNING timezone,country')
      .bind(auth.user, p.data.timezone ?? null, p.data.country ?? null, new Date().toISOString()).first<{timezone: string | null; country: string | null}>();
    await auditEvent(auth.user, 'account.changed', p.data, auth.via);
    return json({timezone: row?.timezone ?? null, country: row?.country ?? null});
  } catch (e) { return failure(e); }
}
