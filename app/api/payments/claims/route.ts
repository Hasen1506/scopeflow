import {db, json, ownerAuth, failure} from '@/lib/server';

// The owner's "I've paid" claims from clients (LT-02), newest first: pending ones by default,
// ?status=all for every claim, ?project_id= for one project.
export async function GET(request: Request) {
  try {
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in or provide a valid API token.'}, 401);
    const url = new URL(request.url), project = url.searchParams.get('project_id'), all = url.searchParams.get('status') === 'all';
    const rows = await db().prepare(`SELECT c.id,c.project_id,c.version,c.purpose,c.invoice_seq,c.amount_minor,c.currency,c.method,c.utr,c.payer_name,c.note,c.status,c.created,c.decided_at,c.ledger_seq,p.latest,v.content
      FROM scopeflow.payment_claims c JOIN projects p ON p.id=c.project_id JOIN versions v ON v.project_id=p.id AND v.version=p.latest
      WHERE p.owner=?${project ? ' AND c.project_id=?' : ''}${all ? '' : " AND c.status='pending'"} ORDER BY c.created DESC LIMIT 200`).bind(auth.user, ...(project ? [project] : [])).all<Record<string, unknown> & {content: string; amount_minor: number | string}>();
    return json({claims: rows.results.map(({content, latest: _latest, ...c}) => ({...c, amount_minor: Number(c.amount_minor), title: (JSON.parse(content) as {title?: string}).title ?? '', client: (JSON.parse(content) as {client?: string}).client ?? ''}))});
  } catch (e) { return failure(e); }
}
