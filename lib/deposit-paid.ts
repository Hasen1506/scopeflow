// R3-04/R4-07: the date the client page shows for a received deposit. Pure and isomorphic.
import {toMinor} from './minor';

type MoneyEntry = {seq: number; kind: string; payload: unknown; created: string};
/** Kinds that bring money in (a received day or a confirmation time), as in lib/money-ledger.ts. */
const CASH_IN = ['payment', 'payment_received', 'payment_claim_confirmed'];

/**
 * R3-04: when the deposit was received, for the client page. A recorded or confirmed payment
 * (payment_received, payment_claim_confirmed) gives the day it arrived as `paid_on` (YYYY-MM-DD); anything
 * else, or such an entry without that day, falls back to the time the entry was written as `paid_at`. Pure.
 */
export function depositPaidWhen(e: {kind: string; payload: unknown; created: string} | undefined): {paid_at: string | null; paid_on: string | null} {
  if (!e) return {paid_at: null, paid_on: null};
  const day = e.kind === 'payment_received' || e.kind === 'payment_claim_confirmed' ? (e.payload as {received?: unknown} | null)?.received : undefined;
  if (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)) return {paid_at: null, paid_on: day};
  return {paid_at: e.created ?? null, paid_on: null};
}

const minorOf = (payload: unknown, currency: string) => {
  const p = payload as {amount_minor?: unknown; amount?: unknown} | null;
  return p && Number.isInteger(p.amount_minor) ? Number(p.amount_minor) : toMinor(Number(p?.amount) || 0, currency);
};

/**
 * R4-07: the payment that completed the deposit, not simply the newest one. Walks the money entries in
 * ledger order with the same fold as moneyState (cash in, less refunds, plus TDS credited) and returns the
 * cash entry at which the settled amount last reached `deposit_minor` (a refund that reopens the deposit
 * resets it). `online` is the newest online `payment` up to that point, for its payment id. Later
 * payments (the balance, an invoice) never move the deposit's date. Pure.
 */
export function depositCoveredBy(entries: readonly MoneyEntry[], currency: string, deposit_minor: number): {src: MoneyEntry | undefined; online: MoneyEntry | undefined} {
  let settled = 0, src: MoneyEntry | undefined, online: MoneyEntry | undefined, lastCash: MoneyEntry | undefined, lastOnline: MoneyEntry | undefined;
  if (!(deposit_minor > 0)) return {src: undefined, online: undefined};
  for (const e of [...entries].sort((a, b) => a.seq - b.seq)) {
    if (!e.payload) continue;
    const amount = minorOf(e.payload, currency), before = settled;
    if (CASH_IN.includes(e.kind)) { settled += amount; lastCash = e; if (e.kind === 'payment') lastOnline = e; }
    else if (e.kind === 'refund') settled -= amount;
    else if (e.kind === 'tds_credit') settled += amount;
    else continue;
    if (settled < deposit_minor) { src = undefined; online = undefined; }
    else if (before < deposit_minor) { src = lastCash; online = lastOnline; }
  }
  return {src, online};
}
