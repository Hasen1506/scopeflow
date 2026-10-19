import {getUser} from '@/lib/auth/server';
import {db, json, body, safeOrigin, allowWrite, failure} from '@/lib/server';
import {rateCardFor} from '@/lib/rate-card';
import {activityOf, canEnterStudio, inviteMember, isMemberRole, memberEmail, membersOf, revokeMember, seatSummary, studioCookieHeader, teamPowers} from '@/lib/team';
import {z} from 'zod';

export async function GET() {
  try {
    const user = await getUser();
    if (!user) return json({error: 'Sign in to see your team.'}, 401);
    const email = user.email.trim().toLowerCase();
    const [summary, members, activity, rate_card, invites] = await Promise.all([
      seatSummary(user.userId),
      membersOf(user.userId),
      activityOf(user.userId),
      rateCardFor(user.userId),
      db().prepare(`SELECT id,account,role,status,created FROM scopeflow.account_members WHERE email=? AND account<>? AND status='invited'`).bind(email, user.userId).all<{id: string; account: string; role: string; status: string; created: string}>(),
    ]);
    return json({
      you: {id: user.userId, email, role: 'owner' as const},
      account: summary,
      members,
      activity,
      rate_card,
      invites: invites.results,
      powers: teamPowers('owner'),
      roles: {
        owner: 'Invites people, edits projects and share links, and owns billing.',
        manager: 'Edits projects and share links, and the shared rate card. Cannot invite or open billing.',
        member: 'Edits drafts. Cannot issue share links, edit the rate card, or open billing.',
        finance: 'Edits the shared rate card and reads activity. Cannot edit scope text or issue share links.',
      },
    });
  } catch (e) { return failure(e); }
}

export async function POST(request: Request) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const user = await getUser();
    if (!user) return json({error: 'Sign in to invite someone.'}, 401);
    if (!await allowWrite('team:' + user.userId)) return json({error: 'Try again in a minute.'}, 429);
    let raw; try { raw = await body(request); } catch { return json({error: 'Provide valid JSON.'}, 400); }
    const email = memberEmail((raw as {email?: unknown}).email);
    const role = (raw as {role?: unknown}).role;
    if (!email || !isMemberRole(role)) return json({error: 'Use an email and a role of manager, member or finance.'}, 400);
    const result = await inviteMember(user.userId, user.email, email, role);
    if (!result.ok) return json(result.body, result.status);
    return json({member: result.member}, 201);
  } catch (e) { return failure(e); }
}

export async function DELETE(request: Request) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const user = await getUser();
    if (!user) return json({error: 'Sign in to change your team.'}, 401);
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return json({error: 'Name the person to remove.'}, 400);
    const result = await revokeMember(user.userId, id);
    if (!result.ok) return json(result.body, result.status);
    return json({revoked: true});
  } catch (e) { return failure(e); }
}

/** Opt into another studio's projects. Billing stays on the signed-in user. */
export async function PUT(request: Request) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const user = await getUser();
    if (!user) return json({error: 'Sign in to choose a workspace.'}, 401);
    let raw; try { raw = await body(request); } catch { return json({error: 'Provide valid JSON.'}, 400); }
    const account = z.object({account: z.string().min(1).max(200).nullable()}).strict().safeParse(raw);
    if (!account.success) return json({error: 'Name the studio, or send null to use your own account.'}, 400);
    const next = account.data.account;
    if (next && !await canEnterStudio(user.userId, next)) return json({error: 'You are not an active member of that studio.', code: 'role'}, 403);
    return json({account: next ?? user.userId}, 200, {'Set-Cookie': studioCookieHeader(next && next !== user.userId ? next : null)});
  } catch (e) { return failure(e); }
}
