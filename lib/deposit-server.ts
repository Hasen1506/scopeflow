import {db} from './server';
import {routeStatus} from './razorpay';
import {loadLedger} from './ledger-server';
import {agreementTotals} from './agreement-totals';
import {balanceOpen, depositOpen, moneyState} from './money-ledger';
import {clientInvoices} from './invoice-server';
import {routeForOwner} from './payment-accounts-server';
import {maskRef, upiNote, upiRef, upiUri} from './upi';
import {fromMinor, toMinor} from './minor';
import type {Payment} from './ledger';
import type {Scope} from './scope';

export type DepositRow = {id: string; order_id: string; amount_minor: number | string; currency: string; status: string; payment_id: string | null; paid_at: string | null};

async function money(projectId: string, version: number, content: Scope) {
  const ledger = await loadLedger(projectId, {forClient: true});
  const own = ledger.entries.filter(e => e.baseline_version === version);
  const totals = agreementTotals(content, own);
  const state = moneyState(ledger.entries, {baseline_version: version, currency: content.currency, total: totals.total, deposit: totals.deposit});
  return {ledger, totals, state};
}

/**
 * What the review page shows about the deposit for an approved version (null when none is due).
 * Coverage reads the project-wide money fold (C4, LT-21): online payments and payments the creator
 * recorded, on any version of the agreement, less refunds; in minor units (M4). `enabled` is true
 * only when the freelancer's own account can take the payment online and confirm it (C3, H7).
 */
export async function depositView(projectId: string, version: number, content: Scope) {
  const owner = (await db().prepare('SELECT owner FROM projects WHERE id=?').bind(projectId).first<{owner: string}>())?.owner ?? '';
  const {ledger, totals, state} = await money(projectId, version, content);
  if (!(totals.deposit > 0)) return null;
  const route = await routeForOwner(owner, content.currency), status = routeStatus(route);
  let paid = null;
  if (state.deposit.covered) {
    const money = ledger.entries.filter(e => e.payload && ['payment', 'payment_received'].includes(e.kind));
    const online = [...money].reverse().find(e => e.kind === 'payment') as {payload: Payment; created: string} | undefined;
    paid = {amount: fromMinor(state.deposit.paid, content.currency), currency: content.currency, payment_id: online?.payload.payment_id ?? null, paid_at: (online ?? money.at(-1))?.created ?? null};
  }
  return {
    pct: content.deposit_pct ?? 0, amount: fromMinor(totals.deposit, content.currency), currency: content.currency, amount_minor: totals.deposit,
    paid, enabled: status.enabled, provider: status.provider, reason: status.enabled ? null : status.reason,
    open_minor: depositOpen(state), received_minor: state.deposit.paid, status: route.status, upi: !!route.upi,
  };
}

export type PayTarget = {purpose: 'deposit' | 'invoice' | 'balance'; seq: number | null; label: string; due_minor: number; open_minor: number; upi_uri: string | null; ref: string};

/**
 * Everything the PayBlock needs on the client page (LT-02, SF-02): what is open (deposit, each open
 * invoice, the remaining balance) for the exact amounts, the freelancer's UPI ID with a ready UPI
 * URI per target (INR only), the bank details from their business profile, whether online checkout
 * is available, and the client's own "I've paid" claims.
 */
export async function paymentOptions(projectId: string, version: number, content: Scope, token: string) {
  const project = await db().prepare('SELECT owner,timezone FROM projects WHERE id=?').bind(projectId).first<{owner: string; timezone: string | null}>();
  const owner = project?.owner ?? '';
  const {ledger, totals, state} = await money(projectId, version, content);
  const route = await routeForOwner(owner, content.currency), status = routeStatus(route);
  const profile = await db().prepare('SELECT business_name,payment_details FROM business_profiles WHERE owner=?').bind(owner).first<{business_name: string | null; payment_details: string | null}>();
  const payee = route.upi?.payee_name || profile?.business_name || '';
  const uri = (purpose: PayTarget['purpose'], seq: number | null, label: string, open: number) => route.upi
    ? upiUri({vpa: route.upi.vpa, payee, amount_minor: open, currency: content.currency, note: upiNote(content.title, label), ref: upiRef(projectId, purpose, seq)}) : null;
  const targets: PayTarget[] = [];
  if (totals.deposit > 0) {
    const open = depositOpen(state);
    targets.push({purpose: 'deposit', seq: null, label: 'Deposit', due_minor: totals.deposit, open_minor: open, upi_uri: open > 0 ? uri('deposit', null, 'Deposit', open) : null, ref: upiRef(projectId, 'deposit')});
  }
  for (const i of await clientInvoices(projectId, version, ledger.entries, project?.timezone ?? null)) {
    const open = toMinor(i.open, content.currency);
    if (open > 0) targets.push({purpose: 'invoice', seq: i.seq, label: `Invoice ${i.number}`, due_minor: toMinor(i.amount, content.currency), open_minor: open, upi_uri: uri('invoice', i.seq, `Invoice ${i.number}`, open), ref: upiRef(projectId, 'invoice', i.seq)});
  }
  const balance = balanceOpen(state, totals.total);
  if (balance > 0) targets.push({purpose: 'balance', seq: null, label: 'Balance', due_minor: totals.total, open_minor: balance, upi_uri: uri('balance', null, 'Balance', balance), ref: upiRef(projectId, 'balance')});
  const claims = await db().prepare('SELECT id,purpose,invoice_seq,amount_minor,currency,method,utr,status,created FROM scopeflow.payment_claims WHERE project_id=? ORDER BY created DESC LIMIT 20').bind(projectId).all<{id: string; purpose: string; invoice_seq: number | null; amount_minor: number | string; currency: string; method: string; utr: string; status: string; created: string}>();
  return {
    project_id: projectId, version, title: content.title, currency: content.currency, payee,
    money: {received_minor: state.received, refunded_minor: state.refunded, net_minor: state.received - state.refunded, total_minor: totals.total, balance_minor: balance, deposit: state.deposit},
    targets,
    upi: route.upi ? {vpa: route.upi.vpa, payee_name: payee} : null,
    bank: profile?.payment_details?.trim() || null,
    online: {enabled: status.enabled, provider: status.provider, status: route.status},
    claims: claims.results.map(c => ({id: c.id, purpose: c.purpose, invoice_seq: c.invoice_seq, amount_minor: Number(c.amount_minor), currency: c.currency, method: c.method, utr: maskRef(c.utr), status: c.status, created: c.created})),
    paths: {deposit: `/api/review/${token}/deposit`, invoice: `/api/review/${token}/invoices/{seq}/pay`, claim: `/api/review/${token}/payment-claim`, verify: `/api/review/${token}/payments/razorpay/verify`},
  };
}
