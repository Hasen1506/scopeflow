import {z} from 'zod';
import {currencyCodes} from './currency';
import type {Scope} from './scope';
import {stateCodes} from './gst';
import {checkGstin, looksLikeGstin} from './gstin';
import {VPA_MESSAGE, VPA_PATTERN} from './vpa';

// Business profile: the seller details printed on invoices, the defaults pre-filled into new drafts,
// and the automatic-reminder interval. Separate from account settings (retention and wording).

export const UDYAM_PATTERN = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;
export const UDYAM_CATEGORIES = ['micro', 'small', 'medium'] as const;
const text = (max: number) => z.union([z.literal(''), z.string().trim().max(max)]);
const pct = z.number().finite().min(0).max(100).nullable();
export const AUTO_REMIND_CHOICES = [3, 5, 7, 14] as const;
export const profileSchema = z.object({
  business_name: text(120),
  business_address: text(500),
  tax_id: text(40),
  payment_details: text(500),
  // WS-03 request: the same rule and wording as invoicePrefixProblem() (prefix + 4-digit number ≤ 16).
  invoice_prefix: z.union([z.literal(''), z.string().trim().regex(/^[A-Za-z0-9/_-]+$/, 'Use letters, digits, - / or _ in the invoice prefix').refine(p => (p + '0001').length <= 16, 'Invoice numbers must be 16 characters or fewer')]),
  default_currency: z.union([z.literal(''), z.enum(currencyCodes)]),
  default_tax_label: text(24),
  default_tax_pct: pct,
  default_deposit_pct: pct,
  default_payment_terms: text(500),
  auto_remind_days: z.union([z.literal(3), z.literal(5), z.literal(7), z.literal(14)]).nullable(),
  // GST tax invoices (India): the seller's registration state, SAC and export LUT. Optional.
  gst_state: z.union([z.literal(''), z.enum(stateCodes)]).default(''),
  sac_code: z.union([z.literal(''), z.string().trim().regex(/^\d{4,8}$/, 'Use the 4 to 8 digit SAC or HSN code')]).default(''),
  lut_arn: z.union([z.literal(''), z.string().trim().max(40).regex(/^[A-Za-z0-9/-]+$/, 'Use the ARN exactly as issued')]).default(''),
  // WS-08 (LT-17, LT-04): UPI VPA (validated) and Udyam (MSME) registration, read by WS-03/WS-04.
  upi_vpa: z.union([z.literal(''), z.string().trim().max(320).regex(VPA_PATTERN, VPA_MESSAGE)]).default(''),
  udyam_number: z.union([z.literal(''), z.string().trim().toUpperCase().regex(UDYAM_PATTERN, 'Use the Udyam number as issued, e.g. UDYAM-TN-02-0012345')]).default(''),
  udyam_date: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the registration date as YYYY-MM-DD').refine(d => !Number.isNaN(Date.parse(d + 'T00:00:00Z')), 'Use a real date')]).default(''),
  udyam_category: z.union([z.literal(''), z.enum(UDYAM_CATEGORIES)]).default(''),
}).strict().superRefine((p, ctx) => {
  // LT-17: a GSTIN is checked for format, check character and state. It must be a valid GSTIN
  // whenever the account is GST-registered (gst_state set) or the tax ID is GSTIN-shaped.
  if (p.tax_id && (p.gst_state || looksLikeGstin(p.tax_id))) {
    const g = checkGstin(p.tax_id, {state: p.gst_state && p.gst_state !== '96' ? p.gst_state : undefined});
    if (!g.ok) ctx.addIssue({code: 'custom', path: ['tax_id'], message: 'Invalid GSTIN. ' + g.message, params: {code: 'invalid_gstin'}});
  }
});
export type Profile = z.infer<typeof profileSchema>;
export const defaultProfile: Profile = {business_name: '', business_address: '', tax_id: '', payment_details: '', invoice_prefix: '', default_currency: '', default_tax_label: '', default_tax_pct: null, default_deposit_pct: null, default_payment_terms: '', auto_remind_days: null, gst_state: '', sac_code: '', lut_arn: '', upi_vpa: '', udyam_number: '', udyam_date: '', udyam_category: ''};
export type ProfileRow = {[K in keyof Profile]: Profile[K] extends string ? string | null : Profile[K]} & {owner: string; next_invoice: number; updated: string};
/** True when an issue list from profileSchema contains a GSTIN problem (the API answers code invalid_gstin). */
export const hasGstinIssue = (issues: {path: (string | number)[]}[]) => issues.some(i => i.path[0] === 'tax_id');
/** MSMED Act s.15–16 apply to micro and small enterprises registered on Udyam (medium units are not "suppliers" for s.15). */
export const msmedEligible = (p: Pick<Profile, 'udyam_number' | 'udyam_category'>) => !!p.udyam_number && (p.udyam_category === 'micro' || p.udyam_category === 'small');

export function profileFromRow(row: ProfileRow | null): Profile {
  if (!row) return defaultProfile;
  const s = (v: string | null) => v ?? '';
  return {
    business_name: s(row.business_name), business_address: s(row.business_address), tax_id: s(row.tax_id), payment_details: s(row.payment_details),
    invoice_prefix: s(row.invoice_prefix), default_currency: s(row.default_currency) as Profile['default_currency'], default_tax_label: s(row.default_tax_label),
    default_tax_pct: row.default_tax_pct ?? null, default_deposit_pct: row.default_deposit_pct ?? null, default_payment_terms: s(row.default_payment_terms),
    auto_remind_days: (AUTO_REMIND_CHOICES as readonly number[]).includes(row.auto_remind_days ?? -1) ? row.auto_remind_days as Profile['auto_remind_days'] : null,
    gst_state: s(row.gst_state), sac_code: s(row.sac_code), lut_arn: s(row.lut_arn),
    upi_vpa: s(row.upi_vpa ?? null), udyam_number: s(row.udyam_number ?? null), udyam_date: s(row.udyam_date ?? null),
    udyam_category: (UDYAM_CATEGORIES as readonly string[]).includes(row.udyam_category ?? '') ? row.udyam_category as Profile['udyam_category'] : '',
  };
}

/** The commercial fields a new draft starts with. Only set fields are returned, so an empty profile changes nothing. */
export function draftDefaults(p: Profile): Partial<Pick<Scope, 'currency' | 'tax_label' | 'tax_pct' | 'deposit_pct' | 'payment_terms'>> {
  const out: ReturnType<typeof draftDefaults> = {};
  if (p.default_currency) out.currency = p.default_currency as Scope['currency'];
  if (p.default_tax_pct) { out.tax_pct = p.default_tax_pct; out.tax_label = p.default_tax_label || 'Tax'; }
  if (p.default_deposit_pct) out.deposit_pct = p.default_deposit_pct;
  if (p.default_payment_terms) out.payment_terms = p.default_payment_terms;
  return out;
}

export type OwnerDefaults = ReturnType<typeof draftDefaults> & {exclusions?: string; notes?: string};
const joinClauses = (own: string, extra: string, max: number) => {
  const a = own.trim(), b = extra.trim();
  if (!a) return b.slice(0, max);
  if (!b || b.includes(a)) return (b || a).slice(0, max);
  return `${a}\n${b}`.slice(0, max);
};
/**
 * A starter template or an AI draft with the owner's own defaults applied: their standard exclusions
 * and working terms come first (the draft's own text is kept after them), and their currency, tax,
 * deposit and payment terms replace the draft's. Pure; an empty `d` returns the content unchanged.
 */
export function applyOwnerDefaults<T extends Pick<Scope, 'exclusions' | 'notes'>>(content: T, d: OwnerDefaults): T {
  const {exclusions = '', notes = '', ...commercial} = d;
  return {...content, ...commercial, exclusions: joinClauses(exclusions, content.exclusions, 3000), notes: joinClauses(notes, content.notes, 3000)};
}

// ---- Onboarding (LT-04/SF-11, WS-08): defaults by country ------------------------------------
export type CountryDefaults = {code: string; name: string; currency: string; timezone: string; locale: string};
export const COUNTRIES: readonly CountryDefaults[] = [
  {code: 'IN', name: 'India', currency: 'INR', timezone: 'Asia/Kolkata', locale: 'en-IN'},
  {code: 'US', name: 'United States', currency: 'USD', timezone: 'America/New_York', locale: 'en-US'},
  {code: 'GB', name: 'United Kingdom', currency: 'GBP', timezone: 'Europe/London', locale: 'en-GB'},
  {code: 'AE', name: 'United Arab Emirates', currency: 'AED', timezone: 'Asia/Dubai', locale: 'en-AE'},
  {code: 'SG', name: 'Singapore', currency: 'SGD', timezone: 'Asia/Singapore', locale: 'en-SG'},
  {code: 'AU', name: 'Australia', currency: 'AUD', timezone: 'Australia/Sydney', locale: 'en-AU'},
  {code: 'CA', name: 'Canada', currency: 'CAD', timezone: 'America/Toronto', locale: 'en-CA'},
  {code: 'NZ', name: 'New Zealand', currency: 'NZD', timezone: 'Pacific/Auckland', locale: 'en-NZ'},
  {code: 'DE', name: 'Germany', currency: 'EUR', timezone: 'Europe/Berlin', locale: 'de-DE'},
  {code: 'FR', name: 'France', currency: 'EUR', timezone: 'Europe/Paris', locale: 'fr-FR'},
  {code: 'NL', name: 'Netherlands', currency: 'EUR', timezone: 'Europe/Amsterdam', locale: 'nl-NL'},
  {code: 'IE', name: 'Ireland', currency: 'EUR', timezone: 'Europe/Dublin', locale: 'en-IE'},
  {code: 'LK', name: 'Sri Lanka', currency: 'LKR', timezone: 'Asia/Colombo', locale: 'en-LK'},
  {code: 'BD', name: 'Bangladesh', currency: 'BDT', timezone: 'Asia/Dhaka', locale: 'en-BD'},
  {code: 'NP', name: 'Nepal', currency: 'NPR', timezone: 'Asia/Kathmandu', locale: 'en-NP'},
  {code: 'OTHER', name: 'Somewhere else', currency: 'USD', timezone: 'UTC', locale: 'en'},
];
export const countryDefaults = (code: string) => COUNTRIES.find(c => c.code === code) ?? COUNTRIES.at(-1)!;
/** The country a browser locale ("en-IN", "hi-IN") or time zone points to; OTHER when unknown. */
export function countryFromLocale(locale: string | undefined, timeZone?: string) {
  // Visual #15: India's zone wins over the locale region, since many Indian browsers report en-US; an
  // en-US browser on Asia/Kolkata otherwise defaulted to USD. Every default stays editable.
  if (timeZone === 'Asia/Kolkata' || timeZone === 'Asia/Calcutta') return 'IN';
  const region = locale?.split(/[-_]/)[1]?.toUpperCase();
  if (region && COUNTRIES.some(c => c.code === region)) return region;
  return COUNTRIES.find(c => c.timezone === timeZone)?.code ?? 'OTHER';
}
/** MSMED Act s.15: a buyer pays a micro/small supplier within the agreed period, at most 45 days from acceptance. */
export const MSMED_TERMS = 'Payment within 45 days of acceptance (MSMED Act 2006, s.15). Delayed payments attract compound interest at three times the RBI bank rate (s.16).';
export const STANDARD_TERMS = 'Balance within 15 days of delivery.';
/**
 * The defaults onboarding proposes (each is shown and editable before it is saved): currency
 * and time zone from the country; GST at 18% suggested only when a GSTIN is given; payment terms
 * that cite MSMED s.15 when the Udyam category is micro or small.
 */
export function onboardingSuggestions(p: {country: string; gstin?: string; udyam_category?: string}) {
  const c = countryDefaults(p.country);
  const gst = c.code === 'IN' && !!p.gstin?.trim();
  return {currency: c.currency, timezone: c.timezone, tax_label: gst ? 'GST' : '', tax_pct: gst ? 18 : null, payment_terms: c.code === 'IN' && (p.udyam_category === 'micro' || p.udyam_category === 'small') ? MSMED_TERMS : STANDARD_TERMS};
}
