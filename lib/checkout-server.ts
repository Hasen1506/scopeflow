import {db, json, allowWrite} from './server';
import {RazorpayError, checkoutKey, createOrder, routeStatus} from './razorpay';
import {SESSION_TTL_SEC, StripeError, createCheckoutSession, expireCheckoutSession, stripeSessionState} from './stripe';
import {loadLedger} from './ledger-server';
import {clientInvoices} from './invoice-server';
import {agreementTotals} from './agreement-totals';
import {depositOpen, moneyState, openVersion} from './money-ledger';
import {razorpayFor, routeForOwner, stripeFor} from './payment-accounts-server';
import {recordPaidPayment} from './payment-record';
import {fromMinor, toMinor} from './minor';
import {publicUrl} from './origin';
import type {Scope} from './scope';

type Row = {id: string; project_id: string; version: number; status: string; content: string; latest: number; timezone: string | null; owner: string};
export type CheckoutTarget = {purpose: 'deposit'} | {purpose: 'invoice'; seq: number};
type OpenOrder = {id: string; order_id: string; amount_minor: number | string; open_version: string | null; account_id: string | null; session_url: string | null; return_ref: string | null};

const sha256Hex = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))).map(b => b.toString(16).padStart(2, '0')).join('');
/** H8: the Stripe idempotency key: the payment itself (project, purpose, target, amount, open-amount version), not the hour. */
export const stripeIdempotencyKey = async (p: {project_id: string; purpose: string; seq: number | null; amount_minor: number; open_version: string; account_id: string | null; generation: number}) =>
  'sf-' + (await sha256Hex([p.project_id, p.purpose, p.seq ?? 0, p.amount_minor, p.open_version, p.account_id ?? 'operator', p.generation].join('|'))).slice(0, 48);

/** What is open on a target right now, in minor units, from the project-wide money fold (C4, LT-21, M4). */
export async function openAmount(projectId: string, version: number, content: Scope, timezone: string | null, target: CheckoutTarget, entries?: Awaited<ReturnType<typeof loadLedger>>['entries']) {
  const all = entries ?? (await loadLedger(projectId)).entries;
  const own = all.filter(e => e.baseline_version === version);
  const t = agreementTotals(content, own);
  const state = moneyState(all, {baseline_version: version, currency: content.currency, total: t.total, deposit: t.deposit});
  if (target.purpose === 'deposit') return {state, totals: t, open_minor: depositOpen(state), invoice: null, open_version: openVersion(all)};
  const invoice = (await clientInvoices(projectId, version, all, timezone)).find(i => i.seq === target.seq) ?? null;
  return {state, totals: t, open_minor: invoice ? toMinor(invoice.open, content.currency) : 0, invoice, open_version: openVersion(all)};
}

/**
 * Starts an online payment from a review link: what is still open on the deposit, or on one issued
 * invoice. The charge always goes to an account the freelancer owns (C3): their own Razorpay
 * (OAuth or keys) answers with an order for the Checkout widget, their own Stripe with a hosted
 * Checkout URL. Without such an account the client is told to pay the freelancer directly (UPI on
 * the page, when set): 409 payment_account_required. Only the provider's verified webhook, the
 * Checkout verify route, the return page or the reconciliation job marks it paid.
 */
export async function startCheckout(request: Request, token: string, target: CheckoutTarget): Promise<Response> {
  if (!/^[a-f0-9]{64}$/.test(token)) return json({error: 'This review link was not found.'}, 404);
  const row = await db().prepare('SELECT v.id,v.project_id,v.version,v.status,v.content,p.latest,p.timezone,p.owner FROM versions v JOIN projects p ON p.id=v.project_id WHERE v.token=? AND v.revoked=0').bind(token).first<Row>();
  if (!row) return json({error: 'This review link was not found.'}, 404);
  if (row.status !== 'approved' || row.version !== row.latest) return json({error: `${target.purpose === 'deposit' ? 'A deposit' : 'An invoice'} can be paid once this version is approved.`, code: 'not_approved'}, 409);
  const content = JSON.parse(row.content) as Scope, currency = content.currency;
  const ledger = await loadLedger(row.project_id);
  const open = await openAmount(row.project_id, row.version, content, row.timezone, target, ledger.entries);
  let invoiceNumber: string | undefined;
  if (target.purpose === 'deposit') {
    if (!(open.totals.deposit > 0)) return json({error: 'This scope has no deposit.', code: 'no_deposit'}, 409);
    // Money already on the record, on ANY version of the agreement, counts: never ask twice.
    if (open.state.deposit.covered || !(open.open_minor > 0)) return json({error: 'The payments on the record already cover the deposit.', code: 'already_paid'}, 409);
  } else {
    if (!open.invoice) return json({error: 'Invoice not found.'}, 404);
    if (!(open.open_minor > 0)) return json({error: `Invoice ${open.invoice.number} is already paid.`, code: 'already_paid'}, 409);
    invoiceNumber = open.invoice.number;
  }
  const route = await routeForOwner(row.owner, currency);
  if (!route.online) {
    const upi = route.upi ? ' Pay by UPI or bank transfer as shown on this page.' : ' Pay the creator the way you agreed.';
    if (route.status === 'operator_refused' || route.status === 'upi_only') return json({error: 'Online card payment is not set up for this scope.' + upi, code: 'payment_account_required', upi: !!route.upi}, 409);
    return json({error: (routeStatus(route) as {reason?: string}).reason + upi, code: 'payments_disabled'}, 503);
  }
  if (!await allowWrite('deposit:' + row.id, 10)) return json({error: 'Too many attempts. Try again in a minute.'}, 429);
  const seq = target.purpose === 'invoice' ? target.seq : null;
  const amount_minor = open.open_minor, {provider, account_id} = route.online;
  const name = target.purpose === 'deposit' ? 'Deposit' : `Invoice ${invoiceNumber}`;
  const description = `${content.title} · version ${row.version}`.slice(0, 250);
  const notes = {project_id: row.project_id, version: String(row.version), purpose: target.purpose, ...(seq ? {invoice_seq: String(seq)} : {})};
  const database = db();
  // H8: an order made for an older open amount (or another account) is superseded, so a later
  // capture on it is recorded as excess instead of silently over-covering the target.
  const stale = await database.prepare("UPDATE payments SET superseded_at=? WHERE project_id=? AND purpose=? AND invoice_seq IS NOT DISTINCT FROM ? AND status='created' AND superseded_at IS NULL AND (amount_minor<>? OR currency<>? OR open_version IS DISTINCT FROM ? OR provider<>? OR account_id IS DISTINCT FROM ?) RETURNING provider,order_id,account_id")
    .bind(new Date().toISOString(), row.project_id, target.purpose, seq, amount_minor, currency, open.open_version, provider, account_id).all<{provider: string; order_id: string; account_id: string | null}>();
  for (const s of stale.results) if (s.provider === 'stripe') { const d = await stripeFor(s.account_id); if (d) await expireCheckoutSession(d.config, s.order_id); }
  const current = () => database.prepare("SELECT id,order_id,amount_minor,open_version,account_id,session_url,return_ref FROM payments WHERE project_id=? AND provider=? AND purpose=? AND invoice_seq IS NOT DISTINCT FROM ? AND status='created' AND superseded_at IS NULL AND amount_minor=? AND currency=? AND account_id IS NOT DISTINCT FROM ? ORDER BY created DESC LIMIT 1")
    .bind(row.project_id, provider, target.purpose, seq, amount_minor, currency, account_id).first<OpenOrder>();
  const store = (orderId: string, extra: {idem_key?: string; expires_at?: string; session_url?: string; return_ref?: string} = {}) => database.prepare('INSERT INTO payments (id,project_id,version,provider,order_id,amount_minor,currency,status,created,purpose,invoice_seq,account_id,open_version,idem_key,expires_at,session_url,return_ref) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING')
    .bind(crypto.randomUUID(), row.project_id, row.version, provider, orderId, amount_minor, currency, 'created', new Date().toISOString(), target.purpose, seq, account_id, open.open_version, extra.idem_key ?? null, extra.expires_at ?? null, extra.session_url ?? null, extra.return_ref ?? null).run();
  try {
    if (provider === 'stripe') {
      const dest = await stripeFor(account_id);
      if (!dest) return json({error: 'Online payment is not available for this scope. Pay the creator the way you agreed.', code: 'payments_disabled'}, 503);
      // One open session per target: reuse it while Stripe says it is still payable.
      let generation = 0;
      const existing = await current();
      if (existing) {
        const s = await stripeSessionState(dest.config, existing.order_id);
        if (s.state === 'open' && existing.session_url) return json({provider, url: existing.session_url, amount_minor, currency, name, description, reused: true});
        if (s.paid) {
          await recordPaidPayment({...s.paid, event_id: null}, 'stripe_reconcile', {provider: 'stripe'});
          return json({error: 'This payment was already made. It is on the record now.', code: 'already_paid'}, 409);
        }
        await database.prepare('UPDATE payments SET superseded_at=? WHERE id=?').bind(new Date().toISOString(), existing.id).run();
        generation = Number((await database.prepare('SELECT COUNT(*)::int AS n FROM payments WHERE project_id=? AND provider=? AND purpose=? AND invoice_seq IS NOT DISTINCT FROM ?').bind(row.project_id, provider, target.purpose, seq).first<{n: number}>())?.n ?? 0);
      }
      const idem = await stripeIdempotencyKey({project_id: row.project_id, purpose: target.purpose, seq, amount_minor, open_version: open.open_version, account_id, generation});
      const ref = (await sha256Hex(idem + ':' + (process.env.SCOPEFLOW_SIGNING_SECRET ?? ''))).slice(0, 32);
      const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
      // L5: the return URL carries Stripe's session id and an opaque reference (never the review token).
      const success = publicUrl(request, '/payment-return') + `?status=success&ref=${ref}&session_id={CHECKOUT_SESSION_ID}`;
      const session = await createCheckoutSession(dest.config, {amount_minor, currency, name, description, metadata: notes, success_url: success,
        cancel_url: publicUrl(request, '/payment-return') + `?status=cancel&ref=${ref}`, idempotencyKey: idem, expires_at: expires});
      await store(session.id, {idem_key: idem, expires_at: new Date(expires * 1000).toISOString(), session_url: session.url, return_ref: ref});
      return json({provider, url: session.url, amount_minor, currency, name, description});
    }
    const dest = await razorpayFor(account_id);
    if (!dest) return json({error: 'Online payment is not available for this scope. Pay the creator the way you agreed.', code: 'payments_disabled'}, 503);
    // Reuse an open order for the same open amount (a reload or a second click never creates a second order).
    let orderId = (await current())?.order_id;
    if (!orderId) {
      orderId = (await createOrder(dest.credential, {amount_minor, currency, receipt: `sf-${row.project_id.slice(0, 20)}-v${row.version}${seq ? '-i' + seq : ''}`, notes,
        ...(dest.transferTo ? {transfers: [{account: dest.transferTo, amount: amount_minor, currency, on_hold: true, notes: {project_id: row.project_id, purpose: target.purpose}}]} : {})})).id;
      await store(orderId);
    }
    return json({provider, key_id: checkoutKey(dest.credential), order_id: orderId, amount_minor, currency, amount: fromMinor(amount_minor, currency),
      name: target.purpose === 'deposit' ? 'Deposit' : `Invoice ${invoiceNumber}`, description, verify_path: `/api/review/${token}/payments/razorpay/verify`});
  } catch (e) {
    if (e instanceof RazorpayError || e instanceof StripeError) return json({error: e.message, code: 'provider_error'}, 502);
    throw e;
  }
}
