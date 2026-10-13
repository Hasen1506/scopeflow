import {db, json, allowRead, failure, ipKey} from '@/lib/server';
import {statementPdf} from '@/lib/invoice-api';
import type {ProjectRow} from '@/lib/invoice-server';
type Ctx = {params: Promise<{token: string}>};
// The client's statement of account for the agreement approved through this review link.
export async function GET(request: Request, ctx: Ctx) {
  try {
    const {token} = await ctx.params;
    if (!await allowRead('receipt-ip:' + await ipKey(request), 30)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    if (!/^[a-f0-9]{64}$/.test(token)) return json({error: 'This review link was not found.'}, 404);
    const row = await db().prepare('SELECT v.version,p.id,p.owner,p.client_email,p.timezone,p.client_gstin,p.client_state,p.client_address FROM versions v JOIN projects p ON p.id=v.project_id WHERE v.token=? AND v.revoked=0').bind(token).first<ProjectRow & {version: number}>();
    if (!row) return json({error: 'This review link was not found.'}, 404);
    return await statementPdf(request, row, {version: row.version});
  } catch (e) { return failure(e); }
}
