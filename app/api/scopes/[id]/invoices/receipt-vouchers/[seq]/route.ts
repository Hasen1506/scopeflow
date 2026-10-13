import {json, allowRead, failure} from '@/lib/server';
import {projectFor} from '@/lib/invoice-api';
import {cachedPdf, loadDocs, readSql, recordKey, streamPdf} from '@/lib/invoice-server';
import {renderReceiptVoucherPdf} from '@/lib/receipt-voucher';
type Ctx = {params: Promise<{id: string; seq: string}>};
// One receipt voucher (or payment receipt) as a PDF, from its frozen snapshot.
export async function GET(request: Request, ctx: Ctx) {
  try {
    const {id, seq} = await ctx.params;
    const p = await projectFor(request, id);
    if (p.error) return p.error;
    if (!await allowRead('owner:' + p.auth.user, 60)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const v = /^\d{1,9}$/.test(seq) ? (await loadDocs(readSql(), id)).vouchers.find(x => x.seq === Number(seq)) : undefined;
    if (!v) return json({error: 'Receipt voucher not found.'}, 404);
    return streamPdf(await cachedPdf(recordKey('rv', id, v.seq, v.number), () => renderReceiptVoucherPdf(v.content)), `${v.number}.pdf`);
  } catch (e) { return failure(e); }
}
