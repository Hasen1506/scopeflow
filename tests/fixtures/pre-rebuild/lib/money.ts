import {formatMoney, itemsOf, type Scope} from './scope';

// PR C: tax, deposit and the fee/items reconciliation, as pure functions shared by the editor,
// the scope paper, the review page and the tests.

const round2 = (n: number) => Math.round(n * 100) / 100;

export type Totals = {fee: number; tax_label: string; tax_pct: number; tax: number; total: number; deposit_pct: number; deposit: number; balance: number};
/** The fee is before tax; tax and deposit are computed on it (deposit on the tax-inclusive total). */
export function totals(s: Pick<Scope, 'fee' | 'tax_pct' | 'tax_label' | 'deposit_pct'>, fee = s.fee): Totals {
  const tax_pct = s.tax_pct ?? 0, deposit_pct = s.deposit_pct ?? 0;
  const tax = round2(fee * tax_pct / 100), total = round2(fee + tax), deposit = round2(total * deposit_pct / 100);
  return {fee, tax_label: s.tax_label || 'Tax', tax_pct, tax, total, deposit_pct, deposit, balance: round2(total - deposit)};
}

export type FeeCheck = {status: 'none' | 'match' | 'partial' | 'under' | 'over'; item_total: number; priced: number; unpriced: number; difference: number; message: string | null};
/**
 * Do the item prices add up to the fee? `under` = items sum to less than the fee with every
 * item priced, `over` = priced items already exceed the fee, `partial` = some items unpriced
 * and the priced ones do not exceed the fee. Pure, used for the inline warning in the editor.
 */
export function feeCheck(s: Pick<Scope, 'fee' | 'currency' | 'items' | 'deliverables'>): FeeCheck {
  const items = itemsOf(s);
  const priced = items.filter(i => i.price != null);
  const item_total = round2(priced.reduce((sum, i) => sum + (i.price ?? 0), 0));
  const difference = round2(s.fee - item_total);
  const base = {item_total, priced: priced.length, unpriced: items.length - priced.length, difference};
  const m = (n: number) => formatMoney(n, s.currency);
  if (!priced.length) return {...base, status: 'none', message: null};
  if (Math.abs(difference) < 0.005) return {...base, status: base.unpriced ? 'partial' : 'match', message: base.unpriced ? `Priced items add up to the fee; ${base.unpriced} ${base.unpriced === 1 ? 'item is' : 'items are'} unpriced.` : null};
  if (difference < 0) return {...base, status: 'over', message: `Item prices add up to ${m(item_total)}, which is ${m(-difference)} more than the fee of ${m(s.fee)}.`};
  if (base.unpriced) return {...base, status: 'partial', message: `Priced items add up to ${m(item_total)}; ${m(difference)} of the ${m(s.fee)} fee is not assigned to an item (${base.unpriced} unpriced).`};
  return {...base, status: 'under', message: `Item prices add up to ${m(item_total)}, ${m(difference)} less than the fee of ${m(s.fee)}.`};
}

export type ScheduleLine = {id: string; title: string; pct: number; due: string; amount: number};
/**
 * The payment schedule in money: each milestone's share of the tax-inclusive total. Shares are
 * rounded to the cent and the last milestone takes the remainder, so the lines always add up to the total.
 */
export function schedule(s: Pick<Scope, 'milestones'>, total: number): ScheduleLine[] {
  const list = s.milestones ?? [];
  let left = round2(total);
  return list.map((m, i) => {
    const amount = i === list.length - 1 ? left : round2(total * m.pct / 100);
    left = round2(left - amount);
    return {id: m.id, title: m.title, pct: m.pct, due: m.due, amount};
  });
}

/** An amount in the scope's locked second currency, or null when the scope has none. */
export function inFx(s: Pick<Scope, 'fx'>, amount: number): {amount: number; currency: string} | null {
  return s.fx ? {amount: round2(amount * s.fx.rate), currency: s.fx.currency} : null;
}
/** "≈ ₹1,50,000.00 at 83.5 INR/USD (RBI reference rate, 2026-10-01)". */
export function fxLine(s: Pick<Scope, 'fx' | 'currency'>, amount: number) {
  const v = inFx(s, amount);
  if (!v || !s.fx) return '';
  return `≈ ${formatMoney(v.amount, v.currency)} at ${s.fx.rate} ${s.fx.currency}/${s.currency} (${s.fx.source}, ${s.fx.as_of})`;
}
