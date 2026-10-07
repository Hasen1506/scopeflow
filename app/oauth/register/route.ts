import {registerClient, oauthJson, oauthError, corsHeaders} from '@/lib/oauth';
import {allowWrite, ipKey, failure} from '@/lib/server';
export const dynamic = 'force-dynamic';
// RFC 7591 dynamic client registration (open registration; clients get no access until a user consents).
export async function POST(request: Request) {
  try {
    if (!await allowWrite('oauth-register:' + await ipKey(request), 20)) return oauthError('temporarily_unavailable', 'Too many registrations. Try again in a minute.', 429);
    let input: unknown;
    try { const text = await request.text(); if (text.length > 8000) throw new Error('too large'); input = JSON.parse(text); } catch { return oauthError('invalid_client_metadata', 'Send client metadata as JSON under 8 KB.'); }
    const result = await registerClient(input);
    if ('error' in result) return oauthError(result.error!, result.description!);
    return oauthJson(result.client, 201);
  } catch (e) { return failure(e); }
}
export function OPTIONS() { return new Response(null, {status: 204, headers: corsHeaders}); }
