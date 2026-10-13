import {z} from 'zod';
import type {Minor} from './contracts';

// WS-03 (H19 / SF-08): TDS the client is expected to deduct, plan §9.4. TDS is always an explicit
// input of the owner (section + rate), set per project or per invoice. Scopeflow never picks a
// section or a rate for anyone: the table below is shown for reference only, with the CA banner.
//
// Income-tax Act 2025 (in force 1 Apr 2026) s.393(1) Table Sl. 6 replaces the 1961 Act's 194C/194J/194M.
// Source: https://www.incometaxindia.gov.in/w/section-393-6 ; old sections, TRACES 2025-26 table:
// https://traces61contents.tdscpc.gov.in/en/tds-2025-2026.html. Needs CA review: the base when GST is
// shown separately (we use the taxable value, excluding GST) and rounding (we round to the nearest rupee).

export const TDS_SECTIONS = ['393(1) Sl.6(iii)-professional', '393(1) Sl.6(iii)-technical', '393(1) Sl.6(i)-contractor-ind-huf', '393(1) Sl.6(i)-contractor-other', '393(1) Sl.6(ii)', 'other'] as const;
export type TdsSection = (typeof TDS_SECTIONS)[number];
export const LEGACY_LABELS = ['194J(b)', '194J(a)', '194C', '194M'] as const;
export type LegacyLabel = (typeof LEGACY_LABELS)[number];

export type TdsSectionInfo = {section: TdsSection; legacy: LegacyLabel | null; title: string; example: string; statutory_rate: number | null; threshold: string};
/** Reference table (shown in the UI next to the inputs; never applied automatically). */
export const TDS_TABLE: TdsSectionInfo[] = [
  {section: '393(1) Sl.6(iii)-professional', legacy: '194J(b)', title: 'Fees for professional services', example: 'Design, legal, consulting, architecture, accountancy', statutory_rate: 10, threshold: '₹50,000 in the year'},
  {section: '393(1) Sl.6(iii)-technical', legacy: '194J(a)', title: 'Fees for technical services (not professional)', example: 'Technical support, call centre, software maintenance', statutory_rate: 2, threshold: '₹50,000 in the year'},
  {section: '393(1) Sl.6(i)-contractor-ind-huf', legacy: '194C', title: 'Contract work, payee an individual or HUF', example: 'Work contract with a sole proprietor', statutory_rate: 1, threshold: '₹30,000 per sum or ₹1,00,000 in the year'},
  {section: '393(1) Sl.6(i)-contractor-other', legacy: '194C', title: 'Contract work, other payees', example: 'Work contract with a firm or company', statutory_rate: 2, threshold: '₹30,000 per sum or ₹1,00,000 in the year'},
  {section: '393(1) Sl.6(ii)', legacy: '194M', title: 'Individuals/HUF not otherwise required to deduct', example: 'Large payments by an individual for contract or professional work', statutory_rate: 2, threshold: 'above ₹50 lakh in the year'},
  {section: 'other', legacy: null, title: 'Another section', example: 'As your CA advises', statutory_rate: null, threshold: ''},
];
export const TDS_BANNER = 'TDS rates depend on the nature of service; confirm with your CA.';

export const tdsInputSchema = z.object({
  section_2025: z.enum(TDS_SECTIONS),
  legacy_label: z.enum(LEGACY_LABELS).nullable().optional(),
  rate_pct: z.number().finite().gt(0).max(30),
  base: z.literal('taxable_value').default('taxable_value'),
}).strict();
export type TdsInput = z.infer<typeof tdsInputSchema>;
export type Tds = {section_2025: TdsSection; legacy_label: LegacyLabel | null; rate_pct: number; base: 'taxable_value'};
export const normalizeTds = (t: TdsInput): Tds => ({section_2025: t.section_2025, legacy_label: t.legacy_label ?? TDS_TABLE.find(x => x.section === t.section_2025)!.legacy, rate_pct: t.rate_pct, base: 'taxable_value'});

/**
 * TDS on a taxable value (GST excluded), rounded to the nearest whole rupee (half up) for INR, or
 * the nearest minor unit otherwise. `taxable` is in minor units. Pure.
 */
export function tdsAmount(taxable: Minor, rate_pct: number, currency = 'INR'): Minor {
  if (!Number.isSafeInteger(taxable) || taxable <= 0 || !(rate_pct > 0)) return 0;
  const r = BigInt(Math.round(rate_pct * 1000)); // thousandths of a percent
  const unit = currency === 'INR' ? BigInt(100) : BigInt(1);
  const d = BigInt(100000) * unit;
  const n = BigInt(taxable) * r;
  const q = n / d, rem = n % d;
  return Number((rem * BigInt(2) >= d ? q + BigInt(1) : q) * unit);
}

/** Indian financial year of a date: "2026-27" for 2026-04-01..2027-03-31. */
export function financialYear(day: string) {
  const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
/** "Q2 FY 2026-27" for a date (quarters Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar). */
export function tdsQuarter(day: string) {
  const m = Number(day.slice(5, 7));
  return `Q${m >= 4 ? Math.floor((m - 4) / 3) + 1 : 4} FY ${financialYear(day)}`;
}
/**
 * The date by which the deductor should have issued the TDS certificate for money paid on `day`
 * (quarterly statement due date + 15 days: 15 Aug, 15 Nov, 15 Feb, 15 Jun). Needs CA review.
 */
export function certificateDueFor(day: string) {
  const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7));
  if (m >= 4 && m <= 6) return `${y}-08-15`;
  if (m >= 7 && m <= 9) return `${y}-11-15`;
  if (m >= 10) return `${y + 1}-02-15`;
  return `${y}-06-15`;
}

/** The label printed for a section: the 2025 Act section, with the old 1961 label alongside for FY 2025-26 and earlier. */
export function tdsLabel(t: Pick<Tds, 'section_2025' | 'legacy_label'>, day: string) {
  const info = TDS_TABLE.find(x => x.section === t.section_2025);
  const legacy = t.legacy_label ?? info?.legacy ?? null;
  const fy = financialYear(day);
  const s = t.section_2025 === 'other' ? 'TDS' : `s.${t.section_2025.replace(/-.*/, '')}`;
  if (legacy && fy <= '2025-26') return `s.${legacy} (now ${s} of the Income-tax Act 2025)`;
  return legacy ? `${s} (formerly s.${legacy})` : s;
}

export const tdsCreditSchema = z.object({
  amount: z.number().finite().positive().max(100000000),
  certificate_no: z.string().trim().min(3).max(40),
  form: z.enum(['16A', '131']).default('16A'),
  quarter: z.string().trim().regex(/^Q[1-4] FY \d{4}-\d{2}$/, 'Use a quarter like "Q2 FY 2026-27"'),
  received: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();
export type TdsCredit = z.infer<typeof tdsCreditSchema>;
