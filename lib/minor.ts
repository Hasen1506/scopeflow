import type {Minor} from './contracts';

// Integer minor units (owner: WS-01). Phase 0: final signatures, bodies reproduce today's behaviour
// (lib/razorpay.ts toMinorUnits/fromMinorUnits: the currency exponent from Intl, Math.round).
// Nothing calls these yet. WS-01 replaces the bodies with float-free arithmetic and the exponent
// table in config/currencies.ts.

export type {Minor};
/** How percentages are rounded to minor units. Phase 0 supports half-up only. */
export type RoundMode = 'half_up';

/** Decimal places of `currency` (JPY 0, INR/USD 2). */
export function exponentOf(currency: string): number {
  return new Intl.NumberFormat('en', {style: 'currency', currency}).resolvedOptions().maximumFractionDigits ?? 2;
}
/** A decimal amount (number or decimal string) in minor units of `currency`. */
export function toMinor(amount: number | string, currency: string): Minor {
  return Math.round(Number(amount) * 10 ** exponentOf(currency));
}
/** Minor units back to a decimal number of `currency`. */
export function fromMinor(minor: Minor, currency: string): number {
  return minor / 10 ** exponentOf(currency);
}
/** `pct` percent of `minor`, rounded to a whole minor unit. */
export function mulPct(minor: Minor, pct: number, _mode: RoundMode = 'half_up'): Minor {
  return Math.round(minor * pct / 100);
}
/** The sum of minor amounts. */
export function sumMinor(values: Iterable<Minor>): Minor {
  let total = 0;
  for (const v of values) total += v;
  return total;
}
