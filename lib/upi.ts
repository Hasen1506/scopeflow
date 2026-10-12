// UPI direct to the freelancer (LT-02 / SF-02, tier 0 of IMPLEMENTATION_PLAN §11.3). Pure.
//
// The client's UPI app pays the freelancer's own UPI ID (VPA) straight from their bank: ScopeFlow
// never touches the money and needs no payment licence or KYC for it. The page shows a QR code and
// intent links for the exact open amount; the client then says "I've paid" with the UTR, the
// freelancer confirms it, and only then a payment_received entry goes on the record.
// UPI is INR only: other currencies never get a UPI option.

/** A UPI ID: handle@psp, as NPCI allows (letters, digits, dot, hyphen, underscore). */
const VPA = /^[A-Za-z0-9][A-Za-z0-9._-]{1,255}@[A-Za-z][A-Za-z0-9]{1,63}$/;
export const isValidVpa = (vpa: string) => VPA.test(vpa.trim());

/** NPCI caps the transaction note; long project titles are cut so the whole note stays within it. */
export const UPI_NOTE_MAX = 80;
/** Transaction reference (tr): letters and digits, at most 35 characters. */
export const UPI_REF_MAX = 35;

/** Percent-encodes a value for the UPI URI; '@' stays readable (every UPI app accepts it raw). */
const enc = (v: string) => encodeURIComponent(v).replace(/%40/g, '@');

/** Minor units (paise) as a rupee string with exactly two decimals, without floating point. */
export function rupees(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new RangeError('amount must be a non-negative integer number of paise');
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
}

/** The note: "<project> <purpose>", whitespace collapsed, cut to UPI_NOTE_MAX characters (by code point). */
export function upiNote(project: string, purpose: string): string {
  const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  const tail = clean(purpose), room = UPI_NOTE_MAX - tail.length - 1;
  const head = [...clean(project)];
  const title = room > 0 ? (head.length > room ? head.slice(0, Math.max(0, room - 1)).join('').trimEnd() + '…' : head.join('')) : '';
  return [...(title ? title + ' ' + tail : tail)].slice(0, UPI_NOTE_MAX).join('');
}

/** A short reference for the payment: SF + project + target, letters and digits only. */
export function upiRef(projectId: string, purpose: 'deposit' | 'invoice' | 'balance', seq?: number | null): string {
  const p = projectId.replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
  return ('SF' + p + (purpose === 'deposit' ? 'D' : purpose === 'invoice' ? 'I' + (seq ?? '') : 'B')).slice(0, UPI_REF_MAX);
}

export type UpiRequest = {vpa: string; payee: string; amount_minor: number; currency: string; note: string; ref: string};

/** upi://pay?pa=&pn=&am=&cu=INR&tn=&tr= for one exact amount, or null for a non-INR amount or a bad VPA. */
export function upiUri(r: UpiRequest): string | null {
  if (r.currency !== 'INR' || !isValidVpa(r.vpa) || !(r.amount_minor > 0)) return null;
  const tn = [...r.note].slice(0, UPI_NOTE_MAX).join('');
  const tr = r.ref.replace(/[^A-Za-z0-9]/g, '').slice(0, UPI_REF_MAX);
  const pn = r.payee.replace(/\s+/g, ' ').trim().slice(0, 50) || r.vpa.trim();
  return `upi://pay?pa=${enc(r.vpa.trim())}&pn=${enc(pn)}&am=${rupees(r.amount_minor)}&cu=INR&tn=${enc(tn)}${tr ? `&tr=${tr}` : ''}`;
}

/** Parses a UPI URI back into its fields (tests and the QR check). */
export function parseUpiUri(uri: string): Record<string, string> | null {
  const m = /^upi:\/\/pay\?(.*)$/.exec(uri);
  if (!m) return null;
  return Object.fromEntries(m[1].split('&').map(p => { const i = p.indexOf('='); return [p.slice(0, i), decodeURIComponent(p.slice(i + 1))]; }));
}

/** App-specific intent links for the same payment (Android/iOS open the app directly). */
export function upiAppLinks(uri: string) {
  const query = uri.slice('upi://pay?'.length);
  return [
    {app: 'gpay', label: 'Google Pay', href: 'tez://upi/pay?' + query},
    {app: 'phonepe', label: 'PhonePe', href: 'phonepe://pay?' + query},
    {app: 'paytm', label: 'Paytm', href: 'paytmmp://pay?' + query},
    {app: 'bhim', label: 'Any UPI app', href: uri},
  ];
}

/**
 * The UTR / reference a client gives for a transfer: a 12-digit UPI RRN, or a bank reference
 * (NEFT/RTGS/IMPS UTR) of 6-22 letters and digits. Returns the normalised value or null.
 */
export function parseUtr(value: string, method: 'upi' | 'bank_transfer'): string | null {
  const v = value.replace(/[\s-]/g, '').toUpperCase();
  if (method === 'upi') return /^\d{12}$/.test(v) ? v : null;
  return /^[A-Z0-9]{6,22}$/.test(v) ? v : null;
}
/** Shows only the last four characters of a reference. */
export const maskRef = (ref: string) => ref.length <= 4 ? ref : '•'.repeat(Math.min(8, ref.length - 4)) + ref.slice(-4);
