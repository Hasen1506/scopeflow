import {z} from 'zod';
import {db, json, ownerAuth, body, safeOrigin, allowWrite, failure} from '@/lib/server';
import {currencyCodes} from '@/lib/currency';
import {validTimeZone} from '@/lib/time';
import {COUNTRIES, UDYAM_CATEGORIES, UDYAM_PATTERN, profileFromRow, type ProfileRow} from '@/lib/profile';
import {checkGstin} from '@/lib/gstin';
import {VPA_MESSAGE, VPA_PATTERN, upiLink} from '@/lib/vpa';
import {MODES, modeDefaults, type Mode} from '@/lib/mode';
import {DEFAULT_RETENTION_DAYS} from '@/lib/settings';
import {auditEvent} from '@/lib/billing';
// LT-04/SF-11: first-run onboarding in one save: workspace mode, country → currency and time
// zone, business details (GSTIN optional, Udyam optional), UPI VPA. Fields not sent keep their
// current values; every field stays editable in Account.
const opt = (max: number) => z.string().trim().max(max).optional().default('');
const input = z.object({
  mode: z.enum(MODES as unknown as [Mode, ...Mode[]]),
  country: z.enum(COUNTRIES.map(c => c.code) as [string, ...string[]]),
  currency: z.enum(currencyCodes),
  timezone: z.string().refine(validTimeZone, 'Choose a time zone from the list'),
  business_name: opt(120),
  gstin: opt(20),
  upi_vpa: z.union([z.literal(''), z.string().trim().regex(VPA_PATTERN, VPA_MESSAGE)]).optional().default(''),
  udyam_number: z.union([z.literal(''), z.string().trim().toUpperCase().regex(UDYAM_PATTERN, 'Use the Udyam number as issued, e.g. UDYAM-TN-02-0012345')]).optional().default(''),
  udyam_date: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')]).optional().default(''),
  udyam_category: z.union([z.literal(''), z.enum(UDYAM_CATEGORIES)]).optional().default(''),
  tax_label: opt(24),
  tax_pct: z.number().finite().min(0).max(100).nullable().optional().default(null),
  payment_terms: opt(500),
}).strict();
export async function POST(request: Request) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in to set up your workspace.'}, 401);
    if (!auth.scopes.includes('scopes:write')) return json({error: 'This credential cannot change settings.'}, 403);
    if (!await allowWrite('owner:' + auth.user)) return json({error: 'Write limit reached. Try again in a minute.'}, 429);
    let raw; try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const p = input.safeParse(raw);
    if (!p.success) return json({error: p.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}, 400);
    const o = p.data;
    let gstin = '', gstState = '';
    if (o.gstin) {
      const g = checkGstin(o.gstin);
      if (!g.ok) return json({error: 'Invalid GSTIN. ' + g.message, code: 'invalid_gstin', field: 'gstin'}, 400);
      if (o.country !== 'IN') return json({error: 'A GSTIN is for businesses registered in India; choose India or leave it empty.', code: 'invalid_gstin', field: 'gstin'}, 400);
      gstin = g.gstin; gstState = g.state;
    }
    if (o.udyam_number && o.country !== 'IN') return json({error: 'Udyam registration is for Indian enterprises; choose India or leave it empty.', field: 'udyam_number'}, 400);
    const now = new Date().toISOString(), orNull = (v: string) => v || null;
    const row = await db().prepare(`INSERT INTO business_profiles (owner,business_name,tax_id,gst_state,upi_vpa,udyam_number,udyam_date,udyam_category,default_currency,default_tax_label,default_tax_pct,default_payment_terms,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT (owner) DO UPDATE SET business_name=coalesce(excluded.business_name,business_profiles.business_name),tax_id=coalesce(excluded.tax_id,business_profiles.tax_id),gst_state=coalesce(excluded.gst_state,business_profiles.gst_state),upi_vpa=coalesce(excluded.upi_vpa,business_profiles.upi_vpa),udyam_number=coalesce(excluded.udyam_number,business_profiles.udyam_number),udyam_date=coalesce(excluded.udyam_date,business_profiles.udyam_date),udyam_category=coalesce(excluded.udyam_category,business_profiles.udyam_category),default_currency=excluded.default_currency,default_tax_label=excluded.default_tax_label,default_tax_pct=excluded.default_tax_pct,default_payment_terms=coalesce(excluded.default_payment_terms,business_profiles.default_payment_terms),updated=excluded.updated RETURNING *`)
      .bind(auth.user, orNull(o.business_name), orNull(gstin), orNull(gstState), orNull(o.upi_vpa), orNull(o.udyam_number), orNull(o.udyam_date), orNull(o.udyam_category), o.currency, orNull(o.tax_pct ? o.tax_label || 'GST' : ''), o.tax_pct || null, orNull(o.payment_terms), now).first<ProfileRow>();
    const retention = modeDefaults(o.mode).retention_required ? DEFAULT_RETENTION_DAYS : null;
    await db().prepare(`INSERT INTO account_settings (owner,mode,country,timezone,onboarded,context_retention_days,updated) VALUES (?,?,?,?,?,?,?) ON CONFLICT (owner) DO UPDATE SET mode=excluded.mode,country=excluded.country,timezone=excluded.timezone,onboarded=coalesce(account_settings.onboarded,excluded.onboarded),context_retention_days=coalesce(account_settings.context_retention_days,excluded.context_retention_days),updated=excluded.updated`)
      .bind(auth.user, o.mode, o.country, o.timezone, now, retention, now).run();
    await auditEvent(auth.user, 'onboarding.completed', {mode: o.mode, country: o.country, currency: o.currency, gstin: !!gstin, udyam: !!o.udyam_number, upi: !!o.upi_vpa}, auth.via);
    const profile = profileFromRow(row);
    return json({profile, mode: o.mode, country: o.country, timezone: o.timezone, upi_link: profile.upi_vpa ? upiLink({vpa: profile.upi_vpa, name: profile.business_name}) : null});
  } catch (e) { return failure(e); }
}
