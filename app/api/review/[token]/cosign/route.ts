import {z} from 'zod';
import {after} from 'next/server';
import {timestampRecord} from '@/lib/timestamps';
import {db, json, body, safeOrigin, allowWrite, failure} from '@/lib/server';
import {sha256} from '@/lib/ledger';
import {anchorOf} from '@/lib/ledger-server';
import {signRecord, publicSigningKey} from '@/lib/signing';
import {decisionContext} from '@/lib/decision';
import {signEvidence} from '@/lib/otp';
import {otpEvidence} from '@/lib/otp-server';
import {cosignMessage, parseCosigners} from '@/lib/cosign';
type Ctx = {params: Promise<{token: string}>};
type Row = {id: string; project_id: string; version: number; latest: number; status: string; content: string; signer: string | null; decided: string | null; owner: string; require_otp: boolean; cosigners: string | null};

const input = z.object({
  cosigner_id: z.string().min(1).max(24),
  signer: z.string().trim().min(2).max(120),
  acknowledged: z.literal(true),
  content_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  otp_session: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();

// A countersignature on the approved version, by one of the roles the creator listed. It is a
// separate signed record: the client's approval and its anchor never change.
export async function POST(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const {token} = await ctx.params;
    if (!/^[a-f0-9]{64}$/.test(token)) return json({error: 'This review link was not found.'}, 404);
    const row = await db().prepare('SELECT v.id,v.project_id,v.version,v.status,v.content,v.signer,v.decided,p.latest,p.owner,p.require_otp,p.cosigners FROM versions v JOIN projects p ON p.id=v.project_id WHERE v.token=? AND v.revoked=0').bind(token).first<Row>();
    if (!row) return json({error: 'This review link was not found.'}, 404);
    if (!await allowWrite('review:' + row.id, 10)) return json({error: 'Too many attempts. Try again in a minute.'}, 429);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const parsed = input.safeParse(raw);
    if (!parsed.success) return json({error: 'Enter your name and confirm you reviewed this version.'}, 400);
    if (row.status !== 'approved' || row.version !== row.latest) return json({error: 'Only the current approved version can be countersigned.', code: 'not_approved'}, 409);
    const role = parseCosigners(row.cosigners).find(c => c.id === parsed.data.cosigner_id);
    if (!role) return json({error: 'This role is not asked to countersign. Ask the creator for the latest link.', code: 'unknown_role'}, 404);
    const contentHash = await sha256(JSON.stringify(JSON.parse(row.content)));
    if (parsed.data.content_sha256 !== contentHash) return json({error: 'This version did not load completely. Reload before signing.'}, 409);
    let identity: Record<string, unknown> = {};
    const anchor = await anchorOf(row);
    if (row.require_otp) {
      const evidence = await otpEvidence(row.id, parsed.data.otp_session);
      if (!evidence) return json({error: 'Confirm the code we send before countersigning.', code: 'otp_required'}, 403);
      identity = {identity: evidence, identity_signature: await signEvidence(`${anchor}:cosign:${role.id}`, evidence)};
    }
    const signed = new Date().toISOString();
    const cosign = {cosigner_id: role.id, role: role.role, signer: parsed.data.signer, signed};
    const signature = signRecord(await cosignMessage(anchor, cosign));
    const context = await decisionContext(request, row.owner, {acknowledged: true, content_sha256: contentHash, ...identity});
    try {
      await db().prepare('INSERT INTO version_cosigns (id,project_id,version,cosigner_id,role,signer,signed,signature,context) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(crypto.randomUUID(), row.project_id, row.version, role.id, role.role, cosign.signer, signed, signature, JSON.stringify(context)).run();
    } catch (e) {
      if (String(e).includes('UNIQUE') || String(e).includes('duplicate')) return json({error: `${role.role} has already countersigned this version.`, code: 'already_signed'}, 409);
      throw e;
    }
    after(async () => timestampRecord(row.project_id, row.version, 'cosign:' + role.id, await sha256(await cosignMessage(anchor, cosign))));
    return json({cosign: {...cosign, signature, anchor, key: publicSigningKey(), ...identity}}, 201);
  } catch (e) { return failure(e); }
}
