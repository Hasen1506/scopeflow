import {revoke, readForm, oauthError, corsHeaders} from '@/lib/oauth';
import {allowWrite, ipKey, failure} from '@/lib/server';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    // S9: same per-address limit as the token endpoint.
    if (!await allowWrite('oauth-revoke:' + await ipKey(request), 60)) return oauthError('temporarily_unavailable', 'Too many requests. Try again in a minute.', 429);
    let form: URLSearchParams;
    try { form = await readForm(request); } catch { return oauthError('invalid_request', 'Send a form-encoded revocation request.'); }
    return await revoke(request, form);
  } catch (e) { return failure(e); }
}
export function OPTIONS() { return new Response(null, {status: 204, headers: corsHeaders}); }
