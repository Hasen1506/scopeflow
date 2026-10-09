// Indian GST helpers for tax invoices (CGST Rules, rule 46): state codes, GSTIN checks, place of
// supply and the CGST + SGST / IGST split. Pure; shared by the invoice route, the PDF and the tests.

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

/**
 * Place of supply for services (IGST Act, s.12(2)): a registered recipient's state (from its
 * GSTIN); otherwise the recipient's state on record; a client billed in a foreign currency with no
 * Indian state is an export; with no address on record, the supplier's own state.
 */
export function placeOfSupply(p: {client_gstin?: string; client_state?: string; currency: string; seller_state: string}): {code: string; basis: 'gstin' | 'address' | 'export' | 'supplier'} {
  const fromGstin = gstinState(p.client_gstin ?? '');
  if (fromGstin) return {code: fromGstin, basis: 'gstin'};
  if (p.client_state && GST_STATES[p.client_state]) return {code: p.client_state, basis: p.client_state === EXPORT_STATE ? 'export' : 'address'};
  if (p.currency !== 'INR') return {code: EXPORT_STATE, basis: 'export'};
  return {code: p.seller_state, basis: 'supplier'};
}

/** A tax is treated as GST when its label says so (GST, IGST, "GST @18%" …). */
export const isGstLabel = (label: string) => /\bgst\b|\bigst\b/i.test(label);

const round2 = (n: number) => Math.round(n * 100) / 100;
export type GstSplit = {kind: 'intra' | 'inter' | 'export'; cgst: number; sgst: number; igst: number};
/**
 * How the tax on an invoice is charged. Same state as the seller: half CGST, half SGST/UTGST (the
 * odd paisa goes to SGST so the two always add up). Another state or Other Territory: IGST. Outside
 * India: an export (zero-rated; under LUT the tax is normally 0, otherwise IGST is charged).
 */
export function gstSplit(tax: number, sellerState: string, placeOfSupply: string): GstSplit {
  if (placeOfSupply === EXPORT_STATE) return {kind: 'export', cgst: 0, sgst: 0, igst: round2(tax)};
  if (sellerState && sellerState === placeOfSupply) { const cgst = round2(tax / 2); return {kind: 'intra', cgst, sgst: round2(tax - cgst), igst: 0}; }
  return {kind: 'inter', cgst: 0, sgst: 0, igst: round2(tax)};
}

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const below100 = (n: number) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : ''));
const below1000 = (n: number) => [n >= 100 ? ONES[Math.floor(n / 100)] + ' hundred' : '', below100(n % 100)].filter(Boolean).join(' and ');
/** Whole rupees in words with Indian grouping (lakh, crore): 125000.5 → "One lakh twenty-five thousand rupees and fifty paise only". */
export function rupeesInWords(amount: number) {
  const paise = Math.round(amount * 100) % 100;
  let n = Math.floor(Math.round(amount * 100) / 100);
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
