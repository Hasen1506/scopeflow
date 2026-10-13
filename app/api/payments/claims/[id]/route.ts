import {z} from 'zod';
import {db, json, ownerAuth, body, safeOrigin, allowWrite, failure} from '@/lib/server';
import {loadLedger, LedgerConflict} from '@/lib/ledger-server';
import {appendMoneyEntry} from '@/lib/ledger-hooks';
import {todayIn} from '@/lib/invoice-server';
import {fromMinor} from '@/lib/minor';
import {isMoneyEntryError} from '@/lib/payment-record';
import {raiseAlert} from '@/lib/payment-accounts-server';
type Ctx = {params: Promise<{id: string}>};
const input = z.object({action: z.enum(['confirm', 'reject']), received: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), note: z.string().trim().max(300).default('')}).strict();

// The owner confirms (or rejects) a client's "I've paid" claim. Confirming appends a
// payment_received entry (method UPI or bank transfer, reference = the UTR) to the signed record,
// once (ledger ref claim:<id>); from then on it counts toward the deposit and the balance like
// any recorded payment, on whichever version is current (C4).
export async function POST(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in or provide a valid API token.'}, 401);
    if (!auth.scopes.includes('scopes:write')) return json({error: 'This credential cannot record payments.'}, 403);
    const {id} = await ctx.params;
    if (!/^[0-9a-f-]{36}$/.test(id)) return json({error: 'Claim not found.'}, 404);
    if (!await allowWrite('owner:' + auth.user, 30)) return json({error: 'Write limit reached. Try again in a minute.'}, 429);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const parsed = input.safeParse(raw);
    if (!parsed.success) return json({error: 'Choose confirm or reject.'}, 400);
    const database = db();
    const claim = await database.prepare('SELECT c.id,c.project_id,c.amount_minor,c.currency,c.method,c.utr,c.payer_name,c.status,c.created,c.ledger_seq,p.timezone,p.archived FROM scopeflow.payment_claims c JOIN projects p ON p.id=c.project_id WHERE c.id=? AND p.owner=?').bind(id, auth.user)
      .first<{id: string; project_id: string; amount_minor: number | string; currency: string; method: 'upi' | 'bank_transfer'; utr: string; payer_name: string; status: string; created: string; ledger_seq: number | null; timezone: string | null; archived: string | null}>();
    if (!claim) return json({error: 'Claim not found.'}, 404);
    if (claim.status === 'confirmed') return json({replayed: true, status: 'confirmed', seq: claim.ledger_seq});
    if (claim.status === 'rejected') return json({error: 'This claim was rejected.', code: 'claim_rejected'}, 409);
    if (parsed.data.action === 'reject') {
      await database.prepare("UPDATE scopeflow.payment_claims SET status='rejected',decided_at=? WHERE id=? AND status='pending'").bind(new Date().toISOString(), id).run();
      return json({status: 'rejected'});
    }
    if (claim.archived) return json({error: 'This project is archived. Restore it before recording payments.', code: 'archived'}, 409);
    const ref = 'claim:' + id;
    const received = parsed.data.received ?? todayIn(claim.timezone);
    const note = ['Client payment confirmed', claim.payer_name ? `from ${claim.payer_name}` : '', parsed.data.note].filter(Boolean).join(' · ').slice(0, 500);
    let seq: number | null = null;
    for (let attempt = 0; attempt < 4 && seq === null; attempt++) {
      const prior = await database.prepare('SELECT seq FROM ledger_entries WHERE project_id=? AND ref=?').bind(claim.project_id, ref).first<{seq: number}>();
      if (prior) { seq = prior.seq; break; }
      const ledger = await loadLedger(claim.project_id);
      if (!ledger.baseline) return json({error: 'There is no approved agreement to record the payment on.', code: 'not_approved'}, 409);
      try {
        seq = (await appendMoneyEntry({baseline: ledger.baseline, expectedHead: ledger.head, kind: 'payment_received', actor: 'owner', ref,
          payload: {amount: fromMinor(Number(claim.amount_minor), claim.currency), method: claim.method, received, reference: claim.utr, note}, context: {claim_id: id}})).seq;
      } catch (e) {
        if ((e instanceof LedgerConflict || (isMoneyEntryError(e) && e.code === 'conflict')) && attempt < 3) continue;
        // H6: the confirmation could not be recorded: alert (payment_alerts + notify) and answer 500.
        await raiseAlert({project_id: claim.project_id, kind: 'claim_unrecorded', dedupe: 'claim:' + id, detail: {claim_id: id, amount_minor: Number(claim.amount_minor), currency: claim.currency, utr: claim.utr, reason: e instanceof Error ? e.message.slice(0, 200) : 'unknown'}});
        return json({error: 'The payment could not be put on the record. Try again shortly.', code: 'record_failed'}, 500);
      }
    }
    if (seq === null) return json({error: 'The record was busy. Try again.', code: 'record_failed'}, 500);
    await database.prepare("UPDATE scopeflow.payment_claims SET status='confirmed',decided_at=?,ledger_seq=? WHERE id=? AND status='pending'").bind(new Date().toISOString(), seq, id).run();
    return json({status: 'confirmed', seq}, 201);
  } catch (e) { return failure(e); }
}
