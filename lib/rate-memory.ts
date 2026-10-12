// M26: read limits without database writes. A sliding one-minute window per key, kept in this
// instance's memory: at most `limit` hits in any 60 seconds. With several instances each keeps its
// own window, so the effective limit is limit × instances; Cloudflare rate-limiting rules
// (docs/ws-10.md) bound the total. Writes keep the database counter in lib/server.ts allowWrite().
// Pure (no imports) so it can be unit tested under plain node.

export type MemoryLimiter = {
  /** Records a hit and says whether it is within the limit. */
  allow(key: string, limit: number, now?: number): boolean;
  /** Seconds until the next hit for `key` would be allowed (0 when it would be now). */
  retryAfter(key: string, limit: number, now?: number): number;
  size(): number;
  clear(): void;
};

export function memoryLimiter({windowMs = 60_000, maxKeys = 50_000}: {windowMs?: number; maxKeys?: number} = {}): MemoryLimiter {
  // Insertion-ordered: the first key is the least recently touched one.
  const hits = new Map<string, number[]>();
  const prune = (list: number[], now: number) => { let i = 0; while (i < list.length && list[i] <= now - windowMs) i++; if (i) list.splice(0, i); return list; };
  return {
    allow(key, limit, now = Date.now()) {
      if (!(limit > 0)) return false;
      const list = prune(hits.get(key) ?? [], now);
      hits.delete(key);
      const allowed = list.length < limit;
      if (allowed) list.push(now);
      hits.set(key, list);
      if (hits.size > maxKeys) {
        // Evict idle keys first, then the least recently touched ones.
        for (const [k, v] of hits) { if (hits.size <= maxKeys) break; if (!prune(v, now).length) hits.delete(k); }
        for (const k of hits.keys()) { if (hits.size <= maxKeys) break; hits.delete(k); }
      }
      return allowed;
    },
    retryAfter(key, limit, now = Date.now()) {
      const list = prune(hits.get(key) ?? [], now);
      if (list.length < limit) return 0;
      return Math.max(1, Math.ceil((list[list.length - limit] + windowMs - now) / 1000));
    },
    size: () => hits.size,
    clear: () => hits.clear(),
  };
}
