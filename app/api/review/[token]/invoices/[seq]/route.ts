import {db, json, allowRead, failure, ipKey} from '@/lib/server';
import {pdfResponse} from '@/lib/receipt-server';
import {ensurePdfFonts} from '@/lib/pdf-fonts';
import {renderInvoicePdf, type InvoiceContent} from '@/lib/invoice';
type Ctx = {params: Promise<{token: string; seq: string}>};
// An invoice issued for the agreement approved through this review link, as the client's PDF copy.
export async function GET(request: Request, ctx: Ctx) {
  try {
    const {token, seq} = await ctx.params;
    if (!await allowRead('receipt-ip:' + await ipKey(request), 30)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    if (!/^[a-f0-9]{64}$/.test(token) || !/^\d{1,9}$/.test(seq)) return json({error: 'Invoice not found.'}, 404);
    const row = await db().prepare("SELECT i.number,i.content FROM versions v JOIN invoices i ON i.project_id=v.project_id AND i.version=v.version WHERE v.token=? AND v.revoked=0 AND v.status='approved' AND i.seq=?").bind(token, Number(seq)).first<{number: string; content: string}>();
    if (!row) return json({error: 'Invoice not found.'}, 404);
    await ensurePdfFonts();
    return pdfResponse(renderInvoicePdf(JSON.parse(row.content) as InvoiceContent), `invoice-${row.number}.pdf`);
  } catch (e) { return failure(e); }
}
