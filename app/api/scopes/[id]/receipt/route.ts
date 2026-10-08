import {db, json, ownerAuth, allowRead, failure} from '@/lib/server';
import {receiptResponse, type DecidedRow} from '@/lib/receipt-server';
type Ctx = {params: Promise<{id: string}>};
// The owner's copy of a version's PDF receipt: GET /api/scopes/<id>/receipt?version=N (latest decided when omitted).
export async function GET(request: Request, ctx: Ctx) {
  try {
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in or provide a valid API token.'}, 401);
    if (!await allowRead('owner:' + auth.user, 60)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const {id} = await ctx.params;
    const raw = new URL(request.url).searchParams.get('version');
    const version = raw === null ? null : Number(raw);
    if (version !== null && (!Number.isInteger(version) || version < 1 || version > 100000)) return json({error: 'Use a whole version number.'}, 400);
    const fields = 'v.id,v.project_id,v.version,v.status,v.content,v.signer,v.comment,v.decided,v.signature,v.decision_context,p.timezone';
    const row = version === null
      ? await db().prepare(`SELECT ${fields} FROM versions v JOIN projects p ON p.id=v.project_id WHERE p.id=? AND p.owner=? AND v.status<>'pending' ORDER BY v.version DESC LIMIT 1`).bind(id, auth.user).first<DecidedRow>()
      : await db().prepare(`SELECT ${fields} FROM versions v JOIN projects p ON p.id=v.project_id WHERE p.id=? AND p.owner=? AND v.version=?`).bind(id, auth.user, version).first<DecidedRow>();
    return receiptResponse(request, row);
  } catch (e) { return failure(e); }
}
