import {maskDestination, type IdentityEvidence, type OtpChannel} from './otp';
import {otpEvidence} from './otp-server';
import {signingSource} from './signing';

// Client identity and signing status (owner: WS-02). Phase 0: final names, today's behaviour,
// lifted from lib/signing.ts, the review decision route and lib/otp.ts. Nothing calls them yet;
// WS-02 moves the review routes onto them and changes the behaviour (C1, C5, H5, §6.2).

type Env = Record<string, string | undefined>;

/** Where the record-signing key comes from: today's lib/signing.ts signingSource(). */
export function signingStatus(env: Env = process.env): 'dedicated' | 'cookie_fallback' | 'off' {
  return signingSource(env);
}

export type DecisionProof =
  | {ok: true; evidence: IdentityEvidence | null}
  | {ok: false; status: 403; code: 'otp_required'; error: string};

/**
 * Is a client decision on `versionId` backed by the identity proof the project requires?
 * Today's rule (app/api/review/[token]/route.ts): when a one-time code is required, a verified,
 * unexpired otp_session for this version must be presented.
 */
export async function checkDecisionProof(opts: {versionId: string; requireOtp: boolean; otpSession?: string}): Promise<DecisionProof> {
  if (!opts.requireOtp) return {ok: true, evidence: null};
  if (!opts.otpSession) return {ok: false, status: 403, code: 'otp_required', error: 'Confirm your email with the code we send you before recording a decision.'};
  const evidence = await otpEvidence(opts.versionId, opts.otpSession);
  if (!evidence) return {ok: false, status: 403, code: 'otp_required', error: 'Your email confirmation expired. Send a new code and try again.'};
  return {ok: true, evidence};
}

/** The masked destination shown to a reviewer: today's lib/otp.ts maskDestination(). */
export function maskAddress(channel: OtpChannel, to: string): string {
  return maskDestination(channel, to);
}

/**
 * Does this review link only show the record (no decision can be recorded on it)? Today: any
 * version that is no longer pending. Revoked links are not served at all (404), so they never
 * reach this check; WS-02 makes revoked decided links read-only instead (§6.3).
 */
export function isLinkReadonly(v: {status: string; revoked?: number | boolean | null}): boolean {
  return v.status !== 'pending';
}
