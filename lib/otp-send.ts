import {db, json, hash, secret} from './server';
import {MailError, brandEmail} from './mail';
import {brandForProject} from './brand-server';
import {publicUrl} from './origin';
import {OTP_MAX_ATTEMPTS, OTP_TTL_MS, OtpDeliveryError, OtpUnavailable, codeHash, deliverCode, generateCode, normalizeCode, otpEmail, type OtpChannel} from './otp';
import {otpSendLimit, recordOtpSpend, type OtpAction} from './otp-server';
import {maskAddress} from './evidence';

// One-time code send and verify, shared by the client review link (decision, change orders) and
// each countersigner's own link (H1). Codes are bound to the version, the action and the target
// (M14) and rate- and cost-limited (M15). Delivery: lib/otp.ts deliverCode (WS-06 replaces the
// transport with sendOtpMessage(); request in docs/ws-02.md).

export type CodeTarget = {versionId: string; projectId: string; version: number; owner: string; title: string; action: OtpAction; target: string | null};

export async function sendCode(request: Request, t: CodeTarget, channel: OtpChannel, destination: string) {
  const limit = await otpSendLimit({versionId: t.versionId, destination, owner: t.owner, channel, cosignRole: t.action === 'cosign' ? t.target : null});
  if (!limit.ok) return json({error: limit.error, code: limit.code, retry_after: limit.retry_after}, 429, {'Retry-After': String(limit.retry_after)});
  const now = Date.now(), id = crypto.randomUUID(), code = generateCode();
  await db().prepare('INSERT INTO review_otps (id,version_id,email,channel,code_hash,expires,created,action,target) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(id, t.versionId, destination, channel, await codeHash(id, code), new Date(now + OTP_TTL_MS).toISOString(), new Date(now).toISOString(), t.action, t.target).run();
  try {
    const brand = await brandForProject(t.projectId);
    const otpMessage = otpEmail({code, title: t.title, version: t.version});
    await deliverCode(destination, {...brandEmail(otpMessage, brand && {name: brand.name, color: brand.color, logoUrl: brand.logoHash ? publicUrl(request, '/api/brand/' + brand.logoHash) : null}), sms: otpMessage.sms}, {code, version_id: t.versionId, id}, process.env, channel, {fromName: brand?.name, replyTo: brand?.replyTo});
  } catch (e) {
    await db().prepare('DELETE FROM review_otps WHERE id=?').bind(id).run();
    if (e instanceof OtpUnavailable) return json({error: 'Codes cannot be sent on this server right now. Ask the creator to turn off the identity check or set up delivery.', code: 'otp_unavailable'}, 503);
    if (e instanceof MailError || e instanceof OtpDeliveryError) return json({error: e.message, code: 'mail_failed'}, 502);
    throw e;
  }
  await recordOtpSpend({owner: t.owner, projectId: t.projectId, versionId: t.versionId, channel, destination}).catch(() => {/* metering never blocks a code */});
  return json({sent: true, to: maskAddress(channel, destination), channel, action: t.action, expires_in: OTP_TTL_MS / 1000});
}

/** Verifies the latest open code of this kind (client codes and countersigner codes never mix). */
export async function verifyCode(t: {versionId: string; channel: OtpChannel; destination: string; cosignRole: string | null}, rawCode: unknown) {
  const code = normalizeCode(rawCode);
  if (!/^\d{6}$/.test(code)) return json({error: 'Enter the 6-digit code from the message.'}, 400);
  const now = Date.now();
  const kind = t.cosignRole === null ? "action<>'cosign'" : "action='cosign' AND target=?";
  const stmt = db().prepare(`SELECT id,code_hash,attempts,expires FROM review_otps WHERE version_id=? AND verified IS NULL AND ${kind} ORDER BY created DESC LIMIT 1`);
  const otp = await (t.cosignRole === null ? stmt.bind(t.versionId) : stmt.bind(t.versionId, t.cosignRole)).first<{id: string; code_hash: string; attempts: number; expires: string}>();
  if (!otp || Date.parse(otp.expires) <= now) return json({error: 'This code has expired. Send a new one.', code: 'otp_expired'}, 410);
  if (otp.attempts >= OTP_MAX_ATTEMPTS) return json({error: 'Too many wrong codes. Send a new one.', code: 'otp_locked'}, 429);
  if (await codeHash(otp.id, code) !== otp.code_hash) {
    const counted = await db().prepare('UPDATE review_otps SET attempts=attempts+1 WHERE id=? AND attempts < ? RETURNING attempts').bind(otp.id, OTP_MAX_ATTEMPTS).first<{attempts: number}>();
    const left = OTP_MAX_ATTEMPTS - (counted?.attempts ?? OTP_MAX_ATTEMPTS);
    return json({error: left > 0 ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong codes. Send a new one.', code: left > 0 ? 'otp_wrong' : 'otp_locked', attempts_left: left}, left > 0 ? 400 : 429);
  }
  const session = secret();
  // Single use: only the first correct submission wins (verified IS NULL in the WHERE clause).
  const marked = await db().prepare('UPDATE review_otps SET verified=?,session_hash=? WHERE id=? AND verified IS NULL AND attempts < ? RETURNING id').bind(new Date(now).toISOString(), await hash(session), otp.id, OTP_MAX_ATTEMPTS).first<{id: string}>();
  if (!marked) return json({error: 'This code was already used. Send a new one.', code: 'otp_used'}, 409);
  return json({verified: true, otp_session: session, email: maskAddress(t.channel, t.destination), channel: t.channel});
}
