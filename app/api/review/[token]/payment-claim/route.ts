import {z} from 'zod';
import {db, json, body, safeOrigin, allowWrite, failure} from '@/lib/server';
import {notify} from '@/lib/notify';
import {paymentOptions} from '@/lib/deposit-server';
import {maskRef, parseUtr} from '@/lib/upi';
import type {Scope} from '@/lib/scope';
type Ctx = {params: Promise<{token: string}>};
const input = z.object({purpose: z.enum(['deposit', 'invoice', 'balance']), invoice_seq: z.number().int().min(1).optional(), amount_minor: z.number().int().positive().max(1e13), method: z.enum(['upi', 'bank_transfer']).default('upi'), utr: z.string().trim().min(6).max(40), payer_name: z.string().trim().max(120).default(''), note: z.string().trim().max(300).default('')}).strict();

// "I've paid" from the client page (LT-02): the client paid the freelancer directly (UPI or bank
// transfer) and gives the UTR / UPI reference. Nothing counts as paid until the freelancer
// confirms it (POST /api/payments/claims/<id>), which appends a payment_received entry; the claim
// itself only notifies them (WS-06 notify('payment_claim')). One claim per reference per project.
export async function POST(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const {token} = await ctx.params;
    if (!/^[a-f0-9]{64}$/.test(token)) return json({error: 'This review link was not found.'}, 404);
    const row = await db().prepare('SELECT v.id,v.project_id,v.version,v.status,v.content,p.latest,p.owner FROM versions v JOIN projects p ON p.id=v.project_id WHERE v.token=? AND v.revoked=0').bind(token).first<{id: string; project_id: string; version: number; status: string; content: string; latest: number; owner: string}>();
    if (!row) return json({error: 'This review link was not found.'}, 404);
    if (row.status !== 'approved' || row.version !== row.latest) return json({error: 'Payments open once this version is approved.', code: 'not_approved'}, 409);
    if (!await allowWrite('claim:' + row.id, 5)) return json({error: 'Too many attempts. Try again in a minute.'}, 429);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const parsed = input.safeParse(raw);
    if (!parsed.success) return json({error: 'Enter the amount and the payment reference (UTR).'}, 400);
    const c = parsed.data;
    const utr = parseUtr(c.utr, c.method);
    if (!utr) return json({error: c.method === 'upi' ? 'Enter the 12-digit UPI reference (UTR / RRN) from your payment app.' : 'Enter the bank reference (UTR) of the transfer: 6 to 22 letters and digits.', code: 'invalid_utr'}, 400);
    const content = JSON.parse(row.content) as Scope;
    const options = await paymentOptions(row.project_id, row.version, content, token);
    const target = options.targets.find(t => t.purpose === c.purpose && (c.purpose !== 'invoice' || t.seq === c.invoice_seq));
    if (!target) return json({error: c.purpose === 'invoice' ? 'That invoice is not open.' : `Nothing is open for the ${c.purpose}.`, code: 'nothing_open'}, 409);
    if (c.amount_minor > options.money.total_minor) return json({error: 'That is more than the whole agreement.', code: 'amount_too_large'}, 400);
    const id = crypto.randomUUID();
    const inserted = await db().prepare('INSERT INTO scopeflow.payment_claims (id,project_id,version,purpose,invoice_seq,amount_minor,currency,method,utr,payer_name,note,status,created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (project_id,utr) DO NOTHING RETURNING id')
      .bind(id, row.project_id, row.version, c.purpose, c.purpose === 'invoice' ? c.invoice_seq ?? null : null, c.amount_minor, content.currency, c.method, utr, c.payer_name, c.note, 'pending', new Date().toISOString()).first();
    if (!inserted) return json({error: 'A payment with this reference was already reported.', code: 'duplicate_claim'}, 409);
    await notify('payment_claim', {project_id: row.project_id, owner: row.owner, data: {claim_id: id, purpose: c.purpose, invoice_seq: c.invoice_seq ?? null, amount_minor: c.amount_minor, currency: content.currency, method: c.method, utr: maskRef(utr)}});
    return json({claim: {id, purpose: c.purpose, invoice_seq: c.invoice_seq ?? null, amount_minor: c.amount_minor, currency: content.currency, method: c.method, utr: maskRef(utr), status: 'pending'}}, 201);
  } catch (e) { return failure(e); }
}
