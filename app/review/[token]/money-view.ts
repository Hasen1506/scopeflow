// What the client page says about money (LT-01, M7, SF-23; owner: WS-07). Pure: every figure comes
// from agreementTotals() (WS-01), so the client page, the statement and the workspace use the same
// tax-head logic and never disagree by a paisa. Amounts are minor units of the agreement currency.
import type {Minor} from '../../../lib/contracts';
import {agreementTotals, type AgreementTaxHead, type AgreementTotals} from '../../../lib/agreement-totals';
import type {CoView, LedgerEntry} from '../../../lib/ledger';
import {toMinor} from '../../../lib/minor';
import type {Scope} from '../../../lib/scope';

export type AgreementNow = {
  currency: string;
  /** Fee after approved change orders, before tax. */
  fee: Minor;
  heads: AgreementTaxHead[];
  tax: Minor;
  total: Minor;
  paid: Minor;
  /** Never negative: an overpayment shows as paid in full. */
  balance: Minor;
  /** How many change orders the client approved (labels the fee row). */
  approved_cos: number;
};

/** The "Agreement now" card from already computed totals (tested with any head split, e.g. CGST + SGST). */
export function nowFromTotals(totals: Pick<AgreementTotals, 'currency' | 'fee' | 'heads' | 'tax' | 'total'>, paid: Minor, approvedCos = 0): AgreementNow {
  return {
    currency: totals.currency, fee: totals.fee, heads: totals.heads, tax: totals.tax, total: totals.total,
    paid, balance: Math.max(0, totals.total - paid), approved_cos: approvedCos,
  };
}

/**
 * The agreement as it stands: the approved scope plus every approved change order, with tax, what
 * has been paid (decimal amount from paymentsOf()) and the balance. `entries` are the baseline's own.
 */
export function agreementNow(content: Scope, entries: LedgerEntry[], paid: number, approvedCos = 0): AgreementNow {
  return nowFromTotals(agreementTotals(content, entries), toMinor(paid, content.currency), approvedCos);
}

export type CoImpact = {
  currency: string;
  /** The change order's own fee change, before tax. */
  fee: Minor;
  /** Tax on it, as the difference the approval makes to the agreement's tax (same head logic). */
  tax: Minor;
  /** fee + tax: what the change costs the client, incl. tax (what gets invoiced, M7). */
  total: Minor;
  total_before: Minor;
  total_after: Minor;
  tax_label: string;
};

/** What approving `co` does (or would do) to the agreement total, incl. tax (before/after on the CO card). */
export function coImpact(content: Scope, entries: LedgerEntry[], co: Pick<CoView, 'seq' | 'fee_delta'>): CoImpact {
  // Measured against the agreement without this change order's own decision, so it works for a
  // pending change order and for one already approved or declined (the decided cards).
  const decided = entries.filter(e => !(e.kind === 'settle' && (e.payload as {ref_seq?: number} | null)?.ref_seq === co.seq));
  const before = agreementTotals(content, decided);
  const version = entries[0]?.baseline_version ?? 0;
  const last = entries.reduce((m, e) => Math.max(m, e.seq), 0);
  // A hypothetical approval of this change order, folded exactly as the real one would be.
  const settle: LedgerEntry = {seq: last + 1, kind: 'settle', baseline_version: version, actor: 'client', created: '', payload: {ref_seq: co.seq, outcome: 'approved', signer: '', comment: ''}, payload_hash: '', prev_hash: '', hash: ''};
  const after = agreementTotals(content, [...decided, settle]);
  const fee = toMinor(co.fee_delta, content.currency), total = after.total - before.total;
  return {
    currency: content.currency, fee, tax: total - fee, total, total_before: before.total, total_after: after.total,
    tax_label: (after.heads.length > 1 ? after.heads.map(h => h.label).join(' + ') : after.heads[0]?.label) ?? before.heads[0]?.label ?? '',
  };
}
