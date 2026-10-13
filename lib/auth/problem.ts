// Auth-form errors in the app's own words. Pure, so it is unit tested (tests/property/ux-r2c.test.mjs).
//
// The Neon Auth client reaches us in two ways on a failed sign-in: it can *return* `{error}` (Better
// Auth's `{status, code: 'INVALID_EMAIL_OR_PASSWORD'}`), or its fetch wrapper can *throw* a normalized
// AuthApiError (`status: 401, code: 'invalid_credentials', message: 'Invalid email or password'`).
// Both must land on the same copy, and both must clear the password on a credentials problem.

export type AuthErrorLike = { message?: unknown; status?: unknown; code?: unknown } | null | undefined;

/** An error the form can show as-is. `credentials` = the details were wrong, so the password is cleared. */
export class AuthProblem extends Error {
  readonly credentials: boolean;
  constructor(message: string, credentials: boolean) { super(message); this.name = 'AuthProblem'; this.credentials = credentials; }
}

export const AUTH_COPY = {
  wrongDetails: 'That email and password don’t match. Check them and try again.',
  verifyFirst: 'Verify your email first: open the link we sent you, then sign in.',
  tooMany: 'Too many attempts. Wait a minute, then try again.',
  ourSide: 'Sign-in is having trouble on our side, so nothing was wrong with your details. Please try again in a moment.',
  offline: 'We couldn’t reach Scopeflow. Check your connection and try again.',
  exists: 'An account with this email already exists. Sign in instead, or reset your password.',
} as const;

const CREDENTIAL_CODES = /^(INVALID_EMAIL_OR_PASSWORD|INVALID_PASSWORD|INVALID_EMAIL|USER_NOT_FOUND|CREDENTIAL_ACCOUNT_NOT_FOUND|INVALID_CREDENTIALS|INVALID_GRANT)$/;
const UNVERIFIED_CODES = /^(EMAIL_NOT_VERIFIED|EMAIL_NOT_CONFIRMED)$/;
const RATE_CODES = /^(TOO_MANY_REQUESTS|OVER_REQUEST_RATE_LIMIT|RATE_LIMITED)$/;
const EXISTS_CODES = /^(USER_ALREADY_EXISTS|USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL|EMAIL_EXISTS)$/;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d{3}$/.test(v) ? Number(v) : 0);
/** Codes come upper snake (Better Auth) or lower snake (normalized); compare one way. */
const norm = (v: unknown) => (typeof v === 'string' ? v.trim().toUpperCase() : '');

/** Maps a returned or thrown auth error to the copy the form shows. Never throws. */
export function authProblem(error: AuthErrorLike | unknown, mode: string): AuthProblem {
  if (error instanceof AuthProblem) return error;
  // fetch() failing outright (offline, DNS, CORS) is a TypeError with no status.
  if (error instanceof TypeError && !num((error as AuthErrorLike)?.status)) return new AuthProblem(AUTH_COPY.offline, false);
  const e = (error && typeof error === 'object' ? error : {}) as { message?: unknown; status?: unknown; code?: unknown };
  const status = num(e.status), code = norm(e.code);
  const message = typeof e.message === 'string' ? e.message : '';
  if (status === 429 || RATE_CODES.test(code)) return new AuthProblem(AUTH_COPY.tooMany, false);
  if (status >= 500 || (!status && !code && !message)) return new AuthProblem(AUTH_COPY.ourSide, false);
  if (mode === 'sign-in') {
    if (UNVERIFIED_CODES.test(code)) return new AuthProblem(AUTH_COPY.verifyFirst, false);
    if (status === 401 || status === 403 || CREDENTIAL_CODES.test(code) || /invalid (email|password|credentials)/i.test(message)) return new AuthProblem(AUTH_COPY.wrongDetails, true);
  }
  if (mode === 'sign-up' && EXISTS_CODES.test(code)) return new AuthProblem(AUTH_COPY.exists, false);
  // R3-11: an unmapped error keeps what the person typed; only mapped credential errors clear the password.
  return new AuthProblem(message || (mode === 'sign-up' ? 'We couldn’t create the account. Check your details and try again.' : 'Unable to sign in.'), false);
}
