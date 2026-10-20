import {allows, featureDenied} from '@/lib/plans';
import {planStateFor} from '@/lib/billing';
import {db, json, ownerAuth, body, safeOrigin, allowWrite, allowRead, failure} from '@/lib/server';
import {profileFromRow, profileSchema, hasGstinIssue, AUTO_REMIND_CHOICES, type ProfileRow} from '@/lib/profile';
import {upiLink} from '@/lib/vpa';
import {mailConfigured} from '@/lib/mail';
// Business profile: invoice seller details, new-draft defaults and automatic reminders.
export async function GET(request: Request) {
  try {
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in or provide a valid API token.'}, 401);
    if (!await allowRead('owner:' + auth.user)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const row = await db().prepare('SELECT * FROM business_profiles WHERE owner=?').bind(auth.user).first<ProfileRow>();
    const brand = row as (ProfileRow & {brand_color?: string | null; reply_to?: string | null; logo?: string | null; logo_hash?: string | null}) | null;
    const profile = profileFromRow(row);
    return json({profile, upi_link: profile.upi_vpa ? upiLink({vpa: profile.upi_vpa, name: profile.business_name}) : null, brand: {brand_color: brand?.brand_color ?? '', reply_to: brand?.reply_to ?? '', logo: brand?.logo ?? '', logo_url: brand?.logo_hash ? `/api/brand/${brand.logo_hash}` : null}, auto_remind_choices: AUTO_REMIND_CHOICES, mail_configured: mailConfigured()});
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
    const input = profileSchema.safeParse(raw);
    if (!input.success) return json({error: input.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '), ...(hasGstinIssue(input.error.issues) ? {code: 'invalid_gstin'} : {})}, 400);
    const p = input.data, orNull = (v: string) => v || null;
    if (p.auto_remind_days != null && !allows((await planStateFor(auth.user)).plan, 'reminders')) return json(featureDenied('reminders'), 402);
    const row = await db().prepare(`INSERT INTO business_profiles (owner,business_name,business_address,tax_id,payment_details,invoice_prefix,default_currency,default_tax_label,default_tax_pct,default_deposit_pct,default_payment_terms,auto_remind_days,gst_state,sac_code,lut_arn,upi_vpa,udyam_number,udyam_date,udyam_category,updated)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (owner) DO UPDATE SET business_name=excluded.business_name,business_address=excluded.business_address,tax_id=excluded.tax_id,payment_details=excluded.payment_details,invoice_prefix=excluded.invoice_prefix,default_currency=excluded.default_currency,default_tax_label=excluded.default_tax_label,default_tax_pct=excluded.default_tax_pct,default_deposit_pct=excluded.default_deposit_pct,default_payment_terms=excluded.default_payment_terms,auto_remind_days=excluded.auto_remind_days,gst_state=excluded.gst_state,sac_code=excluded.sac_code,lut_arn=excluded.lut_arn,upi_vpa=excluded.upi_vpa,udyam_number=excluded.udyam_number,udyam_date=excluded.udyam_date,udyam_category=excluded.udyam_category,updated=excluded.updated RETURNING *`)
      .bind(auth.user, orNull(p.business_name), orNull(p.business_address), orNull(p.tax_id), orNull(p.payment_details), orNull(p.invoice_prefix), orNull(p.default_currency), orNull(p.default_tax_label), p.default_tax_pct, p.default_deposit_pct, orNull(p.default_payment_terms), p.auto_remind_days, orNull(p.gst_state), orNull(p.sac_code), orNull(p.lut_arn), orNull(p.upi_vpa), orNull(p.udyam_number), orNull(p.udyam_date), orNull(p.udyam_category), new Date().toISOString()).first<ProfileRow>();
    const saved = profileFromRow(row);
    return json({profile: saved, upi_link: saved.upi_vpa ? upiLink({vpa: saved.upi_vpa, name: saved.business_name}) : null});
  } catch (e) { return failure(e); }
}
