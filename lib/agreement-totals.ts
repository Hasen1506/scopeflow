import type {GstBreakdown, Minor, TaxHeadName} from './contracts';
import {gstFromExclusive, isGstLabel, placeOfSupply, type PlaceOfSupply, type SupplyType} from './gst';
import {computeAgreement, type LedgerEntry} from './ledger';
import {scheduleMinor} from './money';
import {mulPct, sumMinor, toMinor} from './minor';
import type {Scope} from './scope';

// One set of agreement figures for the client page, statement, workspace and insights (owner: WS-01).
// Everything is integer minor units of the scope currency:
// - fee = the signed baseline fee + every approved change order's fee_delta (from lib/ledger.ts);
// - tax per head from the per-head GST engine (lib/gst.ts), on the whole current fee: one undivided
//   head when no place of supply is known (the tax label, e.g. "GST"), CGST + SGST intra-state,
//   IGST inter-state or for exports. The same head logic for a project everywhere, so the
//   statement, the client page and the invoices never disagree by a paisa (plan §9.3);
// - deposit = deposit_pct of the signed baseline total (as signed);
// - milestones = the schedule frozen at baseline approval (shares of the baseline total, M9);
//   approved change orders are not spread over milestones: they are `unscheduled`.

export type AgreementTaxHead = {
  /** CGST/SGST/IGST/GST for GST; OTHER for a non-GST tax label (VAT, sales tax). */
  name: TaxHeadName | 'OTHER';
  /** What to print: the head name for split GST, otherwise the scope's tax label. */
  label: string;
  rate: number;
  amount: Minor;
};
export type AgreementMilestone = {id: string; title: string; pct: number; due: string; amount: Minor};
export type AgreementTotals = {
  currency: string;
  /** Fee after approved change orders, before tax. */
  fee: Minor;
  heads: AgreementTaxHead[];
  tax: Minor;
  total: Minor;
  /** Deposit due on signature (computed on the signed baseline, as signed). */
  deposit: Minor;
  /** The payment schedule frozen at baseline approval; it adds up to `baseline.total`. */
  milestones: AgreementMilestone[];
  /** The signed baseline on its own (no change orders). */
  baseline: {fee: Minor; tax: Minor; total: Minor};
  /** Approved change orders' fee deltas (before tax). */
  change_orders: Minor;
  /** Part of `total` no milestone covers (approved change orders with their tax) when there is a schedule; else 0. */
  unscheduled: Minor;
  /** The supply type the heads were computed for. */
  supply: SupplyType;
  /** The place of supply when one was given (with its warnings, e.g. an unconfirmed export). */
  place: PlaceOfSupply | null;
  /** The GST breakdown of the current fee (round_off is always 0: amounts are tax-exclusive). */
  breakdown: GstBreakdown;
};

export type AgreementTotalsOptions = {
  /** The supply type when the caller already knows it. */
  supply?: SupplyType;
  /** Or what decides it: the seller's GST state and the client's location (lib/gst.ts placeOfSupply). */
  place?: Parameters<typeof placeOfSupply>[0];
};

/** `entries` are those of the baseline whose `content` is given, in sequence order. */
export function agreementTotals(content: Scope, entries: LedgerEntry[], opts: AgreementTotalsOptions = {}): AgreementTotals {
  const currency = content.currency;
  const version = entries[0]?.baseline_version ?? 0;
  const own = entries.filter(e => e.baseline_version === version);
  const agreement = computeAgreement(content, version, own);
  const baseFee = toMinor(content.fee, currency);
  const change_orders = sumMinor(agreement.change_orders.filter(c => c.status === 'approved').map(c => toMinor(c.fee_delta, currency)));
  const fee = baseFee + change_orders;

  const place = opts.place?.seller_state ? placeOfSupply(opts.place) : null;
  const supply: SupplyType = opts.supply ?? place?.supply ?? 'none';
  const rate = content.tax_pct ?? 0, label = content.tax_label || 'Tax';
  const gst = isGstLabel(label) || opts.supply !== undefined || place !== null;
  const taxOn = (amount: Minor) => {
    const b = gstFromExclusive(amount, rate, gst ? supply : 'none');
    const heads: AgreementTaxHead[] = rate > 0 ? b.heads.map(h => ({
      name: gst ? h.name : 'OTHER', label: gst && supply !== 'none' ? h.name : label, rate: h.rate, amount: h.amount,
    })) : [];
    return {b: rate > 0 ? b : {taxable: amount, heads: [], round_off: 0, total: amount}, heads};
  };
  const now = taxOn(fee), signed = taxOn(baseFee);
  const tax = sumMinor(now.heads.map(h => h.amount)), baseTax = sumMinor(signed.heads.map(h => h.amount));
  const total = fee + tax, baseTotal = baseFee + baseTax;
  const milestones = scheduleMinor(content, baseTotal);
  return {
    currency, fee, heads: now.heads, tax, total,
    deposit: mulPct(baseTotal, content.deposit_pct ?? 0),
    milestones,
    baseline: {fee: baseFee, tax: baseTax, total: baseTotal},
    change_orders,
    unscheduled: milestones.length ? total - sumMinor(milestones.map(m => m.amount)) : 0,
    supply: gst ? supply : 'none', place, breakdown: now.b,
  };
}
