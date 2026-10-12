// UPI virtual payment address (VPA) validation and the UPI deep link a QR code encodes (LT-17).
// Pure. The pattern is the one in the WS-08 brief: a handle of 2–256 letters, digits, dot, hyphen or
// underscore, then @ and a 2–64 letter PSP handle (e.g. ada.studio@okicici).

export const VPA_PATTERN = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;
export function normalizeVpa(input: string) { return input.trim(); }
export function isValidVpa(input: string) { return VPA_PATTERN.test(normalizeVpa(input)); }
export const VPA_MESSAGE = 'Enter a UPI ID like yourname@okbank: letters, digits, dots, hyphens or underscores, then @ and your bank’s handle.';

/**
 * The upi://pay link for a payee (NPCI UPI linking spec): pa (payee VPA), pn (payee name), and
 * optionally am (amount, 2 decimals, INR), cu=INR and tn (note). Returns null for an invalid VPA.
 */
export function upiLink(p: {vpa: string; name?: string; amount?: number | null; note?: string}): string | null {
  const vpa = normalizeVpa(p.vpa);
  if (!isValidVpa(vpa)) return null;
  const q = new URLSearchParams({pa: vpa});
  if (p.name?.trim()) q.set('pn', p.name.trim().slice(0, 99));
  if (p.amount != null && Number.isFinite(p.amount) && p.amount > 0) { q.set('am', p.amount.toFixed(2)); q.set('cu', 'INR'); }
  if (p.note?.trim()) q.set('tn', p.note.trim().slice(0, 80));
  return 'upi://pay?' + q.toString().replace(/\+/g, '%20');
}
