// M28: Idempotency-Key for state-changing requests (decisions, invoices, checkout, refunds).
//
//   export async function POST(request) {
//     return withIdempotency(request, 'decision:' + versionId, raw, () => handle(...));
//   }
//
// The first request with a key runs the handler and stores its reply (status < 500). A retry with
// the same key and the same body gets the stored reply again (with `Idempotency-Replayed: true`)
// instead of running twice, so a network retry of an applied decision returns the original 200.
// The same key with a different body is 422; a retry while the first is still running is 409.
// Without the header the handler simply runs. Keys are kept for 24 hours (cron housekeeping).
import {db, hash} from '@/lib/server';
import {Conflict, ValidationError} from '@/lib/errors';

export const IDEMPOTENCY_TTL_MS = 24 * 3600_000;
const KEY = /^[A-Za-z0-9_.:-]{8,200}$/;

/** The Idempotency-Key header, null when absent; throws ValidationError when it is malformed. */
export function idempotencyKey(request: Request): string | null {
  const value = request.headers.get('idempotency-key');
  if (value === null) return null;
  if (!KEY.test(value)) throw new ValidationError({'Idempotency-Key': 'Use 8–200 letters, digits, dots, colons, dashes or underscores.'}, 'The Idempotency-Key header is not valid.');
  return value;
}

type Stored = {fingerprint: string; status: number | null; body: string | null; created: string};

/**
 * Runs `handler` at most once per (scope, Idempotency-Key). `fingerprint` identifies the request
 * body (any JSON-serialisable value); a different body under the same key is refused.
 */
export async function withIdempotency(request: Request, scope: string, fingerprint: unknown, handler: () => Promise<Response>): Promise<Response> {
  const key = idempotencyKey(request);
  if (!key) return handler();
  const print = await hash(JSON.stringify(fingerprint ?? null));
  const now = new Date();
  const fresh = new Date(now.getTime() - IDEMPOTENCY_TTL_MS).toISOString();
  // Expired keys may be reused.
  await db().prepare('DELETE FROM scopeflow.idempotency_keys WHERE scope=? AND key=? AND created < ?').bind(scope, key, fresh).run();
  const claimed = await db().prepare('INSERT INTO scopeflow.idempotency_keys (scope,key,fingerprint,created) VALUES (?,?,?,?) ON CONFLICT (scope,key) DO NOTHING RETURNING key').bind(scope, key, print, now.toISOString()).first();
  if (!claimed) {
    const row = await db().prepare('SELECT fingerprint,status,body,created FROM scopeflow.idempotency_keys WHERE scope=? AND key=?').bind(scope, key).first<Stored>();
    if (!row) return withIdempotency(request, scope, fingerprint, handler);
    if (row.fingerprint !== print) return Response.json({error: 'This Idempotency-Key was already used for a different request.', code: 'idempotency_key_reused'}, {status: 422, headers: {'Cache-Control': 'no-store'}});
    if (row.status === null) throw new Conflict('idempotency_in_progress', 'The same request is still being processed. Try again in a moment.');
    return new Response(row.body, {status: row.status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Idempotency-Replayed': 'true', 'X-Content-Type-Options': 'nosniff'}});
  }
  let response: Response;
  try {
    response = await handler();
  } catch (e) {
    await db().prepare('DELETE FROM scopeflow.idempotency_keys WHERE scope=? AND key=?').bind(scope, key).run().catch(() => {});
    throw e;
  }
  // Only final answers are remembered: a 5xx (or a 429) may succeed on retry.
  const type = response.headers.get('content-type') ?? '';
  if (response.status >= 500 || response.status === 429 || !type.includes('json')) {
    await db().prepare('DELETE FROM scopeflow.idempotency_keys WHERE scope=? AND key=?').bind(scope, key).run().catch(() => {});
    return response;
  }
  const body = await response.clone().text();
  await db().prepare('UPDATE scopeflow.idempotency_keys SET status=?, body=? WHERE scope=? AND key=?').bind(response.status, body, scope, key).run();
  return response;
}

/** Housekeeping (scripts/cron.mjs): removes keys older than the TTL. */
export const purgeIdempotencySql = 'DELETE FROM scopeflow.idempotency_keys WHERE created < $1';
