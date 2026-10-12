import {z} from 'zod';
import {json, body, safeOrigin, allowWrite, allowRead, failure} from '@/lib/server';
import {loadLedger} from '@/lib/ledger-server';
import {projectFor} from '@/lib/invoice-api';
import {ensureReceiptVouchers, invoicingState, withProjectLock} from '@/lib/invoice-server';
import {fromMinorOf} from '@/lib/invoice';
type Ctx = {params: Promise<{id: string}>};

// H11: receipt vouchers (GST rule 50) for advances. Listing issues any that are due; POST issues one
// for a specific payment on the record that the owner marks as an advance.
export async function GET(request: Request, ctx: Ctx) {
  try {
    const {id} = await ctx.params;
    const p = await projectFor(request, id);
    if (p.error) return p.error;
    if (!await allowRead('owner:' + p.auth.user)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const l = await loadLedger(id);
    const s = await invoicingState(p.row, l, {issueVouchers: !p.row.archived && !!l.baseline});
    return json({receipt_vouchers: s.docs.vouchers.map(v => ({seq: v.seq, number: v.number, kind: v.content.kind, ledger_seq: v.ledger_seq, amount: fromMinorOf(v.amount, s.currency), taxable: fromMinorOf(v.taxable, s.currency), heads: v.content.breakdown?.heads.map(h => ({...h, amount: fromMinorOf(h.amount, s.currency)})) ?? [], received: v.content.received, issued: v.issued.slice(0, 10)}))});
  } catch (e) { return failure(e); }
}

const issueSchema = z.object({ledger_seq: z.number().int().min(1)}).strict();
export async function POST(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const {id} = await ctx.params;
    const p = await projectFor(request, id);
    if (p.error) return p.error;
    if (!p.auth.scopes.includes('scopes:write')) return json({error: 'This credential cannot issue receipt vouchers.'}, 403);
    if (p.row.archived) return json({error: 'This project is archived.', code: 'archived'}, 409);
    if (!await allowWrite('owner:' + p.auth.user)) return json({error: 'Write limit reached. Try again in a minute.'}, 429);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const input = issueSchema.safeParse(raw);
    if (!input.success) return json({error: 'Give the ledger entry (ledger_seq) of the advance payment.'}, 400);
    const l = await loadLedger(id);
    if (!l.baseline || !l.content) return json({error: 'Receipt vouchers are issued once the client approves the scope.', code: 'not_approved'}, 409);
    const baseline = l.baseline, content = l.content;
    const entry = l.entries.find(e => e.seq === input.data.ledger_seq && (e.kind === 'payment' || e.kind === 'payment_received'));
    if (!entry) return json({error: 'That entry is not a payment on the record.', code: 'not_a_payment'}, 400);
    return await withProjectLock(id, async tx => {
      const s = await invoicingState(p.row, l, {tx});
      if (!s.profile.business_name) return json({error: 'Add your business name in Data controls first: it is printed on the voucher.', code: 'profile_required'}, 409);
      const existing = s.docs.vouchers.find(v => v.ledger_seq === entry.seq);
      if (existing) return json({receipt_voucher: {seq: existing.seq, number: existing.number}, replayed: true});
      const [v] = await ensureReceiptVouchers(tx, {owner: p.auth.user, projectId: id, version: baseline.version, content, entries: l.entries, profile: s.profile, project: p.row, agreement: s.agreement!}, entry.seq);
      if (!v) return json({error: 'Nothing is left to invoice on this agreement, so this payment is not an advance.', code: 'exceeds_uninvoiced'}, 409);
      return json({receipt_voucher: {seq: v.seq, number: v.number, amount: fromMinorOf(v.amount, s.currency)}}, 201);
    });
  } catch (e) { return failure(e); }
}
