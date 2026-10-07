import {getUser} from '@/lib/auth/server';
import {clientIp} from '@/lib/server';

/**
 * SF-02: context recorded with every client decision so the record shows how it was
 * made. `owner_session` is true when the decision arrived from a browser that is
 * signed in to the project owner's account, i.e. the freelancer approving their own
 * scope.
 */
export async function decisionContext(request: Request, projectOwner: string, extra: Record<string, unknown> = {}) {
  let ownerSession = false;
  if (/neon-auth/.test(request.headers.get('cookie') || '')) {
    try { ownerSession = (await getUser())?.userId === projectOwner; } catch { ownerSession = false; }
  }
  return {
    channel: 'review_link',
    ip: clientIp(request),
    user_agent: (request.headers.get('user-agent') || '').slice(0, 200),
    owner_session: ownerSession,
    via_api: !request.headers.get('origin'),
    ...extra,
  };
}
