import {db, hash} from './server';
import {OTP_SESSION_TTL_MS, type IdentityEvidence} from './otp';

/**
 * The identity evidence behind an otp_session for one version (the review link it was sent from),
 * or null when the session is missing, unknown or older than OTP_SESSION_TTL_MS. Shared by the
 * scope decision and change-order decisions.
 */
export async function otpEvidence(versionId: string, session: string | undefined): Promise<IdentityEvidence | null> {
  if (!session || !/^[a-f0-9]{64}$/.test(session)) return null;
  const otp = await db().prepare('SELECT id,email,channel,verified FROM review_otps WHERE version_id=? AND session_hash=? AND verified IS NOT NULL').bind(versionId, await hash(session)).first<{id: string; email: string; channel: string | null; verified: string}>();
  if (!otp || Date.now() - Date.parse(otp.verified) > OTP_SESSION_TTL_MS) return null;
  if (otp.channel === 'sms' || otp.channel === 'whatsapp') return {method: otp.channel === 'sms' ? 'sms_otp' : 'whatsapp_otp', phone: otp.email, verified_at: otp.verified, otp_id: otp.id};
  return {method: 'email_otp', email: otp.email, verified_at: otp.verified, otp_id: otp.id};
}
