import {type IdentityEvidence, type OtpChannel} from './otp';
import {consumeOtpSession, type OtpBinding} from './otp-server';
import {signingBlocked as blocked, signingStatus as status} from './signing';
import {maskAddress as mask} from './evidence';
import {getAuth} from './auth/server';
import {json, type Auth} from './server';

// Client identity and signing status (owner: WS-02). Server-side; the pure, client-safe wording
// and masking live in lib/evidence.ts and are re-exported here for the Phase 0 contract.

type Env = Record<string, string | undefined>;
export {evidenceWording, chipWording, evidenceStatement, codeLine, acceptanceWording, canonical, contentFingerprint, formatExpiry, sealStatus} from './evidence';

/**
 * C1: where the record-signing key comes from. WS-10's health route answers 503 unless this is
 * `dedicated` in production. `previous_only`: only retired secrets are set (verification works, no
 * new seals).
 */
export function signingStatus(env: Env = process.env): 'dedicated' | 'cookie_fallback' | 'previous_only' | 'off' {
  return status(env);
}
/** C1: true when production cannot seal new records with the dedicated key; every signing path then refuses. */
export function signingBlocked(env: Env = process.env) { return blocked(env); }
/** C1: the honest 503 every signing path returns while signing is unavailable. Nothing is saved. */
export function signingUnavailable() {
  return json({error: 'This record can’t be signed right now; nothing was saved. Try again later.', code: 'signing_unavailable'}, 503);
}

export type DecisionProof =
  | {ok: true; evidence: IdentityEvidence | null}
  | {ok: false; status: 401 | 403; code: 'otp_required'; error: string};

/**
 * Is a client decision on `versionId` backed by the identity proof the project requires? When a
 * one-time code is required, a verified, unexpired otp_session for this version, bound to this
 * action (and target), must be presented. The session is consumed by this check (M14): a second
 * use answers 401 otp_required. WS-05 uses it for change-order decisions (H17).
 */
export async function checkDecisionProof(opts: {versionId: string; requireOtp: boolean; otpSession?: string} & OtpBinding): Promise<DecisionProof> {
  if (!opts.requireOtp) return {ok: true, evidence: null};
  if (!opts.otpSession) return {ok: false, status: 403, code: 'otp_required', error: 'Confirm your email with the code we send you before recording a decision.'};
  const r = await consumeOtpSession(opts.versionId, opts.otpSession, {action: opts.action, target: opts.target});
  if (r.ok) return {ok: true, evidence: r.evidence};
  if (r.reason === 'used' || r.reason === 'wrong_action') return {ok: false, status: 401, code: 'otp_required', error: 'That code was already used for another step. Send a new code for this one.'};
  return {ok: false, status: 403, code: 'otp_required', error: 'Your email confirmation expired. Send a new code and try again.'};
}

/** The masked destination shown to a reviewer and on receipts (§6.2.6): "s***@e***.com", "+91 ****4044". */
export function maskAddress(channel: OtpChannel | 'phone', to: string): string {
  return mask(channel, to);
}

export type ReadonlyReason = 'revoked' | 'rotated' | 'account_closed';
export type LinkVersion = {status: string; revoked?: number | boolean | null; alias?: boolean | null; owner_deleted?: string | null};

/** Why no new action (decision, change order, payment, cosign) can be taken through this link, or null. */
export function readonlyReason(v: LinkVersion): ReadonlyReason | null {
  if (v.owner_deleted) return 'account_closed';
  if (v.alias) return 'rotated';
  if (v.revoked) return 'revoked';
  return null;
}

/**
 * H4 (§6.3): is this review link read-only? A revoked or rotated-away decided link, or a link of a
 * closed account, still shows the record but takes no new action. A pending version is never
 * served once revoked (404), so it never reaches this. A decided version cannot be decided again
 * but stays open for change orders, payments and countersignatures until it is revoked.
 */
export function isLinkReadonly(v: LinkVersion): boolean {
  return readonlyReason(v) !== null;
}

/** M16: reply for identity-field changes from anything but a freshly authenticated browser session. */
export const REAUTH_WINDOW_MS = 10 * 60_000;
export async function requireFreshSession(auth: Auth): Promise<Response | null> {
  if (auth.via !== 'session') return json({error: 'Change the client contact, identity checks and countersigners from the signed-in ScopeFlow website. API tokens and connectors cannot change them.', code: 'session_required'}, 403);
  let created: number = NaN;
  try {
    const {data} = await getAuth().getSession({query: {disableCookieCache: 'true'}});
    const raw = (data as {session?: {createdAt?: unknown}} | null)?.session?.createdAt;
    created = raw instanceof Date ? raw.getTime() : Date.parse(String(raw));
  } catch { created = NaN; }
  if (!Number.isFinite(created) || Date.now() - created > REAUTH_WINDOW_MS) return json({error: 'For your security, sign in again (within the last 10 minutes) before changing who confirms decisions.', code: 'reauth_required'}, 403);
  return null;
}
