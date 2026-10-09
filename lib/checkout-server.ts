import {db, json, allowWrite} from './server';
import {RazorpayError, createOrder, depositAmount, paymentsStatus, providerFor, razorpayConfig, toMinorUnits} from './razorpay';
import {StripeError, createCheckoutSession, stripeConfig} from './stripe';
import {loadLedger} from './ledger-server';
import {clientInvoices} from './invoice-server';
import {paymentsOf} from './ledger';
import {publicUrl} from './origin';
import type {Scope} from './scope';

type Row = {id: string; project_id: string; version: number; status: string; content: string; latest: number; timezone: string | null};
export type CheckoutTarget = {purpose: 'deposit'} | {purpose: 'invoice'; seq: number};

/**
 * Starts an online payment from a review link: the deposit due on signature, or what is still open
 * on one issued invoice (a partial payment of the balance). Razorpay answers with an order for its
 * Checkout widget; Stripe with a hosted Checkout URL. Only the provider's verified webhook (or the
 * reconciliation job) marks it paid. The review token never goes to the provider.
 */
export async function startCheckout(request: Request, token: string, target: CheckoutTarget): Promise<Response> {
  if (!/^[a-f0-9]{64}$/.test(token)) return json({error: 'This review link was not found.'}, 404);
  const row = await db().prepare('SELECT v.id,v.project_id,v.version,v.status,v.content,p.latest,p.timezone FROM versions v JOIN projects p ON p.id=v.project_id WHERE v.token=? AND v.revoked=0').bind(token).first<Row>();
  if (!row) return json({error: 'This review link was not found.'}, 404);
  if (row.status !== 'approved' || row.version !== row.latest) return json({error: `${target.purpose === 'deposit' ? 'A deposit' : 'An invoice'} can be paid once this version is approved.`, code: 'not_approved'}, 409);
  const content = JSON.parse(row.content) as Scope, currency = content.currency;
  const ledger = await loadLedger(row.project_id);
  const entries = ledger.entries.filter(e => e.baseline_version === row.version);
  let amount: number, invoiceNumber: string | undefined;
  if (target.purpose === 'deposit') {
    amount = depositAmount(content);
    if (!(amount > 0)) return json({error: 'This scope has no deposit.', code: 'no_deposit'}, 409);
    // Money already on the record (recorded by the creator, or paid online) counts: never ask twice.
    if (paymentsOf(entries).paid + 0.005 >= amount) return json({error: 'The payments on the record already cover the deposit.', code: 'already_paid'}, 409);
  } else {
    const invoice = (await clientInvoices(row.project_id, row.version, ledger.entries, row.timezone)).find(i => i.seq === target.seq);
    if (!invoice) return json({error: 'Invoice not found.'}, 404);
    if (!(invoice.open > 0)) return json({error: `Invoice ${invoice.number} is already paid.`, code: 'already_paid'}, 409);
    amount = invoice.open; invoiceNumber = invoice.number;
  }
  const provider = providerFor(currency);
  if (!provider) return json({error: paymentsStatus(process.env, currency).reason + ' Pay the creator the way you agreed.', code: 'payments_disabled'}, 503);
  if (!await allowWrite('deposit:' + row.id, 10)) return json({error: 'Too many attempts. Try again in a minute.'}, 429);
  const seq = target.purpose === 'invoice' ? target.seq : null;
  if (target.purpose === 'deposit' && await db().prepare("SELECT 1 AS x FROM payments WHERE project_id=? AND version=? AND purpose='deposit' AND status='paid'").bind(row.project_id, row.version).first()) return json({error: 'The deposit for this version is already paid.', code: 'already_paid'}, 409);
  const amount_minor = toMinorUnits(amount, currency);
  const name = target.purpose === 'deposit' ? 'Deposit' : `Invoice ${invoiceNumber}`;
  const description = `${content.title} · version ${row.version}`.slice(0, 250);
  const notes = {project_id: row.project_id, version: String(row.version), purpose: target.purpose, ...(seq ? {invoice_seq: String(seq)} : {})};
  const store = (orderId: string) => db().prepare('INSERT INTO payments (id,project_id,version,provider,order_id,amount_minor,currency,status,created,purpose,invoice_seq) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING')
    .bind(crypto.randomUUID(), row.project_id, row.version, provider, orderId, amount_minor, currency, 'created', new Date().toISOString(), target.purpose, seq).run();
  try {
    if (provider === 'stripe') {
      // Idempotent per hour for the same payment: a double click or reload gets the same session.
      const session = await createCheckoutSession(stripeConfig()!, {amount_minor, currency, name, description, metadata: notes,
        success_url: publicUrl(request, '/payment-return?status=success'), cancel_url: publicUrl(request, '/payment-return?status=cancel'),
        idempotencyKey: `sf-${row.project_id}-${row.version}-${target.purpose}-${seq ?? 0}-${amount_minor}-${Math.floor(Date.now() / 3600_000)}`});
      await store(session.id);
      return json({provider, url: session.url, amount_minor, currency, name, description});
    }
    const config = razorpayConfig()!;
    // Reuse an open order for the same payment (a reload or a second click never creates a second order).
    const open = await db().prepare("SELECT order_id FROM payments WHERE project_id=? AND version=? AND provider='razorpay' AND purpose=? AND invoice_seq IS NOT DISTINCT FROM ? AND status='created' AND amount_minor=? AND currency=? ORDER BY created DESC LIMIT 1").bind(row.project_id, row.version, target.purpose, seq, amount_minor, currency).first<{order_id: string}>();
    let orderId = open?.order_id;
    if (!orderId) {
      orderId = (await createOrder(config, {amount_minor, currency, receipt: `sf-${row.project_id.slice(0, 20)}-v${row.version}${seq ? '-i' + seq : ''}`, notes})).id;
      await store(orderId);
    }
    return json({provider, key_id: config.keyId, order_id: orderId, amount_minor, currency, name: target.purpose === 'deposit' ? 'Scopeflow deposit' : `Invoice ${invoiceNumber}`, description});
  } catch (e) {
    if (e instanceof RazorpayError || e instanceof StripeError) return json({error: e.message, code: 'provider_error'}, 502);
    throw e;
  }
}
