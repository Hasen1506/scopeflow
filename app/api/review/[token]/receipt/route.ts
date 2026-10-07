import {db, json, allowRead, failure, ipKey} from '@/lib/server';
import {receiptResponse, type DecidedRow} from '@/lib/receipt-server';
type Ctx = {params: Promise<{token: string}>};
// The client's PDF receipt for the decision recorded through this review link.
export async function GET(request: Request, ctx: Ctx) {
  try {
    const {token} = await ctx.params;
    if (!await allowRead('receipt-ip:' + await ipKey(request), 30)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    if (!/^[a-f0-9]{64}$/.test(token)) return json({error: 'This review link was not found.'}, 404);
    const row = await db().prepare('SELECT id,project_id,version,status,content,signer,comment,decided,signature,decision_context FROM versions WHERE token=? AND revoked=0').bind(token).first<DecidedRow>();
    return receiptResponse(request, row);
  } catch (e) { return failure(e); }
}
