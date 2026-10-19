import {db, json, ownerAuth, allowRead, failure} from '@/lib/server';
import {recordEvidence} from '@/lib/record-evidence';
import {renderApprovalCertificate} from '@/lib/certificate';
import {zoneOrUtc} from '@/lib/time';
import {ensurePdfFonts} from '@/lib/pdf-fonts';
import {evidenceStatement} from '@/lib/evidence';
type Ctx = {params: Promise<{id: string}>};

// The owner's approval certificate for one decided version.
// GET /api/scopes/<id>/certificate?version=N (latest decided version when omitted).
export async function GET(request: Request, ctx: Ctx) {
  try {
    const auth = await ownerAuth(request);
    if (!auth || auth.via !== 'session') return json({error: 'Sign in to download the approval certificate.'}, 401);
    if (!await allowRead('owner:' + auth.user)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const {id} = await ctx.params;
    const raw = new URL(request.url).searchParams.get('version');
    const version = raw === null ? null : Number(raw);
    if (version !== null && (!Number.isInteger(version) || version < 1 || version > 100000)) return json({error: 'Use a whole version number.'}, 400);
    const fields = 'v.id,v.project_id,v.version,v.status,v.content,v.signer,v.comment,v.decided,v.signature,v.decision_context,p.timezone';
    const row = version === null
      ? await db().prepare(`SELECT ${fields} FROM versions v JOIN projects p ON p.id=v.project_id WHERE p.id=? AND p.owner=? AND p.owner_deleted IS NULL AND v.status<>'pending' ORDER BY v.version DESC LIMIT 1`).bind(id, auth.user).first<CertRow>()
      : await db().prepare(`SELECT ${fields} FROM versions v JOIN projects p ON p.id=v.project_id WHERE p.id=? AND p.owner=? AND p.owner_deleted IS NULL AND v.version=?`).bind(id, auth.user, version).first<CertRow>();
    if (!row) return json({error: 'Project not found.'}, 404);
    if (row.status === 'pending' || !row.decided || !row.signer) return json({error: 'This version has no client decision yet.', code: 'not_decided'}, 409);
    await ensurePdfFonts();
    const evidence = await recordEvidence(row);
    let ctxJson: Record<string, unknown> = {};
    try { ctxJson = row.decision_context ? JSON.parse(row.decision_context) as Record<string, unknown> : {}; } catch { ctxJson = {}; }
    const content = JSON.parse(row.content) as {title?: string; client?: string};
    const bytes = renderApprovalCertificate({
      project_id: row.project_id,
      title: content.title || 'Scope',
      client: content.client || 'Client',
      version: row.version,
      status: row.status,
      signer: row.signer,
      decided: row.decided,
      time_zone: zoneOrUtc(row.timezone),
      ip: typeof ctxJson.ip === 'string' && ctxJson.ip ? ctxJson.ip : 'Not recorded',
      browser: typeof ctxJson.user_agent === 'string' && ctxJson.user_agent ? ctxJson.user_agent.slice(0, 180) : 'Not recorded',
      content_sha256: evidence.content_sha256,
      seal_status: evidence.seal.status,
      seal_kid: evidence.seal.kid,
      statement: evidenceStatement({decision: row.status, code_to: evidence.code_to, on_file_since: evidence.on_file_since, owner_session: evidence.owner_session, time_zone: zoneOrUtc(row.timezone), plain: true}),
      otp: evidence.code_to,
    });
    return new Response(Buffer.from(bytes), {status: 200, headers: {'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="scopeflow-approval-v${row.version}.pdf"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'}});
  } catch (e) { return failure(e); }
}

type CertRow = {id: string; project_id: string; version: number; status: string; content: string; signer: string | null; decided: string | null; signature: string | null; decision_context: string | null; timezone?: string | null};
