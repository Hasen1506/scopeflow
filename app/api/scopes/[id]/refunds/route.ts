import {z} from 'zod';
import {db, json, ownerAuth, body, safeOrigin, allowWrite, failure} from '@/lib/server';
import {loadLedger} from '@/lib/ledger-server';
import {findPaymentEntry, projectPaymentLines} from '@/lib/money-ledger';
import {RazorpayError, razorpayRefund} from '@/lib/razorpay';
import {StripeError, stripeRefund} from '@/lib/stripe';
import {razorpayFor, raiseAlert, stripeFor} from '@/lib/payment-accounts-server';
import {finalizeRefund, isMoneyEntryError, REFUND_COLUMNS, type PendingRefund} from '@/lib/payment-record';
import {exponentOf, fromMinor, toMinor} from '@/lib/minor';
type Ctx = {params: Promise<{id: string}>};
const input = z.object({payment_seq: z.number().int().min(1), amount: z.number().finite().positive(), note: z.string().trim().max(500).default(''), request_id: z.string().regex(/^[A-Za-z0-9_-]{8,120}$/)}).strict();

// Refund an online payment through the account that took it (the freelancer's own Razorpay or
// Stripe; legacy payments through the operator's keys that took them), then put the refund on the
// signed record (kind "refund", with the provider's refund id). At most what is still refundable on
// that payment. The payment may be on ANY version of the agreement (C4: money is project-scoped).
//
// H9/H14, in order: (1) reserve the refund as a refunds_pending row, unique on project+request_id,
// inside the project lock, with what is left computed IN the lock (ledger refunds + other pending
// ones); (2) call the provider with an idempotency key; (3) append the ledger entry against the
// current baseline. A crash after (2) leaves an 'issued' row the reconcile job finalises; a crash
// before it a 'pending' row reconcile resolves with the provider. A retry with the same request_id
// never reaches the provider twice.
export async function POST(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in or provide a valid API token.'}, 401);
    if (!auth.scopes.includes('scopes:write')) return json({error: 'This credential cannot refund payments.'}, 403);
    const {id} = await ctx.params;
    const project = await db().prepare('SELECT archived,timezone FROM projects WHERE id=? AND owner=?').bind(id, auth.user).first<{archived: string | null; timezone: string | null}>();
    if (!project) return json({error: 'Project not found.'}, 404);
    if (project.archived) return json({error: 'This project is archived. Restore it before refunding.', code: 'archived'}, 409);
    if (!await allowWrite('owner:' + auth.user, 10)) return json({error: 'Write limit reached. Try again in a minute.'}, 429);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const parsed = input.safeParse(raw);
    if (!parsed.success) return json({error: 'Provide payment_seq, amount and request_id.'}, 400);
    const {payment_seq, note, request_id} = parsed.data;
    const database = db(), ref = 'refund-req:' + request_id;
    const prior = await database.prepare('SELECT seq FROM ledger_entries WHERE project_id=? AND ref=?').bind(id, ref).first<{seq: number}>();
    if (prior) return json({replayed: true, seq: prior.seq});
    const pendingRow = () => database.prepare(`SELECT ${REFUND_COLUMNS} FROM scopeflow.refunds_pending WHERE project_id=? AND request_id=?`).bind(id, request_id).first<PendingRefund>();
    const earlier = await pendingRow();
    if (earlier) return replay(earlier);
    const ledger = await loadLedger(id);
    if (!ledger.baseline) return json({error: 'There is no approved agreement on this project.'}, 409);
    const entry = findPaymentEntry(ledger.entries, payment_seq);
    if (!entry) return json({error: 'That online payment was not found on this project.'}, 404);
    const payment = entry.payload, currency = payment.currency;
    if (Math.abs(parsed.data.amount * 10 ** exponentOf(currency) - Math.round(parsed.data.amount * 10 ** exponentOf(currency))) > 1e-6) return json({error: `Enter the amount with at most ${exponentOf(currency)} decimals.`}, 400);
    const amount_minor = toMinor(parsed.data.amount, currency);
    const line = projectPaymentLines(ledger.entries).find(l => l.seq === payment_seq)!;
    const pendingSum = Number((await database.prepare("SELECT COALESCE(SUM(amount_minor),0)::bigint AS n FROM scopeflow.refunds_pending WHERE project_id=? AND payment_seq=? AND status IN ('pending','issued')").bind(id, payment_seq).first<{n: number | string}>())?.n ?? 0);
    const left = toMinor(line.refundable, currency) - pendingSum;
    if (amount_minor > left) return json({error: `At most ${fromMinor(Math.max(0, left), currency).toFixed(exponentOf(currency))} of this payment can still be refunded.`, code: 'refund_exceeds_paid'}, 400);
    const order = await database.prepare('SELECT account_id FROM payments WHERE provider=? AND order_id=?').bind(payment.provider, payment.order_id).first<{account_id: string | null}>();
    const accountId = order?.account_id ?? null;
    const idem = `sf-refund-${id.slice(0, 24)}-${request_id}`.slice(0, 120);
    const now = new Date().toISOString(), factor = 10 ** exponentOf(currency);
    // (1) Reserve inside the project lock; `left` is recomputed there from the ledger and every
    // other reservation, so two different requests can never both take the same money.
    const reserved = await database.prepare(`INSERT INTO scopeflow.refunds_pending (id,project_id,request_id,payment_seq,amount_minor,currency,provider,account_id,payment_id,idem_key,note,status,created,updated)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,'pending',?,? WHERE ?::bigint <= ?::bigint
        - COALESCE((SELECT SUM(ROUND((l.payload::jsonb->>'amount')::numeric * ?::numeric)) FROM ledger_entries l WHERE l.project_id=? AND l.kind='refund' AND l.payload::jsonb->>'refund_of'=?), 0)
        - COALESCE((SELECT SUM(r.amount_minor) FROM scopeflow.refunds_pending r WHERE r.project_id=? AND r.payment_seq=? AND r.status IN ('pending','issued')), 0)
      ON CONFLICT (project_id, request_id) DO NOTHING RETURNING id`)
      .bind(crypto.randomUUID(), id, request_id, payment_seq, amount_minor, currency, payment.provider, accountId, payment.payment_id, idem, note, now, now,
        amount_minor, toMinor(payment.amount, currency), factor, id, String(payment_seq), id, payment_seq)
      .lock('scopeflow:project:' + id).first<{id: string}>();
    if (!reserved) {
      const same = await pendingRow();
      if (same) return replay(same);
      return json({error: 'Another refund of this payment was just made. Reload to see what is left.', code: 'refund_exceeds_paid'}, 409);
    }
    const p = (await pendingRow())!;
    // (2) The provider, with an idempotency key, through the account that took the payment.
    let refundId: string;
    try {
      if (payment.provider === 'stripe') {
        const dest = await stripeFor(accountId);
        if (!dest) return await unavailable(p, 'Stripe');
        refundId = (await stripeRefund(dest.config, payment.payment_id, amount_minor, idem)).id;
      } else {
        const dest = await razorpayFor(accountId);
        if (!dest) return await unavailable(p, 'Razorpay');
        refundId = (await razorpayRefund(dest.credential, payment.payment_id, amount_minor, `sf-${id.slice(0, 20)}-${payment_seq}`, fetch, process.env, idem)).id;
      }
    } catch (e) {
      if (e instanceof RazorpayError || e instanceof StripeError) {
        // A clear refusal moved no money: release the reservation. Unreachable: keep it pending for reconcile.
        if (e.status >= 400 && e.status < 500) await database.prepare("UPDATE scopeflow.refunds_pending SET status='failed',error=?,updated=? WHERE id=?").bind(e.message.slice(0, 300), new Date().toISOString(), p.id).run();
        return json({error: e.message, code: 'provider_error', ...(e.status ? {} : {pending: true})}, 502);
      }
      throw e;
    }
    await database.prepare("UPDATE scopeflow.refunds_pending SET status='issued',provider_refund_id=?,updated=? WHERE id=? AND status='pending'").bind(refundId, new Date().toISOString(), p.id).run();
    // (3) Put it on the record, against whatever baseline is current now.
    return await finalize({...p, status: 'issued', provider_refund_id: refundId}, 201);
  } catch (e) { return failure(e); }
}

async function finalize(p: PendingRefund, status: number) {
  let failed = false;
  try {
    const seq = await finalizeRefund(p);
    // A replay (status 200: the same request_id while the first was still recording) says so.
    if (seq) return json({seq, refund_id: p.provider_refund_id, ...(status === 200 ? {replayed: true} : {})}, status);
  } catch (e) {
    // H6/H14: the provider refunded but the record could not take it (WS-05 MoneyEntryError, or any
    // other failure): alert the owner (payment_alerts + notify) and answer 500; reconcile finalises it.
    failed = true;
    console.error('Scopeflow refund issued but not recorded', JSON.stringify({project: p.project_id, refund_id: p.provider_refund_id, error: String(e), code: isMoneyEntryError(e) ? e.code : null}));
  }
  await raiseAlert({project_id: p.project_id, kind: 'refund_unrecorded', dedupe: 'refund:' + p.id, detail: {request_id: p.request_id, refund_id: p.provider_refund_id, amount_minor: Number(p.amount_minor), currency: p.currency, payment_seq: p.payment_seq}});
  return json({error: 'The refund was issued. It will appear on the record shortly.', code: 'refund_pending_record', refund_id: p.provider_refund_id}, failed ? 500 : 503);
}
async function replay(p: PendingRefund) {
  if (p.status === 'recorded' && p.ledger_seq) return json({replayed: true, seq: p.ledger_seq});
  if (p.status === 'issued') return finalize(p, 200);
  if (p.status === 'failed') return json({error: 'This refund request was refused by the provider. Use a new request_id to try again.', code: 'refund_failed'}, 409);
  return json({error: 'This refund is already being made.', code: 'refund_in_progress'}, 409);
}
async function unavailable(p: PendingRefund, name: string) {
  await db().prepare("UPDATE scopeflow.refunds_pending SET status='failed',error=?,updated=? WHERE id=?").bind('account unavailable', new Date().toISOString(), p.id).run();
  return json({error: `The ${name} account that took this payment is not available, so it cannot refund. Refund the client another way and record it.`, code: 'payments_disabled'}, 503);
}
