import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {json, body, safeOrigin, allowWrite, allowRead, failure} from '@/lib/server';
import {loadLedger} from '@/lib/ledger-server';
import {appendMoneyEntry} from '@/lib/ledger-hooks';
import {projectFor} from '@/lib/invoice-api';
import {invoicingState, ledgerKindReady, msmedSummary, withProjectLock} from '@/lib/invoice-server';
import {MSMED_DISCLAIMER} from '@/lib/msmed';
type Ctx = {params: Promise<{id: string}>};

// SF-07: delivery and acceptance of the work (MSMED Act s.2(b)), the `delivery_accepted` event. The
// owner records the delivery date and, when it happened, the client's written acceptance or objection
// (and the day the objection was removed). With no objection within 15 days of delivery, acceptance is
// deemed on the delivery day. The due date (s.15) and the interest (s.16) run from acceptance, not from
// the invoice. Append-only: a later record supersedes an earlier one. Mirrored to the ledger once
// WS-05 enables the `delivery_accepted` kind.
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date (YYYY-MM-DD)');
const acceptanceSchema = z.object({
  delivered_on: day,
  accepted_on: day.nullable().optional(),
  objection_on: day.nullable().optional(),
  objection_removed_on: day.nullable().optional(),
  milestone_id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).nullable().optional(),
  evidence: z.string().trim().max(1000).default(''),
}).strict().superRefine((a, ctx) => {
  if (a.accepted_on && a.accepted_on < a.delivered_on) ctx.addIssue({code: 'custom', path: ['accepted_on'], message: 'Acceptance cannot be before delivery'});
  if (a.objection_on && a.objection_on < a.delivered_on) ctx.addIssue({code: 'custom', path: ['objection_on'], message: 'An objection cannot be before delivery'});
  if (a.objection_removed_on && (!a.objection_on || a.objection_removed_on < a.objection_on)) ctx.addIssue({code: 'custom', path: ['objection_removed_on'], message: 'Give the objection first; it is removed on or after that day'});
});

async function view(p: Awaited<ReturnType<typeof projectFor>> & {error: null}, id: string) {
  const l = await loadLedger(id), s = await invoicingState(p.row, l);
  return {...msmedSummary({profile: s.msme, contract_date: l.baseline?.decided ?? null, acceptances: s.docs.acceptances, terms: s.terms, views: s.views, currency: s.currency, today: s.today}), history: s.docs.acceptances, disclaimer: MSMED_DISCLAIMER};
}

export async function GET(request: Request, ctx: Ctx) {
  try {
    const {id} = await ctx.params;
    const p = await projectFor(request, id);
    if (p.error) return p.error;
    if (!await allowRead('owner:' + p.auth.user)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    return json(await view(p, id));
  } catch (e) { return failure(e); }
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const {id} = await ctx.params;
    const p = await projectFor(request, id);
    if (p.error) return p.error;
    if (!p.auth.scopes.includes('scopes:write')) return json({error: 'This credential cannot record acceptance.'}, 403);
    if (!await allowWrite('owner:' + p.auth.user)) return json({error: 'Write limit reached. Try again in a minute.'}, 429);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const input = acceptanceSchema.safeParse(raw);
    if (!input.success) return json({error: input.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}, 400);
    const a = input.data, l = await loadLedger(id);
    if (!l.baseline) return json({error: 'Record acceptance once the client has approved the scope.', code: 'not_approved'}, 409);
    const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
    if ([a.delivered_on, a.accepted_on, a.objection_on, a.objection_removed_on].some(d => d && d > tomorrow)) return json({error: 'Dates cannot be in the future.', code: 'future_date'}, 400);
    await withProjectLock(id, tx => tx.unsafe('INSERT INTO scopeflow.delivery_acceptances (id,owner,project_id,milestone_id,delivered_on,accepted_on,objection_on,objection_removed_on,evidence,created) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [randomUUID(), p.auth.user, id, a.milestone_id ?? null, a.delivered_on, a.accepted_on ?? null, a.objection_on ?? null, a.objection_removed_on ?? null, a.evidence, new Date().toISOString()]));
    if (ledgerKindReady('delivery_accepted')) await appendMoneyEntry({baseline: l.baseline, expectedHead: l.head, kind: 'delivery_accepted', payload: a, actor: 'owner'}).catch(() => null);
    return json(await view(p, id), 201);
  } catch (e) { return failure(e); }
}
