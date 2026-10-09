import {db, json, allowRead, failure, ipKey} from '@/lib/server';
import {statementResponse} from '@/lib/receipt-server';
type Ctx = {params: Promise<{token: string}>};
// The client's statement of account for the agreement approved through this review link.
export async function GET(request: Request, ctx: Ctx) {
  try {
    const {token} = await ctx.params;
    if (!await allowRead('receipt-ip:' + await ipKey(request), 30)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    if (!/^[a-f0-9]{64}$/.test(token)) return json({error: 'This review link was not found.'}, 404);
    const row = await db().prepare('SELECT v.project_id,v.version,p.timezone FROM versions v JOIN projects p ON p.id=v.project_id WHERE v.token=? AND v.revoked=0').bind(token).first<{project_id: string; version: number; timezone: string | null}>();
    if (!row) return json({error: 'This review link was not found.'}, 404);
    return statementResponse(request, row.project_id, {version: row.version, timezone: row.timezone});
  } catch (e) { return failure(e); }
}
