import {z} from 'zod';
import {db, json, body, safeOrigin, ownerAuth, allowWrite, failure} from '@/lib/server';
import {receiptModel} from '@/lib/receipt-server';
import {renderReceiptPdf} from '@/lib/receipt';
import {esignProvider, EsignUnavailable} from '@/lib/esign';
type Ctx = {params: Promise<{id: string}>};

// SF-15: per-version opt-in to an Aadhaar eSign of the approved record (SCOPEFLOW_ESIGN_PROVIDER).
// The provider receives the receipt PDF; the client signs on the provider's page (the link shows
// on the review page); the provider's callback attaches the signed PDF and audit trail.
export async function POST(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in required.'}, 401);
    if (auth.via !== 'session') return json({error: 'Request an Aadhaar eSign from the ScopeFlow website.', code: 'session_required'}, 403);
    const {id} = await ctx.params;
    if (!await allowWrite('owner:' + auth.user)) return json({error: 'Write limit reached. Try again in a minute.'}, 429);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const parsed = z.object({version: z.number().int().min(1)}).strict().safeParse(raw);
    if (!parsed.success) return json({error: 'Choose the approved version to eSign.'}, 400);
    const provider = esignProvider();
    if (!provider) return json({error: 'Aadhaar eSign is not set up on this server.', code: 'esign_unavailable'}, 409);
    const row = await db().prepare("SELECT v.id,v.project_id,v.version,v.status,v.content,v.signer,v.comment,v.decided,v.signature,v.decision_context,v.token,p.timezone,p.contact_since,p.client_email,p.client_phone FROM versions v JOIN projects p ON p.id=v.project_id WHERE p.id=? AND p.owner=? AND p.owner_deleted IS NULL AND v.version=?").bind(id, auth.user, parsed.data.version).first<{id: string; project_id: string; version: number; status: string; content: string; signer: string | null; comment: string | null; decided: string | null; signature: string | null; decision_context: string | null; token: string; timezone: string | null; contact_since: string | null; client_email: string | null; client_phone: string | null}>();
    if (!row) return json({error: 'Version not found.'}, 404);
    if (row.status !== 'approved') return json({error: 'Only an approved version can be eSigned.', code: 'not_approved'}, 409);
    const existing = await db().prepare('SELECT provider,document_id,status,signing_url FROM scopeflow.esign_records WHERE project_id=? AND version=?').bind(id, row.version).first<{provider: string; document_id: string; status: string; signing_url: string | null}>();
    if (existing) return json({esign: existing});
    const origin = (process.env.APP_URL || new URL(request.url).origin).replace(/\/$/, '');
    const pdf = renderReceiptPdf(await receiptModel(request, row));
    let created;
    try {
      created = await provider.create({project_id: id, version: row.version, title: (JSON.parse(row.content) as {title: string}).title, pdf, signer: {name: row.signer, email: row.client_email, phone: row.client_phone}, callback_url: `${origin}/api/esign/${provider.id}/callback`, return_url: `${origin}/review/${row.token}`});
    } catch (e) {
      if (e instanceof EsignUnavailable) return json({error: e.message, code: 'esign_unavailable'}, 502);
      throw e;
    }
    await db().prepare('INSERT INTO scopeflow.esign_records (id,project_id,version,provider,document_id,status,signing_url,created) VALUES (?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(), id, row.version, provider.id, created.document_id, 'requested', created.signing_url, new Date().toISOString()).run();
    return json({esign: {provider: provider.id, document_id: created.document_id, status: 'requested', signing_url: created.signing_url}}, 201);
  } catch (e) { return failure(e); }
}
