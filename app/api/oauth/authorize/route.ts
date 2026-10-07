import {getUser} from '@/lib/auth/server';
import {safeOrigin, allowWrite, failure} from '@/lib/server';
import {validateAuthorize, issueCode, redirectWith} from '@/lib/oauth';
export const dynamic = 'force-dynamic';
const page = (message: string, status: number) => new Response(`<!doctype html><meta charset="utf-8"><title>Scopeflow</title><p>${message.replace(/[<>&"]/g, c => `&#${c.charCodeAt(0)};`)}</p><p><a href="/">Back to Scopeflow</a></p>`, {status, headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}});
// Consent decision from /oauth/authorize. Same-origin form POST with the user's session.
export async function POST(request: Request) {
  try {
    if (!safeOrigin(request) || !request.headers.get('origin')) return page('This approval must be submitted from the Scopeflow consent page.', 403);
    const user = await getUser();
    if (!user) return page('Your session ended. Start the connection again from your app.', 401);
    if (!await allowWrite('oauth-consent:' + user.userId, 20)) return page('Too many attempts. Try again in a minute.', 429);
    const form = new URLSearchParams(await request.text());
    const query = Object.fromEntries(['client_id', 'redirect_uri', 'state', 'scope', 'code_challenge', 'code_challenge_method', 'response_type', 'resource'].map(k => [k, form.get(k) ?? undefined]));
    const checked = await validateAuthorize(request, query);
    if (!checked.ok) {
      if (!checked.redirect) return page(checked.message, 400);
      return Response.redirect(redirectWith(request, checked.redirect_uri, {error: checked.error, error_description: checked.description, state: checked.state}), 303);
    }
    const {params} = checked;
    if (form.get('decision') !== 'approve') return Response.redirect(redirectWith(request, params.redirect_uri, {error: 'access_denied', error_description: 'The user declined access.', state: params.state}), 303);
    const code = await issueCode(params, user.userId);
    return Response.redirect(redirectWith(request, params.redirect_uri, {code, state: params.state}), 303);
  } catch (e) { return failure(e); }
}
