import {randomUUID} from 'node:crypto';
import {json, body, safeOrigin, allowWrite, failure} from '@/lib/server';
import {loadLedger} from '@/lib/ledger-server';
import {appendMoneyEntry} from '@/lib/ledger-hooks';
import {projectFor} from '@/lib/invoice-api';
import {invoicingState, ledgerKindReady, withProjectLock} from '@/lib/invoice-server';
import {toMinorOf} from '@/lib/invoice';
import {tdsCreditSchema} from '@/lib/tds';
type Ctx = {params: Promise<{id: string; seq: string}>};

// H19: record the TDS certificate (Form 16A / 131) for an invoice paid net of TDS. It closes the TDS
// part of the invoice (status tds_credited). Mirrored to the ledger as `tds_credit` once WS-05 enables it.
export async function POST(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const {id, seq} = await ctx.params;
    const p = await projectFor(request, id);
    if (p.error) return p.error;
    if (!p.auth.scopes.includes('scopes:write')) return json({error: 'This credential cannot record TDS credits.'}, 403);
    if (!/^\d{1,9}$/.test(seq)) return json({error: 'Invoice not found.'}, 404);
    if (!await allowWrite('owner:' + p.auth.user)) return json({error: 'Write limit reached. Try again in a minute.'}, 429);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const input = tdsCreditSchema.safeParse(raw);
    if (!input.success) return json({error: input.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}, 400);
    const c = input.data, l = await loadLedger(id);
    const res = await withProjectLock(id, async tx => {
      const s = await invoicingState(p.row, l, {tx});
      const v = s.views.find(x => x.seq === Number(seq));
      if (!v) return json({error: 'Invoice not found.'}, 404);
      if (!v.tds) return json({error: `Invoice ${v.number} has no TDS on it.`, code: 'no_tds'}, 409);
      const left = Math.round((v.tds.amount - v.tds.credited) * 100) / 100;
      if (!(left > 0)) return json({error: `The TDS on ${v.number} is already credited.`, code: 'tds_already_credited'}, 409);
      if (c.amount > left + 0.005) return json({error: `At most ${left} of TDS is open on ${v.number}.`, code: 'tds_exceeds'}, 400);
      const ins = await tx.unsafe('INSERT INTO scopeflow.tds_credits (id,owner,project_id,invoice_seq,amount_minor,currency,certificate_no,form,quarter,received,created) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING RETURNING id',
        [randomUUID(), p.auth.user, id, v.seq, toMinorOf(c.amount, v.currency), v.currency, c.certificate_no, c.form, c.quarter, c.received, new Date().toISOString()]);
      if (!ins.length) return json({error: 'That certificate is already recorded for this invoice.', code: 'duplicate'}, 409);
      return null;
    });
    if (res) return res;
    // The signed ledger copy, once WS-05 enables the kind (plan §4: tds_credit).
    if (ledgerKindReady('tds_credit') && l.baseline) await appendMoneyEntry({baseline: l.baseline as never, expectedHead: l.head, kind: 'tds_credit', payload: {invoice_seq: Number(seq), ...c}, actor: 'owner'}).catch(() => null);
    const s = await invoicingState(p.row, await loadLedger(id));
    return json({invoice: s.views.find(x => x.seq === Number(seq))}, 201);
  } catch (e) { return failure(e); }
}
