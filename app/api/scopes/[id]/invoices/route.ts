import {randomUUID} from 'node:crypto';
import {db, json, body, safeOrigin, allowWrite, allowRead, failure} from '@/lib/server';
import {loadLedger} from '@/lib/ledger-server';
import {amountProblem, fromMinorOf, grossBreakdown, invoiceContent, invoiceNumber, invoiceNumberProblem, invoiceProblem, invoiceRequestSchema, netDays, type InvoiceContent} from '@/lib/invoice';
import {gstContext, invoicingState, unadjustedAdvances, viewsOf, allocationOf, loadDocs, withProjectLock, lockOwnerSeries} from '@/lib/invoice-server';
import {invoicingJson, projectFor} from '@/lib/invoice-api';
import {normalizeTds} from '@/lib/tds';
import {zoneOrUtc} from '@/lib/time';
type Ctx = {params: Promise<{id: string}>};

// Invoices for a project's approved agreement: list them, or issue the next one.
export async function GET(request: Request, ctx: Ctx) {
  try {
    const {id} = await ctx.params;
    const p = await projectFor(request, id);
    if (p.error) return p.error;
    if (!await allowRead('owner:' + p.auth.user)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const l = await loadLedger(id);
    // Issuing any receipt voucher due (H11) needs the project lock; archived projects are read only.
    const s = await invoicingState(p.row, l, {issueVouchers: !p.row.archived && !!l.baseline});
    return json(invoicingJson(s, l.entries, l.baseline?.decided ?? null, l.content?.payment_terms));
  } catch (e) { return failure(e); }
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const {id} = await ctx.params;
    const p = await projectFor(request, id);
    if (p.error) return p.error;
    const {auth, row} = p;
    if (!auth.scopes.includes('scopes:write')) return json({error: 'This credential cannot issue invoices.'}, 403);
    if (row.archived) return json({error: 'This project is archived. Restore it before issuing an invoice.', code: 'archived'}, 409);
    if (!await allowWrite('owner:' + auth.user)) return json({error: 'Write limit reached. Try again in a minute.'}, 429);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const input = invoiceRequestSchema.safeParse(raw);
    if (!input.success) return json({error: input.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}, 400);
    const req = input.data;
    const replay = async () => {
      if (!req.request_id) return null;
      const existing = await db().prepare('SELECT seq FROM invoices WHERE owner=? AND request_id=?').bind(auth.user, req.request_id).first<{seq: number}>();
      if (!existing) return null;
      const l = await loadLedger(id), s = await invoicingState(row, l);
      return json({invoice: s.views.find(v => v.seq === existing.seq), replayed: true});
    };
    const replayed = await replay();
    if (replayed) return replayed;
    const l = await loadLedger(id);
    const out = await withProjectLock(id, async tx => {
      const s = await invoicingState(row, l, {tx, issueVouchers: !!l.baseline});
      if (!s.profile.business_name) return json({error: 'Add your business name in Data controls (Business details) first: it is printed on the invoice.', code: 'profile_required'}, 409);
      if (!l.baseline || !l.content || !l.agreement || !s.agreement || !s.cap) return json({error: 'Invoices are issued once the client approves the scope.', code: 'not_approved'}, 409);
      const content = l.content, a = s.agreement, cap = s.cap, currency = a.currency;
      // M9: a milestone invoice: its frozen share, less what earlier live invoices for it asked for (min with C2).
      let milestone: InvoiceContent['milestone'], change_order: InvoiceContent['change_order'];
      let amount = req.amount, includes_tax = req.includes_tax ?? false, ceiling: number | null = null;
      if (req.milestone_id) {
        const line = s.schedule.find(m => m.id === req.milestone_id);
        if (!line) return json({error: 'That milestone is not in the approved scope.', code: 'unknown_milestone'}, 400);
        milestone = {id: line.id, title: line.title, pct: line.pct};
        const open = Math.max(0, line.amount - line.invoiced);
        if (!(open > 0)) return json({error: `${line.title} has already been invoiced in full.`, code: 'milestone_invoiced'}, 409);
        ceiling = open;
        if (amount === undefined) { amount = fromMinorOf(Math.min(open, cap.total > 0 ? cap.total : cap.gross_total), currency); includes_tax = true; }
      }
      if (req.change_order_seq) {
        const co = s.change_orders.find(c => c.seq === req.change_order_seq);
        if (!co) return json({error: 'That change order is not an approved change to this agreement.', code: 'unknown_change_order'}, 400);
        if (co.total <= 0) return json({error: 'This change order lowers the price: issue a credit note against an invoice instead.', code: 'negative_change_order'}, 409);
        change_order = {seq: co.seq, title: co.title};
        const open = Math.max(0, co.total - co.invoiced);
        if (!(open > 0)) return json({error: `Change order "${co.title}" has already been invoiced in full.`, code: 'change_order_invoiced'}, 409);
        ceiling = ceiling === null ? open : Math.min(ceiling, open);
        if (amount === undefined) { amount = fromMinorOf(Math.min(open, cap.total > 0 ? cap.total : cap.gross_total), currency); includes_tax = true; }
      }
      if (amount === undefined) return json({error: 'Give an amount to invoice.'}, 400);
      const decimals = amountProblem(amount, currency);
      if (decimals) return json({error: decimals, code: 'invalid_amount'}, 400);
      const gst = gstContext(s.profile, row);
      const gross = grossBreakdown({amount, includes_tax, currency, tax_pct: a.rate, tax_label: a.label, gst});
      if (ceiling !== null && gross.total > ceiling) return json({error: `Only ${fromMinorOf(ceiling, currency).toFixed(2)} is left to invoice on this ${milestone ? 'milestone' : 'change order'}.`, code: 'exceeds_uninvoiced', invoiceable: fromMinorOf(Math.min(ceiling, cap.total), currency)}, 409);
      // H11: the invoice that completes the agreement adjusts the advances (or any invoice, when asked).
      const final = cap.advances > 0 && req.adjust_advances !== false && (req.adjust_advances === true || gross.taxable >= cap.gross_taxable);
      const problem = invoiceProblem(gross, cap, currency, final);
      if (problem) return json({error: problem.error, code: problem.code, invoiceable: problem.invoiceable}, problem.status);
      const advances = final ? unadjustedAdvances(s.docs) : [];
      if (advances.reduce((t, v) => t + v.taxable, 0) > gross.taxable) return json({error: 'This invoice is smaller than the advances it would adjust. Invoice the whole balance.', code: 'advance_exceeds_invoice'}, 409);
      const tds = req.tds === null ? null : req.tds ? normalizeTds(req.tds) : s.terms.tds;
      await lockOwnerSeries(tx, auth.user, 'inv');
      const [next] = await tx.unsafe('SELECT next_invoice,invoice_prefix FROM scopeflow.business_profiles WHERE owner=$1', [auth.user]);
      const seq = Number(next.next_invoice ?? 1), number = invoiceNumber(s.profile.invoice_prefix, seq);
      const tooLong = invoiceNumberProblem(number);
      if (tooLong) return json({error: tooLong, code: 'invoice_number_too_long'}, 400);
      const issued = new Intl.DateTimeFormat('en-CA', {timeZone: zoneOrUtc(row.timezone), year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
      const doc = invoiceContent({
        number, issued, due_days: req.due_days ?? netDays(content.payment_terms ?? s.profile.default_payment_terms) ?? 15, description: req.description, amount, includes_tax,
        seller: {name: s.profile.business_name, address: s.profile.business_address, tax_id: s.profile.tax_id, payment_details: s.profile.payment_details},
        client: {name: content.client, email: row.client_email ?? ''}, project: {id, title: content.title, version: l.baseline.version},
        currency, tax_label: a.label, tax_pct: a.rate, agreed_total: fromMinorOf(a.total, currency), paid: fromMinorOf(s.alloc.received - s.alloc.refunded, currency), payment_terms: content.payment_terms ?? s.profile.default_payment_terms,
        gst, milestone, change_order, fx: content.fx, advances, tds, cap,
      });
      await tx.unsafe('UPDATE scopeflow.business_profiles SET next_invoice=next_invoice+1 WHERE owner=$1', [auth.user]);
      const gross_minor = (doc.breakdown?.total ?? 0) + (doc.advance?.total ?? 0);
      const [ins] = await tx.unsafe('INSERT INTO scopeflow.invoices (id,owner,project_id,seq,number,version,amount,currency,issued,request_id,content,tds_minor,gross_minor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (owner, request_id) DO NOTHING RETURNING seq',
        [randomUUID(), auth.user, id, seq, number, l.baseline.version, doc.total, currency, new Date().toISOString(), req.request_id ?? null, JSON.stringify(doc), doc.tds?.amount ?? null, gross_minor]);
      if (!ins) throw new ReplayConflict();
      const docs = await loadDocs(tx, id);
      const view = viewsOf(docs, allocationOf(docs, l.entries, currency, s.today)).find(v => v.seq === seq)!;
      return json({invoice: view, invoiceable: fromMinorOf(Math.max(0, cap.total - (final ? 0 : gross.total)), currency)}, 201);
    }).catch(async e => { if (e instanceof ReplayConflict) return (await replay()) ?? json({error: 'Another invoice was issued at the same moment. Try again.', code: 'conflict'}, 409); throw e; });
    return out;
  } catch (e) { return failure(e); }
}
class ReplayConflict extends Error {}
