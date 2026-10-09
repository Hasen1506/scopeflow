import {z} from 'zod';
import {db, json, ownerAuth, body, safeOrigin, allowWrite, failure} from '@/lib/server';
import {loadLedger, appendEntry, LedgerConflict} from '@/lib/ledger-server';
import {paymentsOf, refundableOf, type Payment} from '@/lib/ledger';
import {RazorpayError, razorpayConfig, razorpayRefund, toMinorUnits} from '@/lib/razorpay';
import {StripeError, stripeConfig, stripeRefund} from '@/lib/stripe';
import {todayIn} from '@/lib/invoice-server';
type Ctx = {params: Promise<{id: string}>};
const input = z.object({payment_seq: z.number().int().min(1), amount: z.number().finite().positive(), note: z.string().trim().max(500).default(''), request_id: z.string().regex(/^[A-Za-z0-9_-]{8,120}$/)}).strict();
// Refund an online payment through the provider that took it (Razorpay or Stripe), then put the
// refund on the signed record (kind "refund", with the provider's refund id). At most what is still
// refundable on that payment. A retry with the same request_id returns the recorded refund.
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
    const {payment_seq, note, request_id} = parsed.data, amount = Math.round(parsed.data.amount * 100) / 100;
    const ref = 'refund-req:' + request_id;
    const prior = await db().prepare('SELECT seq FROM ledger_entries WHERE project_id=? AND ref=?').bind(id, ref).first<{seq: number}>();
    if (prior) return json({replayed: true, seq: prior.seq});
    const ledger = await loadLedger(id);
    if (!ledger.baseline) return json({error: 'There is no approved agreement on this project.'}, 409);
    const entry = ledger.entries.find(e => e.seq === payment_seq && e.kind === 'payment' && e.baseline_version === ledger.baseline!.version);
    if (!entry || !entry.payload) return json({error: 'That online payment was not found on the current agreement.'}, 404);
    const payment = entry.payload as Payment;
    const {lines} = paymentsOf(ledger.entries.filter(e => e.baseline_version === ledger.baseline!.version));
    const line = lines.find(l => l.seq === payment_seq)!;
    const left = refundableOf(line, lines);
    if (amount > left + 0.005) return json({error: `At most ${left.toFixed(2)} of this payment can still be refunded.`, code: 'refund_exceeds_paid'}, 400);
    let refundId: string;
    try {
      const minor = toMinorUnits(amount, payment.currency);
      if (payment.provider === 'stripe') {
        const config = stripeConfig();
        if (!config) return json({error: 'Stripe is not configured on this server, so it cannot refund. Refund the client another way and record it.', code: 'payments_disabled'}, 503);
        refundId = (await stripeRefund(config, payment.payment_id, minor, 'sf-refund-' + request_id)).id;
      } else {
        const config = razorpayConfig();
        if (!config) return json({error: 'Razorpay is not configured on this server, so it cannot refund. Refund the client another way and record it.', code: 'payments_disabled'}, 503);
        refundId = (await razorpayRefund(config, payment.payment_id, minor, `sf-${id.slice(0, 20)}-${payment_seq}`)).id;
      }
    } catch (e) {
      if (e instanceof RazorpayError || e instanceof StripeError) return json({error: e.message, code: 'provider_error'}, 502);
      throw e;
    }
    // The provider has refunded: record it, retrying when the ledger moved underneath.
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = attempt ? await loadLedger(id) : ledger;
      try {
        const appended = await appendEntry({baseline: current.baseline!, expectedHead: current.head, kind: 'refund', actor: 'owner', ref,
          payload: {amount, method: payment.provider, refunded: todayIn(project.timezone), reference: '', note, provider_refund_id: refundId, refund_of: payment_seq}});
        return json({seq: appended.seq, refund_id: refundId}, 201);
      } catch (e) { if (!(e instanceof LedgerConflict) || attempt === 2) { console.error('Scopeflow refund issued but not recorded', JSON.stringify({project: id, refund_id: refundId})); throw e; } }
    }
    return json({error: 'The refund was issued but could not be recorded; record it manually.', refund_id: refundId}, 503);
  } catch (e) { return failure(e); }
}
