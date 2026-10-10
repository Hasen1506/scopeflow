// Pure helpers for the scope editor (unit-tested in tests/unit.mjs).
import type {Scope} from './scope';

/** Number inputs: keep NaN (empty field) as-is, otherwise clamp into [min, max]. */
export function clampNumber(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return value;
  return Math.min(max, Math.max(min, value));
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
export const DRAFT_PREFIX = 'scopeflow:draft';
export const LEGACY_DRAFT_KEY = DRAFT_PREFIX + ':v1';
const MAX_AGE = 14 * 86400_000;
/** Storage key for an account's draft; `null` is the signed-out visitor (sessionStorage). */
export function draftKey(account: string | null) {
  return `${DRAFT_PREFIX}:v2:${account ?? 'anon'}`;
}
export function serializeDraft(draft: Scope, now = Date.now(), account: string | null = null) {
  return JSON.stringify({v: 2, account, saved_at: now, draft});
}
type DraftStore = Pick<Storage, 'length' | 'key' | 'removeItem'>;
/** Removes stored drafts: all of them, or every account's except `keep` (and the signed-out draft). */
export function clearDrafts(storage: DraftStore, keep?: string) {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k?.startsWith(DRAFT_PREFIX)) keys.push(k); }
  for (const k of keys) if (keep === undefined || (k !== draftKey(keep) && k !== draftKey(null))) storage.removeItem(k);
}
const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const validItem = (x: unknown) => isRecord(x) && typeof x.id === 'string' && typeof x.title === 'string';
const validInput = (x: unknown) => isRecord(x) && typeof x.id === 'string' && typeof x.title === 'string';
function normalizeItem(i: Record<string, unknown>) {
  return {id: i.id as string, title: i.title as string, qty: typeof i.qty === 'number' && Number.isFinite(i.qty) ? i.qty : 1, unit: typeof i.unit === 'string' ? i.unit : '', price: typeof i.price === 'number' && Number.isFinite(i.price) ? i.price : null, acceptance: typeof i.acceptance === 'string' ? i.acceptance : ''};
}
/** The stored draft when it belongs to `account` (null: signed out), is recent and well formed. */
export function restoreDraft(raw: string | null, now = Date.now(), account: string | null = null): Scope | null {
  if (!raw || raw.length > 200_000) return null;
  try {
    const value = JSON.parse(raw);
    if (value?.v !== 2 || (value.account ?? null) !== account || typeof value.saved_at !== 'number' || now - value.saved_at > MAX_AGE) return null;
    const d = value.draft;
    if (!d || typeof d !== 'object' || typeof d.title !== 'string' || typeof d.client !== 'string' || typeof d.deliverables !== 'string' || typeof d.exclusions !== 'string' || typeof d.notes !== 'string' || typeof d.due !== 'string' || typeof d.currency !== 'string') return null;
    return {
      ...d,
      fee: typeof d.fee === 'number' ? d.fee : 0,
      revisions: typeof d.revisions === 'number' ? d.revisions : 0,
      // QoL: a draft saved by an older build or edited by hand may hold malformed rows; keep only
      // rows the editor can render instead of crashing it on load.
      items: Array.isArray(d.items) ? d.items.filter(validItem).map(normalizeItem) : [],
      client_inputs: Array.isArray(d.client_inputs) ? d.client_inputs.filter(validInput).map((c: {id: string; title: string; due?: unknown}) => ({id: c.id, title: c.title, due: typeof c.due === 'string' ? c.due : ''})) : [],
    } as Scope;
  } catch {
    return null;
  }
}
/** Is this draft worth keeping (i.e. not the untouched example or an empty form)? */
export function meaningfulDraft(draft: Scope, sample: Scope, blank: Scope) {
  const text = JSON.stringify(draft);
  return text !== JSON.stringify(sample) && text !== JSON.stringify(blank);
}
/** Browser only: forget every stored draft (sign-out, account deletion, switching account). */
export function forgetDrafts() {
  for (const get of [() => localStorage, () => sessionStorage]) {
    try { clearDrafts(get()); } catch { /* storage unavailable */ }
  }
}
