import {db, json, ownerAuth, allowRead, failure} from '@/lib/server';
import {pdfResponse} from '@/lib/receipt-server';
import {ensurePdfFonts} from '@/lib/pdf-fonts';
import {renderInvoicePdf, type InvoiceContent} from '@/lib/invoice';
type Ctx = {params: Promise<{id: string; seq: string}>};
// One issued invoice as a PDF, rendered from its frozen snapshot.
export async function GET(request: Request, ctx: Ctx) {
  try {
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in or provide a valid API token.'}, 401);
    if (!await allowRead('owner:' + auth.user, 60)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const {id, seq} = await ctx.params;
    if (!/^\d{1,9}$/.test(seq)) return json({error: 'Invoice not found.'}, 404);
    const row = await db().prepare('SELECT number,content FROM invoices WHERE project_id=? AND owner=? AND seq=?').bind(id, auth.user, Number(seq)).first<{number: string; content: string}>();
    if (!row) return json({error: 'Invoice not found.'}, 404);
    await ensurePdfFonts();
    return pdfResponse(renderInvoicePdf(JSON.parse(row.content) as InvoiceContent), `invoice-${row.number}.pdf`);
  } catch (e) { return failure(e); }
}
