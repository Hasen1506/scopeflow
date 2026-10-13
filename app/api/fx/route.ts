import {json, ownerAuth, allowRead, failure} from '@/lib/server';
import {FxError, MANUAL_RATE_FIELDS, referenceRate} from '@/lib/fx';

// Today's reference rate for a scope's second currency (owners only, so this is not an open proxy).
// WS-01 (L6): the provider chain in lib/fx.ts; when every provider fails the answer says so
// (`manual`), and the editor asks the owner for the rate with its source and date.
export async function GET(request: Request) {
  try {
    const auth = await ownerAuth(request);
    if (!auth) return json({error: 'Sign in or provide a valid API token.'}, 401);
    if (!await allowRead('owner:' + auth.user)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const url = new URL(request.url);
    const from = url.searchParams.get('from') ?? '', to = url.searchParams.get('to') ?? '';
    try { return json(await referenceRate(from, to)); }
    catch (e) {
      if (e instanceof FxError) return json({error: e.message, code: e.status === 400 ? 'invalid_currency' : 'fx_unavailable', ...(e.manual ? {manual: {required: MANUAL_RATE_FIELDS, tried: e.tried}} : {})}, e.status);
      throw e;
    }
  } catch (e) { return failure(e); }
}
