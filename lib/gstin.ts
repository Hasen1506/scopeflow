import {GST_STATES, EXPORT_STATE} from './gst';

// GSTIN validation (LT-17). A GSTIN is 15 characters: a 2-digit state code, the holder's PAN
// (5 letters, 4 digits, 1 letter), an entity number (1–9 or A–Z), the letter Z by default and a
// mod-36 check character computed over the first 14 (the algorithm GSTN publishes). Pure.

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** The check character for the first 14 characters of a GSTIN, or null when they are not GSTIN characters. */
export function gstinChecksum(first14: string): string | null {
  const s = first14.toUpperCase();
  if (s.length !== 14) return null;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const code = CHARS.indexOf(s[i]);
    if (code < 0) return null;
    const product = code * (i % 2 ? 2 : 1);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

export type GstinProblem = 'empty' | 'format' | 'state_code' | 'checksum' | 'state_mismatch';
export type GstinCheck = {ok: true; gstin: string; state: string; pan: string} | {ok: false; problem: GstinProblem; message: string};

const MESSAGES: Record<GstinProblem, string> = {
  empty: 'Enter your GSTIN.',
  format: 'A GSTIN has 15 characters: 2-digit state code, your 10-character PAN, an entity number, Z and a check character (e.g. 27AAPFU0939F1ZV).',
  state_code: 'The first two digits of this GSTIN are not an Indian state code.',
  checksum: 'This GSTIN’s last character does not match the rest. Check it against your GST registration certificate.',
  state_mismatch: 'This GSTIN is registered in a different state from the one selected.',
};

/** Format, state code, check character and (when `state` is given) the registration state. */
export function checkGstin(input: string, {state}: {state?: string} = {}): GstinCheck {
  const g = input.trim().toUpperCase().replace(/\s+/g, '');
  const fail = (problem: GstinProblem): GstinCheck => ({ok: false, problem, message: MESSAGES[problem]});
  if (!g) return fail('empty');
  if (!GSTIN_PATTERN.test(g)) return fail('format');
  const code = g.slice(0, 2);
  if (!GST_STATES[code] || code === EXPORT_STATE) return fail('state_code');
  if (gstinChecksum(g.slice(0, 14)) !== g[14]) return fail('checksum');
  if (state && state !== code) return fail('state_mismatch');
  return {ok: true, gstin: g, state: code, pan: g.slice(2, 12)};
}
export const isValidGstin = (input: string, state?: string) => checkGstin(input, {state}).ok;
/** True when a tax ID looks like it is meant to be a GSTIN (starts with a state code and a letter). */
export const looksLikeGstin = (input: string) => /^\d{2}[A-Za-z]/.test(input.trim());
