import { z } from 'zod';

export const currencies = ['USD', 'INR', 'GBP', 'EUR'] as const;
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
}).strict();
export type Item = z.infer<typeof itemSchema>;

// Something the client must provide for the work to proceed (copy, access, feedback).
export const clientInputSchema = z.object({
  id: stableId,
  title: z.string().trim().min(2).max(200),
  due: dateString.default(''),
}).strict();
export type ClientInput = z.infer<typeof clientInputSchema>;

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
  // PR F: deposit due on signature, % of the fee. Optional and omitted when unset, so content signed
  // before it existed keeps its exact canonical form (and hash).
  deposit_pct: z.number().finite().min(0).max(100).optional(),
}).strict().superRefine((s, ctx) => {
  if (!s.items?.length && s.deliverables.length < 5) ctx.addIssue({code: 'custom', path: ['deliverables'], message: 'Add at least one deliverable'});
  const unique = (list: {id: string}[] | undefined, path: string) => {
    if (list && new Set(list.map(x => x.id)).size !== list.length) ctx.addIssue({code: 'custom', path: [path], message: 'Ids must be unique'});
  };
  unique(s.items, 'items');
  unique(s.client_inputs, 'client_inputs');
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

export function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', {style: 'currency', currency, maximumFractionDigits: 2}).format(amount);
}
export function money(s: Pick<Scope, 'fee' | 'currency'>) { return formatMoney(s.fee, s.currency); }
export function label(status: string) {
  return ({pending: 'Awaiting review', approved: 'Approved', changes_requested: 'Changes requested', proposed: 'Awaiting client', declined: 'Declined', withdrawn: 'Withdrawn', superseded: 'Superseded'} as Record<string, string>)[status] || status;
}
