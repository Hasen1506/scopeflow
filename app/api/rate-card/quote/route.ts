import {z} from 'zod';
import {db, json, owner, body, safeOrigin, allowRead, failure} from '@/lib/server';
import {rateCardFor, priceLine, coFromLine} from '@/lib/rate-card';
import {loadLedger} from '@/lib/ledger-server';
import {newId} from '@/lib/scope';

// SF-06: price a rate-card item and draft the change order for it. Records nothing.
// With project_id, the project's currency and agreed tax rate apply.
const requestSchema = z.object({
  item_id: z.string().min(1).max(40),
  qty: z.number().finite().positive().max(100000).default(1),
  multipliers: z.array(z.string().min(1).max(40)).max(10).default([]),
  project_id: z.string().min(1).max(100).optional(),
}).strict();

export async function POST(request: Request) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const user = await owner(request);
    if (!user) return json({error: 'Sign in or provide a valid API token.'}, 401);
    if (!await allowRead('owner:' + user)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const input = requestSchema.safeParse(raw);
    if (!input.success) return json({error: input.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}, 400);
    const card = await rateCardFor(user);
    const item = card.items.find(i => i.id === input.data.item_id);
    if (!item) return json({error: 'That item is not on your rate card.'}, 404);
    let taxPct: number | undefined, taxLabel = 'Tax';
    if (input.data.project_id) {
      const project = await db().prepare('SELECT id FROM projects WHERE id=? AND owner=?').bind(input.data.project_id, user).first();
      if (!project) return json({error: 'Project not found.'}, 404);
      const ledger = await loadLedger(input.data.project_id);
      const content = ledger.content;
      if (!content) return json({error: 'The ledger opens once the client approves the latest version.'}, 409);
      if (content.currency !== item.currency) return json({error: `This item is priced in ${item.currency}; the agreement is in ${content.currency}.`, code: 'currency_mismatch'}, 409);
      taxPct = content.tax_pct ?? 0; taxLabel = content.tax_label || 'Tax';
    }
    let line;
    try { line = priceLine(item, input.data.qty, input.data.multipliers, card, taxPct); } catch (e) { return json({error: (e as Error).message}, 400); }
    return json({line, tax_label: taxLabel, change_order: coFromLine(line, newId('rc'), {multiplierIds: input.data.multipliers})});
  } catch (e) { return failure(e); }
}
