import {z} from 'zod';
import {after} from 'next/server';
import {timestampRecord} from '@/lib/timestamps';
import {db, json, body, safeOrigin, allowWrite, allowRead, failure, ipKey} from '@/lib/server';
import {sha256} from '@/lib/ledger';
import {anchorOf} from '@/lib/ledger-server';
import {signRecord, publicSigningKey} from '@/lib/signing';
import {decisionContext} from '@/lib/decision';
import {signEvidence} from '@/lib/otp';
import {cosignMessage} from '@/lib/cosign';
import {zoneOrUtc} from '@/lib/time';
import {canonical, evidenceStatement, maskAddress} from '@/lib/evidence';
import {checkDecisionProof, signingBlocked, signingUnavailable} from '@/lib/identity';
import {resolveCosignToken, roleDestination} from '@/lib/cosign-server';
import {recordEvidence, parseContext} from '@/lib/record-evidence';
type Ctx = {params: Promise<{token: string}>};

const notFound = () => json({error: 'This countersigning link was not found.', code: 'not_found'}, 404);
const input = z.object({
  signer: z.string().trim().min(2).max(120),
  acknowledged: z.literal(true),
  content_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  otp_session: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();

// H1: one countersigning role's own link. It shows the approved version and lets that role, and
// only that role, countersign after a one-time code to its own address (when it has one).
export async function GET(request: Request, ctx: Ctx) {
  try {
    if (!await allowRead('cosign-ip:' + await ipKey(request), 120)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const {token} = await ctx.params;
    const r = await resolveCosignToken(token);
    if (!r) return notFound();
    const signed = await db().prepare('SELECT signer,signed,signature,context FROM version_cosigns WHERE project_id=? AND version=? AND cosigner_id=?').bind(r.project_id, r.version, r.cosigner_id).first<{signer: string; signed: string; signature: string | null; context: string | null}>();
    const dest = roleDestination(r);
    return json({
      role: {id: r.cosigner_id, role: r.role, name: r.name},
      scope: {project_id: r.project_id, version: r.version, latest: r.latest, content: JSON.parse(r.content), status: r.status, signer: r.signer, decided: r.decided},
      cosign: signed ? {signer: signed.signer, signed: signed.signed, signature: signed.signature, verified_to: (parseContext(signed.context).verified_to as string | undefined) ?? null} : null,
      identity_check: !signed && !r.readonly && dest ? {method: dest.channel + '_otp', channel: dest.channel, to: maskAddress(dest.channel, dest.to), action: 'cosign'} : null,
      readonly: r.readonly, readonly_reason: r.readonly_reason,
      evidence: r.status !== 'pending' && r.decided ? await recordEvidence(r) : null,
      time_zone: zoneOrUtc(r.timezone), signing_key: publicSigningKey(),
    });
  } catch (e) { return failure(e); }
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const {token} = await ctx.params;
    const r = await resolveCosignToken(token);
    if (!r) return notFound();
    if (r.readonly) return json({error: 'This countersigning link is closed for new signatures.', code: 'link_readonly', readonly_reason: r.readonly_reason}, 403);
    if (signingBlocked()) return signingUnavailable();
    if (r.status !== 'approved' || r.version !== r.latest) return json({error: 'Only the current approved version can be countersigned.', code: 'not_approved'}, 409);
    if (!await allowWrite('cosign:' + r.invite_id, 10)) return json({error: 'Too many attempts. Try again in a minute.'}, 429);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const parsed = input.safeParse(raw);
    if (!parsed.success) return json({error: 'Enter your name and confirm you reviewed this version.'}, 400);
    const contentHash = await sha256(canonical(JSON.parse(r.content)));
    if (parsed.data.content_sha256 !== contentHash) return json({error: 'This version did not load completely. Reload before signing.', code: 'content_changed'}, 409);
    const dest = roleDestination(r);
    // A role with an address proves control of it with a code bound to this role (M14).
    const proof = await checkDecisionProof({versionId: r.id, requireOtp: !!dest, otpSession: parsed.data.otp_session, action: 'cosign', target: r.cosigner_id});
    if (!proof.ok) return json({error: proof.error.replace('your email', 'your address'), code: proof.code}, proof.status);
    const anchor = await anchorOf(r);
    const verifiedTo = proof.evidence && dest ? maskAddress(dest.channel, dest.to) : null;
    const identity = proof.evidence ? {identity: proof.evidence, identity_signature: await signEvidence(`${anchor}:cosign:${r.cosigner_id}`, proof.evidence), verified_to: verifiedTo} : {};
    const signed = new Date().toISOString();
    const cosign = {cosigner_id: r.cosigner_id, role: r.role, signer: parsed.data.signer, signed};
    const signature = signRecord(await cosignMessage(anchor, cosign));
    if (!signature && signingBlocked()) return signingUnavailable();
    const context = await decisionContext(request, r.owner, {channel: 'cosign_link', acknowledged: true, content_sha256: contentHash, ...identity});
    try {
      await db().prepare('INSERT INTO version_cosigns (id,project_id,version,cosigner_id,role,signer,signed,signature,context) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(crypto.randomUUID(), r.project_id, r.version, r.cosigner_id, r.role, cosign.signer, signed, signature, JSON.stringify(context)).run();
    } catch (e) {
      if (String(e).includes('UNIQUE') || String(e).includes('duplicate')) return json({error: `${r.role} has already countersigned this version.`, code: 'already_signed'}, 409);
      if (String(e).includes('closed this account')) return json({error: 'The creator closed their ScopeFlow account; this record is read-only.', code: 'account_closed'}, 409);
      throw e;
    }
    after(async () => timestampRecord(r.project_id, r.version, 'cosign:' + r.cosigner_id, await sha256(await cosignMessage(anchor, cosign))));
    return json({cosign: {...cosign, signature, anchor, key: publicSigningKey(), ...identity, statement: evidenceStatement({decision: 'countersigned', code_to: verifiedTo, owner_session: context.owner_session === true, time_zone: r.timezone})}}, 201);
  } catch (e) { return failure(e); }
}
