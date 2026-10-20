import {getUser} from '@/lib/auth/server';
import {json, body, safeOrigin, allowWrite, failure, db} from '@/lib/server';
import {rateCardFor, saveRateCard, rateCardSchema} from '@/lib/rate-card';
import {isMemberRole, recordActivity, teamPowers, type MemberRole} from '@/lib/team';
import {allows} from '@/lib/plans';
import {planStateFor} from '@/lib/billing';

/** Shared rate card. The owner edits their own. A manager or finance member edits the studio's. */
export async function GET(request: Request) {
  try {
    const user = await getUser();
    if (!user) return json({error: 'Sign in to read the rate card.'}, 401);
    const account = await accountFor(user.userId, new URL(request.url).searchParams.get('account'));
    if (!account.ok) return json(account.body, account.status);
    return json({account: account.account, role: account.role, rate_card: await rateCardFor(account.account), can_edit: teamPowers(account.role).editRateCard});
  } catch (e) { return failure(e); }
}

export async function PUT(request: Request) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const user = await getUser();
    if (!user) return json({error: 'Sign in to edit the rate card.'}, 401);
    const account = await accountFor(user.userId, new URL(request.url).searchParams.get('account'));
    if (!account.ok) return json(account.body, account.status);
    if (!teamPowers(account.role).editRateCard) return json({error: 'Your role can read the shared rate card, not change it.', code: 'role'}, 403);
    if (!await allowWrite('rate:' + account.account)) return json({error: 'Try again in a minute.'}, 429);
    let raw; try { raw = await body(request); } catch { return json({error: 'Provide valid JSON.'}, 400); }
    const parsed = rateCardSchema.safeParse(raw);
    if (!parsed.success) return json({error: parsed.error.issues.map(i => `${i.path.join('.') || 'rate card'}: ${i.message}`).join('; ')}, 400);
    const saved = await saveRateCard(account.account, parsed.data);
    await recordActivity(account.account, user.userId, 'rate_card', {items: saved.items.length});
    return json({rate_card: saved});
  } catch (e) { return failure(e); }
}

async function accountFor(userId: string, requested: string | null): Promise<{ok: true; account: string; role: 'owner' | MemberRole} | {ok: false; status: number; body: {error: string; code?: string}}> {
  if (!requested || requested === userId) return {ok: true, account: userId, role: 'owner'};
  const member = await db().prepare(`SELECT role FROM scopeflow.account_members WHERE account=? AND user_id=? AND status='active'`).bind(requested, userId).first<{role: string}>();
  if (!member || !isMemberRole(member.role)) return {ok: false, status: 403, body: {error: 'You are not an active member of that studio.', code: 'role'}};
  if (!allows((await planStateFor(requested)).plan, 'team')) return {ok: false, status: 402, body: {error: 'That studio is not on a plan with team seats.', code: 'plan_feature'}};
  return {ok: true, account: requested, role: member.role};
}
