import {json, allowRead, failure} from '@/lib/server';
import {projectFor} from '@/lib/invoice-api';
import {cachedPdf, loadDocs, readSql, recordKey, streamPdf} from '@/lib/invoice-server';
import {renderCreditNotePdf} from '@/lib/credit-note';
type Ctx = {params: Promise<{id: string; seq: string}>};
// One credit note as a PDF, from its frozen snapshot.
export async function GET(request: Request, ctx: Ctx) {
  try {
    const {id, seq} = await ctx.params;
    const p = await projectFor(request, id);
    if (p.error) return p.error;
    if (!await allowRead('owner:' + p.auth.user, 60)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const c = /^\d{1,9}$/.test(seq) ? (await loadDocs(readSql(), id)).credits.find(x => x.seq === Number(seq)) : undefined;
    if (!c) return json({error: 'Credit note not found.'}, 404);
    return streamPdf(await cachedPdf(recordKey('cn', id, c.seq, c.number), () => renderCreditNotePdf(c.content)), `${c.number}.pdf`);
  } catch (e) { return failure(e); }
}
