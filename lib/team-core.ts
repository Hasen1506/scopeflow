// Pure role rules for a studio account. No database.

export type TeamRole = 'owner' | 'manager' | 'member' | 'finance';
export type MemberRole = Exclude<TeamRole, 'owner'>;
export const MEMBER_ROLES: readonly MemberRole[] = ['manager', 'member', 'finance'];

export type TeamPowers = {invite: boolean; revoke: boolean; editRateCard: boolean; readRateCard: boolean; issueLinks: boolean; editScope: boolean};

/** What each role may do. Owner is the account itself; the other three are invited. */
export function teamPowers(role: TeamRole): TeamPowers {
  const owner = role === 'owner';
  return {
    invite: owner,
    revoke: owner,
    editRateCard: owner || role === 'manager' || role === 'finance',
    readRateCard: true,
    issueLinks: owner || role === 'manager',
    editScope: owner || role === 'manager' || role === 'member',
  };
}

export function isMemberRole(v: unknown): v is MemberRole {
  return v === 'manager' || v === 'member' || v === 'finance';
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function memberEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const email = v.trim().toLowerCase();
  return email.length <= 200 && EMAIL.test(email) ? email : null;
}

export function studioCookie(request: {headers: {get(name: string): string | null}}): string | null {
  const raw = request.headers.get('cookie') ?? '';
  const match = raw.match(/(?:^|;\s*)sf_studio=([^;]+)/);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

export function studioCookieHeader(account: string | null) {
  if (!account) return 'sf_studio=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
  return `sf_studio=${encodeURIComponent(account)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}`;
}
