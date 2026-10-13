import { db, json, failure } from '@/lib/server';
import { adminAuthorized } from '@/lib/readiness';
import { IDEMPOTENCY_TTL_MS } from '@/lib/idempotency';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Daily housekeeping (scripts/cron.mjs housekeeping): expired idempotency keys (M28), OAuth codes
// a day past expiry (used ones are kept that long for replay detection, M23), expired OAuth tokens
// and cron runs older than 90 days (M31). Idempotent.
export async function POST(request: Request) {
  try {
    if (!adminAuthorized(request)) return json({ error: 'Operator token required.' }, 401);
    const now = Date.now();
    const [keys, codes, tokens, runs] = await db().batch([
      db().prepare('DELETE FROM scopeflow.idempotency_keys WHERE created < ?').bind(new Date(now - IDEMPOTENCY_TTL_MS).toISOString()),
      db().prepare('DELETE FROM oauth_codes WHERE expires < ?').bind(new Date(now - 86400_000).toISOString()),
      db().prepare('DELETE FROM oauth_tokens WHERE expires < ?').bind(new Date(now).toISOString()),
      db().prepare('DELETE FROM scopeflow.cron_runs WHERE started < ?').bind(new Date(now - 90 * 86400_000).toISOString()),
    ]);
    return json({ idempotency_keys: keys.meta.changes, oauth_codes: codes.meta.changes, oauth_tokens: tokens.meta.changes, cron_runs: runs.meta.changes });
  } catch (e) { return failure(e); }
}
