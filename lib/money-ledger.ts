import type {MoneyPurpose, MoneyState} from './contracts';
import {paymentsOf, refundableOf, type LedgerEntry, type Payment, type PaymentLine} from './ledger';
import {toMinor} from './minor';

// The project's money fold (owner: WS-04). Pure: no database, no network.
//
// C4: money belongs to the PROJECT, not to one baseline version. Payments, refunds, TDS credits
// and excess flags recorded against any baseline (v1, v2, ...) all count, so superseding an
// agreement never makes a recorded payment disappear. A superseding approval may add a signed
// `baseline_superseded` entry carrying {from, to, paid_minor, invoiced_minor} (WS-05); it moves no
// money and is only checked here (carryForwardOk), never added.
//
// LT-21: deposit coverage reads every money entry: online `payment`s and the creator's recorded
// `payment_received`s (unallocated money is applied to the deposit first), less refunds.
// M4: everything is integer minor units of the agreement currency, so a ¥333 payment covers a
// ¥333 deposit with no residue.

export type {MoneyState};
/** What the fold needs to know about the agreement. `total` and `deposit` are minor units (lib/agreement-totals.ts). */
export type MoneyAgreement = {baseline_version: number; currency: string; total: number; deposit: number};

/** Entry kinds that move money (or flag it). */
export const MONEY_KINDS = ['payment', 'payment_received', 'payment_claim_confirmed', 'refund', 'tds_credit', 'excess_payment', 'credit_note'] as const;
const isMoney = (kind: string) => (MONEY_KINDS as readonly string[]).includes(kind);
const amountOf = (payload: unknown) => Number((payload as {amount?: unknown} | null)?.amount) || 0;
/**
 * An entry's amount in minor units: kinds WS-05 enabled after Phase 0 (tds_credit, excess_payment,
 * payment_claim_confirmed) carry integer `amount_minor`; the original kinds a decimal `amount`.
 */
const minorOf = (payload: unknown, currency: string) => {
  const p = payload as {amount_minor?: unknown} | null;
  return p && Number.isInteger(p.amount_minor) ? Number(p.amount_minor) : toMinor(amountOf(payload), currency);
};

/**
 * M2: a money entry carrying a currency other than the agreement's (an online `payment`, an
 * `excess_payment` flag) cannot be counted at face value. Returns the seqs of such payments, so
 * refunds of them are left out too.
 */
export function foreignPaymentSeqs(entries: readonly {seq: number; kind: string; payload: unknown}[], currency: string): Set<number> {
  const out = new Set<number>();
  for (const e of entries) if (e.kind === 'payment' && isForeign(e.payload, currency)) out.add(e.seq);
  return out;
}
const isForeign = (payload: unknown, currency: string) => {
  const c = (payload as {currency?: unknown} | null)?.currency;
  return typeof c === 'string' && c !== '' && c !== currency;
};
const refundOf = (payload: unknown) => Number((payload as {refund_of?: unknown} | null)?.refund_of);

export function moneyState(entries: LedgerEntry[], agreement: MoneyAgreement): MoneyState {
  const foreign = foreignPaymentSeqs(entries, agreement.currency);
  const by_purpose: Partial<Record<MoneyPurpose, number>> = {};
  const add = (k: MoneyPurpose, v: number) => { by_purpose[k] = (by_purpose[k] ?? 0) + v; };
  let received = 0, refunded = 0, tds = 0;
  for (const e of entries) {
    if (!e.payload || !isMoney(e.kind)) continue;
    const amount = minorOf(e.payload, agreement.currency);
    // M2: a payment in another currency is not money toward this agreement: it is all excess (in its
    // own currency the owner refunds it). Its excess_payment flag and any refund of it are skipped.
    if (e.kind === 'payment' && foreign.has(e.seq)) { add('excess', amount); continue; }
    if (e.kind === 'excess_payment' && isForeign(e.payload, agreement.currency)) continue;
    if (e.kind === 'refund' && foreign.has(refundOf(e.payload))) continue;
    if (e.kind === 'payment') { received += amount; add((e.payload as Payment).purpose === 'invoice' ? 'invoice' : 'deposit', amount); }
    else if (e.kind === 'payment_received' || e.kind === 'payment_claim_confirmed') { received += amount; add('recorded', amount); }
    else if (e.kind === 'refund') { refunded += amount; add('refund', amount); }
    else if (e.kind === 'tds_credit') { tds += amount; add('tds_credit', amount); }
    // An excess_payment entry flags part of a payment already counted above; it adds no money.
    else if (e.kind === 'excess_payment') add('excess', amount);
  }
  const net = received - refunded;
  const due = agreement.deposit;
  // Money the client has settled: cash net of refunds plus tax deducted at source on their side.
  const settled = net + tds;
  return {
    received, refunded, tds_credited: tds,
    excess: Math.max(0, settled - agreement.total),
    by_purpose,
    deposit: {due, paid: Math.max(0, Math.min(settled, due)), covered: due > 0 && settled >= due},
  };
}

/** Minor units still open on the deposit (0 when covered or there is none). */
export const depositOpen = (state: MoneyState) => Math.max(0, state.deposit.due - state.deposit.paid);
/** Minor units still open on the whole agreement (total less everything settled). */
export const balanceOpen = (state: MoneyState, total: number) => Math.max(0, total - (state.received - state.refunded + state.tds_credited));

/**
 * The "open-amount version" of a project: changes whenever money moves (any money entry is
 * appended). Part of the Stripe idempotency key and stored on orders, so an order created for an
 * older open amount is recognisably stale (H8).
 */
export function openVersion(entries: LedgerEntry[]): string {
  let last = 0;
  for (const e of entries) if (isMoney(e.kind) && e.seq > last) last = e.seq;
  return 'm' + last;
}

/** Every money line on the project across all baselines (C4), with refundable amounts for online payments. */
export function projectPaymentLines(entries: LedgerEntry[]): (PaymentLine & {baseline_version: number; refundable: number})[] {
  const {lines} = paymentsOf(entries);
  const base = new Map(entries.map(e => [e.seq, e.baseline_version]));
  return lines.map(l => ({...l, baseline_version: base.get(l.seq) ?? 0, refundable: refundableOf(l, lines)}));
}

/** The payment entry `seq` anywhere on the project (C4: refund lookup is project-wide), or null. */
export function findPaymentEntry(entries: LedgerEntry[], seq: number): (LedgerEntry & {payload: Payment}) | null {
  const e = entries.find(x => x.seq === seq && x.kind === 'payment' && x.payload);
  return e ? e as LedgerEntry & {payload: Payment} : null;
}

/**
 * How a captured amount applies to what was open on its target when it arrived (H8, M20).
 * `apply` counts toward the target, `excess` is beyond it (an overpayment, or a capture on an
 * order a newer open amount replaced), `short` is what the capture fell short of its order.
 * Invariant: apply + excess === captured; apply <= max(0, open).
 */
export function classifyCapture({open_minor, order_minor, captured_minor}: {open_minor: number; order_minor: number; captured_minor: number}) {
  const apply = Math.min(captured_minor, Math.max(0, open_minor));
  return {apply_minor: apply, excess_minor: captured_minor - apply, short_minor: Math.max(0, order_minor - captured_minor)};
}

/**
 * A `baseline_superseded` entry is consistent with the money on the record before it: the
 * carried-forward `paid_minor` equals received - refunded over the entries before it. True when
 * there is no such entry.
 */
export function carryForwardOk(entries: LedgerEntry[], currency: string): boolean {
  let net = 0;
  const foreign = foreignPaymentSeqs(entries, currency);
  for (const e of [...entries].sort((a, b) => a.seq - b.seq)) {
    if (!e.payload) continue;
    // M2: money in another currency was never counted toward the agreement.
    if (foreign.has(e.seq) || (e.kind === 'refund' && foreign.has(refundOf(e.payload)))) continue;
    if (e.kind === 'baseline_superseded') {
      const paid = Number((e.payload as {paid_minor?: unknown}).paid_minor);
      if (Number.isFinite(paid) && paid !== net) return false;
    } else if (e.kind === 'payment' || e.kind === 'payment_received' || e.kind === 'payment_claim_confirmed') net += minorOf(e.payload, currency);
    else if (e.kind === 'refund') net -= minorOf(e.payload, currency);
  }
  return true;
}
