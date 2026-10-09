import {z} from 'zod';
import {db, json, body, safeOrigin, allowWrite, failure} from '@/lib/server';
import {settleSchema, checkEntry} from '@/lib/ledger';
import {loadLedger, appendEntry, LedgerConflict} from '@/lib/ledger-server';
import {decisionContext} from '@/lib/decision';
import {signEvidence} from '@/lib/otp';
import {otpEvidence} from '@/lib/otp-server';
type Ctx = {params: Promise<{token: string}>};

const decisionSchema = z.object({
  seq: z.number().int().min(1),
  decision: z.enum(['approved', 'declined']),
  signer: z.string().trim().min(2).max(120),
  comment: z.string().trim().max(3000),
  otp_session: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();

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

    const ledger = await loadLedger(row.project_id, {forClient: true});
    if (!ledger.baseline || ledger.baseline.id !== row.id || !ledger.content || !ledger.agreement) return json({error: 'This link is not for the current approved agreement. Ask the creator for the latest link.'}, 409);
    const payload = settleSchema.parse({ref_seq: input.data.seq, outcome: input.data.decision, signer: input.data.signer, comment: input.data.comment});
    const problem = checkEntry('settle', payload, ledger.content, ledger.agreement, 'client');
    if (problem) return json({error: problem}, /already|no longer|not found/.test(problem) ? 409 : 400);
    // PR B: the creator's email-code requirement covers change-order decisions too.
    let identity: Record<string, unknown> = {};
    if (row.require_otp) {
      const evidence = await otpEvidence(row.id, input.data.otp_session);
      if (!evidence) return json({error: input.data.otp_session ? 'Your email confirmation expired. Send a new code and try again.' : 'Confirm your email with the code we send you before recording a decision.', code: 'otp_required'}, 403);
      const anchor = ledger.anchors[ledger.baseline.version];
      identity = {identity: evidence, identity_signature: await signEvidence(`${anchor}:settle:${payload.ref_seq}`, evidence)};
    }
    try {
      const entry = await appendEntry({baseline: ledger.baseline, expectedHead: ledger.head, kind: 'settle', payload, actor: 'client', ref: 'settle:' + payload.ref_seq, context: await decisionContext(request, row.owner, identity)});
      return json({status: input.data.decision, seq: input.data.seq, receipt: {entry_seq: entry.seq, hash: entry.hash, signature: entry.signature, ...identity}});
    } catch (e) {
      if (e instanceof LedgerConflict) return json({error: e.message}, 409);
      throw e;
    }
  } catch (e) { return failure(e); }
}
