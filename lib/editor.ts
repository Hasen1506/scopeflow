// Pure helpers for the scope editor (unit-tested in tests/unit.mjs).
import type {Item, Scope} from './scope';
import {exactUnitPrice, itemsTotal, lineTotal} from './money';

/** Number inputs: keep NaN (empty field) as-is, otherwise clamp into [min, max]. */
export function clampNumber(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return value;
  return Math.min(max, Math.max(min, value));
}

/** Deliverable quantity typed into the Qty field (UX-C37): a whole number in [1, 10000], or null while the field
 *  is empty or not a number, so the editor can let the user clear it and type a new value without it snapping to 1. */
export const QTY_MAX = 10000;
export function parseQty(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(QTY_MAX, Math.max(1, Math.round(n)));
}

/** Inline validation messages for the fee and revision rounds (BUG-1, BUG-2). */
export function numberProblems(draft: Pick<Scope, 'fee' | 'revisions'>) {
  const problems: {fee?: string; revisions?: string} = {};
  if (!Number.isFinite(draft.fee)) problems.fee = 'Enter a fee of 0 or more.';
  else if (draft.fee < 0) problems.fee = 'The fee cannot be negative.';
  if (!Number.isFinite(draft.revisions)) problems.revisions = 'Enter 0 or more revision rounds.';
  else if (draft.revisions < 0 || !Number.isInteger(draft.revisions)) problems.revisions = 'Use a whole number of 0 or more.';
  return problems;
}

/** Why the primary save button is disabled, shown next to it (BUG-13). Null when it is enabled. */
export function saveBlockReason(state: {busy: boolean; signedIn: boolean; loading?: boolean; editingSaved: boolean; changed: boolean}) {
  if (state.busy) return null;
  if (state.loading) return 'Checking your sign-in…';
  if (!state.signedIn) return 'Sign in to save this scope and create its review link. Your draft is kept in this tab until you do.';
  if (state.editingSaved && !state.changed) return 'No changes yet. Edit the scope to save a new version.';
  return null;
}

// Unsaved drafts survive reloads, cold starts and accidental resets (BUG-14). Every draft belongs to one
// account: a signed-in owner's draft is kept in localStorage under that account's key, a signed-out
// visitor's only in sessionStorage (this tab), and signing out removes both. Version 1 drafts carried no
// owner, so a draft typed by one account was restored for the next account that signed in on the same
// browser; they are never restored.
export {DRAFT_PREFIX, LEGACY_DRAFT_KEY, draftKey, clearDrafts, forgetDrafts} from './draft-storage';
import {DRAFT_PREFIX} from './draft-storage';
const MAX_AGE = 14 * 86400_000;
export function serializeDraft(draft: Scope, now = Date.now(), account: string | null = null) {
  return JSON.stringify({v: 2, account, saved_at: now, draft});
}
const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const validItem = (x: unknown) => isRecord(x) && typeof x.id === 'string' && typeof x.title === 'string';
const validInput = (x: unknown) => isRecord(x) && typeof x.id === 'string' && typeof x.title === 'string';
function normalizeItem(i: Record<string, unknown>) {
  return {id: i.id as string, title: i.title as string, qty: typeof i.qty === 'number' && Number.isFinite(i.qty) ? i.qty : 1, unit: typeof i.unit === 'string' ? i.unit : '', price: typeof i.price === 'number' && Number.isFinite(i.price) ? i.price : null, ...(typeof i.unit_price === 'number' && Number.isFinite(i.unit_price) ? {unit_price: i.unit_price} : {}), acceptance: typeof i.acceptance === 'string' ? i.acceptance : ''};
}
/** A draft as the editor can render it, or null when it is not a scope draft. Malformed list rows are
 *  dropped instead of crashing the editor (drafts from older builds, edited by hand, or sent to the API). */
export function normalizeDraft(d: unknown): Scope | null {
  if (!isRecord(d) || typeof d.title !== 'string' || typeof d.client !== 'string' || typeof d.deliverables !== 'string' || typeof d.exclusions !== 'string' || typeof d.notes !== 'string' || typeof d.due !== 'string' || typeof d.currency !== 'string') return null;
  return {
    ...d,
    fee: typeof d.fee === 'number' && Number.isFinite(d.fee) ? d.fee : 0,
    revisions: typeof d.revisions === 'number' && Number.isFinite(d.revisions) ? d.revisions : 0,
    items: Array.isArray(d.items) ? d.items.filter(validItem).map(normalizeItem) : [],
    client_inputs: Array.isArray(d.client_inputs) ? d.client_inputs.filter(validInput).map((c: {id: string; title: string; due?: unknown}) => ({id: c.id, title: c.title, due: typeof c.due === 'string' ? c.due : ''})) : [],
  } as unknown as Scope;
}
/** The stored draft when it belongs to `account` (null: signed out), is recent and well formed. */
export function restoreDraft(raw: string | null, now = Date.now(), account: string | null = null): Scope | null {
  if (!raw || raw.length > 200_000) return null;
  try {
    const value = JSON.parse(raw);
    if (value?.v !== 2 || (value.account ?? null) !== account || typeof value.saved_at !== 'number' || now - value.saved_at > MAX_AGE) return null;
    return normalizeDraft(value.draft);
  } catch {
    return null;
  }
}
/** Is this draft worth keeping (i.e. not the untouched example or an empty form)? */
export function meaningfulDraft(draft: Scope, sample: Scope, blank: Scope) {
  const text = JSON.stringify(draft);
  return text !== JSON.stringify(sample) && text !== JSON.stringify(blank);
}
/** The scope fields an unsaved draft may carry (scopeSchema's keys; a unit test keeps them in step). */
// Phase 0 (contracts commit): the optional fields client_country … language added to scopeSchema.
export const DRAFT_FIELDS = ['title', 'client', 'deliverables', 'items', 'client_inputs', 'exclusions', 'fee', 'currency', 'revisions', 'due', 'notes', 'tax_label', 'tax_pct', 'deposit_pct', 'payment_terms', 'milestones', 'fx', 'revision_bank', 'client_country', 'engagement', 'retainer', 'tds', 'msmed', 'language'] as const;
/** A draft sent to the server, reduced to the editor's fields; null when it is not a scope draft. */
export function draftForStorage(input: unknown): Scope | null {
  const draft = normalizeDraft(input) as Record<string, unknown> | null;
  if (!draft) return null;
  const kept: Record<string, unknown> = {};
  for (const k of DRAFT_FIELDS) if (draft[k] !== undefined) kept[k] = draft[k];
  return kept as unknown as Scope;
}

// ---- WS-09 LT-06 / LT-07: field-level validation messages ---------------------------------------
/** Largest fee or item price the scope schema accepts (lib/scope.ts). */
export const MAX_AMOUNT = 10_000_000;
/** "₹1,00,00,000" for INR, "$10,000,000" for USD: the amount cap in the scope's currency, no decimals. */
export function maxAmountLabel(currency: string) {
  try { return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {style: 'currency', currency, maximumFractionDigits: 0}).format(MAX_AMOUNT); }
  catch { return MAX_AMOUNT.toLocaleString('en-US') + ' ' + currency; }
}
/** Inline problem for an item price or fee as typed: never coerced, just explained (LT-07). */
export function amountProblem(value: number | null | undefined, currency: string, what = 'Price') {
  if (value == null || Number.isNaN(value)) return null;
  if (value === Infinity) return `Max ${maxAmountLabel(currency)}`; // R5-04: "1e400" parses to Infinity
  if (!Number.isFinite(value)) return `${what} must be a number.`;
  if (value < 0) return `${what} can't be negative`;
  if (value > MAX_AMOUNT) return `Max ${maxAmountLabel(currency)}`;
  return null;
}
/** Editor labels for the scope fields a validation message can point at. */
export const FIELD_LABELS: Record<string, string> = {
  title: 'Project name', client: 'Client', deliverables: 'Deliverables', items: 'Deliverables', client_inputs: 'Client inputs',
  exclusions: 'Outside this scope', fee: 'Project fee', currency: 'Currency', revisions: 'Revision rounds', due: 'Target delivery',
  notes: 'Working terms', tax_label: 'Tax name', tax_pct: 'Tax (%)', deposit_pct: 'Deposit (%)', payment_terms: 'Payment terms',
  milestones: 'Payment schedule', fx: 'Exchange rate', revision_bank: 'Revision bank',
};
/** The subset of a zod issue the editor reads (zod 3 and 4 shapes). */
export type FieldIssue = {path: (string | number)[]; code?: string; message: string; minimum?: number | bigint; maximum?: number | bigint; type?: string; origin?: string};
/** The editor field an issue belongs to: `items.2.title` is shown under Deliverables. */
export function issueField(issue: Pick<FieldIssue, 'path'>) {
  const top = String(issue.path[0] ?? '');
  return top === 'items' ? 'deliverables' : top;
}
/** A human sentence for one schema issue, never a raw key (LT-06). */
export function humanIssue(issue: FieldIssue): string {
  const kind = issue.type ?? issue.origin;
  const min = issue.minimum === undefined ? undefined : Number(issue.minimum);
  const max = issue.maximum === undefined ? undefined : Number(issue.maximum);
  let text: string;
  if (issue.code === 'too_small' && kind === 'string') text = min && min > 1 ? `Use at least ${min} characters` : 'This can’t be empty';
  else if (issue.code === 'too_big' && kind === 'string') text = `Use at most ${max} characters`;
  else if (issue.code === 'too_small' && kind === 'number') text = min === 0 ? 'Can’t be negative' : `Use ${min} or more`;
  else if (issue.code === 'too_big' && kind === 'number') text = `Use ${max?.toLocaleString('en-US')} or less`;
  else if (issue.code === 'too_small' && kind === 'array') text = `Add at least ${min}`;
  else if (issue.code === 'too_big' && kind === 'array') text = `Use at most ${max}`;
  else if (issue.code === 'invalid_type' && /number|nan/i.test(issue.message)) text = 'Enter a number';
  else if (issue.code === 'invalid_type' || issue.code === 'invalid_enum_value' || issue.code === 'invalid_value') text = 'Choose a valid value';
  else text = issue.message;
  if (issue.path[0] === 'items' && typeof issue.path[1] === 'number') {
    const sub = String(issue.path[2] ?? '');
    const what = sub === 'title' ? 'name' : sub === 'qty' ? 'quantity' : sub === 'unit_price' ? 'price each' : sub; // R5: the field reads "Price each"
    return `Deliverable ${issue.path[1] + 1}${what ? ' ' + what : ''}: ${text.charAt(0).toLowerCase() + text.slice(1)}`;
  }
  return text;
}
/** Field → first human message, from zod issues or a server `{fields}` answer (WS-10 errors). */
export function fieldErrors(issues: FieldIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) { const f = issueField(issue); if (f && !out[f]) out[f] = humanIssue(issue); }
  return out;
}
export const VALIDATION_BANNER = 'Check the highlighted fields: ';
/** The banner above the save bar: names the fields by their labels. */
export function validationBanner(fields: Record<string, string>, problem?: string | null) {
  const names = [...new Set(Object.keys(fields).map(f => FIELD_LABELS[f] ?? f))];
  // B-2: a cross-field problem (deposit vs payment schedule) is named, not just the field.
  return VALIDATION_BANNER + names.join(', ') + '.' + (problem ? ' ' + problem : '');
}

/** UX-C40: the brand colour field, checked as it is typed with the server's own rule (empty means "not set"). */
export function hexColorProblem(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  return /^#[0-9a-fA-F]{6}$/.test(v) ? null : 'Use a six-digit hex colour such as #1f6feb, or leave it empty.';
}

/**
 * Visual re-audit #6: the save banner after the owner fixes a deposit/schedule conflict (e.g. "Clear deposit").
 * When the banner carries `problem` and that problem is gone, the problem sentence is dropped, and so is the
 * Payment schedule name it brought in; when nothing else is listed, the banner goes (null). Otherwise unchanged.
 */
export function bannerAfterFix(error: string, problem: string, stillThere: boolean): string | null {
  if (!error || stillThere || !error.startsWith(VALIDATION_BANNER) || !error.endsWith(' ' + problem)) return error;
  const head = error.slice(VALIDATION_BANNER.length, error.length - problem.length - 1).replace(/\.$/, '');
  const names = head.split(', ').filter(n => n && n !== FIELD_LABELS.milestones);
  return names.length ? VALIDATION_BANNER + names.join(', ') + '.' : null;
}

// R4-02: an item is priced either by its line total (`price`) or per unit (`unit_price`, line = qty × unit_price).
// Setting one clears the other, so what the owner types is always what the client page, PDF and totals use.
type Priced = Pick<Item, 'qty' | 'price' | 'unit_price'>;
/** The item priced by its line total (`price`); any unit price is removed. */
export function withLinePrice<T extends Priced>(item: T, price: number | null): T {
  const {unit_price: _unit, ...rest} = item;
  return {...rest, price} as T;
}
/** The item priced per unit; `price` is cleared (null), and an empty field leaves it unpriced. */
export function withUnitPrice<T extends Priced>(item: T, unit: number | null): T {
  const {unit_price: _unit, ...rest} = item;
  return (unit == null ? {...rest, price: null} : {...rest, price: null, unit_price: unit}) as T;
}
/** Switch to per-unit pricing without changing the line total; null when the total does not divide exactly by qty. */
export function toPerUnit<T extends Priced>(item: T, currency: string): T | null {
  if (item.unit_price != null) return item;
  if (item.price == null) return withUnitPrice(item, null);
  const unit = exactUnitPrice(item, currency);
  return unit == null ? null : withUnitPrice(item, unit);
}
/** Switch to a line total, keeping the money the client sees (qty × unit_price). */
export function toLineTotal<T extends Priced>(item: T, currency: string): T {
  let line: number | null = null;
  try { line = lineTotal(item, currency); } catch { /* too large to compute: left unpriced */ }
  return withLinePrice(item, line);
}
/**
 * R4-03: a drafted change order with a suggested price per unit on each unpriced new item (`unit` by item id), going
 * in as unit_price because a change-order item's `price` is its line total; fee_delta, when not set, becomes the sum of
 * the line totals. So 3 × ₹1,000 proposes ₹3,000 and the agreement shows ₹3,000 for that deliverable.
 */
export function priceCoItems<I extends Priced & {id: string}, C extends {add_items?: I[]; fee_delta?: number}>(co: C, unit: ReadonlyMap<string, number>, currency: string): C {
  const add = (co.add_items ?? []).map(i => (typeof i.price === 'number' || i.unit_price != null || !unit.has(i.id) ? i : withUnitPrice(i, unit.get(i.id)!)));
  const fee = itemsTotal(add, currency).total;
  return {...co, add_items: add, ...(!co.fee_delta && fee ? {fee_delta: fee} : {})};
}
/**
 * R4-05/R4-06: what a template keeps from the draft it replaces: the typed project name, client and client email,
 * for a new (unsaved) draft that is not the example. The chip row and "Use template" (/?template=) both use it.
 */
export function templateKeep(s: {active: boolean; isSample: boolean; draft: Pick<Scope, 'title' | 'client'>; clientEmail: string}): {title?: string; client?: string; email?: string} {
  const keep: {title?: string; client?: string; email?: string} = {};
  if (s.active || s.isSample) return keep;
  if (s.draft.title.trim()) keep.title = s.draft.title;
  if (s.draft.client.trim()) keep.client = s.draft.client;
  if (s.clientEmail.trim()) keep.email = s.clientEmail;
  return keep;
}

/**
 * R5-05: the client email of an unsaved draft lives outside the scope content, so it is kept beside the draft in this
 * tab (sessionStorage) for the same account. Going to /templates and back with "Use template" (a page load) then keeps
 * it, like the typed name and client. An empty email removes the entry; sign-out clears it with the drafts (same prefix).
 */
export const DRAFT_EMAIL_KEY = DRAFT_PREFIX + ':email';
type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function writeDraftEmail(store: () => KV, account: string | null, email: string, now = Date.now()) {
  try {
    if (!email.trim() || email.length > 320) store().removeItem(DRAFT_EMAIL_KEY);
    else store().setItem(DRAFT_EMAIL_KEY, JSON.stringify({account, saved_at: now, email}));
  } catch { /* storage unavailable: kept for this page only */ }
}
export function readDraftEmail(store: () => KV, account: string | null, now = Date.now()): string {
  try {
    const v = JSON.parse(store().getItem(DRAFT_EMAIL_KEY) ?? 'null');
    if (!isRecord(v) || (v.account ?? null) !== account || typeof v.email !== 'string' || typeof v.saved_at !== 'number' || now - v.saved_at > MAX_AGE) return '';
    return v.email.slice(0, 320);
  } catch { return ''; }
}
