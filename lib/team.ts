// Studio membership. The signed-in person keeps their own account unless they opt in
// with the sf_studio cookie, and only on the routes that call workspaceUser.
// Billing, API tokens and account deletion keep using the real user id.
import {allows, featureDenied, seatCapError, type FeatureGate} from './plans';
import {planStateFor, limitsFor} from './billing';
import {db, type Auth} from './server';
import {isMemberRole, studioCookie, teamPowers, type MemberRole, type TeamRole} from './team-core';

export {isMemberRole, memberEmail, studioCookie, studioCookieHeader, teamPowers, MEMBER_ROLES, type MemberRole, type TeamPowers, type TeamRole} from './team-core';

export async function recordActivity(account: string, actor: string, kind: string, detail: Record<string, unknown>) {
  try {
    await db().prepare('INSERT INTO scopeflow.account_activity (id,account,actor,kind,detail,created) VALUES (?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), account, actor, kind, JSON.stringify(detail), new Date().toISOString()).run();
  } catch (e) { console.error('Scopeflow team activity not recorded:', kind, e instanceof Error ? e.message : e); }
}

export type MemberRow = {id: string; account: string; email: string; user_id: string | null; role: MemberRole; status: 'invited' | 'active'; created: string};

export async function membersOf(account: string) {
  const rows = await db().prepare('SELECT id,account,email,user_id,role,status,created FROM scopeflow.account_members WHERE account=? ORDER BY created').bind(account).all<MemberRow>();
  return rows.results;
}
export async function activityOf(account: string) {
  const rows = await db().prepare('SELECT id,actor,kind,detail,created FROM scopeflow.account_activity WHERE account=? ORDER BY created DESC LIMIT 40').bind(account).all<{id: string; actor: string; kind: string; detail: string; created: string}>();
  return rows.results.map(r => ({...r, detail: safeDetail(r.detail)}));
}
function safeDetail(raw: string) {
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
}

/** Seats in use: the owner plus every invited or active member. */
export async function seatsUsed(account: string) {
  const row = await db().prepare('SELECT COUNT(*)::int AS n FROM scopeflow.account_members WHERE account=?').bind(account).first<{n: number | string}>();
  return Number(row?.n ?? 0) + 1;
}

export async function inviteMember(account: string, actorEmail: string, email: string, role: MemberRole) {
  const state = await planStateFor(account);
  if (!allows(state.plan, 'team')) return {ok: false as const, status: 402, body: featureDenied('team')};
  if (email === actorEmail.trim().toLowerCase()) return {ok: false as const, status: 400, body: {error: 'You are already on this account.', code: 'self'}};
  const powers = teamPowers('owner');
  if (!powers.invite) return {ok: false as const, status: 403, body: {error: 'Only the studio owner invites people.', code: 'role'}};
  const used = await seatsUsed(account);
  const cap = seatCapError(used, state.plan.limits);
  if (cap) return {ok: false as const, status: 429, body: {error: cap, code: 'plan_limit', limit: state.plan.limits.seats}};
  const existing = await db().prepare('SELECT id,status FROM scopeflow.account_members WHERE account=? AND email=?').bind(account, email).first<{id: string; status: string}>();
  if (existing) return {ok: false as const, status: 409, body: {error: 'That person is already invited or active.', code: 'exists'}};
  const id = crypto.randomUUID(), now = new Date().toISOString();
  await db().prepare('INSERT INTO scopeflow.account_members (id,account,email,user_id,role,status,created) VALUES (?,?,?,?,?,?,?)').bind(id, account, email, null, role, 'invited', now).run();
  await recordActivity(account, account, 'invite', {email, role});
  return {ok: true as const, member: {id, email, role, status: 'invited' as const, created: now}};
}

export async function acceptInvite(memberId: string, userId: string, email: string) {
  const row = await db().prepare('SELECT id,account,email,role,status FROM scopeflow.account_members WHERE id=?').bind(memberId).first<MemberRow>();
  if (!row || row.email !== email.trim().toLowerCase()) return {ok: false as const, status: 404, body: {error: 'No invite for this account.', code: 'not_found'}};
  const state = await planStateFor(row.account);
  if (!allows(state.plan, 'team')) return {ok: false as const, status: 402, body: featureDenied('team')};
  if (row.status !== 'active') {
    await db().prepare(`UPDATE scopeflow.account_members SET status='active', user_id=? WHERE id=? AND email=?`).bind(userId, row.id, row.email).run();
    await recordActivity(row.account, userId, 'accept', {email: row.email, role: row.role});
  }
  return {ok: true as const, account: row.account, role: row.role};
}

export async function revokeMember(account: string, memberId: string) {
  const row = await db().prepare('SELECT id,email,role FROM scopeflow.account_members WHERE id=? AND account=?').bind(memberId, account).first<{id: string; email: string; role: string}>();
  if (!row) return {ok: false as const, status: 404, body: {error: 'That person is not on this account.', code: 'not_found'}};
  await db().prepare('DELETE FROM scopeflow.account_members WHERE id=? AND account=?').bind(memberId, account).run();
  await recordActivity(account, account, 'revoke', {email: row.email, role: row.role});
  return {ok: true as const};
}

export type Workspace = {user: string; role: TeamRole; studio: boolean};

/**
 * The account a project route should read. API tokens and OAuth always stay on their
 * own user. A browser session uses another account only when the sf_studio cookie names
 * a studio they belong to and that studio is still on a plan with team seats.
 */
export async function workspaceUser(request: Request, auth: Auth): Promise<Workspace> {
  if (auth.via !== 'session') return {user: auth.user, role: 'owner', studio: false};
  const wanted = studioCookie(request);
  if (!wanted || wanted === auth.user) return {user: auth.user, role: 'owner', studio: false};
  const member = await db().prepare(`SELECT role FROM scopeflow.account_members WHERE account=? AND user_id=? AND status='active'`).bind(wanted, auth.user).first<{role: MemberRole}>();
  if (!member || !isMemberRole(member.role)) return {user: auth.user, role: 'owner', studio: false};
  const state = await planStateFor(wanted);
  if (!allows(state.plan, 'team' satisfies FeatureGate)) return {user: auth.user, role: 'owner', studio: false};
  return {user: wanted, role: member.role, studio: true};
}

/** Confirms the signed-in user may enter `account` (their own id, or an active seat). */
export async function canEnterStudio(userId: string, account: string) {
  if (account === userId) return true;
  const member = await db().prepare(`SELECT role FROM scopeflow.account_members WHERE account=? AND user_id=? AND status='active'`).bind(account, userId).first();
  if (!member) return false;
  return allows((await planStateFor(account)).plan, 'team');
}

export async function seatSummary(account: string) {
  const [state, used] = await Promise.all([planStateFor(account), seatsUsed(account)]);
  const limits = state.plan.limits.seats ? state.plan.limits : await limitsFor(account);
  return {plan: state.plan.id, name: state.plan.name, seats: limits.seats, used, team: allows(state.plan, 'team')};
}
