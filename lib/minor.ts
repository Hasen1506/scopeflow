import type {Minor} from './contracts';
import {currencies, otherExponents} from '../config/currencies';

// Integer minor units (owner: WS-01, M3/M4). Every money computation happens on safe integers in
// the currency's ISO 4217 minor unit (paise, cents, yen); decimal numbers exist only at the
// boundaries (signed scope content, request bodies, display). Decimal input is parsed as text, so
// 1.005 is one rupee and half a paisa (rounds to 101 paise), never the binary 1.00499999….
// Rounding is half-up on the integer value, symmetric for negatives (half away from zero), which
// is what Indian tax invoices and most ledgers use. No floating point is used in any rounding step.

export type {Minor};
/** How a fraction of a minor unit is rounded. `half_up` = half away from zero (the default). */
export type RoundMode = 'half_up' | 'floor' | 'ceil';

// bigint constants (tsconfig targets ES2017, which has no bigint literals).
const B0 = BigInt(0), B1 = BigInt(1), B2 = BigInt(2), B10 = BigInt(10), B100 = BigInt(100);
const pow10 = (n: number) => B10 ** BigInt(n);

const exponents = new Map<string, number>([...Object.entries(otherExponents), ...currencies.map(c => [c.code, c.exponent] as [string, number])]);

/** Decimal places of `currency` (JPY 0, INR/USD 2, KWD 3): the configured ISO table, then Intl, then 2. */
export function exponentOf(currency: string): number {
  const known = exponents.get(currency);
  if (known !== undefined) return known;
  try { return new Intl.NumberFormat('en', {style: 'currency', currency}).resolvedOptions().maximumFractionDigits ?? 2; } catch { return 2; }
}

/** An exact decimal: `digits` × 10^-`scale` (digits is a signed integer). */
export type Decimal = {digits: bigint; scale: number};

/** Parse a decimal number or string exactly ("25000.555", "-1.5", "1e-7", 0.1 → its shortest form "0.1"). */
export function parseDecimal(value: number | string): Decimal {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new RangeError('Amount must be a finite number');
  const text = String(value).trim();
  const m = /^([+-])?(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!m || (!m[2] && !m[3])) throw new RangeError(`Not a decimal number: ${JSON.stringify(text)}`);
  const sign = m[1] === '-' ? -B1 : B1;
  const int = m[2] || '0', frac = m[3] ?? '', exp = m[4] ? Number(m[4]) : 0;
  let digits = BigInt(int + frac) * sign;
  let scale = frac.length - exp;
  if (scale < 0) { digits *= pow10(-scale); scale = 0; }
  return {digits, scale};
}

/** `numerator / denominator` rounded to an integer (denominator > 0). */
export function divRound(numerator: bigint, denominator: bigint, mode: RoundMode = 'half_up'): bigint {
  if (denominator <= B0) throw new RangeError('Denominator must be positive');
  const q = numerator / denominator, r = numerator % denominator; // truncates toward zero
  if (r === B0) return q;
  if (mode === 'floor') return numerator < B0 ? q - B1 : q;
  if (mode === 'ceil') return numerator > B0 ? q + B1 : q;
  const twice = (r < B0 ? -r : r) * B2;
  if (twice >= denominator) return numerator < B0 ? q - B1 : q + B1;
  return q;
}

/** A bigint as a Minor, refusing anything outside Number's safe integer range. */
export function safe(n: bigint): Minor {
  const v = Number(n);
  if (!Number.isSafeInteger(v)) throw new RangeError('Amount is too large to compute exactly');
  return v === 0 ? 0 : v; // never -0
}

/** A decimal amount (number or decimal string) in minor units of `currency`, rounded half-up. */
export function toMinor(amount: number | string, currency: string, mode: RoundMode = 'half_up'): Minor {
  const {digits, scale} = parseDecimal(amount);
  const e = exponentOf(currency);
  if (scale <= e) return safe(digits * pow10(e - scale));
  return safe(divRound(digits, pow10(scale - e), mode));
}

/** Minor units back to a decimal number of `currency` (the nearest double to the exact decimal). */
export function fromMinor(minor: Minor, currency: string): number {
  assertMinor(minor);
  const v = minor / 10 ** exponentOf(currency);
  return v === 0 ? 0 : v;
}

/** Minor units as an exact decimal string with the currency's decimals ("1234.50", "-0.05", "333"). */
export function minorToString(minor: Minor, currency: string): string {
  assertMinor(minor);
  const e = exponentOf(currency);
  const neg = minor < 0, abs = String(Math.abs(minor)).padStart(e + 1, '0');
  const out = e ? `${abs.slice(0, -e)}.${abs.slice(-e)}` : abs;
  return neg ? '-' + out : out;
}

/** How many decimals a number or decimal string has ("100.0049" → 4, 1e-7 → 7, 12 → 0). Trailing zeros of a string count. */
export function decimalsOf(amount: number | string): number {
  return Math.max(0, parseDecimal(amount).scale);
}
/** True when `amount` has no more decimals than `currency` allows (exact; 0.1 + 0.2 style floats are their shortest form). */
export function fitsExponent(amount: number | string, currency: string): boolean {
  const {digits, scale} = parseDecimal(amount);
  const e = exponentOf(currency);
  return scale <= e || digits % pow10(scale - e) === B0;
}

/** `pct` percent of `minor`, rounded to a whole minor unit. `pct` is exact decimal (33.333, 18, 2.5). */
export function mulPct(minor: Minor, pct: number | string, mode: RoundMode = 'half_up'): Minor {
  assertMinor(minor);
  const {digits, scale} = parseDecimal(pct);
  return safe(divRound(BigInt(minor) * digits, B100 * pow10(scale), mode));
}

/** `minor` × `factor` (an exact decimal such as an exchange rate), rounded to a whole minor unit. */
export function mulDecimal(minor: Minor, factor: number | string, mode: RoundMode = 'half_up'): Minor {
  assertMinor(minor);
  const {digits, scale} = parseDecimal(factor);
  return safe(divRound(BigInt(minor) * digits, pow10(scale), mode));
}

/** `minor` × `num` / `den` with integer arithmetic, rounded (used for tax-inclusive splits). */
export function mulDiv(minor: Minor, num: bigint, den: bigint, mode: RoundMode = 'half_up'): Minor {
  assertMinor(minor);
  return safe(divRound(BigInt(minor) * num, den, mode));
}

/** Convert an amount in minor units of `from` to minor units of `to` at `rate` units of `to` per one `from`. */
export function convertMinor(minor: Minor, from: string, to: string, rate: number | string, mode: RoundMode = 'half_up'): Minor {
  assertMinor(minor);
  const {digits, scale} = parseDecimal(rate);
  const shift = exponentOf(to) - exponentOf(from) - scale;
  const n = BigInt(minor) * digits;
  return safe(shift >= 0 ? n * pow10(shift) : divRound(n, pow10(-shift), mode));
}

/** The sum of minor amounts. Throws if any value or the running total leaves the safe integer range. */
export function sumMinor(values: Iterable<Minor>): Minor {
  let total = 0;
  for (const v of values) {
    assertMinor(v);
    total += v;
    if (!Number.isSafeInteger(total)) throw new RangeError('Amount is too large to compute exactly');
  }
  return total;
}

/** Split `total` into shares by percentage; every share is rounded and the last takes the remainder, so the shares add up exactly. */
export function allocatePct(total: Minor, pcts: (number | string)[]): Minor[] {
  let left = total;
  return pcts.map((p, i) => {
    const share = i === pcts.length - 1 ? left : mulPct(total, p);
    left -= share;
    return share;
  });
}

/** Round a decimal amount to the currency's decimals, half-up, exactly (number in, number out). */
export function roundMajor(amount: number | string, currency: string): number {
  return fromMinor(toMinor(amount, currency), currency);
}

/**
 * Transitional shim for consumers that still keep decimal amounts (WS-03/04/05 read paths). Exact
 * half-up to 2 decimals, so it never has the float-multiply-then-round drift (1.005 → 1.01).
 * @deprecated Compute in minor units; the owning workstreams delete their uses in their PRs.
 */
export function round2(amount: number): number {
  return roundMajor(amount, 'USD');
}

function assertMinor(v: number) {
  if (!Number.isSafeInteger(v)) throw new RangeError(`Minor units must be a safe integer, got ${v}`);
}
