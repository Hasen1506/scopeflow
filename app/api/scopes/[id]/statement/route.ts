import {json, allowRead, failure} from '@/lib/server';
import {projectFor, statementPdf} from '@/lib/invoice-api';
type Ctx = {params: Promise<{id: string}>};
// The owner's statement of account (agreed total, invoices, payments on the record, balance due) as a PDF.
export async function GET(request: Request, ctx: Ctx) {
  try {
    const {id} = await ctx.params;
    const p = await projectFor(request, id);
    if (p.error) return p.error;
    if (!await allowRead('owner:' + p.auth.user, 60)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    return await statementPdf(request, p.row);
  } catch (e) { return failure(e); }
}
