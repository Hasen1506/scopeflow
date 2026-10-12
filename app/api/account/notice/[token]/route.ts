import {json, allowRead, failure, ipKey} from '@/lib/server';
import {clientNotice, dataNotice} from '@/lib/account-closure';
// Public, per review link: the closed-account banner (H10) and the client data notice (M32) for
// the client page (WS-07 mounts <AccountClosedBanner/> and the DataNotice slot from this).
type Ctx = {params: Promise<{token: string}>};
export async function GET(request: Request, ctx: Ctx) {
  try {
    if (!await allowRead('review-ip:' + await ipKey(request), 300)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const {token} = await ctx.params;
    const n = await clientNotice(token);
    if (!n) return json({error: 'This review link was not found.'}, 404);
    return json({...n, data_notice: dataNotice(n.retention_days)});
  } catch (e) { return failure(e); }
}
