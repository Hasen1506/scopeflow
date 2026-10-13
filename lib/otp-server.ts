import {db, hash} from './server';
import {OTP_SESSION_TTL_MS, type IdentityEvidence} from './otp';
import {OTP_UNIT_COST, OTP_WINDOW_MS, otpDailyBudget, otpSendAllowed, type OtpLimit} from './otp-limits';

export type OtpAction = 'decision' | 'change_order' | 'cosign';
export type OtpBinding = {action?: OtpAction; target?: string | number | null};
type OtpRow = {id: string; email: string; channel: string | null; verified: string; action: string | null; target: string | null; consumed: string | null};

const evidenceOf = (otp: OtpRow): IdentityEvidence => otp.channel === 'sms' || otp.channel === 'whatsapp'
  ? {method: otp.channel === 'sms' ? 'sms_otp' : 'whatsapp_otp', phone: otp.email, verified_at: otp.verified, otp_id: otp.id}
  : {method: 'email_otp', email: otp.email, verified_at: otp.verified, otp_id: otp.id};

export type OtpSessionCheck =
  | {ok: true; evidence: IdentityEvidence}
  | {ok: false; reason: 'missing' | 'unknown' | 'expired' | 'used' | 'wrong_action'};

/**
 * M14: the identity evidence behind an otp_session for one version, consumed by this use. A
 * session is bound to the action it was sent for (decision, change_order, cosign) and to a target
 * (change-order seq or countersigning role) once used; it backs exactly one record. Shared by the
 * scope decision, change-order decisions and countersignatures.
 */
export async function consumeOtpSession(versionId: string, session: string | undefined, bind: OtpBinding = {}): Promise<OtpSessionCheck> {
  if (!session || !/^[a-f0-9]{64}$/.test(session)) return {ok: false, reason: 'missing'};
  const otp = await db().prepare('SELECT id,email,channel,verified,action,target,consumed FROM review_otps WHERE version_id=? AND session_hash=? AND verified IS NOT NULL').bind(versionId, await hash(session)).first<OtpRow>();
  if (!otp) return {ok: false, reason: 'unknown'};
  if (otp.consumed) return {ok: false, reason: 'used'};
  if (Date.now() - Date.parse(otp.verified) > OTP_SESSION_TTL_MS) return {ok: false, reason: 'expired'};
  // A countersigner's code (sent to that role's address) never backs anything but that role's signature.
  if ((otp.action === 'cosign') !== (bind.action === 'cosign')) return {ok: false, reason: 'wrong_action'};
  if (bind.action && otp.action && otp.action !== bind.action) return {ok: false, reason: 'wrong_action'};
  const target = bind.target == null ? null : String(bind.target);
  if (target !== null && otp.target !== null && otp.target !== target) return {ok: false, reason: 'wrong_action'};
  const used = await db().prepare('UPDATE review_otps SET consumed=?,target=coalesce(target,?) WHERE id=? AND consumed IS NULL RETURNING id').bind(new Date().toISOString(), target, otp.id).first<{id: string}>();
  if (!used) return {ok: false, reason: 'used'};
  return {ok: true, evidence: evidenceOf(otp)};
}

/**
 * Backwards-compatible form used by routes outside WS-02 (the change-order decision): the evidence,
 * or null. It consumes the session too (M14), so one code never backs two records.
 */
export async function otpEvidence(versionId: string, session: string | undefined, bind: OtpBinding = {}): Promise<IdentityEvidence | null> {
  const r = await consumeOtpSession(versionId, session, bind);
  return r.ok ? r.evidence : null;
}

/** M15: may a code for this version go to `destination` now? */
export async function otpSendLimit(o: {versionId: string; destination: string; owner: string; channel: 'email' | 'sms' | 'whatsapp'; cosignRole?: string | null}): Promise<OtpLimit> {
  const now = Date.now(), since = new Date(now - OTP_WINDOW_MS).toISOString();
  // The client's codes and each countersigning role's codes are limited separately.
  const version = o.cosignRole
    ? await db().prepare("SELECT created FROM review_otps WHERE version_id=? AND action='cosign' AND target=? AND created > ? ORDER BY created").bind(o.versionId, o.cosignRole, since).all<{created: string}>()
    : await db().prepare("SELECT created FROM review_otps WHERE version_id=? AND action<>'cosign' AND created > ? ORDER BY created").bind(o.versionId, since).all<{created: string}>();
  const destination = await db().prepare('SELECT created FROM review_otps WHERE email=? AND created > ? ORDER BY created').bind(o.destination, since).all<{created: string}>();
  const spent = await otpSpendToday(o.owner);
  return otpSendAllowed({now, version: version.results.map(r => Date.parse(r.created)), destination: destination.results.map(r => Date.parse(r.created)), spent: spent.units, cost: OTP_UNIT_COST[o.channel], budget: otpDailyBudget()});
}

/** M15: meter one code sent (owner-private; the destination is stored only as a hash). */
export async function recordOtpSpend(o: {owner: string; projectId: string; versionId: string; channel: 'email' | 'sms' | 'whatsapp'; destination: string}) {
  const now = new Date();
  await db().prepare('INSERT INTO scopeflow.otp_spend (id,owner,project_id,version_id,channel,destination_hash,units,day,created) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), o.owner, o.projectId, o.versionId, o.channel, (await hash('otp-destination:' + o.destination)).slice(0, 32), OTP_UNIT_COST[o.channel], now.toISOString().slice(0, 10), now.toISOString()).run();
}

/** M15: today's (UTC) code spend for an owner, for readiness and the budget check. */
export async function otpSpendToday(owner: string) {
  const day = new Date().toISOString().slice(0, 10);
  const r = await db().prepare('SELECT COUNT(*) AS codes, COALESCE(SUM(units),0) AS units FROM scopeflow.otp_spend WHERE owner=? AND day=?').bind(owner, day).first<{codes: number; units: number}>();
  return {day, codes: Number(r?.codes ?? 0), units: Number(r?.units ?? 0), budget: otpDailyBudget()};
}

/** M15: today's spend across every owner (for /api/readiness, WS-10 mounts it). */
export async function otpSpendTotals() {
  const day = new Date().toISOString().slice(0, 10);
  const r = await db().prepare('SELECT COUNT(*) AS codes, COALESCE(SUM(units),0) AS units, COUNT(DISTINCT owner) AS owners FROM scopeflow.otp_spend WHERE day=?').bind(day).first<{codes: number; units: number; owners: number}>();
  return {day, codes: Number(r?.codes ?? 0), units: Number(r?.units ?? 0), owners: Number(r?.owners ?? 0)};
}
