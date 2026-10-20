import {z} from 'zod';
import {dateString, itemSchema, itemsOf, itemLine, formatMoney, type Item, type Scope} from './scope';
import {formatDay} from './time';
import {toMinor, fromMinor, exponentOf} from './minor';
import {pctOfMinor} from './ledger-math';
import {retainerState, type RetainerView} from './retainer';

/** UX-C20: what the Payment step shows. The quote copy ("fixed when your client approves") is only for a version that
 *  is not approved; an approved one waits for the ledger (loading) or says the ledger failed (error) instead. */
export type PaymentPanelState = 'quote' | 'loading' | 'error' | 'agreement';
export function paymentPanelState(input: {approved: boolean; loaded: boolean; agreement: boolean; error: string}): PaymentPanelState {
  if (!input.approved) return 'quote';
  if (input.agreement) return 'agreement';
  if (!input.loaded) return input.error ? 'error' : 'loading';
  return 'quote'; // the ledger answered but has no agreement for this version: show the signed quote figures
}

// ---------------------------------------------------------------------------
// Entry payloads. Every post-approval event is one immutable ledger entry.
// ---------------------------------------------------------------------------

export const changeOrderSchema = z.object({
  title: z.string().trim().min(3).max(160),
  reason: z.string().trim().max(2000).default(''),
  request_quote: z.string().trim().max(2000).default(''),
  add_items: z.array(itemSchema).max(20).default([]),
  remove_item_ids: z.array(z.string().min(1).max(40)).max(60).default([]),
  fee_delta: z.number().finite().min(-10000000).max(10000000).default(0),
  days_delta: z.number().int().min(-365).max(365).default(0),
  revisions_delta: z.number().int().min(-50).max(50).default(0),
  // Hours or money added to (or taken from) the revision bank. Optional, so older entries keep their exact payload.
  bank_delta: z.number().finite().min(-100000).max(100000).optional(),
  // WS-05 (LT-08): this change order replaces CO-<revises>, which was withdrawn in the same request.
  revises: z.number().int().min(1).optional(),
  // WS-05 (SF-05): proposed automatically for usage beyond a retainer quota.
  overage: z.object({period: z.string().regex(/^\d{4}-\d{2}$/), item_id: z.string().min(1).max(40), qty: z.number().finite().positive().max(100000), usage_seq: z.number().int().min(1)}).strict().optional(),
  // WS-05 (SF-06): priced from the account rate card (provenance only; fee_delta is what applies).
  rate_card: z.object({item_id: z.string().min(1).max(40), qty: z.number().finite().positive().max(100000), unit_price_minor: z.number().int().min(0), multipliers: z.array(z.string().min(1).max(40)).max(10).default([])}).strict().optional(),
}).strict().refine(
  c => c.add_items.length || c.remove_item_ids.length || c.fee_delta || c.days_delta || c.revisions_delta || c.bank_delta,
  'A change order must change deliverables, fee, timeline, revision rounds or the revision bank.',
);
export const settleSchema = z.object({
  ref_seq: z.number().int().min(1),
  outcome: z.enum(['approved', 'declined', 'withdrawn']),
  signer: z.string().trim().max(120).default(''),
  comment: z.string().trim().max(3000).default(''),
  // WS-05 (H17): content proof of the change order the client decided on. Optional, so settle
  // entries recorded before it keep their exact payload. `acknowledged` is present only when the
  // client page sent the acknowledgement and the hash itself (otherwise the server computed it).
  acknowledged: z.literal(true).optional(),
  co_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  total_incl_tax_minor: z.number().int().optional(),
}).strict();
export const goodwillSchema = z.object({
  title: z.string().trim().min(3).max(160),
  value: z.number().finite().min(0).max(10000000),
  hours: z.number().finite().min(0).max(10000).default(0),
  note: z.string().trim().max(2000).default(''),
  visible: z.boolean().default(true),
}).strict();
export const revisionRoundSchema = z.object({
  feedback_date: dateString.refine(Boolean, 'Enter the date feedback arrived'),
  note: z.string().trim().max(2000).default(''),
  // Hours (or money) the round drew from the revision bank, when the scope has one.
  used: z.number().finite().min(0).max(100000).optional(),
}).strict();
export const clientInputSchema = z.object({
  input_id: z.string().min(1).max(40),
  received: dateString.refine(Boolean, 'Enter the date it arrived'),
  shift: z.boolean().default(true),
  note: z.string().trim().max(2000).default(''),
}).strict();

// PR F: a deposit paid through the payment provider. Appended only by the verified webhook
// (never by an owner or client request), so it is evidence that the money arrived.
export const paymentProviders = ['razorpay', 'stripe'] as const;
export const PROVIDER_LABEL: Record<(typeof paymentProviders)[number], string> = {razorpay: 'Razorpay', stripe: 'Stripe'};
export const paymentSchema = z.object({
  provider: z.enum(paymentProviders),
  purpose: z.enum(['deposit', 'invoice']),
  order_id: z.string().min(1).max(255),
  payment_id: z.string().min(1).max(255),
  amount: z.number().finite().min(0),
  currency: z.string().regex(/^[A-Z]{3}$/),
  /** For purpose "invoice": the invoice the client paid online. */
  invoice_number: z.string().min(1).max(40).optional(),
  /** WS-05 (H6): the baseline the order was created on, when it is not the baseline the payment is recorded against. */
  order_baseline: z.number().int().min(1).optional(),
}).strict();

// A payment the creator received outside Scopeflow (bank transfer, UPI, cash…), recorded by the
// owner. It is the creator's own statement, shown to the client on the record, not provider evidence.
export const paymentMethods = ['bank_transfer', 'upi', 'card', 'cash', 'cheque', 'other'] as const;
export const PAYMENT_METHOD_LABEL: Record<(typeof paymentMethods)[number], string> = {bank_transfer: 'Bank transfer', upi: 'UPI', card: 'Card', cash: 'Cash', cheque: 'Cheque', other: 'Other'};
const PAYMENT_METHOD_PHRASE: Record<(typeof paymentMethods)[number], string> = {bank_transfer: 'by bank transfer', upi: 'by UPI', card: 'by card', cash: 'in cash', cheque: 'by cheque', other: 'by another method'};
export const paymentReceivedSchema = z.object({
  amount: z.number().finite().positive().max(100000000),
  method: z.enum(paymentMethods),
  received: dateString.refine(Boolean, 'Enter the date it arrived'),
  reference: z.string().trim().max(80).default(''),
  note: z.string().trim().max(500).default(''),
}).strict();

// Money returned to the client: recorded by the creator (a refund made outside Scopeflow), or issued
// through Razorpay or Stripe from the workspace (provider_refund_id is the provider's refund id).
// It lowers the amount paid; refund_of is the ledger entry of the payment it reverses, when known.
export const refundSchema = z.object({
  amount: z.number().finite().positive().max(100000000),
  method: z.enum([...paymentMethods, ...paymentProviders]),
  refunded: dateString.refine(Boolean, 'Enter the date of the refund'),
  reference: z.string().trim().max(80).default(''),
  note: z.string().trim().max(500).default(''),
  provider_refund_id: z.string().min(1).max(255).optional(),
  refund_of: z.number().int().min(1).optional(),
  /** WS-05 (H6): the baseline of the payment being refunded, when older than the current one. */
  order_baseline: z.number().int().min(1).optional(),
}).strict();

// ---------------------------------------------------------------------------
// WS-05: kinds enabled after Phase 0. Amounts are integer minor units of `currency`.
// ---------------------------------------------------------------------------
const minorAmount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const currencyCode = z.string().regex(/^[A-Z]{3}$/);
const periodKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a period like 2026-10');
/** C4/H6: a superseding approval carries the money already on the record forward (written by onBaselineApproved). */
export const baselineSupersededSchema = z.object({
  from: z.number().int().min(1),
  to: z.number().int().min(1),
  currency: currencyCode,
  received_minor: minorAmount,
  refunded_minor: minorAmount,
  paid_minor: z.number().int(),
  tds_minor: minorAmount,
  invoiced_minor: minorAmount,
  entries_before: z.number().int().min(0),
}).strict();
/** TDS the client deducted and deposited (WS-03 records it against an invoice). */
export const tdsCreditSchema = z.object({
  amount_minor: minorAmount.refine(n => n > 0, 'Enter the TDS amount'),
  currency: currencyCode,
  credited: dateString.refine(Boolean, 'Enter the date of the credit'),
  section: z.string().trim().max(60).default(''),
  certificate: z.string().trim().max(80).default(''),
  invoice_number: z.string().min(1).max(40).optional(),
  note: z.string().trim().max(500).default(''),
  order_baseline: z.number().int().min(1).optional(),
}).strict();
/** Money captured beyond what was owed (WS-04): recorded, never silently dropped. */
export const excessPaymentSchema = z.object({
  amount_minor: minorAmount.refine(n => n > 0, 'Enter the excess amount'),
  currency: currencyCode,
  reason: z.enum(['overpaid', 'superseded_order', 'duplicate']),
  provider: z.enum(paymentProviders).optional(),
  order_id: z.string().min(1).max(255).optional(),
  payment_id: z.string().min(1).max(255).optional(),
  note: z.string().trim().max(500).default(''),
  order_baseline: z.number().int().min(1).optional(),
}).strict();
/** Written or deemed acceptance of the delivered work (WS-03, MSMED). */
export const deliveryAcceptedSchema = z.object({
  accepted: dateString.refine(Boolean, 'Enter the date of acceptance'),
  deemed: z.boolean().default(false),
  item_ids: z.array(z.string().min(1).max(40)).max(80).default([]),
  evidence: z.string().trim().max(500).default(''),
  note: z.string().trim().max(1000).default(''),
}).strict();
/** The creator confirms a payment the client said they made (WS-04 UPI direct). */
export const paymentClaimConfirmedSchema = z.object({
  claim_id: z.string().min(1).max(80),
  amount_minor: minorAmount.refine(n => n > 0, 'Enter the amount'),
  currency: currencyCode,
  method: z.enum(paymentMethods),
  received: dateString.refine(Boolean, 'Enter the date it arrived'),
  reference: z.string().trim().max(80).default(''),
  note: z.string().trim().max(500).default(''),
}).strict();
/** SF-05: a retainer period starts, with the quotas it grants (carried = unused quota brought forward). */
export const periodOpenSchema = z.object({
  period: periodKey,
  starts: dateString.refine(Boolean),
  ends: dateString.refine(Boolean),
  quotas: z.array(z.object({item_id: z.string().min(1).max(40), qty: z.number().finite().min(0).max(100000), carried: z.number().finite().min(0).max(100000).default(0)}).strict()).max(60),
}).strict();
/** SF-05: n units of a quota item delivered in a period. */
export const usageSchema = z.object({
  period: periodKey,
  item_id: z.string().min(1).max(40),
  qty: z.number().finite().positive().max(100000),
  date: dateString.refine(Boolean, 'Enter the date'),
  note: z.string().trim().max(500).default(''),
}).strict();
/** SF-05: a retainer period closes; the lines are its statement. */
export const periodCloseSchema = z.object({
  period: periodKey,
  lines: z.array(z.object({item_id: z.string().min(1).max(40), quota: z.number().finite().min(0), carried: z.number().finite().min(0), used: z.number().finite().min(0), over: z.number().finite().min(0), carry_out: z.number().finite().min(0)}).strict()).max(60),
  overage_cos: z.array(z.number().int().min(1)).max(200).default([]),
}).strict();

export const payloadSchemas = {
  change_order: changeOrderSchema,
  settle: settleSchema,
  goodwill: goodwillSchema,
  revision_round: revisionRoundSchema,
  client_input: clientInputSchema,
  payment: paymentSchema,
  payment_received: paymentReceivedSchema,
  refund: refundSchema,
  // WS-05: the Phase 0 planned kinds, enabled.
  baseline_superseded: baselineSupersededSchema,
  tds_credit: tdsCreditSchema,
  excess_payment: excessPaymentSchema,
  delivery_accepted: deliveryAcceptedSchema,
  payment_claim_confirmed: paymentClaimConfirmedSchema,
  period_open: periodOpenSchema,
  usage: usageSchema,
  period_close: periodCloseSchema,
} as const;
/** Kinds the ledger accepts today. */
export type ActiveEntryKind = keyof typeof payloadSchemas;
/**
 * Phase 0: kinds reserved for later workstreams. They are part of EntryKind so code can name them,
 * but no payload schema exists yet and checkEntry() refuses them until the owner (WS-05, on request
 * of WS-03/WS-04) enables them by adding a payload schema.
 */
export const plannedEntryKinds = ['baseline_superseded', 'tds_credit', 'excess_payment', 'delivery_accepted', 'payment_claim_confirmed', 'period_open', 'usage', 'period_close'] as const;
export type PlannedEntryKind = (typeof plannedEntryKinds)[number];
export type EntryKind = ActiveEntryKind | PlannedEntryKind;
/** The enabled kinds (WS-05: every planned kind now has a payload schema). */
export const entryKinds = Object.keys(payloadSchemas) as ActiveEntryKind[];
/**
 * H6: kinds that record money. They are exempt from the plan's entry cap and are appended to the
 * current baseline even when the order or payment belongs to an older one (lib/ledger-hooks.ts).
 */
export const moneyEntryKinds = ['payment', 'payment_received', 'refund', 'tds_credit', 'excess_payment', 'payment_claim_confirmed', 'baseline_superseded'] as const satisfies readonly ActiveEntryKind[];
export function isMoneyKind(kind: string): boolean { return (moneyEntryKinds as readonly string[]).includes(kind); }
/** The plan cap applies only to entries the owner authors that do not record money. */
export function countsTowardCap(kind: string, actor: Actor): boolean { return actor === 'owner' && !isMoneyKind(kind); }
/** True when `kind` has a payload schema, i.e. can be appended. */
export function entryKindEnabled(kind: string): kind is ActiveEntryKind { return Object.hasOwn(payloadSchemas, kind); }
export type ChangeOrder = z.infer<typeof changeOrderSchema>;
export type Settle = z.infer<typeof settleSchema>;
export type Goodwill = z.infer<typeof goodwillSchema>;
export type RevisionRound = z.infer<typeof revisionRoundSchema>;
export type ClientInputReceived = z.infer<typeof clientInputSchema>;
export type Payment = z.infer<typeof paymentSchema>;
export type PaymentReceived = z.infer<typeof paymentReceivedSchema>;
export type Refund = z.infer<typeof refundSchema>;
export type BaselineSuperseded = z.infer<typeof baselineSupersededSchema>;
export type TdsCredit = z.infer<typeof tdsCreditSchema>;
export type ExcessPayment = z.infer<typeof excessPaymentSchema>;
export type DeliveryAccepted = z.infer<typeof deliveryAcceptedSchema>;
export type PaymentClaimConfirmed = z.infer<typeof paymentClaimConfirmedSchema>;
export type PeriodOpen = z.infer<typeof periodOpenSchema>;
export type Usage = z.infer<typeof usageSchema>;
export type PeriodClose = z.infer<typeof periodCloseSchema>;
const methodLabel = (m: Refund['method']) => m === 'razorpay' || m === 'stripe' ? PROVIDER_LABEL[m] : PAYMENT_METHOD_LABEL[m];

/** Who appended an entry: the creator, the client (review link), or Scopeflow itself for verified provider events (payments). */
export type Actor = 'owner' | 'client' | 'system';
/** A stored entry. `payload` is null when hidden from the client; `payload_hash` still commits to it. */
export type LedgerEntry = {
  seq: number; kind: EntryKind; baseline_version: number; actor: Actor; created: string;
  payload: unknown; payload_hash: string; prev_hash: string; hash: string;
};

// ---------------------------------------------------------------------------
// Hash chain. Isomorphic (Workers, browsers, Node) via WebCrypto.
// ---------------------------------------------------------------------------

export async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, '0')).join('');
}
/** The approved version every entry amends. Changing its content or decision changes every hash after it. */
export type Anchor = {project_id: string; version: number; content: Scope; signer: string | null; decided: string | null};
export function anchorHash(a: Anchor) {
  return sha256(['scopeflow-baseline-v1', a.project_id, a.version, JSON.stringify(a.content), a.signer ?? '', a.decided ?? ''].join('|'));
}
export function entryHash(e: Omit<LedgerEntry, 'hash' | 'payload'>, anchor: string) {
  return sha256(['scopeflow-entry-v1', e.prev_hash, e.seq, e.kind, e.baseline_version, anchor, e.actor, e.created, e.payload_hash].join('|'));
}
export const GENESIS = '0'.repeat(64);

/**
 * Recompute the chain. `anchors` maps baseline version → anchor hash. Hidden entries
 * are checked through their payload hash; visible ones must also match their payload.
 */
export async function verifyChain(entries: LedgerEntry[], anchors: Record<number, string>) {
  let prev = GENESIS;
  for (const [n, e] of entries.entries()) {
    if (e.seq !== n + 1 || e.prev_hash !== prev) return {intact: false as const, at: e.seq, reason: 'sequence or link broken'};
    if (e.payload !== null && await sha256(JSON.stringify(e.payload)) !== e.payload_hash) return {intact: false as const, at: e.seq, reason: 'content does not match its fingerprint'};
    const anchor = anchors[e.baseline_version];
    if (!anchor || await entryHash(e, anchor) !== e.hash) return {intact: false as const, at: e.seq, reason: 'fingerprint mismatch'};
    prev = e.hash;
  }
  return {intact: true as const, head: prev, count: entries.length};
}

// ---------------------------------------------------------------------------
// Folding entries into the current agreement.
// ---------------------------------------------------------------------------

export type CoStatus = 'proposed' | 'approved' | 'declined' | 'withdrawn';
export type AgreementItem = Item & {source: 'baseline' | number};
export type CoView = ChangeOrder & {seq: number; created: string; status: CoStatus; settled_by: string; settled_at: string | null; comment: string};
export type Agreement = {
  baseline_version: number; currency: string;
  items: AgreementItem[]; removed: AgreementItem[];
  fee_base: number; fee: number;
  due_base: string; due: string; days_shift: number;
  revisions_allowed: number; revisions_used: number; rounds_over: number;
  change_orders: CoView[]; pending: number;
  goodwill: (Goodwill & {seq: number; created: string})[]; goodwill_value: number; goodwill_hours: number;
  delays: {seq: number; input_id: string; title: string; due: string; received: string; days_late: number; shifted: boolean}[];
  /** Present only when the approved scope has a revision bank, so agreements without one are unchanged. */
  bank?: {unit: 'hours' | 'money'; allowed: number; used: number; left: number; over: number; overage_rate: number | null; overage_value: number};
  /** LT-14: the deliverables now in force (baseline plus approved change orders), one line each, in the scope's text form. */
  deliverables: string;
  /** SF-05: present only for retainer engagements. */
  retainer?: RetainerView;
};

export function addDays(date: string, days: number) {
  if (!date || !days) return date;
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
}

/** Entries must be those of one baseline, in sequence order. */
export function computeAgreement(baseline: Scope, baselineVersion: number, entries: LedgerEntry[]): Agreement {
  const settled = new Map<number, {e: LedgerEntry; s: Settle}>();
  for (const e of entries) if (e.kind === 'settle' && e.payload) settled.set((e.payload as Settle).ref_seq, {e, s: e.payload as Settle});

  let items: AgreementItem[] = itemsOf(baseline).map(i => ({...i, source: 'baseline'}));
  const removed: AgreementItem[] = [];
  let fee = baseline.fee, codays = 0, revisions = baseline.revisions, used = 0, shift = 0, bankAllowed = baseline.revision_bank?.amount ?? 0, bankUsed = 0;
  const change_orders: CoView[] = [], goodwill: Agreement['goodwill'] = [], delays: Agreement['delays'] = [];
  const inputs = new Map((baseline.client_inputs ?? []).map(i => [i.id, i]));

  for (const e of entries) {
    if (!e.payload) continue;
    if (e.kind === 'change_order') {
      const co = e.payload as ChangeOrder;
      const settle = settled.get(e.seq);
      const status: CoStatus = settle ? settle.s.outcome : 'proposed';
      change_orders.push({...co, seq: e.seq, created: e.created, status, settled_by: settle?.s.signer ?? '', settled_at: settle?.e.created ?? null, comment: settle?.s.comment ?? ''});
      if (status !== 'approved') continue;
      const drop = new Set(co.remove_item_ids);
      removed.push(...items.filter(i => drop.has(i.id)));
      items = [...items.filter(i => !drop.has(i.id)), ...co.add_items.map(i => ({...i, source: e.seq}))];
      fee += co.fee_delta;
      codays += co.days_delta;
      revisions += co.revisions_delta;
      bankAllowed += co.bank_delta ?? 0;
    } else if (e.kind === 'revision_round') {
      used++;
      bankUsed += (e.payload as RevisionRound).used ?? 0;
    } else if (e.kind === 'goodwill') {
      goodwill.push({...(e.payload as Goodwill), seq: e.seq, created: e.created});
    } else if (e.kind === 'client_input') {
      const c = e.payload as ClientInputReceived;
      const input = inputs.get(c.input_id);
      const due = input?.due ?? '';
      const late = due ? Math.max(0, daysBetween(due, c.received)) : 0;
      if (c.shift && late) shift += late;
      delays.push({seq: e.seq, input_id: c.input_id, title: input?.title ?? c.input_id, due, received: c.received, days_late: late, shifted: !!baseline.due && c.shift && late > 0});
    }
  }
  // SF-12: with no baseline due date there is nothing to move; never report a shift.
  const days = baseline.due ? codays + shift : 0;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const b = baseline.revision_bank;
  const over = b ? r2(Math.max(0, bankUsed - Math.max(0, bankAllowed))) : 0;
  const bank = b ? {
    unit: b.unit, allowed: r2(Math.max(0, bankAllowed)), used: r2(bankUsed), left: r2(Math.max(0, bankAllowed - bankUsed)), over,
    overage_rate: b.overage_rate ?? null, overage_value: b.unit === 'money' ? over : r2(over * (b.overage_rate ?? 0)),
  } : null;
  const agreement: Agreement = {
    baseline_version: baselineVersion, currency: baseline.currency,
    items, removed, fee_base: baseline.fee, fee: Math.round(fee * 100) / 100,
    due_base: baseline.due, due: addDays(baseline.due, days), days_shift: days,
    revisions_allowed: Math.max(0, revisions), revisions_used: used, rounds_over: Math.max(0, used - Math.max(0, revisions)),
    change_orders, pending: change_orders.filter(c => c.status === 'proposed').length,
    goodwill, goodwill_value: goodwill.reduce((s, g) => s + g.value, 0), goodwill_hours: goodwill.reduce((s, g) => s + g.hours, 0),
    delays,
    deliverables: items.map(i => itemLine(i) + (i.source === 'baseline' ? '' : ` [CO-${i.source}]`)).join('\n'),
  };
  if (bank) agreement.bank = bank;
  if (baseline.engagement === 'retainer' && baseline.retainer) agreement.retainer = retainerState(baseline, entries, change_orders);
  return agreement;
}

// ---------------------------------------------------------------------------
// H17: the change order as the client sees it, canonicalised and hashed. The client page computes
// the same hash (WebCrypto) from the view it rendered and sends it with the decision; the server
// recomputes it from the ledger and refuses a mismatch (409 co_changed).
// ---------------------------------------------------------------------------

export {pctOfMinor};
export type CoTotals = {currency: string; fee_delta_minor: number; tax: {label: string; pct: number; amount_minor: number}; total_incl_tax_minor: number};
/** M7/H17: what a change order adds, with the scope's tax on it, in minor units. */
export function coTotals(co: Pick<ChangeOrder, 'fee_delta'>, scope: Pick<Scope, 'currency' | 'tax_pct' | 'tax_label'>): CoTotals {
  const fee = toMinor(co.fee_delta, scope.currency);
  const pct = scope.tax_pct ?? 0;
  const tax = pct ? pctOfMinor(fee, pct) : 0;
  return {currency: scope.currency, fee_delta_minor: fee, tax: {label: scope.tax_label || 'Tax', pct, amount_minor: tax}, total_incl_tax_minor: fee + tax};
}
/** The canonical, rendered form of CO-`seq`: title, deliverables, fee delta, tax, total incl. tax, timeline and rounds. */
export function coCanonical(co: ChangeOrder & {seq: number}, scope: Pick<Scope, 'currency' | 'tax_pct' | 'tax_label'>) {
  const t = coTotals(co, scope);
  return {
    v: 1, seq: co.seq, title: co.title,
    add_items: co.add_items.map(i => ({id: i.id, title: i.title, qty: i.qty, unit: i.unit, acceptance: i.acceptance})),
    remove_item_ids: co.remove_item_ids,
    currency: t.currency, fee_delta_minor: t.fee_delta_minor, tax: t.tax, total_incl_tax_minor: t.total_incl_tax_minor,
    days_delta: co.days_delta, revisions_delta: co.revisions_delta, bank_delta: co.bank_delta ?? 0,
  };
}
export function coSha256(co: ChangeOrder & {seq: number}, scope: Pick<Scope, 'currency' | 'tax_pct' | 'tax_label'>) {
  return sha256('scopeflow-co-v1|' + JSON.stringify(coCanonical(co, scope)));
}
/** Decimal form of a minor amount (for display next to legacy decimal fields). */
export function minorToDecimal(minor: number, currency: string) { return fromMinor(minor, currency); }

/**
 * Money received against one baseline: online payments (Razorpay or Stripe, provider evidence),
 * payments the creator recorded, and refunds (negative amounts). `paid` is the net amount.
 */
export type PaymentLine = {seq: number; created: string; source: 'razorpay' | 'stripe' | 'owner' | 'refund'; amount: number; method: string; received: string; reference: string; note: string; provider_refund_id?: string; refund_of?: number};
export function paymentsOf(entries: LedgerEntry[]): {lines: PaymentLine[]; paid: number} {
  const lines: PaymentLine[] = [];
  for (const e of entries) {
    if (!e.payload) continue;
    if (e.kind === 'payment') { const p = e.payload as Payment; lines.push({seq: e.seq, created: e.created, source: p.provider, amount: Number(p.amount) || 0, method: PROVIDER_LABEL[p.provider] ?? p.provider, received: e.created.slice(0, 10), reference: p.payment_id, note: p.purpose === 'invoice' ? `Invoice ${p.invoice_number ?? ''}`.trim() : 'Deposit'}); }
    else if (e.kind === 'refund') { const r = e.payload as Refund; lines.push({seq: e.seq, created: e.created, source: 'refund', amount: -r.amount, method: `Refund · ${methodLabel(r.method)}`, received: r.refunded, reference: r.reference || (r.provider_refund_id ?? ''), note: r.note, ...(r.provider_refund_id ? {provider_refund_id: r.provider_refund_id} : {}), ...(r.refund_of ? {refund_of: r.refund_of} : {})}); }
    else if (e.kind === 'payment_received') { const p = e.payload as PaymentReceived; lines.push({seq: e.seq, created: e.created, source: 'owner', amount: p.amount, method: PAYMENT_METHOD_LABEL[p.method], received: p.received, reference: p.reference, note: p.note}); }
  }
  return {lines, paid: Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100};
}
/** How much of an online payment can still be refunded (its amount less refunds that name it). */
export function refundableOf(line: PaymentLine, lines: PaymentLine[]) {
  if (line.source !== 'razorpay' && line.source !== 'stripe') return 0;
  return Math.max(0, Math.round((line.amount + lines.filter(l => l.source === 'refund' && l.refund_of === line.seq).reduce((s, l) => s + l.amount, 0)) * 100) / 100);
}

/**
 * M8: what the server knows about "now" for date checks. `today` is the calendar date in the
 * project's time zone; `approved_on` the date (same zone) the baseline was approved. Omitted by
 * pure callers that only fold, in which case dates are not bounded.
 */
export type EntryContext = {today?: string; approved_on?: string};
function dateBounds(date: string, ctx: EntryContext, what: string): string | null {
  if (ctx.today && date > addDays(ctx.today, 1)) return `The date ${what} cannot be in the future.`;
  if (ctx.approved_on && date < ctx.approved_on) return `The date ${what} cannot be before the scope was approved (${ctx.approved_on}).`;
  return null;
}

/**
 * M5 (WS-01) for change orders: a fee change and the prices of added deliverables carry at most the
 * agreement currency's decimals (INR/USD 2, JPY 0). Mirrors WS-01's changeOrderMoneyProblems in
 * lib/scope.ts; once WS-01 lands this delegates to it (change request in the WS-05 PR).
 * Returns [path, message] pairs.
 */
export function changeOrderMoneyProblems(co: {fee_delta?: number; add_items?: {price?: number | null; unit_price?: number}[]}, currency: string): [(string | number)[], string][] {
  const e = exponentOf(currency);
  const out: [(string | number)[], string][] = [];
  const check = (path: (string | number)[], v: number | null | undefined) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return;
    const scaled = Math.abs(v) * 10 ** e;
    if (Math.abs(scaled - Math.round(scaled)) > 1e-6 * Math.max(1, scaled)) out.push([path, e === 0 ? `Use whole amounts: ${currency} has no decimals` : `Use at most ${e} decimals`]);
  };
  check(['fee_delta'], co.fee_delta);
  co.add_items?.forEach((i, n) => { check(['add_items', n, 'price'], i.price); check(['add_items', n, 'unit_price'], i.unit_price); });
  return out;
}
const CO_FIELD: Record<string, string> = {fee_delta: 'Fee change', price: 'price', unit_price: 'price each'};
function coFieldLabel(path: (string | number)[]) {
  return path.map(p => typeof p === 'number' ? String(p + 1) : p === 'add_items' ? 'Added deliverable' : CO_FIELD[p] ?? p).join(' ');
}

/** A decimal amount with more decimals than the agreement currency has (INR/USD 2, JPY 0), or null. */
function decimalsProblem(amount: number, currency: string): string | null {
  const e = exponentOf(currency), scaled = amount * 10 ** e;
  if (Math.abs(scaled - Math.round(scaled)) <= 1e-6 * Math.max(1, Math.abs(scaled))) return null;
  return e === 0 ? `Enter a whole amount: ${currency} has no decimals.` : e === 2 ? 'Enter the amount with at most two decimals.' : `Enter the amount with at most ${e} decimals.`;
}

/** Validates a new entry against the current agreement. Returns an error message or null. */
export function checkEntry(kind: EntryKind, payload: unknown, baseline: Scope, agreement: Agreement, actor: Actor, ctx: EntryContext = {}): string | null {
  if (!entryKindEnabled(kind)) return 'This kind of entry is not enabled yet.';
  if (kind === 'change_order') {
    const co = payload as ChangeOrder;
    const money = changeOrderMoneyProblems(co, baseline.currency);
    if (money.length) return money.map(([path, message]) => `${coFieldLabel(path)}: ${message}`).join('; ');
    if (co.revises !== undefined && !agreement.change_orders.some(c => c.seq === co.revises)) return `CO-${co.revises} does not exist, so it cannot be revised.`;
    const current = new Set(agreement.items.map(i => i.id));
    const everUsed = new Set([...current, ...agreement.removed.map(i => i.id), ...agreement.change_orders.flatMap(c => c.add_items.map(i => i.id))]);
    const missing = co.remove_item_ids.filter(id => !current.has(id));
    if (missing.length) return `Unknown deliverable to remove: ${missing.join(', ')}. Read the current agreement first.`;
    const clash = co.add_items.filter(i => everUsed.has(i.id));
    if (clash.length) return `Deliverable id already used: ${clash.map(i => i.id).join(', ')}. Use new ids for added work.`;
    if (new Set(co.add_items.map(i => i.id)).size !== co.add_items.length) return 'Added deliverables need unique ids.';
    if (co.days_delta && !baseline.due) return 'The approved scope has no delivery date, so a timeline change cannot apply. Set days_delta to 0, or revise the scope with a delivery date first.';
    if (agreement.fee + co.fee_delta < 0) return 'The fee cannot go below zero.';
    if (agreement.revisions_allowed + co.revisions_delta < 0) return 'Revision rounds cannot go below zero.';
    if (co.bank_delta && !agreement.bank) return 'The approved scope has no revision bank, so bank_delta cannot apply.';
    if (co.bank_delta && agreement.bank && agreement.bank.allowed + co.bank_delta < 0) return 'The revision bank cannot go below zero.';
    return null;
  }
  if (kind === 'settle') {
    const s = payload as Settle;
    const co = agreement.change_orders.find(c => c.seq === s.ref_seq);
    if (!co) return 'Change order not found.';
    if (co.status !== 'proposed') return 'This change order has already been settled.';
    if (actor === 'owner' && s.outcome !== 'withdrawn') return 'Only the client can approve or decline a change order.';
    if (actor === 'client' && s.outcome === 'withdrawn') return 'Only the creator can withdraw a change order.';
    if (actor === 'client' && s.signer.length < 2) return 'Enter your name to record this decision.';
    if (actor === 'client' && s.outcome === 'declined' && !s.comment) return 'Please say why, so the creator can follow up.';
    if (actor === 'client' && s.outcome === 'approved') {
      const check = checkEntry('change_order', co, baseline, {...agreement, change_orders: agreement.change_orders.filter(c => c.seq !== co.seq)}, 'owner');
      if (check) return 'This change order no longer applies to the current agreement. Ask the creator for an updated one.';
    }
    return null;
  }
  if (kind === 'refund') {
    const r = payload as Refund;
    const decimals = decimalsProblem(r.amount, baseline.currency);
    if (decimals) return decimals;
    if (r.refunded > addDays(ctx.today ?? new Date().toISOString().slice(0, 10), 1)) return 'The date of a refund cannot be in the future.';
    if (actor === 'client') return 'Only the creator records refunds.';
    return null;
  }
  if (kind === 'payment_received') {
    const p = payload as PaymentReceived;
    const decimals = decimalsProblem(p.amount, baseline.currency);
    if (decimals) return decimals;
    // One day of slack: the creator's local date can run ahead of UTC (or of the project's zone).
    if (p.received > addDays(ctx.today ?? new Date().toISOString().slice(0, 10), 1)) return 'The date a payment arrived cannot be in the future.';
    return null;
  }
  if (kind === 'revision_round') {
    const r = payload as RevisionRound;
    const bound = dateBounds(r.feedback_date, ctx, 'feedback arrived');
    if (bound) return bound;
    if (agreement.bank && r.used === undefined) return `Enter how many ${agreement.bank.unit === 'hours' ? 'hours this round took' : 'of the revision budget this round used'}.`;
    if (!agreement.bank && r.used !== undefined) return 'The approved scope has no revision bank; leave out the hours used.';
    return null;
  }
  if (kind === 'client_input') {
    const c = payload as ClientInputReceived;
    if (!(baseline.client_inputs ?? []).some(i => i.id === c.input_id)) return 'Unknown client input. Use one listed in the approved scope.';
    if (agreement.delays.some(d => d.input_id === c.input_id)) return 'This input has already been recorded as received.';
    return dateBounds(c.received, ctx, 'it arrived');
  }
  if (kind === 'baseline_superseded') {
    if (actor !== 'system') return 'Only Scopeflow records a superseded baseline.';
    const b = payload as BaselineSuperseded;
    if (b.from >= b.to) return 'A baseline can only be superseded by a later version.';
    return null;
  }
  if (kind === 'excess_payment') return actor === 'system' ? null : 'Only Scopeflow records an excess payment from the provider.';
  if (kind === 'tds_credit') {
    if (actor === 'client') return 'Only the creator records TDS credits.';
    const t = payload as TdsCredit;
    if (t.currency !== baseline.currency) return `Record TDS in ${baseline.currency}, the currency of the agreement.`;
    return dateBounds(t.credited, ctx, 'of the credit');
  }
  if (kind === 'payment_claim_confirmed') {
    if (actor !== 'owner') return 'Only the creator confirms a payment claim.';
    const p = payload as PaymentClaimConfirmed;
    if (p.currency !== baseline.currency) return `Record the payment in ${baseline.currency}, the currency of the agreement.`;
    return dateBounds(p.received, ctx, 'a payment arrived');
  }
  if (kind === 'delivery_accepted') {
    const d = payload as DeliveryAccepted;
    if (d.deemed && actor !== 'system') return 'Deemed acceptance is recorded by Scopeflow only.';
    const unknown = d.item_ids.filter(id => !agreement.items.some(i => i.id === id));
    if (unknown.length) return `Unknown deliverable: ${unknown.join(', ')}.`;
    return dateBounds(d.accepted, ctx, 'of acceptance');
  }
  if (kind === 'period_open' || kind === 'usage' || kind === 'period_close') {
    if (actor === 'client') return 'Only the creator records retainer periods and usage.';
    const r = agreement.retainer;
    if (!r || baseline.engagement !== 'retainer' || !baseline.retainer) return 'This agreement is not a retainer.';
    const quotaIds = new Set(baseline.retainer.quotas.map(q => q.item_id));
    if (kind === 'period_open') {
      const p = payload as PeriodOpen;
      if (r.periods.some(x => x.period === p.period)) return `Period ${p.period} is already open.`;
      if (r.periods.some(x => x.period > p.period)) return 'A later period is already open.';
      if (p.ends < p.starts) return 'A period cannot end before it starts.';
      if (p.quotas.some(q => !quotaIds.has(q.item_id))) return 'A quota names an item that is not in the retainer.';
      return null;
    }
    const period = r.periods.find(x => x.period === (payload as Usage | PeriodClose).period);
    if (!period) return `Period ${(payload as Usage).period} is not open.`;
    if (period.closed_seq) return `Period ${period.period} is closed.`;
    if (kind === 'usage') {
      const u = payload as Usage;
      if (!quotaIds.has(u.item_id)) return 'This item has no quota in the retainer.';
      if (u.date < period.starts || u.date > period.ends) return `The date must fall within ${period.period} (${period.starts} to ${period.ends}).`;
      return dateBounds(u.date, ctx, 'of the work');
    }
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Presentation helpers shared by the workspace, review page and MCP.
// ---------------------------------------------------------------------------

function signed(n: number, unit: string) { return (n > 0 ? '+' : '') + n + ' ' + unit + (Math.abs(n) === 1 ? '' : 's'); }
export function coSummary(co: ChangeOrder, currency: string, items: Item[] = []) {
  const parts: string[] = [];
  for (const i of co.add_items) parts.push(`add ${i.title}${i.qty > 1 || i.unit ? ` ×${i.qty}${i.unit ? ' ' + i.unit : ''}` : ''}`);
  for (const id of co.remove_item_ids) parts.push(`remove ${items.find(i => i.id === id)?.title ?? id}`);
  if (co.fee_delta) parts.push(`${co.fee_delta > 0 ? '+' : '−'}${formatMoney(Math.abs(co.fee_delta), currency)}`);
  if (co.days_delta) parts.push(signed(co.days_delta, 'day'));
  if (co.revisions_delta) parts.push(signed(co.revisions_delta, 'revision round'));
  if (co.bank_delta) parts.push(`${co.bank_delta > 0 ? '+' : '−'}${Math.abs(co.bank_delta)} revision bank`);
  return parts.join(' · ');
}
export function describeEntry(e: LedgerEntry, currency: string, items: Item[] = [], inputs: {id: string; title: string}[] = []): string {
  if (!e.payload) return e.kind === 'goodwill' ? 'Private note (hidden from client)' : 'Hidden entry';
  switch (e.kind) {
    case 'change_order': { const co = e.payload as ChangeOrder; return `Change order CO-${e.seq} proposed: ${co.title} (${coSummary(co, currency, items)})${co.revises ? ` · revises CO-${co.revises}` : ''}`; }
    case 'settle': { const s = e.payload as Settle; return `CO-${s.ref_seq} ${s.outcome}${s.signer ? ' by ' + s.signer : ''}${s.comment ? ': “' + s.comment + '”' : ''}${s.co_sha256 ? ` · content ${s.co_sha256.slice(0, 12)}` : ''}`; }
    case 'goodwill': { const g = e.payload as Goodwill; return `Goodwill: ${g.title} (${formatMoney(g.value, currency)}${g.hours ? `, ${g.hours}h` : ''} not billed)`; }
    case 'revision_round': { const r = e.payload as RevisionRound; return `Revision round received ${formatDay(r.feedback_date)}${r.used !== undefined ? ` (${r.used} used from the revision bank)` : ''}${r.note ? ': ' + r.note : ''}`; }
    case 'payment': { const p = e.payload as Payment; return `${p.purpose === 'invoice' ? `Payment for invoice ${p.invoice_number ?? ''}`.trim() : 'Deposit'} received: ${formatMoney(p.amount, p.currency)} via ${PROVIDER_LABEL[p.provider] ?? p.provider} (payment ${p.payment_id})`; }
    case 'refund': { const r = e.payload as Refund; return `Refund: ${formatMoney(r.amount, currency)} returned ${r.method === 'razorpay' || r.method === 'stripe' ? `through ${PROVIDER_LABEL[r.method]}` : PAYMENT_METHOD_PHRASE[r.method]} on ${formatDay(r.refunded)}${r.reference ? ` (ref. ${r.reference})` : ''}${r.note ? ': ' + r.note : ''}`; }
    case 'payment_received': { const p = e.payload as PaymentReceived; return `Payment received: ${formatMoney(p.amount, currency)} ${PAYMENT_METHOD_PHRASE[p.method]} on ${formatDay(p.received)}${p.reference ? ` (ref. ${p.reference})` : ''}`; }
    case 'client_input': { const c = e.payload as ClientInputReceived; return `Received from client: ${inputs.find(i => i.id === c.input_id)?.title ?? c.input_id} on ${formatDay(c.received)}`; }
    case 'baseline_superseded': { const b = e.payload as BaselineSuperseded; return `Version ${b.to} replaced version ${b.from}: ${formatMoney(fromMinor(b.paid_minor, b.currency), b.currency)} paid${b.tds_minor ? ` and ${formatMoney(fromMinor(b.tds_minor, b.currency), b.currency)} TDS` : ''} carried forward`; }
    case 'tds_credit': { const t = e.payload as TdsCredit; return `TDS credited: ${formatMoney(fromMinor(t.amount_minor, t.currency), t.currency)} on ${formatDay(t.credited)}${t.section ? ` (${t.section})` : ''}${t.invoice_number ? ` for invoice ${t.invoice_number}` : ''}`; }
    case 'excess_payment': { const x = e.payload as ExcessPayment; return `Excess payment recorded: ${formatMoney(fromMinor(x.amount_minor, x.currency), x.currency)} (${x.reason.replaceAll('_', ' ')})${x.payment_id ? ` · payment ${x.payment_id}` : ''}`; }
    case 'delivery_accepted': { const d = e.payload as DeliveryAccepted; return `${d.deemed ? 'Delivery deemed accepted' : 'Delivery accepted'} on ${formatDay(d.accepted)}${d.item_ids.length ? `: ${d.item_ids.map(id => items.find(i => i.id === id)?.title ?? id).join(', ')}` : ''}`; }
    case 'payment_claim_confirmed': { const p = e.payload as PaymentClaimConfirmed; return `Payment confirmed: ${formatMoney(fromMinor(p.amount_minor, p.currency), p.currency)} ${PAYMENT_METHOD_PHRASE[p.method]} on ${formatDay(p.received)}${p.reference ? ` (ref. ${p.reference})` : ''}`; }
    case 'period_open': { const p = e.payload as PeriodOpen; return `Retainer period ${p.period} opened (${formatDay(p.starts)} to ${formatDay(p.ends)})`; }
    case 'usage': { const u = e.payload as Usage; return `Used ${u.qty} × ${items.find(i => i.id === u.item_id)?.title ?? u.item_id} in ${u.period}${u.note ? ': ' + u.note : ''}`; }
    case 'period_close': { const p = e.payload as PeriodClose; const over = p.lines.reduce((s, l) => s + l.over, 0); return `Retainer period ${p.period} closed${over ? ` · ${over} over quota` : ''}${p.overage_cos.length ? ` · overage CO-${p.overage_cos.join(', CO-')}` : ''}`; }
    default: return 'Ledger entry: ' + String(e.kind).replaceAll('_', ' ');
  }
}
