import type {GstBreakdown, GstHead, Minor} from './contracts';
import {gstFromExclusive as engineExclusive, gstFromInclusive as engineInclusive, type SupplyType} from './gst';

// WS-03: GST on one invoice amount in integer minor units, by the rules of plan §9.3. Pure and
// float-free. M10: the arithmetic is WS-01's lib/gst.ts gstFromExclusive()/gstFromInclusive() (exact
// decimal rates); tests/golden/ws-03-gst.golden.json pins the figures the swap must keep byte for byte.
// Needs CA review: per-head rounding and the round-off line.
//
//   Exclusive entry (default): taxable = the amount entered; tax on top.
//   Inclusive entry ("amount includes GST"): taxable = round(amount × 100 / (100 + rate)); the heads
//     are computed from taxable and any residual paisa is an explicit round_off line.
//   Per head: CGST = SGST = round(taxable × rate / 2), IGST = round(taxable × rate); half-up.
//   A single undivided head ("GST", no place of supply) = round(taxable × rate).

/**
 * How the tax is split: same state (CGST + SGST), another state or export (IGST), or one undivided head.
 * 'none' is WS-01's name (lib/gst.ts SupplyType) for the undivided head and is accepted as 'single'.
 */
export type {SupplyType};
export type HeadKind = SupplyType | 'single';
/** The head a tax is printed under, WS-01's AgreementTaxHead shape: {name, label, rate, amount}. */
export type LabeledHead = {name: GstHead['name'] | 'OTHER'; label: string; rate: number; amount: Minor};
/** A breakdown's heads with the label to print (the scope's tax label for an undivided head). Mirrors WS-01's agreementTotals heads. */
export function labeledHeads(b: GstBreakdown, taxLabel: string): LabeledHead[] {
  return b.heads.map(h => h.name === 'GST'
    ? {name: /\b(gst|igst)\b/i.test(taxLabel) || !taxLabel ? 'GST' : 'OTHER', label: taxLabel || 'GST', rate: h.rate, amount: h.amount}
    : {name: h.name, label: h.name, rate: h.rate, amount: h.amount});
}

// M10: one GST engine. The per-head arithmetic lives in lib/gst.ts (exact decimal rates, BigInt
// half-up rounding); this module keeps the invoice-level API (HeadKind 'single', no heads at a 0% rate)
// on top of it, so tests/golden/ws-03-gst.golden.json still pins the same figures.
const supplyOf = (kind: HeadKind): SupplyType => kind === 'single' ? 'none' : kind;
const assertRate = (rate: number) => { if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error('Tax rate must be between 0 and 100'); };
const assertMinor = (v: number, what: string) => { if (!Number.isSafeInteger(v)) throw new Error(`${what} must be a whole number of minor units`); };
/** round(n / d) half away from zero, for d > 0. */
export function divRound(n: bigint, d: bigint): bigint {
  const q = n / d, r = n % d;
  if (r === BigInt(0)) return q;
  const twice = (r < BigInt(0) ? -r : r) * BigInt(2);
  if (twice >= d) return n < BigInt(0) ? q - BigInt(1) : q + BigInt(1);
  return q;
}

/** The tax heads on a taxable value. */
export function gstHeads(taxable: Minor, rate: number, kind: HeadKind): GstHead[] {
  assertMinor(taxable, 'Taxable value');
  assertRate(rate);
  if (rate === 0) return [];
  return engineExclusive(taxable, rate, supplyOf(kind)).heads;
}

/** GST on top of a taxable value (exclusive entry). */
export function gstFromExclusive(taxable: Minor, rate: number, kind: HeadKind): GstBreakdown {
  const heads = gstHeads(taxable, rate, kind);
  return {taxable, heads, round_off: 0, total: taxable + heads.reduce((s, h) => s + h.amount, 0)};
}

/** GST inside an amount (inclusive entry): the total stays exactly the amount entered. */
export function gstFromInclusive(amount: Minor, rate: number, kind: HeadKind): GstBreakdown {
  assertMinor(amount, 'Amount');
  assertRate(rate);
  if (rate === 0) return {taxable: amount, heads: [], round_off: 0, total: amount};
  return engineInclusive(amount, rate, supplyOf(kind));
}

/** Σ heads. */
export const taxOf = (b: GstBreakdown) => b.heads.reduce((s, h) => s + h.amount, 0);

/**
 * The same breakdown with its total capped at `cap` by an explicit (negative) round-off: used for the
 * last invoice of an agreement, where per-head rounding can come out a paisa above the agreed total.
 * Never moves the total by more than one minor unit per head.
 */
export function capTotal(b: GstBreakdown, cap: Minor): GstBreakdown {
  const over = b.total - cap;
  if (over <= 0 || over > Math.max(1, b.heads.length)) return b;
  return {...b, round_off: b.round_off - over, total: cap};
}

/** The head kind for a GST tax invoice (seller state vs place of supply), or 'single' with no place of supply. */
export function headKind(gst: {kind: 'intra' | 'inter' | 'export'} | null | undefined): HeadKind {
  return gst ? gst.kind : 'single';
}
