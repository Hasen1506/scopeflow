import { z } from 'zod';
import {currencyCodes, formatMoney} from './currency';
export {formatMoney} from './currency';

/** Configured currency codes (config/currencies.ts). */
export const currencies = currencyCodes;
const stableId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'Use 1–40 letters, numbers, dashes or underscores');
export const dateString = z.string().refine(
  x => !x || (/^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x),
  'Use a valid date',
);

// A deliverable with a stable id so versions, diffs and change orders can refer to it.
export const itemSchema = z.object({
  id: stableId,
  title: z.string().trim().min(2).max(200),
  qty: z.number().int().min(1).max(10000).default(1),
  unit: z.string().trim().max(40).default(''),
  price: z.number().finite().min(0).max(10000000).nullable().default(null),
  acceptance: z.string().trim().max(1000).default(''),
  // Phase 0 (M6, WS-01): optional price per unit; when present the line total is qty × unit_price.
  // Omitted when unset, so items signed before it existed keep their canonical form.
  unit_price: z.number().finite().min(0).max(10000000).optional(),
}).strict();
export type Item = z.infer<typeof itemSchema>;

// Something the client must provide for the work to proceed (copy, access, feedback).
export const clientInputSchema = z.object({
  id: stableId,
  title: z.string().trim().min(2).max(200),
  due: dateString.default(''),
}).strict();
export type ClientInput = z.infer<typeof clientInputSchema>;

// A payment milestone: a share of the tax-inclusive total, due on a date or on an event (empty due).
export const milestoneSchema = z.object({
  id: stableId,
  title: z.string().trim().min(2).max(120),
  pct: z.number().finite().gt(0).max(100),
  due: dateString.default(''),
}).strict();
export type Milestone = z.infer<typeof milestoneSchema>;

// A second currency shown next to the agreed one, at a rate fixed in the signed scope: `rate` units
// of `currency` per one unit of the scope's currency, as published by `source` on `as_of`.
export const fxSchema = z.object({
  currency: z.enum(currencyCodes),
  rate: z.number().finite().positive().max(1000000),
  as_of: dateString.refine(Boolean, 'Enter the date of the rate'),
  source: z.string().trim().min(2).max(80),
}).strict();
export type Fx = z.infer<typeof fxSchema>;

// Revisions as a bank of hours or a money budget instead of (or as well as) counted rounds: each
// logged round draws on it, and use beyond it is billed at `overage_rate` per hour (hours banks).
export const revisionBankSchema = z.object({
  unit: z.enum(['hours', 'money']),
  amount: z.number().finite().positive().max(100000),
  overage_rate: z.number().finite().min(0).max(1000000).optional(),
}).strict();
export type RevisionBank = z.infer<typeof revisionBankSchema>;

// Phase 0 contract shapes (see the optional fields at the end of scopeSchema).
// A retainer: a recurring period with quotas of agreed deliverables (WS-05).
export const retainerSchema = z.object({
  period: z.enum(['monthly']),
  quotas: z.array(z.object({item_id: stableId, qty: z.number().finite().positive().max(100000)}).strict()).max(60),
  carry_over: z.enum(['none', 'cap']),
  renewal: z.enum(['auto', 'manual']).optional(),
}).strict();
export type Retainer = z.infer<typeof retainerSchema>;
// TDS the client is expected to deduct (WS-03, plan §9.4): an explicit input, never a default.
export const tdsSchema = z.object({
  section_2025: z.enum(['393(1) Sl.6(iii)-professional', '393(1) Sl.6(iii)-technical', '393(1) Sl.6(i)-contractor-ind-huf', '393(1) Sl.6(i)-contractor-other', '393(1) Sl.6(ii)', 'other']),
  legacy_label: z.enum(['194J(b)', '194J(a)', '194C', '194M']).nullable(),
  rate_pct: z.number().finite().min(0).max(100),
  base: z.literal('taxable_value'),
}).strict();
export type Tds = z.infer<typeof tdsSchema>;
// MSMED Act payment terms (WS-03): days after acceptance agreed in writing (at most 45 by law).
export const msmedSchema = z.object({
  agreed_days: z.number().int().min(1).max(45).optional(),
}).strict();
export type Msmed = z.infer<typeof msmedSchema>;

export const scopeSchema = z.object({
  title: z.string().trim().min(3).max(160),
  client: z.string().trim().min(2).max(120),
  deliverables: z.string().trim().max(5000),
  items: z.array(itemSchema).max(60).optional(),
  client_inputs: z.array(clientInputSchema).max(20).optional(),
  exclusions: z.string().trim().max(3000),
  fee: z.number().finite().min(0).max(10000000),
  currency: z.enum(currencies),
  revisions: z.number().int().min(0).max(50),
  due: dateString,
  notes: z.string().trim().max(3000),
  // PR C: commercial terms. Optional and omitted when unset, so content signed before they
  // existed keeps its exact canonical form (and hash).
  tax_label: z.string().trim().min(1).max(24).optional(),
  tax_pct: z.number().finite().min(0).max(100).optional(),
  deposit_pct: z.number().finite().min(0).max(100).optional(),
  payment_terms: z.string().trim().min(1).max(500).optional(),
  // Phase 3: payment schedule, locked exchange rate and revision bank. Optional and omitted when
  // unset, like the commercial terms above.
  milestones: z.array(milestoneSchema).min(1).max(12).optional(),
  fx: fxSchema.optional(),
  revision_bank: revisionBankSchema.optional(),
  // Phase 0 contracts: optional and omitted when unset, like the terms above, so canonical hashes of
  // existing content never change. Shapes are owned by WS-01 (this file); behaviour by the
  // workstream named on each line, which may tighten the shape before anything uses it.
  client_country: z.string().regex(/^[A-Z]{2}$/, 'Use a two-letter country code, e.g. IN').optional(), // H13, WS-01
  engagement: z.enum(['project', 'retainer']).optional(), // SF-05, WS-05
  retainer: retainerSchema.optional(), // SF-05, WS-05
  tds: tdsSchema.optional(), // H19, WS-03 (never defaulted)
  msmed: msmedSchema.optional(), // SF-07, WS-03
  language: z.enum(['en', 'hi', 'ta']).optional(), // SF-09, WS-07
}).strict().superRefine((s, ctx) => {
  if (!s.items?.length && s.deliverables.length < 5) ctx.addIssue({code: 'custom', path: ['deliverables'], message: 'Add at least one deliverable'});
  const unique = (list: {id: string}[] | undefined, path: string) => {
    if (list && new Set(list.map(x => x.id)).size !== list.length) ctx.addIssue({code: 'custom', path: [path], message: 'Ids must be unique'});
  };
  unique(s.items, 'items');
  unique(s.client_inputs, 'client_inputs');
  unique(s.milestones, 'milestones');
  if (s.milestones?.length) {
    const sum = s.milestones.reduce((a, m) => a + m.pct, 0);
    if (Math.abs(sum - 100) > 0.01) ctx.addIssue({code: 'custom', path: ['milestones'], message: `Payment milestones must add up to 100% (they add up to ${Math.round(sum * 100) / 100}%)`});
    if (s.deposit_pct) ctx.addIssue({code: 'custom', path: ['milestones'], message: 'Use either a deposit or a payment schedule: make the deposit the first milestone'});
  }
  if (s.fx && s.fx.currency === s.currency) ctx.addIssue({code: 'custom', path: ['fx', 'currency'], message: 'Pick a currency other than the scope currency'});
}).transform(s => (s.items?.length ? {...s, deliverables: s.items.map(itemLine).join('\n').slice(0, 5000)} : s));
export type Scope = z.infer<typeof scopeSchema>;
export type Version = {id: string; project_id: string; version: number; token: string; revoked?: number; content: Scope; status: string; signer: string | null; comment: string | null; created: string; decided: string | null; archived?: string | null; client_email?: string | null};

/** One-line text form of an item; used for the legacy `deliverables` field. */
export function itemLine(i: Item) {
  const amount = i.qty > 1 || i.unit ? ` (${i.qty}${i.unit ? ' ' + i.unit : ''})` : '';
  return i.title + amount;
}
/** Structured items for any scope, deriving them from `deliverables` lines for legacy content. */
export function itemsOf(s: Pick<Scope, 'items' | 'deliverables'>): Item[] {
  if (s.items?.length) return s.items;
  return s.deliverables.split('\n').map(x => x.trim()).filter(Boolean)
    .map((title, n) => ({id: 'line-' + (n + 1), title, qty: 1, unit: '', price: null, acceptance: ''}));
}
export function newId(prefix = 'i') {
  return prefix + '_' + crypto.randomUUID().replaceAll('-', '').slice(0, 8);
}

const studioItems: Item[] = [
  {id: 'i_logo', title: 'Primary logo and two variations', qty: 1, unit: 'logo suite', price: 900, acceptance: 'Delivered as SVG, PNG and PDF in colour and mono'},
  {id: 'i_palette', title: 'Colour palette and typography', qty: 1, unit: '', price: 300, acceptance: ''},
  {id: 'i_guide', title: 'Brand guidelines', qty: 12, unit: 'pages', price: 600, acceptance: 'Print-ready PDF'},
];
export const sample: Scope = {
  title: 'Brand identity / Studio North', client: 'Studio North',
  deliverables: studioItems.map(itemLine).join('\n'), items: studioItems,
  client_inputs: [{id: 'c_brief', title: 'Completed brand questionnaire', due: ''}],
  exclusions: 'Website design, social media templates, and print production.',
  fee: 1800, currency: 'USD', revisions: 2, due: '',
  notes: 'Feedback is consolidated into one list per round. Additional work needs a separate agreement.',
};
export const blank: Scope = {title: '', client: '', deliverables: '', items: [], client_inputs: [], exclusions: '', fee: 0, currency: 'USD', revisions: 2, due: '', notes: ''};

export function money(s: Pick<Scope, 'fee' | 'currency'>) { return formatMoney(s.fee, s.currency); }
export function label(status: string) {
  return ({pending: 'Awaiting review', approved: 'Approved', changes_requested: 'Changes requested', proposed: 'Awaiting client', declined: 'Declined', withdrawn: 'Withdrawn', superseded: 'Superseded'} as Record<string, string>)[status] || status;
}
