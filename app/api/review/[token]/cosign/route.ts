import {json, safeOrigin, failure} from '@/lib/server';
import {resolveReviewToken} from '@/lib/review-link';
type Ctx = {params: Promise<{token: string}>};

// H1: countersignatures are never recorded through the client's review link. Each countersigning
// role has its own identity, link (/cosign/<token>) and one-time code to that role's own address:
// POST /api/cosign/<token>. Countersignatures recorded here before are kept (read-only).
export async function POST(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const {token} = await ctx.params;
    if (!await resolveReviewToken(token)) return json({error: 'This review link was not found.'}, 404);
    return json({error: 'Countersign from the link the creator sent to your role. The client’s review link cannot countersign.', code: 'use_your_cosigner_link'}, 403);
  } catch (e) { return failure(e); }
}
