// Typed request errors and their HTTP responses (owner: WS-10, M28).
//
// Taxonomy: ValidationError 400 (with a field map), Forbidden 403, Conflict 409, RateLimited 429,
// Unavailable 503 (only when a dependency is down or not configured), anything unexpected 500 with
// an error id that is also logged. lib/server.ts failure() is the catch-all every route uses and
// delegates to errorResponse() here.

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

// ---------------------------------------------------------------------------------------------
// M28: classification of everything else a route can throw.
// ---------------------------------------------------------------------------------------------

/** Connection-level failures: the database (or another dependency) is down, not a bug. */
const DOWN_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE',
  '57P01', '57P02', '57P03', '53300', '53400', '08000', '08001', '08003', '08004', '08006', '08007', '08P01']);
const DOWN_MESSAGES = /timeout exceeded when trying to connect|Connection terminated|connect ECONNREFUSED|DATABASE_URL is required|the database system is (?:starting up|shutting down)|too many clients/i;

function codeOf(e: unknown): string | null {
  for (let x: unknown = e, i = 0; x && typeof x === 'object' && i < 4; x = (x as {cause?: unknown}).cause, i++) {
    const code = (x as {code?: unknown}).code;
    if (typeof code === 'string') return code;
  }
  return null;
}
function messageOf(e: unknown): string {
  const parts: string[] = [];
  for (let x: unknown = e, i = 0; x && i < 4; x = (x as {cause?: unknown}).cause, i++) parts.push(x instanceof Error ? x.message : String(x));
  return parts.join(' | ');
}

export type ErrorClass = 'typed' | 'invalid_input' | 'conflict' | 'immutable' | 'dependency' | 'unexpected';
/** Which branch errorResponse() takes for `e` (exported for tests). */
export function classify(e: unknown): ErrorClass {
  if (toResponse(e)) return 'typed';
  if (e instanceof Error && e.name === 'InvalidInputError') return 'invalid_input';
  const code = codeOf(e), message = messageOf(e);
  if (code === '23505' || /UNIQUE constraint violation/.test(message) || code === '40001' || code === '40P01') return 'conflict';
  if (code === 'P0001' && /scopeflow: /.test(message)) return 'immutable';
  if ((code && DOWN_CODES.has(code)) || DOWN_MESSAGES.test(message)) return 'dependency';
  return 'unexpected';
}

/** A short random id, quoted in the reply and in the server log, so support can find the failure. */
export function errorId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return 'err_' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/** The HTTP response for any error a route throws. `log` receives unexpected failures only. */
export function errorResponse(e: unknown, log: (id: string, e: unknown) => void = (id, err) => console.error('Scopeflow request failed', id, err instanceof Error ? (err.stack ?? err.message) : String(err))): Response {
  const typed = toResponse(e);
  if (typed) return typed;
  switch (classify(e)) {
    case 'invalid_input':
      return json({error: 'Some input could not be stored: remove control characters (such as NUL) and use whole numbers within range.', code: 'invalid_input'}, 400);
    case 'conflict':
      return json({error: 'This changed at the same time. Reload and try again.', code: 'conflict'}, 409);
    case 'immutable':
      return json({error: 'This record is final and cannot be changed.', code: 'immutable'}, 409);
    case 'dependency':
      console.error('Scopeflow dependency unavailable', messageOf(e));
      return json({error: 'Scopeflow cannot reach its database right now. Your input is preserved; try again in a moment.', code: 'unavailable', dependency: 'database'}, 503, {'Retry-After': '5'});
    default: {
      const id = errorId();
      log(id, e);
      return json({error: `Something went wrong on our side (error ${id}). Please try again; if it keeps happening, quote this id to support.`, code: 'internal_error', error_id: id}, 500);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// LT-06 support: zod issues as human field messages, keyed by the dotted field path.
// ---------------------------------------------------------------------------------------------

type Issue = {path: (string | number)[]; message: string; code?: string; minimum?: unknown; maximum?: unknown; type?: string};
const humanize = (key: string) => key.replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase());

/** One message per field path (the first issue wins), with the field's label instead of its schema key. */
export function fieldErrors(issues: Issue[], labels: Record<string, string> = {}): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of issues) {
    const path = issue.path.join('.') || '_form';
    if (out[path]) continue;
    const top = String(issue.path[0] ?? '');
    const label = labels[path] ?? labels[top] ?? (top ? humanize(top) : 'This form');
    let message = issue.message;
    if (issue.code === 'too_small' && issue.type === 'string') message = Number(issue.minimum) <= 1 ? `${label} is required.` : `${label}: use at least ${issue.minimum} characters.`;
    else if (issue.code === 'too_big' && issue.type === 'string') message = `${label}: use at most ${issue.maximum} characters.`;
    else if (issue.code === 'invalid_type' && /required/i.test(issue.message)) message = `${label} is required.`;
    else if (/^(?:Required|Invalid input|Expected .* received .*)$/i.test(issue.message)) message = `Check ${label.toLowerCase()}.`;
    out[path] = message;
  }
  return out;
}

/** A ValidationError from a failed zod parse (`result.error.issues`). */
export function validationFromZod(issues: Issue[], labels: Record<string, string> = {}, message?: string) {
  return new ValidationError(fieldErrors(issues, labels), message);
}
