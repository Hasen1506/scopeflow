// R3-04: the date the client page shows for a received deposit. Pure and isomorphic.

/**
 * R3-04: when the deposit was received, for the client page. A recorded payment (payment_received) gives the
 * day it arrived as `paid_on` (YYYY-MM-DD); anything else, or a recorded payment without that day, falls back
 * to the time the entry was written as `paid_at`. Pure.
 */
export function depositPaidWhen(e: {kind: string; payload: unknown; created: string} | undefined): {paid_at: string | null; paid_on: string | null} {
  if (!e) return {paid_at: null, paid_on: null};
  const day = e.kind === 'payment_received' ? (e.payload as {received?: unknown} | null)?.received : undefined;
  if (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)) return {paid_at: null, paid_on: day};
  return {paid_at: e.created ?? null, paid_on: null};
}
