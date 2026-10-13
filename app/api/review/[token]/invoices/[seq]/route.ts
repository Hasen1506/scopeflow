import {db, json, allowRead, failure, ipKey} from '@/lib/server';
import {loadBrand} from '@/lib/brand-server';
import {pdfBrand} from '@/lib/brand';
import {renderInvoicePdf} from '@/lib/invoice';
import {cachedPdf, loadDocs, readSql, recordKey, streamPdf} from '@/lib/invoice-server';
type Ctx = {params: Promise<{token: string; seq: string}>};
// An invoice issued for the agreement approved through this review link, as the client's PDF copy.
export async function GET(request: Request, ctx: Ctx) {
  try {
    const {token, seq} = await ctx.params;
    if (!await allowRead('receipt-ip:' + await ipKey(request), 30)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    if (!/^[a-f0-9]{64}$/.test(token) || !/^\d{1,9}$/.test(seq)) return json({error: 'Invoice not found.'}, 404);
    // integration: GET is read-only; a revoked or closed link keeps serving the client's record (live scenario 7, H10)
    const row = await db().prepare("SELECT i.project_id,i.owner FROM versions v JOIN invoices i ON i.project_id=v.project_id AND i.version=v.version WHERE v.token=? AND v.status='approved' AND i.seq=?").bind(token, Number(seq)).first<{project_id: string; owner: string}>();
    if (!row) return json({error: 'Invoice not found.'}, 404);
    const inv = (await loadDocs(readSql(), row.project_id)).invoices.find(i => i.row.seq === Number(seq));
    if (!inv) return json({error: 'Invoice not found.'}, 404);
    const brand = pdfBrand(await loadBrand(row.owner));
    const bytes = await cachedPdf(recordKey('invoice', inv.row.id, inv.cancelled_by, brand), () => renderInvoicePdf(inv.content, brand, {cancelled_by: inv.cancelled_by}));
    return streamPdf(bytes, `invoice-${inv.row.number}.pdf`);
  } catch (e) { return failure(e); }
}
