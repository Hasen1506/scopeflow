import {json, allowRead, failure, ipKey} from '@/lib/server';
import {receiptResponse} from '@/lib/receipt-server';
import {resolveReviewToken} from '@/lib/review-link';
type Ctx = {params: Promise<{token: string}>};
// The client's PDF receipt for the decision recorded through this review link. A revoked or rotated
// decided link (read-only, H4) still serves it: it is the client's copy of the record.
export async function GET(request: Request, ctx: Ctx) {
  try {
    const {token} = await ctx.params;
    if (!await allowRead('receipt-ip:' + await ipKey(request), 30)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const row = await resolveReviewToken(token);
    if (!row) return json({error: 'This review link was not found.'}, 404);
    return receiptResponse(request, row);
  } catch (e) { return failure(e); }
}
