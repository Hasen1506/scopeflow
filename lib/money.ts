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
