import {revoke, readForm, oauthError, corsHeaders} from '@/lib/oauth';
import {failure} from '@/lib/server';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    let form: URLSearchParams;
    try { form = await readForm(request); } catch { return oauthError('invalid_request', 'Send a form-encoded revocation request.'); }
    return await revoke(request, form);
  } catch (e) { return failure(e); }
}
export function OPTIONS() { return new Response(null, {status: 204, headers: corsHeaders}); }
