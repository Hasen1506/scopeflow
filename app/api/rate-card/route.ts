import {json, owner, body, safeOrigin, allowWrite, allowRead, failure} from '@/lib/server';
import {rateCardFor, saveRateCard, rateCardSchema} from '@/lib/rate-card';

// SF-06: the account's rate card (price book). GET reads it, PUT replaces it.
export async function GET(request: Request) {
  try {
    const user = await owner(request);
    if (!user) return json({error: 'Sign in or provide a valid API token.'}, 401);
    if (!await allowRead('owner:' + user)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    return json({rate_card: await rateCardFor(user)});
  } catch (e) { return failure(e); }
}

export async function PUT(request: Request) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const user = await owner(request);
    if (!user) return json({error: 'Sign in or provide a valid API token.'}, 401);
    if (!await allowWrite('owner:' + user)) return json({error: 'Write limit reached. Try again in a minute.'}, 429);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const parsed = rateCardSchema.safeParse(raw);
    if (!parsed.success) return json({error: parsed.error.issues.map(i => `${i.path.join('.') || 'rate card'}: ${i.message}`).join('; '), fields: parsed.error.issues.map(i => i.path.join('.'))}, 400);
    return json({rate_card: await saveRateCard(user, parsed.data)});
  } catch (e) { return failure(e); }
}
