// Rate card / price book (SF-06, owner: WS-05). Pure and isomorphic: the settings page, the
// change-order picker, the radar (WS-06) and the server price lines the same way.
// Prices are integer minor units; multipliers (rush +25 % and the like) and tax are applied in
// exact integer arithmetic, rounding half-up at each step.
import {z} from 'zod';
import {currencyCodes} from './currency';
import {fromMinor} from './minor';
import {pctOfMinor} from './ledger-math';
import type {ChangeOrder} from './ledger';

const stableId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'Use 1–40 letters, numbers, dashes or underscores');
export const rateItemSchema = z.object({
  id: stableId,
  title: z.string().trim().min(2).max(160),
  unit: z.string().trim().max(40).default(''),
  unit_price_minor: z.number().int().min(0).max(1_000_000_000_000),
  currency: z.enum(currencyCodes),
  tax_pct: z.number().finite().min(0).max(100).default(0),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
}).strict();
export const multiplierSchema = z.object({
  id: stableId,
  label: z.string().trim().min(2).max(60),
  pct: z.number().finite().min(-100).max(500),
}).strict();
export const rateCardSchema = z.object({
  items: z.array(rateItemSchema).max(200),
  multipliers: z.array(multiplierSchema).max(10),
}).strict().superRefine((c, ctx) => {
  if (new Set(c.items.map(i => i.id)).size !== c.items.length) ctx.addIssue({code: 'custom', path: ['items'], message: 'Item ids must be unique'});
  if (new Set(c.multipliers.map(m => m.id)).size !== c.multipliers.length) ctx.addIssue({code: 'custom', path: ['multipliers'], message: 'Multiplier ids must be unique'});
});
export type RateItem = z.infer<typeof rateItemSchema>;
export type Multiplier = z.infer<typeof multiplierSchema>;
export type RateCard = z.infer<typeof rateCardSchema>;

/** The default rule set every account starts with. */
export const DEFAULT_MULTIPLIERS: Multiplier[] = [{id: 'rush', label: 'Rush delivery', pct: 25}];
export const EMPTY_RATE_CARD: RateCard = {items: [], multipliers: DEFAULT_MULTIPLIERS};

export type PricedLine = {
  item_id: string; title: string; unit: string; currency: string; qty: number;
  unit_price_minor: number; base_minor: number;
  adjustments: {id: string; label: string; pct: number; amount_minor: number}[];
  subtotal_minor: number;
  tax: {pct: number; amount_minor: number};
  total_minor: number;
};

/**
 * Prices `qty` of a rate-card item. base = qty × unit price (rounded half-up for fractional
 * quantities); each multiplier then adds its percentage of the running amount, rounded half-up;
 * tax is the rate's percentage of the subtotal. `taxPct` overrides the item's own rate (a project's
 * agreed tax applies to its change orders).
 */
export function priceLine(item: RateItem, qty: number, multiplierIds: string[], card: Pick<RateCard, 'multipliers'>, taxPct?: number): PricedLine {
  if (!(qty > 0)) throw new RangeError('Quantity must be positive');
  const base = pctOfMinor(item.unit_price_minor, qty * 100);
  const adjustments: PricedLine['adjustments'] = [];
  let running = base;
  for (const id of multiplierIds) {
    const m = card.multipliers.find(x => x.id === id);
    if (!m) throw new RangeError(`Unknown multiplier: ${id}`);
    const amount = pctOfMinor(running, m.pct);
    adjustments.push({id: m.id, label: m.label, pct: m.pct, amount_minor: amount});
    running += amount;
  }
  const pct = taxPct ?? item.tax_pct;
  const tax = pctOfMinor(running, pct);
  return {item_id: item.id, title: item.title, unit: item.unit, currency: item.currency, qty, unit_price_minor: item.unit_price_minor, base_minor: base, adjustments, subtotal_minor: running, tax: {pct, amount_minor: tax}, total_minor: running + tax};
}

/** The rate-card item that prices a scope deliverable: same id, or tagged `item:<id>`. */
export function rateItemFor(card: Pick<RateCard, 'items'>, itemId: string): RateItem | null {
  return card.items.find(i => i.id === itemId) ?? card.items.find(i => i.tags.includes('item:' + itemId)) ?? null;
}

/** Items that match a search (title, unit or tag), for the picker and the radar. */
export function searchRateCard(card: Pick<RateCard, 'items'>, query: string, currency?: string): RateItem[] {
  const q = query.trim().toLowerCase();
  return card.items.filter(i => (!currency || i.currency === currency) && (!q || [i.title, i.unit, ...i.tags].some(x => x.toLowerCase().includes(q))));
}

/**
 * A change-order draft for a priced line (SF-06): one added deliverable and the pre-tax fee change.
 * `newId` makes the deliverable id (unique within the project).
 */
export function coFromLine(line: PricedLine, newId: string, opts: {multiplierIds?: string[]; reason?: string} = {}): ChangeOrder {
  const whole = Number.isInteger(line.qty);
  const fee = fromMinor(line.subtotal_minor, line.currency);
  const rush = line.adjustments.length ? ` (${line.adjustments.map(a => a.label).join(', ')})` : '';
  return {
    title: `${line.title}${line.qty !== 1 ? ` × ${line.qty}` : ''}${rush}`.slice(0, 160),
    reason: opts.reason ?? 'Priced from the rate card.',
    request_quote: '',
    add_items: [{id: newId, title: line.title, qty: whole ? line.qty : 1, unit: whole ? line.unit : `${line.qty} ${line.unit}`.trim().slice(0, 40), price: fee, acceptance: ''}],
    remove_item_ids: [], fee_delta: fee, days_delta: 0, revisions_delta: 0,
    rate_card: {item_id: line.item_id, qty: line.qty, unit_price_minor: line.unit_price_minor, multipliers: opts.multiplierIds ?? line.adjustments.map(a => a.id)},
  };
}
