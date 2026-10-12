// Exact integer helpers for WS-05 money in minor units (change orders, rate card, retainers).
// Pure and isomorphic; no floating-point rounding on percentages.

/** Half-up (away from zero) `pct` percent of an integer minor amount, computed exactly. `pct` may have up to 4 decimals. */
export function pctOfMinor(minor: number, pct: number): number {
  if (!Number.isSafeInteger(Math.round(minor))) throw new RangeError('Amount out of range');
  const bp = BigInt(Math.round(pct * 10000)); // 1 = 0.0001 %
  const n = BigInt(Math.round(minor)) * bp;
  const zero = BigInt(0), d = BigInt(1000000), half = BigInt(500000);
  const q = n < zero ? -n : n;
  const r = (q + half) / d;
  return Number(n < zero ? -r : r);
}

/** The calendar date (YYYY-MM-DD) of an instant in an IANA time zone (UTC when the zone is missing or invalid). */
export function dayIn(iso: string | number | Date, tz?: string | null): string {
  const d = new Date(iso);
  let zone = 'UTC';
  if (tz) { try { new Intl.DateTimeFormat('en-CA', {timeZone: tz}); zone = tz; } catch { /* UTC */ } }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(d).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** M8: "today" and the approval date, both in the project's time zone (see lib/ledger.ts EntryContext). */
export function entryContext(timezone: string | null, decided: string | null): {today: string; approved_on?: string} {
  return {today: dayIn(Date.now(), timezone), ...(decided ? {approved_on: dayIn(decided, timezone)} : {})};
}
