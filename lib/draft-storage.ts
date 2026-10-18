// Draft keys and sign-out cleanup. Kept out of lib/editor.ts so the landing page does not download the editor.
export const DRAFT_PREFIX = 'scopeflow:draft';
export const LEGACY_DRAFT_KEY = DRAFT_PREFIX + ':v1';

/** Storage key for an account's draft; `null` is the signed-out visitor (sessionStorage). */
export function draftKey(account: string | null) {
  return `${DRAFT_PREFIX}:v2:${account ?? 'anon'}`;
}

type DraftStore = Pick<Storage, 'length' | 'key' | 'removeItem'>;
/** Removes stored drafts: all of them, or every account's except `keep` (and the signed-out draft). */
export function clearDrafts(storage: DraftStore, keep?: string) {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k?.startsWith(DRAFT_PREFIX)) keys.push(k); }
  for (const k of keys) if (keep === undefined || (k !== draftKey(keep) && k !== draftKey(null))) storage.removeItem(k);
}

/** Browser only: forget every stored draft (sign-out, account deletion, switching account). */
export function forgetDrafts() {
  for (const get of [() => localStorage, () => sessionStorage]) {
    try { clearDrafts(get()); } catch { /* storage unavailable */ }
  }
}
