import {db} from './server';
import {depositAmount, fromMinorUnits, paymentsStatus, toMinorUnits} from './razorpay';
import type {Scope} from './scope';

export type DepositRow = {id: string; order_id: string; amount_minor: number | string; currency: string; status: string; payment_id: string | null; paid_at: string | null};

/** What the review page shows about the deposit for an approved version (null when none is due). */
export async function depositView(projectId: string, version: number, content: Scope) {
  const amount = depositAmount(content);
  if (!(amount > 0)) return null;
  const paid = await db().prepare("SELECT order_id,amount_minor,currency,status,payment_id,paid_at FROM payments WHERE project_id=? AND version=? AND status='paid' ORDER BY paid_at DESC LIMIT 1").bind(projectId, version).first<DepositRow>();
  const status = paymentsStatus();
  return {
    pct: content.deposit_pct ?? 0, amount, currency: content.currency, amount_minor: toMinorUnits(amount, content.currency),
    paid: paid ? {amount: fromMinorUnits(Number(paid.amount_minor), paid.currency), currency: paid.currency, payment_id: paid.payment_id, paid_at: paid.paid_at} : null,
    enabled: status.enabled, provider: status.provider, reason: status.enabled ? null : status.reason,
  };
}
