import {db, json, safeOrigin, allowWrite, failure} from '@/lib/server';
import {RazorpayError, createOrder, depositAmount, paymentsStatus, razorpayConfig, toMinorUnits} from '@/lib/razorpay';
import type {Scope} from '@/lib/scope';
type Ctx = {params: Promise<{token: string}>};
type Row = {id: string; project_id: string; version: number; status: string; content: string; latest: number};
// PR F: create (or reuse) the Razorpay order for the deposit due on an approved version.
// Disabled with an explanation (503, payments_disabled) unless RAZORPAY_KEY_ID/SECRET are set.
export async function POST(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const {token} = await ctx.params;
    if (!/^[a-f0-9]{64}$/.test(token)) return json({error: 'This review link was not found.'}, 404);
    const row = await db().prepare('SELECT v.id,v.project_id,v.version,v.status,v.content,p.latest FROM versions v JOIN projects p ON p.id=v.project_id WHERE v.token=? AND v.revoked=0').bind(token).first<Row>();
    if (!row) return json({error: 'This review link was not found.'}, 404);
    if (row.status !== 'approved' || row.version !== row.latest) return json({error: 'A deposit can be paid once this version is approved.', code: 'not_approved'}, 409);
    const content = JSON.parse(row.content) as Scope;
    const amount = depositAmount(content);
    if (!(amount > 0)) return json({error: 'This scope has no deposit.', code: 'no_deposit'}, 409);
    // Money the creator already recorded (bank transfer, UPI…) counts: never ask the client to pay the deposit twice.
    const recorded = await db().prepare("SELECT payload FROM ledger_entries WHERE project_id=? AND baseline_version=? AND kind='payment_received'").bind(row.project_id, row.version).all<{payload: string}>();
    const recordedPaid = recorded.results.reduce((sum, r) => sum + (Number(JSON.parse(r.payload).amount) || 0), 0);
    if (recordedPaid + 0.005 >= amount) return json({error: 'The creator has already recorded payments that cover the deposit.', code: 'already_paid'}, 409);
    const config = razorpayConfig();
    if (!config) return json({error: paymentsStatus().reason + ' Pay the creator the way you agreed.', code: 'payments_disabled'}, 503);
    if (!await allowWrite('deposit:' + row.id, 10)) return json({error: 'Too many attempts. Try again in a minute.'}, 429);
    const paid = await db().prepare("SELECT 1 AS x FROM payments WHERE project_id=? AND version=? AND status='paid'").bind(row.project_id, row.version).first();
    if (paid) return json({error: 'The deposit for this version is already paid.', code: 'already_paid'}, 409);
    const amount_minor = toMinorUnits(amount, content.currency);
    // Reuse an open order for the same amount (a reload or a second click never creates a second order).
    const open = await db().prepare("SELECT order_id FROM payments WHERE project_id=? AND version=? AND status='created' AND amount_minor=? AND currency=? ORDER BY created DESC LIMIT 1").bind(row.project_id, row.version, amount_minor, content.currency).first<{order_id: string}>();
    let orderId = open?.order_id;
    if (!orderId) {
      try {
        const order = await createOrder(config, {amount_minor, currency: content.currency, receipt: `sf-${row.project_id.slice(0, 24)}-v${row.version}`, notes: {project_id: row.project_id, version: String(row.version), purpose: 'deposit'}});
        orderId = order.id;
      } catch (e) {
        if (e instanceof RazorpayError) return json({error: e.message, code: 'provider_error'}, 502);
        throw e;
      }
      await db().prepare('INSERT INTO payments (id,project_id,version,provider,order_id,amount_minor,currency,status,created) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING').bind(crypto.randomUUID(), row.project_id, row.version, 'razorpay', orderId, amount_minor, content.currency, 'created', new Date().toISOString()).run();
    }
    return json({provider: 'razorpay', key_id: config.keyId, order_id: orderId, amount_minor, currency: content.currency, name: 'Scopeflow deposit', description: `${content.title} · version ${row.version}`.slice(0, 250)});
  } catch (e) { return failure(e); }
}
