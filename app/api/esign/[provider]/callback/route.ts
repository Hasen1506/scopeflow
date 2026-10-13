import {db, json, failure, readText, BODY_LIMITS} from '@/lib/server';
import {sha256} from '@/lib/ledger';
import {esignProvider} from '@/lib/esign';
type Ctx = {params: Promise<{provider: string}>};

// SF-15: the eSign provider's callback. Authenticated by the provider's MAC; attaches the signed PDF
// (stored with its SHA-256) and the audit trail to the record once. The receipt then names the
// Aadhaar eSign and the PDF's fingerprint; nothing else about the record changes.
export async function POST(request: Request, ctx: Ctx) {
  try {
    const {provider: name} = await ctx.params;
    const provider = esignProvider(process.env, name);
    if (!provider || provider.id !== name) return json({error: 'Unknown eSign provider.'}, 404);
    // H1: a signed PDF can be several MB; read at most BODY_LIMITS.esign (proxy.ts skips this path).
    const raw = await readText(request, BODY_LIMITS.esign);
    const done = await provider.parseCallback(raw, request.headers).catch(() => null);
    if (!done) return json({error: 'Callback not authenticated.'}, 401);
    const pdf = done.signed_pdf;
    if (done.status === 'signed' && (!pdf || Buffer.from(pdf).subarray(0, 5).toString('latin1') !== '%PDF-')) return json({error: 'The signed document is missing or not a PDF.'}, 400);
    const signedSha = pdf ? await sha256(Buffer.from(pdf).toString('latin1')) : null;
    const r = await db().prepare("UPDATE scopeflow.esign_records SET status=?,signed_pdf=?,signed_sha256=?,audit_trail=?,signer_masked=?,completed=? WHERE document_id=? AND provider=? AND status='requested' RETURNING project_id,version")
      .bind(done.status, pdf ? Buffer.from(pdf).toString('base64') : null, signedSha, done.audit_trail == null ? null : JSON.stringify(done.audit_trail), done.signer_masked, new Date().toISOString(), done.document_id, name).first<{project_id: string; version: number}>();
    if (!r) return json({ok: true, unchanged: true});
    return json({ok: true, status: done.status, signed_sha256: signedSha});
  } catch (e) { return failure(e); }
}
