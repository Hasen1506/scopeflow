import {formatMoney, itemsOf, type Item, type Scope} from './scope';
import {allocatePct, convertMinor, exponentOf, fromMinor, mulPct, sumMinor, toMinor, type Minor} from './minor';

// PR C: tax, deposit and the fee/items reconciliation, as pure functions shared by the editor,
// the scope paper, the review page and the tests.
// WS-01 (M3/M4): every figure is computed in integer minor units of the scope currency (lib/minor.ts)
// and converted back to a decimal number only on the way out, so ₹25,000 + 18% is exactly ₹29,500.00,
// 1.005 rounds to 1.01, and a yen deposit is a whole number of yen (¥1,000 @ 33.333% → ¥333). The
// signed scope content keeps its decimal numbers; nothing here changes a canonical form.

/** Fields the money helpers read. `currency` decides the decimals; without it, 2 (older callers). */
type Terms = Pick<Scope, 'fee' | 'tax_pct' | 'tax_label' | 'deposit_pct'> & {currency?: string};
const ccyOf = (s: {currency?: string}) => s.currency || 'USD';

export type Totals = {fee: number; tax_label: string; tax_pct: number; tax: number; total: number; deposit_pct: number; deposit: number; balance: number};
/** The same totals in minor units of the scope currency. */
export type TotalsMinor = {currency: string; fee: Minor; tax: Minor; total: Minor; deposit: Minor; balance: Minor};

/** Totals in minor units: tax on the fee (one head, half-up), deposit on the tax-inclusive total. */
export function totalsMinor(s: Terms, fee: number = s.fee): TotalsMinor {
  const currency = ccyOf(s);
  const feeM = toMinor(fee, currency);
  const tax = mulPct(feeM, s.tax_pct ?? 0), total = sumMinor([feeM, tax]);
  const deposit = mulPct(total, s.deposit_pct ?? 0);
  return {currency, fee: feeM, tax, total, deposit, balance: total - deposit};
}

/** The fee is before tax; tax and deposit are computed on it (deposit on the tax-inclusive total). */
export function totals(s: Terms, fee = s.fee): Totals {
  const tax_pct = s.tax_pct ?? 0, deposit_pct = s.deposit_pct ?? 0;
  const t = totalsMinor(s, fee), d = (m: Minor) => fromMinor(m, t.currency);
  return {fee: d(t.fee), tax_label: s.tax_label || 'Tax', tax_pct, tax: d(t.tax), total: d(t.total), deposit_pct, deposit: d(t.deposit), balance: d(t.balance)};
}

/**
 * M6: the money value of one item line. With `unit_price` the line total is qty × unit_price;
 * otherwise the legacy `price` is the line total (as signed before unit prices existed). null when unpriced.
 */
export function lineTotalMinor(i: Pick<Item, 'qty' | 'price' | 'unit_price'>, currency: string): Minor | null {
  if (i.unit_price != null) return safeProduct(toMinor(i.unit_price, currency), i.qty ?? 1);
  return i.price == null ? null : toMinor(i.price, currency);
}
function safeProduct(a: Minor, b: number): Minor {
  const p = a * b;
  if (!Number.isSafeInteger(p)) throw new RangeError('Amount is too large to compute exactly');
  return p;
}
/** Line total as a decimal number (see lineTotalMinor). */
export function lineTotal(i: Pick<Item, 'qty' | 'price' | 'unit_price'>, currency: string): number | null {
  const m = lineTotalMinor(i, currency);
  return m == null ? null : fromMinor(m, currency);
}

/**
 * Visual #9: how one item's price reads on the scope document. `line` is the line total (lineTotal). With a unit price
 * and qty > 1 `each` is that unit price ("₹2,500 each" under "₹30,000"). A legacy `price` is already the line total, so
 * with qty > 1 `forAll` is the quantity it covers ("for all 12"), and it is never shown as if it were a unit price.
 */
export function itemPriceView(i: Pick<Item, 'qty' | 'price' | 'unit_price'>, currency: string): {line: number; each: number | null; forAll: number | null} | null {
  const line = lineTotal(i, currency);
  if (line == null) return null;
  const qty = i.qty ?? 1;
  if (qty <= 1) return {line, each: null, forAll: null};
  return i.unit_price != null ? {line, each: i.unit_price, forAll: null} : {line, each: null, forAll: qty};
}

/**
 * R4-02: the items' line totals added up exactly (minor units), with how many lines are priced. The one sum the
 * owner's editor, the clarity check, feeCheck and change-order forms use, so each agrees with the client page.
 * A line too large to compute exactly counts as unpriced here (the schema rejects it on save).
 */
export function itemsTotal(items: Pick<Item, 'qty' | 'price' | 'unit_price'>[], currency: string): {total: number; priced: number; unpriced: number} {
  const lines = items.map(i => { try { return lineTotalMinor(i, currency); } catch { return null; } });
  const priced = lines.filter((l): l is Minor => l != null);
  return {total: fromMinor(sumMinor(priced), currency), priced: priced.length, unpriced: items.length - priced.length};
}

/** R4-02: " · ₹30,000.00 (₹2,500.00 each)" or " · ₹10,000.00" for one item line (receipt, version diff); '' when unpriced. */
export function itemPriceText(i: Pick<Item, 'qty' | 'price' | 'unit_price'>, currency: string): string {
  let v: ReturnType<typeof itemPriceView>;
  try { v = itemPriceView(i, currency); } catch { return ''; }
  if (!v) return '';
  return ` · ${formatMoney(v.line, currency)}${v.each != null ? ` (${formatMoney(v.each, currency)} each)` : ''}`;
}

/** R4-02: the per-unit price an item implies: its unit_price, else its line total ÷ qty when that is exact in minor units, else null. */
export function exactUnitPrice(i: Pick<Item, 'qty' | 'price' | 'unit_price'>, currency: string): number | null {
  if (i.unit_price != null) return i.unit_price;
  if (i.price == null) return null;
  const qty = i.qty ?? 1, m = toMinor(i.price, currency);
  return qty >= 1 && m % qty === 0 ? fromMinor(m / qty, currency) : null;
}

export type FeeCheck = {status: 'none' | 'match' | 'partial' | 'under' | 'over'; item_total: number; priced: number; unpriced: number; difference: number; message: string | null};
/**
 * Do the item line totals add up to the fee? `under` = items sum to less than the fee with every
 * item priced, `over` = priced items already exceed the fee, `partial` = some items unpriced
 * and the priced ones do not exceed the fee. Pure, used for the inline warning in the editor.
 * Line totals are qty × unit_price when a unit price is set (M6); compared exactly in minor units.
 */
export function feeCheck(s: Pick<Scope, 'fee' | 'currency' | 'items' | 'deliverables'>): FeeCheck {
  const items = itemsOf(s), ccy = s.currency;
  const lines = items.map(i => lineTotalMinor(i, ccy));
  const priced = lines.filter((l): l is Minor => l != null);
  const itemM = sumMinor(priced), diffM = toMinor(s.fee, ccy) - itemM;
  const item_total = fromMinor(itemM, ccy), difference = fromMinor(diffM, ccy);
  const base = {item_total, priced: priced.length, unpriced: items.length - priced.length, difference};
  const m = (n: number) => formatMoney(n, ccy);
  if (!priced.length) return {...base, status: 'none', message: null};
  if (diffM === 0) return {...base, status: base.unpriced ? 'partial' : 'match', message: base.unpriced ? `Priced items add up to the fee; ${base.unpriced} ${base.unpriced === 1 ? 'item is' : 'items are'} unpriced.` : null};
  if (diffM < 0) return {...base, status: 'over', message: `Item prices add up to ${m(item_total)}, which is ${m(-difference)} more than the fee of ${m(s.fee)}.`};
  if (base.unpriced) return {...base, status: 'partial', message: `Priced items add up to ${m(item_total)}; ${m(difference)} of the ${m(s.fee)} fee is not assigned to an item (${base.unpriced} unpriced).`};
  return {...base, status: 'under', message: `Item prices add up to ${m(item_total)}, ${m(difference)} less than the fee of ${m(s.fee)}.`};
}

export type ScheduleLine = {id: string; title: string; pct: number; due: string; amount: number};
/** The payment schedule in minor units: each milestone's share of `totalMinor`; the last takes the remainder. */
export function scheduleMinor(s: Pick<Scope, 'milestones'>, totalMinor: Minor): (Omit<ScheduleLine, 'amount'> & {amount: Minor})[] {
  const list = s.milestones ?? [];
  const shares = allocatePct(totalMinor, list.map(m => m.pct));
  return list.map((m, i) => ({id: m.id, title: m.title, pct: m.pct, due: m.due, amount: shares[i]}));
}
/**
 * The payment schedule in money: each milestone's share of the tax-inclusive total. Shares are
 * rounded to the currency's minor unit and the last milestone takes the remainder, so the lines
 * always add up to the total exactly.
 */
export function schedule(s: Pick<Scope, 'milestones'> & {currency?: string}, total: number): ScheduleLine[] {
  const ccy = ccyOf(s);
  return scheduleMinor(s, toMinor(total, ccy)).map(l => ({...l, amount: fromMinor(l.amount, ccy)}));
}

/** An amount in the scope's locked second currency, or null when the scope has none. Exact, rounded to that currency's decimals. */
export function inFx(s: Pick<Scope, 'fx'> & {currency?: string}, amount: number): {amount: number; currency: string} | null {
  if (!s.fx) return null;
  const from = ccyOf(s), to = s.fx.currency;
  return {amount: fromMinor(convertMinor(toMinor(amount, from), from, to, s.fx.rate), to), currency: to};
}
/** "≈ ₹1,50,000.00 at 83.5 INR/USD (RBI reference rate, 2026-10-01)". */
export function fxLine(s: Pick<Scope, 'fx' | 'currency'>, amount: number) {
  const v = inFx(s, amount);
  if (!v || !s.fx) return '';
  return `≈ ${formatMoney(v.amount, v.currency)} at ${s.fx.rate} ${s.fx.currency}/${s.currency} (${s.fx.source}, ${s.fx.as_of})`;
}

/**
 * How a change order's money reads to the client (M7, WS-03/WS-07): "+₹10,000.00 + GST ₹1,800.00 = ₹11,800.00".
 * Tax is computed at the agreement's rate on the fee delta, in minor units. Without tax: "+₹10,000.00".
 */
export function coDisplay(s: Terms & {currency: string}, fee_delta: number): {delta: Minor; tax: Minor; total: Minor; text: string} {
  const ccy = s.currency, delta = toMinor(fee_delta, ccy), tax = mulPct(delta, s.tax_pct ?? 0), total = delta + tax;
  const f = (m: Minor) => formatMoney(fromMinor(Math.abs(m), ccy), ccy), sign = (m: Minor) => (m < 0 ? '−' : '+');
  const text = tax ? `${sign(delta)}${f(delta)} ${tax < 0 ? '−' : '+'} ${s.tax_label || 'Tax'} ${f(tax)} = ${sign(total)}${f(total)}` : `${sign(delta)}${f(delta)}`;
  return {delta, tax, total, text};
}

/** Decimals allowed for amounts in `currency` (re-exported for the editor's number inputs). */
export const decimalsFor = exponentOf;
