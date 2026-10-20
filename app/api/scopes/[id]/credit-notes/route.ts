import {randomUUID} from 'node:crypto';
import {db, json, body, safeOrigin, allowWrite, allowRead, failure} from '@/lib/server';
import {projectFor} from '@/lib/invoice-api';
import {cancelled, loadDocs, lockOwnerSeries, readSql, withProjectLock} from '@/lib/invoice-server';
import {creditNoteContent, creditNoteRequestSchema, liveHeadsOf} from '@/lib/credit-note';
import {fromMinorOf, toMinorOf, amountProblem} from '@/lib/invoice';
import {zoneOrUtc} from '@/lib/time';
type Ctx = {params: Promise<{id: string}>};

// H12: credit notes against issued invoices. Own series (CN-0001 …), immutable, full or partial. A
// fully credited invoice is cancelled and stops counting toward the invoicing cap (C2).
export async function GET(request: Request, ctx: Ctx) {
  try {
    const {id} = await ctx.params;
    const p = await projectFor(request, id);
    if (p.error) return p.error;
    if (!await allowRead('owner:' + p.auth.user)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const docs = await loadDocs(readSql(), id);
    return json({credit_notes: docs.credits.map(c => ({seq: c.seq, number: c.number, invoice_seq: c.invoice_seq, invoice_number: c.content.invoice.number, amount: fromMinorOf(c.amount, c.content.currency), full: c.content.full, reason: c.content.reason, issued: c.issued.slice(0, 10)}))});
  } catch (e) { return failure(e); }
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const {id} = await ctx.params;
    const p = await projectFor(request, id);
    if (p.error) return p.error;
    if (!p.auth.scopes.includes('scopes:write')) return json({error: 'This credential cannot issue credit notes.'}, 403);
    if (!await allowWrite('owner:' + p.auth.user)) return json({error: 'Write limit reached. Try again in a minute.'}, 429);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const input = creditNoteRequestSchema.safeParse(raw);
    if (!input.success) return json({error: input.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}, 400);
    const req = input.data, owner = p.auth.user;
    if (req.request_id) {
      const hit = await db().prepare('SELECT seq,number FROM scopeflow.credit_notes WHERE owner=? AND request_id=?').bind(owner, req.request_id).first<{seq: number; number: string}>();
      if (hit) return json({credit_note: hit, replayed: true});
    }
    return await withProjectLock(id, async tx => {
      const docs = await loadDocs(tx, id);
      const inv = docs.invoices.find(i => i.row.seq === req.invoice_seq);
      if (!inv) return json({error: 'Invoice not found.'}, 404);
      if (cancelled(inv)) return json({error: `Invoice ${inv.row.number} is already cancelled by ${inv.cancelled_by.join(', ')}.`, code: 'already_cancelled'}, 409);
      const live = inv.total - inv.credited, liveTaxable = Math.max(0, inv.gross_taxable - (inv.content.advance?.taxable ?? 0) - inv.credited_taxable);
      if (!(live > 0)) return json({error: `Invoice ${inv.row.number} asks for nothing that could be credited.`, code: 'nothing_to_credit'}, 409);
      let amount: number | null = null;
      if (req.amount !== undefined) {
        const bad = amountProblem(req.amount, inv.row.currency);
        if (bad) return json({error: bad, code: 'invalid_amount'}, 400);
        amount = toMinorOf(req.amount, inv.row.currency);
        if (amount > live) return json({error: `At most ${fromMinorOf(live, inv.row.currency).toFixed(2)} is left on ${inv.row.number} to credit.`, code: 'exceeds_invoice'}, 400);
      }
      await lockOwnerSeries(tx, owner, 'cn');
      const [n] = await tx.unsafe('SELECT coalesce(max(seq),0)+1 AS seq FROM scopeflow.credit_notes WHERE owner=$1', [owner]);
      const seq = Number(n.seq);
      const issued = new Intl.DateTimeFormat('en-CA', {timeZone: zoneOrUtc(p.row.timezone), year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
      // M5: the invoice's heads less those of earlier credit notes on it, so a full credit after partial ones reverses exactly what is left.
      const liveHeads = liveHeadsOf(inv.content, docs.credits.filter(c => c.invoice_seq === inv.row.seq));
      const content = creditNoteContent({seq, issued, reason: req.reason, invoice_seq: inv.row.seq, invoice: inv.content, live, live_taxable: liveTaxable, amount, ...(liveHeads ? {live_heads: liveHeads} : {})});
      await tx.unsafe('INSERT INTO scopeflow.credit_notes (id,owner,project_id,seq,number,invoice_seq,amount_minor,taxable_minor,currency,reason,issued,request_id,content) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
        [randomUUID(), owner, id, seq, content.number, inv.row.seq, content.breakdown.total, content.breakdown.taxable, inv.row.currency, req.reason, new Date().toISOString(), req.request_id ?? null, JSON.stringify(content)]);
      return json({credit_note: {seq, number: content.number, invoice_seq: inv.row.seq, invoice_number: inv.row.number, amount: fromMinorOf(content.breakdown.total, inv.row.currency), full: content.full}}, 201);
    });
  } catch (e) { return failure(e); }
}
