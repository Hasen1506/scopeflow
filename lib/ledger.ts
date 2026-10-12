import {z} from 'zod';
import {dateString, itemSchema, itemsOf, formatMoney, type Item, type Scope} from './scope';
import {formatDay} from './time';

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
}).strict().refine(
  c => c.add_items.length || c.remove_item_ids.length || c.fee_delta || c.days_delta || c.revisions_delta || c.bank_delta,
  'A change order must change deliverables, fee, timeline, revision rounds or the revision bank.',
);
export const settleSchema = z.object({
  ref_seq: z.number().int().min(1),
  outcome: z.enum(['approved', 'declined', 'withdrawn']),
  signer: z.string().trim().max(120).default(''),
  comment: z.string().trim().max(3000).default(''),
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
/** The enabled kinds (unchanged by Phase 0). */
export const entryKinds = Object.keys(payloadSchemas) as ActiveEntryKind[];
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
  };
  if (bank) agreement.bank = bank;
  return agreement;
}

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

/** Validates a new entry against the current agreement. Returns an error message or null. */
export function checkEntry(kind: EntryKind, payload: unknown, baseline: Scope, agreement: Agreement, actor: Actor): string | null {
  if (!entryKindEnabled(kind)) return 'This kind of entry is not enabled yet.';
  if (kind === 'change_order') {
    const co = payload as ChangeOrder;
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
    if (Math.abs(r.amount * 100 - Math.round(r.amount * 100)) > 1e-6) return 'Enter the amount with at most two decimals.';
    if (r.refunded > addDays(new Date().toISOString().slice(0, 10), 1)) return 'The date of a refund cannot be in the future.';
    if (actor === 'client') return 'Only the creator records refunds.';
    return null;
  }
  if (kind === 'payment_received') {
    const p = payload as PaymentReceived;
    if (Math.abs(p.amount * 100 - Math.round(p.amount * 100)) > 1e-6) return 'Enter the amount with at most two decimals.';
    // One day of slack: the creator's local date can run ahead of UTC.
    if (p.received > addDays(new Date().toISOString().slice(0, 10), 1)) return 'The date a payment arrived cannot be in the future.';
    return null;
  }
  if (kind === 'revision_round') {
    const r = payload as RevisionRound;
    if (agreement.bank && r.used === undefined) return `Enter how many ${agreement.bank.unit === 'hours' ? 'hours this round took' : 'of the revision budget this round used'}.`;
    if (!agreement.bank && r.used !== undefined) return 'The approved scope has no revision bank; leave out the hours used.';
    return null;
  }
  if (kind === 'client_input') {
    const c = payload as ClientInputReceived;
    if (!(baseline.client_inputs ?? []).some(i => i.id === c.input_id)) return 'Unknown client input. Use one listed in the approved scope.';
    if (agreement.delays.some(d => d.input_id === c.input_id)) return 'This input has already been recorded as received.';
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
    case 'change_order': { const co = e.payload as ChangeOrder; return `Change order CO-${e.seq} proposed: ${co.title} (${coSummary(co, currency, items)})`; }
    case 'settle': { const s = e.payload as Settle; return `CO-${s.ref_seq} ${s.outcome}${s.signer ? ' by ' + s.signer : ''}${s.comment ? ': “' + s.comment + '”' : ''}`; }
    case 'goodwill': { const g = e.payload as Goodwill; return `Goodwill: ${g.title} (${formatMoney(g.value, currency)}${g.hours ? `, ${g.hours}h` : ''} not billed)`; }
    case 'revision_round': { const r = e.payload as RevisionRound; return `Revision round received ${formatDay(r.feedback_date)}${r.used !== undefined ? ` (${r.used} used from the revision bank)` : ''}${r.note ? ': ' + r.note : ''}`; }
    case 'payment': { const p = e.payload as Payment; return `${p.purpose === 'invoice' ? `Payment for invoice ${p.invoice_number ?? ''}`.trim() : 'Deposit'} received: ${formatMoney(p.amount, p.currency)} via ${PROVIDER_LABEL[p.provider] ?? p.provider} (payment ${p.payment_id})`; }
    case 'refund': { const r = e.payload as Refund; return `Refund: ${formatMoney(r.amount, currency)} returned ${r.method === 'razorpay' || r.method === 'stripe' ? `through ${PROVIDER_LABEL[r.method]}` : PAYMENT_METHOD_PHRASE[r.method]} on ${formatDay(r.refunded)}${r.reference ? ` (ref. ${r.reference})` : ''}${r.note ? ': ' + r.note : ''}`; }
    case 'payment_received': { const p = e.payload as PaymentReceived; return `Payment received: ${formatMoney(p.amount, currency)} ${PAYMENT_METHOD_PHRASE[p.method]} on ${formatDay(p.received)}${p.reference ? ` (ref. ${p.reference})` : ''}`; }
    case 'client_input': { const c = e.payload as ClientInputReceived; return `Received from client: ${inputs.find(i => i.id === c.input_id)?.title ?? c.input_id} on ${formatDay(c.received)}`; }
    // Phase 0: planned kinds are never stored yet; their owners replace this generic line.
    default: return 'Ledger entry: ' + e.kind.replaceAll('_', ' ');
  }
}
