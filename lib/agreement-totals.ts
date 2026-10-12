import type {Minor} from './contracts';
import {computeAgreement, type LedgerEntry} from './ledger';
import {schedule, totals} from './money';
import {toMinor} from './minor';
import type {Scope} from './scope';

// One set of agreement figures for the client page, statement, workspace and insights (owner: WS-01).
// Phase 0: final signature; the body reproduces today's figures (lib/money.ts totals() on the fee
// after approved change orders, the deposit on the signed fee, lib/money.ts schedule()) converted
// to minor units. Nothing calls it yet. WS-01 moves it onto the per-head GST engine.

export type AgreementTaxHead = {label: string; rate: number; amount: Minor};
export type AgreementMilestone = {id: string; title: string; pct: number; due: string; amount: Minor};
export type AgreementTotals = {
  currency: string;
  /** Fee after approved change orders, before tax. */
  fee: Minor;
  heads: AgreementTaxHead[];
  tax: Minor;
  total: Minor;
  /** Deposit due on signature (computed on the signed baseline, as today). */
  deposit: Minor;
  milestones: AgreementMilestone[];
};

/** `entries` are those of the baseline whose `content` is given, in sequence order. */
export function agreementTotals(content: Scope, entries: LedgerEntry[]): AgreementTotals {
  const version = entries[0]?.baseline_version ?? 0;
  const own = entries.filter(e => e.baseline_version === version);
  const fee = computeAgreement(content, version, own).fee;
  const t = totals(content, fee), signed = totals(content);
  const m = (n: number) => toMinor(n, content.currency);
  return {
    currency: content.currency,
    fee: m(t.fee),
    heads: t.tax_pct > 0 ? [{label: t.tax_label, rate: t.tax_pct, amount: m(t.tax)}] : [],
    tax: m(t.tax),
    total: m(t.total),
    deposit: m(signed.deposit),
    milestones: schedule(content, t.total).map(l => ({id: l.id, title: l.title, pct: l.pct, due: l.due, amount: m(l.amount)})),
  };
}
