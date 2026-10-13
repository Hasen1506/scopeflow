import {z} from 'zod';
import {db, json, owner, body, safeOrigin, allowWrite, allowRead, failure} from '@/lib/server';
import {checkEntry, computeAgreement, payloadSchemas, type ChangeOrder, type EntryKind, type LedgerEntry, type Actor} from '@/lib/ledger';
import {loadLedger, appendEntries, LedgerConflict} from '@/lib/ledger-server';
import {closingLines, openingQuotas, overageOf, periodBounds, periodOf, retainerStatement} from '@/lib/retainer';
import {rateCardFor, rateItemFor, priceLine} from '@/lib/rate-card';
import {entryContext} from '@/lib/ledger-math';
import {fromMinor, toMinor} from '@/lib/minor';
import {itemsOf} from '@/lib/scope';
type Ctx = {params: Promise<{id: string}>};

// SF-05: retainer periods. GET returns the live counters (and ?period=YYYY-MM the statement data
// WS-03 renders); POST logs usage, opens or closes a period. Usage past a quota proposes exactly one
// overage change order per usage entry, priced from the account rate card, in the same transaction.

const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const requestSchema = z.discriminatedUnion('action', [
  z.object({action: z.literal('usage'), baseline_version: z.number().int().min(1), item_id: z.string().min(1).max(40), qty: z.number().finite().positive().max(100000), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().trim().max(500).default(''), request_id: z.string().regex(/^[A-Za-z0-9_-]{8,120}$/).optional()}).strict(),
  z.object({action: z.literal('open'), baseline_version: z.number().int().min(1), period}).strict(),
  z.object({action: z.literal('close'), baseline_version: z.number().int().min(1), period}).strict(),
]);

async function ownedProject(request: Request, id: string) {
  const user = await owner(request);
  if (!user) return {error: json({error: 'Sign in or provide a valid API token.'}, 401)};
  const project = await db().prepare('SELECT id,archived,timezone FROM projects WHERE id=? AND owner=?').bind(id, user).first<{id: string; archived: string | null; timezone: string | null}>();
  if (!project) return {error: json({error: 'Project not found.'}, 404)};
  return {user, archived: !!project.archived, timezone: project.timezone};
}

type Planned = {kind: EntryKind; payload: unknown; actor: Actor; ref: string | null};
/** The entries as they will be once `planned` lands (for validating each planned entry in order). */
function simulated(entries: LedgerEntry[], planned: Planned[], baselineVersion: number): LedgerEntry[] {
  let seq = entries.at(-1)?.seq ?? 0;
  return [...entries, ...planned.map(p => ({seq: ++seq, kind: p.kind, baseline_version: baselineVersion, actor: p.actor, created: new Date().toISOString(), payload: p.payload, payload_hash: '', prev_hash: '', hash: ''}))];
}

async function state(id: string) {
  const ledger = await loadLedger(id);
  if (!ledger.baseline || !ledger.content || !ledger.agreement) return {ledger, error: json({error: 'The ledger opens once the client approves the latest version.'}, 409)};
  if (ledger.content.engagement !== 'retainer' || !ledger.content.retainer || !ledger.agreement.retainer) return {ledger, error: json({error: 'This agreement is not a retainer.', code: 'not_retainer'}, 409)};
  return {ledger, error: null};
}

export async function GET(request: Request, ctx: Ctx) {
  try {
    const {id} = await ctx.params;
    const access = await ownedProject(request, id);
    if (access.error) return access.error;
    if (!await allowRead('owner:' + access.user)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const {ledger, error} = await state(id);
    if (error) return error;
    const current = ledger.entries.filter(e => e.baseline_version === ledger.baseline!.version);
    const wanted = new URL(request.url).searchParams.get('period');
    if (wanted !== null && !period.safeParse(wanted).success) return json({error: 'Use ?period=YYYY-MM.'}, 400);
    const statement = wanted ? retainerStatement(ledger.content!, current, ledger.agreement!.change_orders, wanted) : null;
    if (wanted && !statement) return json({error: `Period ${wanted} has not been opened.`}, 404);
    return json({baseline_version: ledger.baseline!.version, currency: ledger.content!.currency, retainer: ledger.agreement!.retainer, terms: ledger.content!.retainer, ...(statement ? {statement} : {})});
  } catch (e) { return failure(e); }
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const {id} = await ctx.params;
    const access = await ownedProject(request, id);
    if (access.error) return access.error;
    if (access.archived) return json({error: 'This project is archived. Restore it before adding to its ledger.', code: 'archived'}, 409);
    if (!await allowWrite('owner:' + access.user)) return json({error: 'Write limit reached. Try again in a minute.'}, 429);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const input = requestSchema.safeParse(raw);
    if (!input.success) return json({error: input.error.issues.map(i => `${i.path.join('.') || 'request'}: ${i.message}`).join('; ')}, 400);
    const req = input.data;
    const {ledger, error} = await state(id);
    if (error) return error;
    const baseline = ledger.baseline!, content = ledger.content!, agreement = ledger.agreement!;
    if (baseline.version !== req.baseline_version) return json({error: `The approved baseline is version ${baseline.version}. Read the agreement again before adding to it.`}, 409);
    const current = ledger.entries.filter(e => e.baseline_version === baseline.version);
    const context = entryContext(access.timezone, baseline.decided);

    if (req.action === 'usage' && req.request_id) {
      const prior = await db().prepare('SELECT seq,kind,payload FROM ledger_entries WHERE project_id=? AND ref=?').bind(id, 'req:' + req.request_id).first<{seq: number; kind: string; payload: string}>();
      if (prior) {
        const p = JSON.parse(prior.payload);
        if (prior.kind !== 'usage' || p.item_id !== req.item_id || p.qty !== req.qty || p.date !== req.date) return json({error: 'That request_id was already used with different content.'}, 409);
        const fresh = await loadLedger(id);
        return json({replayed: true, seq: prior.seq, retainer: fresh.agreement?.retainer ?? null}, 200);
      }
    }

    const planned: Planned[] = [];
    const plannedOpen = (key: string) => {
      const view = computeAgreement(content, baseline.version, simulated(current, planned, baseline.version)).retainer!;
      planned.push({kind: 'period_open', actor: 'owner', ref: `period_open:${baseline.version}:${key}`, payload: payloadSchemas.period_open.parse({period: key, ...periodBounds(key), quotas: openingQuotas(content, view, key)})});
    };
    let overage: {qty: number; priced: 'rate_card' | 'scope' | 'unpriced'} | null = null;
    if (req.action === 'open') plannedOpen(req.period);
    else if (req.action === 'close') {
      const view = agreement.retainer!;
      const p = view.periods.find(x => x.period === req.period);
      if (!p) return json({error: `Period ${req.period} is not open.`}, 409);
      if (p.closed_seq) return json({replayed: true, seq: p.closed_seq, retainer: view}, 200);
      planned.push({kind: 'period_close', actor: 'owner', ref: `period_close:${baseline.version}:${req.period}`, payload: payloadSchemas.period_close.parse({period: req.period, lines: closingLines(view, req.period), overage_cos: p.overage_cos.map(o => o.seq)})});
      // Auto-renewal opens the next month in the same transaction.
      if (content.retainer!.renewal === 'auto') {
        const [y, m] = req.period.split('-').map(Number);
        const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`;
        if (!view.periods.some(x => x.period === next)) plannedOpen(next);
      }
    } else {
      const key = periodOf(req.date);
      if (!agreement.retainer!.periods.some(x => x.period === key)) plannedOpen(key);
      const usage = payloadSchemas.usage.parse({period: key, item_id: req.item_id, qty: req.qty, date: req.date, note: req.note});
      const view = computeAgreement(content, baseline.version, simulated(current, planned, baseline.version)).retainer!;
      const over = overageOf(view, usage);
      planned.push({kind: 'usage', actor: 'owner', ref: req.request_id ? 'req:' + req.request_id : null, payload: usage});
      if (over > 0) {
        const usageSeq = (current.at(-1)?.seq ?? 0) + planned.length;
        const item = itemsOf(content).find(i => i.id === req.item_id);
        const card = await rateCardFor(access.user);
        const rate = rateItemFor(card, req.item_id);
        let feeMinor = 0, priced: 'rate_card' | 'scope' | 'unpriced' = 'unpriced', rateCard: ChangeOrder['rate_card'];
        if (rate && rate.currency === content.currency) {
          const line = priceLine(rate, over, [], card, content.tax_pct ?? 0);
          feeMinor = line.subtotal_minor; priced = 'rate_card';
          rateCard = {item_id: rate.id, qty: over, unit_price_minor: rate.unit_price_minor, multipliers: []};
        } else if (item?.unit_price !== undefined) {
          feeMinor = Math.round(toMinor(item.unit_price, content.currency) * over); priced = 'scope';
        }
        const title = item?.title ?? req.item_id;
        const co = payloadSchemas.change_order.parse({
          title: `Overage: ${over} × ${title} (${key})`.slice(0, 160),
          reason: `Usage beyond the ${key} quota (${view.periods.find(p => p.period === key)?.lines.find(l => l.item_id === req.item_id)?.allowance ?? 0} included).`,
          request_quote: '',
          add_items: [{id: `ov_${usageSeq}_${req.item_id}`.slice(0, 40), title, qty: Number.isInteger(over) ? over : 1, unit: Number.isInteger(over) ? (item?.unit ?? '') : `${over} ${item?.unit ?? ''}`.trim().slice(0, 40), price: fromMinor(feeMinor, content.currency), acceptance: ''}],
          remove_item_ids: [], fee_delta: fromMinor(feeMinor, content.currency), days_delta: 0, revisions_delta: 0,
          overage: {period: key, item_id: req.item_id, qty: over, usage_seq: usageSeq},
          ...(rateCard ? {rate_card: rateCard} : {}),
        });
        planned.push({kind: 'change_order', actor: 'owner', ref: `overage:${usageSeq}`, payload: co});
        overage = {qty: over, priced};
      }
    }
    // Validate each planned entry against the agreement as it will be when that entry lands.
    for (const [n, p] of planned.entries()) {
      const a = computeAgreement(content, baseline.version, simulated(current, planned.slice(0, n), baseline.version));
      const problem = checkEntry(p.kind, p.payload, content, a, 'owner', context);
      if (problem) return json({error: problem}, /already|closed|later period/.test(problem) ? 409 : 400);
    }
    try {
      const written = await appendEntries({baseline, expectedHead: ledger.head, entries: planned});
      const fresh = await loadLedger(id);
      return json({entries: written.map(e => ({seq: e.seq, kind: e.kind})), overage, retainer: fresh.agreement?.retainer ?? null}, 201);
    } catch (e) {
      if (e instanceof LedgerConflict) return json({error: e.message}, e.message.includes('supports') ? 429 : 409);
      throw e;
    }
  } catch (e) { return failure(e); }
}
