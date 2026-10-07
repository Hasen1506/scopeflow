// Vendored verbatim from Hasen1506/scopeflow at bda2652 (parent of e19fa63, i.e. before PR #3)
// for the differential tests in tests/differential. Not used by the application.
import {z} from 'zod';
import {dateString, itemSchema, itemsOf, formatMoney, type Item, type Scope} from './scope';

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
}).strict().refine(
  c => c.add_items.length || c.remove_item_ids.length || c.fee_delta || c.days_delta || c.revisions_delta,
  'A change order must change deliverables, fee, timeline or revision rounds.',
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
}).strict();
export const clientInputSchema = z.object({
  input_id: z.string().min(1).max(40),
  received: dateString.refine(Boolean, 'Enter the date it arrived'),
  shift: z.boolean().default(true),
  note: z.string().trim().max(2000).default(''),
}).strict();

export const payloadSchemas = {
  change_order: changeOrderSchema,
  settle: settleSchema,
  goodwill: goodwillSchema,
  revision_round: revisionRoundSchema,
  client_input: clientInputSchema,
} as const;
export type EntryKind = keyof typeof payloadSchemas;
export const entryKinds = Object.keys(payloadSchemas) as EntryKind[];
export type ChangeOrder = z.infer<typeof changeOrderSchema>;
export type Settle = z.infer<typeof settleSchema>;
export type Goodwill = z.infer<typeof goodwillSchema>;
export type RevisionRound = z.infer<typeof revisionRoundSchema>;
export type ClientInputReceived = z.infer<typeof clientInputSchema>;

/** A stored entry. `payload` is null when hidden from the client; `payload_hash` still commits to it. */
export type LedgerEntry = {
  seq: number; kind: EntryKind; baseline_version: number; actor: 'owner' | 'client'; created: string;
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
  let fee = baseline.fee, codays = 0, revisions = baseline.revisions, used = 0, shift = 0;
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
    } else if (e.kind === 'revision_round') {
      used++;
    } else if (e.kind === 'goodwill') {
      goodwill.push({...(e.payload as Goodwill), seq: e.seq, created: e.created});
    } else if (e.kind === 'client_input') {
      const c = e.payload as ClientInputReceived;
      const input = inputs.get(c.input_id);
      const due = input?.due ?? '';
      const late = due ? Math.max(0, daysBetween(due, c.received)) : 0;
      if (c.shift && late) shift += late;
      delays.push({seq: e.seq, input_id: c.input_id, title: input?.title ?? c.input_id, due, received: c.received, days_late: late, shifted: c.shift && late > 0});
    }
  }
  const days = codays + shift;
  return {
    baseline_version: baselineVersion, currency: baseline.currency,
    items, removed, fee_base: baseline.fee, fee: Math.round(fee * 100) / 100,
    due_base: baseline.due, due: addDays(baseline.due, days), days_shift: days,
    revisions_allowed: Math.max(0, revisions), revisions_used: used, rounds_over: Math.max(0, used - Math.max(0, revisions)),
    change_orders, pending: change_orders.filter(c => c.status === 'proposed').length,
    goodwill, goodwill_value: goodwill.reduce((s, g) => s + g.value, 0), goodwill_hours: goodwill.reduce((s, g) => s + g.hours, 0),
    delays,
  };
}

/** Validates a new entry against the current agreement. Returns an error message or null. */
export function checkEntry(kind: EntryKind, payload: unknown, baseline: Scope, agreement: Agreement, actor: 'owner' | 'client'): string | null {
  if (kind === 'change_order') {
    const co = payload as ChangeOrder;
    const current = new Set(agreement.items.map(i => i.id));
    const everUsed = new Set([...current, ...agreement.removed.map(i => i.id), ...agreement.change_orders.flatMap(c => c.add_items.map(i => i.id))]);
    const missing = co.remove_item_ids.filter(id => !current.has(id));
    if (missing.length) return `Unknown deliverable to remove: ${missing.join(', ')}. Read the current agreement first.`;
    const clash = co.add_items.filter(i => everUsed.has(i.id));
    if (clash.length) return `Deliverable id already used: ${clash.map(i => i.id).join(', ')}. Use new ids for added work.`;
    if (new Set(co.add_items.map(i => i.id)).size !== co.add_items.length) return 'Added deliverables need unique ids.';
    if (agreement.fee + co.fee_delta < 0) return 'The fee cannot go below zero.';
    if (agreement.revisions_allowed + co.revisions_delta < 0) return 'Revision rounds cannot go below zero.';
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
  return parts.join(' · ');
}
export function describeEntry(e: LedgerEntry, currency: string, items: Item[] = [], inputs: {id: string; title: string}[] = []): string {
  if (!e.payload) return e.kind === 'goodwill' ? 'Private note (hidden from client)' : 'Hidden entry';
  switch (e.kind) {
    case 'change_order': { const co = e.payload as ChangeOrder; return `Change order CO-${e.seq} proposed: ${co.title} (${coSummary(co, currency, items)})`; }
    case 'settle': { const s = e.payload as Settle; return `CO-${s.ref_seq} ${s.outcome}${s.signer ? ' by ' + s.signer : ''}${s.comment ? ': “' + s.comment + '”' : ''}`; }
    case 'goodwill': { const g = e.payload as Goodwill; return `Goodwill: ${g.title} (${formatMoney(g.value, currency)}${g.hours ? `, ${g.hours}h` : ''} not billed)`; }
    case 'revision_round': { const r = e.payload as RevisionRound; return `Revision round received ${r.feedback_date}${r.note ? ': ' + r.note : ''}`; }
    case 'client_input': { const c = e.payload as ClientInputReceived; return `Received from client: ${inputs.find(i => i.id === c.input_id)?.title ?? c.input_id} on ${c.received}`; }
  }
}
