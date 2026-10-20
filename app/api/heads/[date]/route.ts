import { json, failure, allowRead, ipKey } from '@/lib/server';
import { isDate, isFinal, storedDigest, previewDigest, publishDigest, projectKey, verifyDigest } from '@/lib/heads';
import { adminAuthorized } from '@/lib/readiness';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
type Ctx = { params: Promise<{ date: string }> };

// C7: GET /api/heads/<YYYY-MM-DD> — the signed digest of every ledger head at the end of that UTC
// date, with its RFC 3161 token once published. ?project=<id> also returns that project's head key,
// so a client can find its own line. Public: it contains only hashes.
export async function GET(request: Request, ctx: Ctx) {
  try {
    const { date } = await ctx.params;
    if (!isDate(date)) return json({ error: 'Use a date like 2026-10-11.', code: 'invalid_date' }, 400);
    if (!isFinal(date)) return json({ error: 'This date has not ended yet (UTC); its digest is published the day after.', code: 'not_final' }, 409);
    if (!await allowRead('heads-ip:' + await ipKey(request), 120)) return json({ error: 'Too many requests. Try again in a minute.' }, 429);
    // D5: an unpublished date is not computed for anonymous callers (a full ledger scan plus a
    // signature per request). The operator token may still preview it.
    const stored = await storedDigest(date);
    if (!stored && !adminAuthorized(request)) return json({ error: 'No digest has been published for this date yet.', code: 'not_published' }, 404);
    const digest = stored ?? await previewDigest(date);
    const project = new URL(request.url).searchParams.get('project');
    const mine = project ? digest.heads.find(h => h.p === projectKey(project)) ?? null : undefined;
    return json({ ...digest, signature_state: verifyDigest(digest), message: `scopeflow-heads-v1:${digest.date}:${digest.digest}`, ...(mine !== undefined ? { project_head: mine } : {}) }, 200, { 'Cache-Control': digest.published ? 'public, max-age=86400, immutable' : 'no-store' });
  } catch (e) { return failure(e); }
}

// The daily cron (scripts/cron.mjs heads) publishes yesterday's digest with the operator token.
export async function POST(request: Request, ctx: Ctx) {
  try {
    if (!adminAuthorized(request)) return json({ error: 'Operator token required.' }, 401);
    const { date } = await ctx.params;
    if (!isDate(date) || !isFinal(date)) return json({ error: 'Publish only a date that has ended (UTC).', code: 'not_final' }, 409);
    return json(await publishDigest(date), 201);
  } catch (e) { return failure(e); }
}
