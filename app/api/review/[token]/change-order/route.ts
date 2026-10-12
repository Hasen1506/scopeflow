import {z} from 'zod';
import {db, json, body, safeOrigin, allowWrite, failure} from '@/lib/server';
import {settleSchema, checkEntry, coSha256, coTotals} from '@/lib/ledger';
import {loadLedger, appendEntry, LedgerConflict} from '@/lib/ledger-server';
import {decisionContext} from '@/lib/decision';
import {signEvidence} from '@/lib/otp';
import {checkDecisionProof} from '@/lib/identity';
type Ctx = {params: Promise<{token: string}>};

const decisionSchema = z.object({
  seq: z.number().int().min(1),
  decision: z.enum(['approved', 'declined']),
  signer: z.string().trim().min(2).max(120),
  comment: z.string().trim().max(3000),
  otp_session: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  // H17: the client's acknowledgement and the SHA-256 of the change order exactly as rendered
  // (lib/ledger.ts coCanonical: title, deliverables, fee change, tax, total incl. tax, days).
  acknowledged: z.boolean().optional(),
  co_sha256: z.string().optional(),
}).strict();

/**
 * H17 transition: until the client page sends the proof (WS-07 mounts CoCard), a decision in the
 * pre-WS-05 shape (neither `acknowledged` nor `co_sha256`) is still accepted and recorded exactly as
 * before (no proof in the settle payload); the receipt reports the hash of the change order served. SCOPEFLOW_CO_PROOF=strict refuses that shape (400).
 * Any request that carries either field must carry both, and the hash must match (409 co_changed).
 */
function legacyAllowed(env: Record<string, string | undefined> = process.env) { return env.SCOPEFLOW_CO_PROOF !== 'strict'; }

// The client settles change orders through the review link of the approved baseline.
export async function POST(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const {token} = await ctx.params;
    if (!/^[a-f0-9]{64}$/.test(token)) return json({error: 'This review link was not found.'}, 404);
    const row = await db().prepare('SELECT v.id,v.project_id,p.owner,p.require_otp FROM versions v JOIN projects p ON p.id=v.project_id WHERE v.token=? AND v.revoked=0').bind(token).first<{id: string; project_id: string; owner: string; require_otp: boolean}>();
    if (!row) return json({error: 'This review link was not found.'}, 404);
    if (!await allowWrite('review:' + row.id, 10)) return json({error: 'Too many attempts. Try again in a minute.'}, 429);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const input = decisionSchema.safeParse(raw);
    if (!input.success) return json({error: 'Enter your name and a valid decision.'}, 400);
    const proofSent = input.data.acknowledged !== undefined || input.data.co_sha256 !== undefined;
    if (proofSent || !legacyAllowed()) {
      if (input.data.acknowledged !== true) return json({error: 'Confirm that you reviewed this change order before recording a decision.', code: 'co_proof_required'}, 400);
      if (!input.data.co_sha256 || !/^[a-f0-9]{64}$/.test(input.data.co_sha256)) return json({error: 'Your page did not send the fingerprint of the change order you reviewed. Reload the page and try again.', code: 'co_proof_required'}, 400);
    }

    const ledger = await loadLedger(row.project_id, {forClient: true});
    if (!ledger.baseline || ledger.baseline.id !== row.id || !ledger.content || !ledger.agreement) return json({error: 'This link is not for the current approved agreement. Ask the creator for the latest link.'}, 409);
    const co = ledger.agreement.change_orders.find(c => c.seq === input.data.seq);
    const proof = co ? {co_sha256: await coSha256(co, ledger.content), total_incl_tax_minor: coTotals(co, ledger.content).total_incl_tax_minor} : null;
    if (proof && proofSent && proof.co_sha256 !== input.data.co_sha256 && co?.status === 'proposed') return json({error: 'This change order is not the one your page showed. Reload to see the current version before deciding.', code: 'co_changed'}, 409);
    // The proof goes on the record only when the client's page sent it: a legacy-shape decision keeps
    // the exact pre-WS-05 settle payload (so existing exports and goldens are unchanged); its receipt
    // still reports the hash the server computed for the change order it served.
    const payload = settleSchema.parse({ref_seq: input.data.seq, outcome: input.data.decision, signer: input.data.signer, comment: input.data.comment, ...(proofSent ? {acknowledged: true, ...(proof ?? {})} : {})});
    const problem = checkEntry('settle', payload, ledger.content, ledger.agreement, 'client');
    if (problem) return json({error: problem}, /already|no longer|not found/.test(problem) ? 409 : 400);
    // PR B: the creator's email-code requirement covers change-order decisions too (WS-02 helper).
    let identity: Record<string, unknown> = {};
    const otp = await checkDecisionProof({versionId: row.id, requireOtp: !!row.require_otp, otpSession: input.data.otp_session});
    if (!otp.ok) return json({error: otp.error, code: otp.code}, otp.status);
    if (otp.evidence) {
      const anchor = ledger.anchors[ledger.baseline.version];
      identity = {identity: otp.evidence, identity_signature: await signEvidence(`${anchor}:settle:${payload.ref_seq}`, otp.evidence)};
    }
    try {
      const entry = await appendEntry({baseline: ledger.baseline, expectedHead: ledger.head, kind: 'settle', payload, actor: 'client', ref: 'settle:' + payload.ref_seq, context: await decisionContext(request, row.owner, identity)});
      return json({status: input.data.decision, seq: input.data.seq, receipt: {entry_seq: entry.seq, hash: entry.hash, signature: entry.signature, change_order: `CO-${payload.ref_seq}`, co_sha256: proof?.co_sha256, total_incl_tax_minor: proof?.total_incl_tax_minor, proof_recorded: proofSent, ...identity}});
    } catch (e) {
      if (e instanceof LedgerConflict) return json({error: e.message}, 409);
      throw e;
    }
  } catch (e) { return failure(e); }
}
