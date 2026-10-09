import {z} from 'zod';
import {currencyCodes} from './currency';
import type {Scope} from './scope';
import {stateCodes} from './gst';

// Business profile: the seller details printed on invoices, the defaults pre-filled into new drafts,
// and the automatic-reminder interval. Separate from account settings (retention and wording).

const text = (max: number) => z.union([z.literal(''), z.string().trim().max(max)]);
const pct = z.number().finite().min(0).max(100).nullable();
export const AUTO_REMIND_CHOICES = [3, 5, 7, 14] as const;
export const profileSchema = z.object({
  business_name: text(120),
  business_address: text(500),
  tax_id: text(40),
  payment_details: text(500),
  invoice_prefix: z.union([z.literal(''), z.string().trim().max(12).regex(/^[A-Za-z0-9/_-]+$/, 'Use letters, digits, - / or _ in the invoice prefix')]),
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
}).strict();
export type Profile = z.infer<typeof profileSchema>;
export const defaultProfile: Profile = {business_name: '', business_address: '', tax_id: '', payment_details: '', invoice_prefix: '', default_currency: '', default_tax_label: '', default_tax_pct: null, default_deposit_pct: null, default_payment_terms: '', auto_remind_days: null, gst_state: '', sac_code: '', lut_arn: ''};
export type ProfileRow = {[K in keyof Profile]: Profile[K] extends string ? string | null : Profile[K]} & {owner: string; next_invoice: number; updated: string};

export function profileFromRow(row: ProfileRow | null): Profile {
  if (!row) return defaultProfile;
  const s = (v: string | null) => v ?? '';
  return {
    business_name: s(row.business_name), business_address: s(row.business_address), tax_id: s(row.tax_id), payment_details: s(row.payment_details),
    invoice_prefix: s(row.invoice_prefix), default_currency: s(row.default_currency) as Profile['default_currency'], default_tax_label: s(row.default_tax_label),
    default_tax_pct: row.default_tax_pct ?? null, default_deposit_pct: row.default_deposit_pct ?? null, default_payment_terms: s(row.default_payment_terms),
    auto_remind_days: (AUTO_REMIND_CHOICES as readonly number[]).includes(row.auto_remind_days ?? -1) ? row.auto_remind_days as Profile['auto_remind_days'] : null,
    gst_state: s(row.gst_state), sac_code: s(row.sac_code), lut_arn: s(row.lut_arn),
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
