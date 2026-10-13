import {json, allowRead, failure} from '@/lib/server';
import {loadBrand} from '@/lib/brand-server';
import {pdfBrand} from '@/lib/brand';
import {renderInvoicePdf} from '@/lib/invoice';
import {cachedPdf, loadDocs, readSql, recordKey, streamPdf} from '@/lib/invoice-server';
import {projectFor} from '@/lib/invoice-api';
type Ctx = {params: Promise<{id: string; seq: string}>};
// One issued invoice as a PDF, rendered from its frozen snapshot ("Cancelled by CN-…" once fully credited).
export async function GET(request: Request, ctx: Ctx) {
  try {
    const {id, seq} = await ctx.params;
    const p = await projectFor(request, id);
    if (p.error) return p.error;
    if (!await allowRead('owner:' + p.auth.user, 60)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    if (!/^\d{1,9}$/.test(seq)) return json({error: 'Invoice not found.'}, 404);
    const docs = await loadDocs(readSql(), id);
    const inv = docs.invoices.find(i => i.row.seq === Number(seq));
    if (!inv) return json({error: 'Invoice not found.'}, 404);
    const brand = pdfBrand(await loadBrand(p.auth.user));
    const bytes = await cachedPdf(recordKey('invoice', inv.row.id, inv.cancelled_by, brand), () => renderInvoicePdf(inv.content, brand, {cancelled_by: inv.cancelled_by}));
    return streamPdf(bytes, `invoice-${inv.row.number}.pdf`);
  } catch (e) { return failure(e); }
}
