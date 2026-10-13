import {z} from 'zod';
import {json, body, safeOrigin, allowWrite, failure} from '@/lib/server';
import type {Scope} from '@/lib/scope';
import {resolveCosignToken, roleDestination} from '@/lib/cosign-server';
import {sendCode, verifyCode} from '@/lib/otp-send';
type Ctx = {params: Promise<{token: string}>};

const input = z.discriminatedUnion('action', [
  z.object({action: z.literal('send')}).strict(),
  z.object({action: z.literal('verify'), code: z.string().max(20)}).strict(),
]);

// H1/M14: a countersigning role's one-time code goes to that role's own address and is bound to
// "cosign" for that role; it cannot back the client's decision or another role.
export async function POST(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const {token} = await ctx.params;
    const r = await resolveCosignToken(token);
    if (!r) return json({error: 'This countersigning link was not found.', code: 'not_found'}, 404);
    if (r.readonly) return json({error: 'This countersigning link is closed for new signatures.', code: 'link_readonly'}, 403);
    if (r.status !== 'approved' || r.version !== r.latest) return json({error: 'Only the current approved version can be countersigned.', code: 'not_approved'}, 409);
    const dest = roleDestination(r);
    if (!dest) return json({error: 'This role signs with a typed name; no code is needed.', code: 'otp_not_required'}, 409);
    if (!await allowWrite('otp-cosign:' + r.invite_id, 20)) return json({error: 'Too many attempts. Try again in a minute.'}, 429);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const parsed = input.safeParse(raw);
    if (!parsed.success) return json({error: 'Choose send or verify.'}, 400);
    if (parsed.data.action === 'send') return sendCode(request, {versionId: r.id, projectId: r.project_id, version: r.version, owner: r.owner, title: (JSON.parse(r.content) as Scope).title, action: 'cosign', target: r.cosigner_id}, dest.channel, dest.to);
    return verifyCode({versionId: r.id, channel: dest.channel, destination: dest.to, cosignRole: r.cosigner_id}, parsed.data.code);
  } catch (e) { return failure(e); }
}
