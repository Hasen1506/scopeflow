import type {MoneyPurpose, MoneyState} from './contracts';
import {paymentsOf, type LedgerEntry, type Payment} from './ledger';
import {toMinor} from './minor';

// The project's money fold (owner: WS-04). Phase 0: final signature; the body delegates to today's
// per-baseline fold (lib/ledger.ts paymentsOf on the entries of one baseline) so it agrees with the
// statement and checkout. Nothing calls it yet. WS-04 folds across all baselines (C4).

export type {MoneyState};
/** What the fold needs to know about the agreement. `total` and `deposit` are minor units (lib/agreement-totals.ts). */
export type MoneyAgreement = {baseline_version: number; currency: string; total: number; deposit: number};

export function moneyState(entries: LedgerEntry[], agreement: MoneyAgreement): MoneyState {
  const own = entries.filter(e => e.baseline_version === agreement.baseline_version);
  const m = (n: number) => toMinor(n, agreement.currency);
  const {lines, paid} = paymentsOf(own);
  const by_purpose: Partial<Record<MoneyPurpose, number>> = {};
  const add = (k: MoneyPurpose, v: number) => { by_purpose[k] = (by_purpose[k] ?? 0) + v; };
  for (const e of own) {
    if (!e.payload) continue;
    if (e.kind === 'payment') { const p = e.payload as Payment; add(p.purpose === 'invoice' ? 'invoice' : 'deposit', m(Number(p.amount) || 0)); }
    else if (e.kind === 'payment_received') add('recorded', m((e.payload as {amount: number}).amount));
    else if (e.kind === 'refund') add('refund', m((e.payload as {amount: number}).amount));
  }
  const received = m(lines.filter(l => l.amount > 0).reduce((s, l) => s + l.amount, 0));
  const refunded = m(lines.filter(l => l.amount < 0).reduce((s, l) => s - l.amount, 0));
  const net = m(paid);
  // Today's coverage rule (lib/checkout-server.ts): net payments on the record cover the deposit.
  const due = agreement.deposit;
  return {
    received, refunded, tds_credited: 0,
    excess: Math.max(0, net - agreement.total),
    by_purpose,
    deposit: {due, paid: Math.max(0, Math.min(net, due)), covered: due > 0 && net >= due},
  };
}
