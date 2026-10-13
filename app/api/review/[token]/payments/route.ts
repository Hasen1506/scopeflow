import {db, json, allowRead, failure, ipKey} from '@/lib/server';
import {paymentOptions} from '@/lib/deposit-server';
import {linkExpired} from '@/lib/link';
import type {Scope} from '@/lib/scope';
type Ctx = {params: Promise<{token: string}>};
type Row = {id: string; project_id: string; version: number; status: string; content: string; latest: number; link_issued: string | null; link_expiry_days: number | null; created: string};

// How the client can pay, for the PayBlock on the client page (LT-02, SF-02): the open amounts
// (deposit, invoices, balance), the freelancer's UPI ID with a ready UPI URI for each, their bank
// details, whether their own online checkout is available, and the client's "I've paid" claims.
// Only for the approved latest version of a live link.
export async function GET(request: Request, ctx: Ctx) {
  try {
    const {token} = await ctx.params;
    if (!/^[a-f0-9]{64}$/.test(token)) return json({error: 'This review link was not found.'}, 404);
    if (!await allowRead('review-ip:' + await ipKey(request), 300)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const row = await db().prepare('SELECT v.id,v.project_id,v.version,v.status,v.content,v.created,p.latest,p.link_issued,p.link_expiry_days FROM versions v JOIN projects p ON p.id=v.project_id WHERE v.token=? AND v.revoked=0').bind(token).first<Row>();
    if (!row) return json({error: 'This review link was not found.'}, 404);
    if (linkExpired(row as never)) return json({error: 'This review link expired. Ask the creator for a new link.', code: 'link_expired'}, 410);
    if (row.status !== 'approved' || row.version !== row.latest) return json({error: 'Payments open once this version is approved.', code: 'not_approved'}, 409);
    return json(await paymentOptions(row.project_id, row.version, JSON.parse(row.content) as Scope, token));
  } catch (e) { return failure(e); }
}
