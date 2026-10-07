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
  if (!state.signedIn) return 'Sign in to save this scope and create its review link. Your draft is kept in this browser.';
  if (state.editingSaved && !state.changed) return 'No changes yet. Edit the scope to save a new version.';
  return null;
}

// Unsaved drafts survive reloads, cold starts and accidental resets (BUG-14).
export const DRAFT_KEY = 'scopeflow:draft:v1';
const MAX_AGE = 14 * 86400_000;
export function serializeDraft(draft: Scope, now = Date.now()) {
  return JSON.stringify({v: 1, saved_at: now, draft});
}
export function restoreDraft(raw: string | null, now = Date.now()): Scope | null {
  if (!raw || raw.length > 200_000) return null;
  try {
    const value = JSON.parse(raw);
    if (value?.v !== 1 || typeof value.saved_at !== 'number' || now - value.saved_at > MAX_AGE) return null;
    const d = value.draft;
    if (!d || typeof d !== 'object' || typeof d.title !== 'string' || typeof d.client !== 'string' || typeof d.deliverables !== 'string' || typeof d.exclusions !== 'string' || typeof d.notes !== 'string' || typeof d.due !== 'string' || typeof d.currency !== 'string') return null;
    return {
      ...d,
      fee: typeof d.fee === 'number' ? d.fee : 0,
      revisions: typeof d.revisions === 'number' ? d.revisions : 0,
      items: Array.isArray(d.items) ? d.items : [],
      client_inputs: Array.isArray(d.client_inputs) ? d.client_inputs : [],
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
