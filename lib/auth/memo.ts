// M27: one Neon Auth lookup per request. The memo is keyed by an object that lives exactly as long
// as the request (Next's per-request headers object), so nothing leaks between requests and a
// WeakMap lets it be collected with the request. Pure (no imports) for unit tests.

export type SessionMode = 'fresh' | 'cached';

export function requestMemo<K extends object, V>() {
  const store = new WeakMap<K, Partial<Record<SessionMode, Promise<V>>>>();
  /**
   * The memoised lookup for `key`. A fresh (round-trip) result also answers a later cached read in
   * the same request; a cached read never answers a fresh one.
   */
  return function memo(key: K | null, mode: SessionMode, compute: (mode: SessionMode) => Promise<V>): Promise<V> {
    if (!key) return compute(mode);
    let entry = store.get(key);
    if (!entry) { entry = {}; store.set(key, entry); }
    const hit = entry.fresh ?? (mode === 'cached' ? entry.cached : undefined);
    if (hit) return hit;
    const promise = compute(mode);
    entry[mode] = promise;
    // A failed lookup is not remembered.
    promise.catch(() => { if (entry![mode] === promise) delete entry![mode]; });
    return promise;
  };
}
