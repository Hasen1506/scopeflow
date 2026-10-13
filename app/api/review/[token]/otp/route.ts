import {z} from 'zod';
import {json, body, safeOrigin, allowWrite, failure} from '@/lib/server';
import {type OtpChannel} from '@/lib/otp';
import type {Scope} from '@/lib/scope';
import {loadLedger} from '@/lib/ledger-server';
import {linkExpired} from '@/lib/link';
import {resolveReviewToken, linkStateOf} from '@/lib/review-link';
import {sendCode, verifyCode} from '@/lib/otp-send';
import type {OtpAction} from '@/lib/otp-server';
type Ctx = {params: Promise<{token: string}>};

const input = z.discriminatedUnion('action', [
  z.object({action: z.literal('send'), target: z.union([z.number().int().min(1), z.null()]).optional()}).strict(),
  z.object({action: z.literal('verify'), code: z.string().max(20)}).strict(),
]);

// PR B + M14/M15: the reviewer proves control of the project's client email or phone before deciding.
// send   -> a 6-digit code goes to the client contact the creator set (never one the reviewer types),
//           bound to what is waiting on this link: the decision on a pending version, or a change
//           order on the approved one (optionally one target seq). Rate- and cost-limited.
// verify -> a correct code returns a short-lived otp_session, consumed by the one record it backs.
// Countersigners never use this link: each role has its own link and code (/api/cosign/<token>/otp).
export async function POST(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const {token} = await ctx.params;
    const row = await resolveReviewToken(token);
    if (!row) return json({error: 'This review link was not found.'}, 404);
    if (row.readonly) return json({error: 'The creator closed this link for new changes. Your record stays available here.', code: 'link_readonly', readonly_reason: row.readonly_reason}, 403);
    if (linkExpired(linkStateOf(row))) return json({error: 'This review link has expired. Ask the creator for a new link.', code: 'link_expired'}, 410);
    if (!row.require_otp) return json({error: 'This scope does not need an email code.', code: 'otp_not_required'}, 409);
    if (row.version !== row.latest) return json({error: 'This version has been replaced. Ask the creator for the latest link.'}, 409);
    let action: OtpAction = 'decision';
    if (row.status !== 'pending') {
      const ledger = row.status === 'approved' ? await loadLedger(row.project_id, {forClient: true}) : null;
      const changeOrder = !!ledger?.agreement && ledger.baseline?.id === row.id && ledger.agreement.pending > 0;
      if (!changeOrder) return json({error: 'This version already has a decision and nothing is waiting for you.'}, 409);
      action = 'change_order';
    }
    const channel = (row.otp_channel ?? 'email') as OtpChannel;
    const destination = channel === 'email' ? row.client_email : row.client_phone;
    if (!destination) return json(channel === 'email' ? {error: 'The creator has not set your email address yet. Ask them to add it, then try again.', code: 'otp_no_email'} : {error: 'The creator has not set your phone number yet. Ask them to add it, then try again.', code: 'otp_no_phone'}, 409);
    if (!await allowWrite('otp:' + row.id, 20)) return json({error: 'Too many attempts. Try again in a minute.'}, 429);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const parsed = input.safeParse(raw);
    if (!parsed.success) return json({error: 'Choose send or verify.'}, 400);
    if (parsed.data.action === 'send') {
      const target = action === 'change_order' && parsed.data.target != null ? String(parsed.data.target) : null;
      return sendCode(request, {versionId: row.id, projectId: row.project_id, version: row.version, owner: row.owner, title: (JSON.parse(row.content) as Scope).title, action, target}, channel, destination);
    }
    return verifyCode({versionId: row.id, channel, destination, cosignRole: null}, parsed.data.code);
  } catch (e) { return failure(e); }
}
