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

type SendLimitInput = {versionId: string; destination: string; owner: string; channel: 'email' | 'sms' | 'whatsapp'; cosignRole?: string | null};
// The client's codes and each countersigning role's codes are limited separately.
const versionWhere = (cosignRole?: string | null) => cosignRole ? "version_id=? AND action='cosign' AND target=?" : "version_id=? AND action<>'cosign'";
const versionArgs = (o: SendLimitInput) => o.cosignRole ? [o.versionId, o.cosignRole] : [o.versionId];
// S6: the per-address limit counts only this owner's projects; a higher cap applies across owners.
const OWNER_DESTINATION = 'email=? AND version_id IN (SELECT v.id FROM versions v JOIN projects p ON p.id=v.project_id WHERE p.owner=?)';
/** S7: advisory lock keys that serialize the limit check and the insert for one version / one address. */
export const otpSendLockKeys = (o: {versionId: string; destination: string}) => [`scopeflow:otp-version:${o.versionId}`, `scopeflow:otp-destination:${o.destination.toLowerCase()}`] as const;

/** M15: may a code for this version go to `destination` now? `counts` are what the check saw (S7 re-checks them at insert). */
export async function otpSendLimit(o: SendLimitInput): Promise<OtpLimit & {counts?: {version: number; destination: number; since: string}}> {
  const now = Date.now(), since = new Date(now - OTP_WINDOW_MS).toISOString();
  const version = await db().prepare(`SELECT created FROM review_otps WHERE ${versionWhere(o.cosignRole)} AND created > ? ORDER BY created`).bind(...versionArgs(o), since).all<{created: string}>();
  const destination = await db().prepare(`SELECT created FROM review_otps WHERE ${OWNER_DESTINATION} AND created > ? ORDER BY created`).bind(o.destination, o.owner, since).all<{created: string}>();
  const global = await db().prepare('SELECT created FROM review_otps WHERE email=? AND created > ? ORDER BY created').bind(o.destination, since).all<{created: string}>();
  const spent = await otpSpendToday(o.owner);
  const verdict = otpSendAllowed({now, version: version.results.map(r => Date.parse(r.created)), destination: destination.results.map(r => Date.parse(r.created)), destinationGlobal: global.results.map(r => Date.parse(r.created)), spent: spent.units, cost: OTP_UNIT_COST[o.channel], budget: otpDailyBudget()});
  return verdict.ok ? {...verdict, counts: {version: version.results.length, destination: global.results.length, since}} : verdict;
}

/**
 * S7: insert the code row only if no other send for this version or address landed since the limit
 * check. Runs in one transaction that first takes both advisory locks (version, then address, so
 * the order is the same everywhere), so parallel sends cannot all pass the limits. Null = lost the race.
 */
export async function claimOtpSlot(o: SendLimitInput & {counts: {version: number; destination: number; since: string}}, row: {id: string; codeHash: string; expires: string; created: string; action: OtpAction; target: string | null}) {
  const [versionKey, destinationKey] = otpSendLockKeys(o);
  const insert = db().prepare(`INSERT INTO review_otps (id,version_id,email,channel,code_hash,expires,created,action,target)
    SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM review_otps WHERE ${versionWhere(o.cosignRole)} AND created > ?) = ?
      AND (SELECT COUNT(*) FROM review_otps WHERE email=? AND created > ?) = ? RETURNING id`)
    .bind(row.id, o.versionId, o.destination, o.channel, row.codeHash, row.expires, row.created, row.action, row.target, ...versionArgs(o), o.counts.since, o.counts.version, o.destination, o.counts.since, o.counts.destination);
  const lock = db().prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))').bind(destinationKey);
  const [, inserted] = await db().batch<{id: string}>([lock, insert], {lock: versionKey});
  return inserted.results[0]?.id ?? null;
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
