// Indian GST helpers for tax invoices (CGST Rules, rule 46): state codes, GSTIN checks, place of
// supply and the CGST + SGST / IGST split. Pure; shared by the invoice route, the PDF and the tests.
import type {GstBreakdown, GstHead, Minor} from './contracts';
import {mulDiv, mulPct, parseDecimal, sumMinor, toMinor} from './minor';

export const GST_STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory', '96': 'Outside India (export)',
};
export const EXPORT_STATE = '96';
export const stateCodes = Object.keys(GST_STATES) as [string, ...string[]];
export const stateName = (code: string) => GST_STATES[code] ?? '';

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** GSTIN format and check digit (the mod-36 algorithm GSTN publishes). */
export function validGstin(gstin: string) {
  const g = gstin.trim().toUpperCase();
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g) || !GST_STATES[g.slice(0, 2)]) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = GSTIN_CHARS.indexOf(g[i]) * (i % 2 ? 2 : 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36] === g[14];
}
/** The state a GSTIN-shaped number belongs to (its first two digits), or ''. The check digit is not required. */
export function gstinState(gstin: string) {
  const g = gstin.trim().toUpperCase();
  return /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g) && GST_STATES[g.slice(0, 2)] ? g.slice(0, 2) : '';
}

/** How a supply is taxed: CGST + SGST/UTGST, IGST, a zero-rated export, or one undivided "GST" head (no place of supply known). */
export type SupplyType = 'intra' | 'inter' | 'export' | 'none';
export type PlaceBasis = 'gstin' | 'address' | 'export' | 'supplier';
export type PlaceOfSupply = {
  code: string;
  basis: PlaceBasis;
  /** H13: decided by the recipient's location (and, for exports, the forex confirmation), never by the invoice currency. */
  supply: Exclude<SupplyType, 'none'>;
  zero_rated: boolean;
  /** Plain-language notes for the owner (e.g. why a foreign client is not zero-rated, the LUT/bond note). */
  warnings: string[];
};
export const EXPORT_NOTE = 'Zero-rated export of services: issue it under a Letter of Undertaking (LUT) or bond without IGST, or pay IGST and claim a refund (IGST Act s.16). Needs CA review.';
export const NOT_EXPORT_WARNING = 'Not zero-rated: a client outside India is an export of services only when payment is received in convertible foreign exchange (or in Indian rupees where the RBI permits). Confirm that to zero-rate it; until then IGST applies.';
export const CURRENCY_NOT_LOCATION_WARNING = "The invoice currency doesn't decide the place of supply. Add the client's country and state to get the right tax heads.";

/**
 * Place of supply for services (IGST Act s.12(2); export conditions in s.2(6)). The recipient's
 * location decides it, never the currency (H13):
 * - a registered recipient: the state in its GSTIN;
 * - a recipient outside India (`client_country` other than IN, or the "Outside India" state 96):
 *   an export only when the owner confirms the consideration is received in convertible foreign
 *   exchange or in INR as permitted by the RBI (`forex_confirmed`); otherwise an inter-state supply
 *   with IGST, and a warning;
 * - otherwise the recipient's state on record;
 * - with no address on record, the supplier's own state (s.12(2)(b)).
 * `currency` is accepted for older callers and ignored.
 */
export function placeOfSupply(p: {seller_state: string; client_gstin?: string; client_state?: string; client_country?: string; forex_confirmed?: boolean; currency?: string}): PlaceOfSupply {
  const seller = p.seller_state;
  const domestic = (code: string, basis: PlaceBasis, warnings: string[] = []): PlaceOfSupply =>
    ({code, basis, supply: seller && seller === code ? 'intra' : 'inter', zero_rated: false, warnings});
  const fromGstin = gstinState(p.client_gstin ?? '');
  if (fromGstin) return domestic(fromGstin, 'gstin');
  const country = (p.client_country ?? '').trim().toUpperCase();
  const abroad = (country && country !== 'IN') || p.client_state === EXPORT_STATE;
  if (abroad) {
    if (p.forex_confirmed) return {code: EXPORT_STATE, basis: 'export', supply: 'export', zero_rated: true, warnings: [EXPORT_NOTE]};
    return {code: EXPORT_STATE, basis: 'address', supply: 'inter', zero_rated: false, warnings: [NOT_EXPORT_WARNING]};
  }
  if (p.client_state && GST_STATES[p.client_state]) return domestic(p.client_state, 'address');
  return domestic(seller, 'supplier', !country && p.currency && p.currency !== 'INR' ? [CURRENCY_NOT_LOCATION_WARNING] : []);
}

/** A tax is treated as GST when its label says so (GST, IGST, "GST @18%" …). */
export const isGstLabel = (label: string) => /\bgst\b|\bigst\b/i.test(label);

// ---- The per-head GST engine (M1, M2), integer minor units -------------------------------------

/**
 * GST on a taxable value (exclusive entry, the default for invoices). Each head is computed from the
 * taxable value: CGST = SGST = round(taxable × rate/2 %), IGST = round(taxable × rate %), so CGST
 * and SGST are always equal. `supply` 'none' is one undivided "GST" head (no place of supply known);
 * 'export' charges IGST at `rate` (pass rate 0 for an export under LUT/bond). Half-up rounding.
 */
export function gstFromExclusive(taxable: Minor, rate: number, supply: SupplyType): GstBreakdown {
  const heads = headsFor(taxable, rate, supply);
  return {taxable, heads, round_off: 0, total: sumMinor([taxable, ...heads.map(h => h.amount)])};
}

/**
 * GST inside a tax-inclusive amount ("amount includes GST"). taxable = round(amount × 100 / (100 + rate)),
 * the heads are computed from the taxable value as in gstFromExclusive, and whatever is left between
 * that and the amount entered is an explicit round-off line, so `total` is exactly the amount:
 * ₹100 at 18% intra-state → 84.75 + 7.63 + 7.63 − 0.01.
 */
export function gstFromInclusive(amount: Minor, rate: number, supply: SupplyType): GstBreakdown {
  const {digits, scale} = parseDecimal(rate);
  const unit = BigInt(10) ** BigInt(scale);
  // amount × 100 / (100 + rate), with rate = digits / 10^scale.
  const taxable = mulDiv(amount, BigInt(100) * unit, BigInt(100) * unit + digits);
  const heads = headsFor(taxable, rate, supply);
  const charged = sumMinor([taxable, ...heads.map(h => h.amount)]);
  return {taxable, heads, round_off: amount - charged, total: amount};
}

/** Tax heads only (the sum of their amounts). */
export const taxOf = (b: GstBreakdown) => sumMinor(b.heads.map(h => h.amount));

function headsFor(taxable: Minor, rate: number, supply: SupplyType): GstHead[] {
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new RangeError('GST rate must be between 0 and 100');
  if (supply === 'intra') {
    const {digits, scale} = parseDecimal(rate);
    const half = mulDiv(taxable, digits, BigInt(200) * BigInt(10) ** BigInt(scale));
    const r = halfRate(rate);
    return [{name: 'CGST', rate: r, amount: half}, {name: 'SGST', rate: r, amount: half}];
  }
  if (supply === 'export' && rate === 0) return [];
  return [{name: supply === 'none' ? 'GST' : 'IGST', rate, amount: mulPct(taxable, rate)}];
}
/** rate / 2 without float noise (9 for 18, 2.5 for 5, 0.125 for 0.25). */
function halfRate(rate: number) {
  const {digits, scale} = parseDecimal(rate);
  const even = digits % BigInt(2) === BigInt(0);
  return Number(fromDecimal(even ? digits / BigInt(2) : digits * BigInt(5), even ? scale : scale + 1));
}
function fromDecimal(digits: bigint, scale: number) {
  const neg = digits < BigInt(0), abs = (neg ? -digits : digits).toString().padStart(scale + 1, '0');
  const s = scale ? abs.slice(0, -scale) + '.' + abs.slice(-scale) : abs;
  return (neg ? '-' : '') + s;
}

/** The supply type for a project when no place of supply is known: the label decides between GST and other taxes. */
export const supplyForPlace = (pos: PlaceOfSupply | null): SupplyType => pos ? pos.supply : 'none';

// ---- Legacy split (read path for invoices issued before the per-head engine) --------------------

export type GstSplit = {kind: 'intra' | 'inter' | 'export'; cgst: number; sgst: number; igst: number};
/**
 * How the tax on an invoice was charged before the per-head engine: same state as the seller, half
 * CGST and half SGST/UTGST (the odd paisa went to SGST); another state, IGST; outside India, an export.
 * Kept unchanged so already-issued invoices read back exactly as they were issued; new invoices use
 * gstFromExclusive/gstFromInclusive (WS-03 wires lib/invoice.ts to them).
 * @deprecated for new invoices.
 */
export function gstSplit(tax: number, sellerState: string, placeOfSupply: string): GstSplit {
  const paise = toMinor(tax, 'INR'), major = (m: number) => m / 100;
  if (placeOfSupply === EXPORT_STATE) return {kind: 'export', cgst: 0, sgst: 0, igst: major(paise)};
  if (sellerState && sellerState === placeOfSupply) { const c = mulDiv(paise, BigInt(1), BigInt(2)); return {kind: 'intra', cgst: major(c), sgst: major(paise - c), igst: 0}; }
  return {kind: 'inter', cgst: 0, sgst: 0, igst: major(paise)};
}

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const below100 = (n: number) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : ''));
const below1000 = (n: number) => [n >= 100 ? ONES[Math.floor(n / 100)] + ' hundred' : '', below100(n % 100)].filter(Boolean).join(' and ');
/** Whole rupees in words with Indian grouping (lakh, crore): 125000.5 → "One lakh twenty-five thousand rupees and fifty paise only". */
export function rupeesInWords(amount: number) {
  const total = toMinor(amount, 'INR'); // exact paise (M3), not Math.round(amount * 100)
  const paise = total % 100;
  let n = Math.floor(total / 100);
  if (n === 0 && paise === 0) return 'Zero rupees only';
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push((crore >= 1000 ? rupeesInWords(crore).replace(/ rupees only$/i, '').toLowerCase() : below1000(crore)) + ' crore');
  if (lakh) parts.push(below100(lakh) + ' lakh');
  if (thousand) parts.push(below100(thousand) + ' thousand');
  if (n) parts.push(below1000(n));
  const rupees = parts.length ? parts.join(' ') + ' rupee' + (parts.join() === 'one' ? '' : 's') : '';
  const text = [rupees, paise ? below100(paise) + ' paise' : ''].filter(Boolean).join(' and ') + ' only';
  return text.charAt(0).toUpperCase() + text.slice(1);
}
