// Typed request errors and their HTTP responses (owner: WS-10). Phase 0: the classes and
// toResponse() exist; no route throws them yet, so no response changes. lib/server.ts failure()
// stays the catch-all.

// Pure (no '@/' imports) so it can be unit tested under plain node; the headers match lib/server.ts json().
function json(data: unknown, status: number, headers: Record<string, string> = {}) {
  return Response.json(data, {status, headers: {'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', ...headers}});
}

export type FieldErrors = Record<string, string>;

export class ValidationError extends Error {
  readonly fields: FieldErrors;
  constructor(fields: FieldErrors, message = 'Check the highlighted fields.') { super(message); this.name = 'ValidationError'; this.fields = fields; }
}
export class Conflict extends Error {
  readonly code: string;
  constructor(code: string, message = 'This changed at the same time. Reload and try again.') { super(message); this.name = 'Conflict'; this.code = code; }
}
export class RateLimited extends Error {
  /** Seconds until a retry can succeed. */
  readonly retryAfter: number;
  constructor(retryAfter: number, message = 'Too many requests. Try again in a minute.') { super(message); this.name = 'RateLimited'; this.retryAfter = retryAfter; }
}
export class Unavailable extends Error {
  /** The dependency that is down or not configured (e.g. 'database', 'signing', 'mail'). */
  readonly dep: string;
  constructor(dep: string, message = 'Unable to complete this request. Your input is preserved; please try again.') { super(message); this.name = 'Unavailable'; this.dep = dep; }
}
export class Forbidden extends Error {
  readonly code: string;
  constructor(code: string, message = 'You cannot do this here.') { super(message); this.name = 'Forbidden'; this.code = code; }
}

/** The HTTP response for a typed error, or null for anything else (let failure() handle it). */
export function toResponse(e: unknown): Response | null {
  if (e instanceof ValidationError) return json({error: e.message, code: 'invalid_input', fields: e.fields}, 400);
  if (e instanceof Forbidden) return json({error: e.message, code: e.code}, 403);
  if (e instanceof Conflict) return json({error: e.message, code: e.code}, 409);
  if (e instanceof RateLimited) return json({error: e.message, code: 'rate_limited'}, 429, {'Retry-After': String(Math.max(1, Math.ceil(e.retryAfter)))});
  if (e instanceof Unavailable) return json({error: e.message, code: 'unavailable', dependency: e.dep}, 503);
  return null;
}
