import {getUser} from '@/lib/auth/server';
import {clientIp} from '@/lib/server';

/**
 * SF-02: context recorded with every client decision so the record shows how it was
 * made. `owner_session` is true when the decision arrived from a browser that is
 * signed in to the project owner's account, i.e. the freelancer approving their own
 * scope.
 */
/** True when the request comes from a browser signed in to `projectOwner`'s account. */
export async function isOwnerSession(request: Request, projectOwner: string) {
  if (!/neon-auth/.test(request.headers.get('cookie') || '')) return false;
  try { return (await getUser())?.userId === projectOwner; } catch { return false; }
}

export async function decisionContext(request: Request, projectOwner: string, extra: Record<string, unknown> = {}) {
  const ownerSession = await isOwnerSession(request, projectOwner);
  return {
    channel: 'review_link',
    ip: clientIp(request),
    user_agent: (request.headers.get('user-agent') || '').slice(0, 200),
    owner_session: ownerSession,
    via_api: !request.headers.get('origin'),
    ...extra,
  };
}
