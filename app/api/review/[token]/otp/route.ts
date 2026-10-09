import {z} from 'zod';
import {db, json, body, safeOrigin, allowWrite, failure, hash, secret} from '@/lib/server';
import {MailError} from '@/lib/mail';
import {OTP_MAX_ATTEMPTS, OTP_SENDS_PER_WINDOW, OTP_TTL_MS, OtpUnavailable, codeHash, deliverCode, generateCode, maskEmail, normalizeCode, otpEmail} from '@/lib/otp';
import type {Scope} from '@/lib/scope';
import {loadLedger} from '@/lib/ledger-server';
type Ctx = {params: Promise<{token: string}>};
type Row = {id: string; project_id: string; version: number; status: string; content: string; latest: number; require_otp: boolean; client_email: string | null};

const input = z.discriminatedUnion('action', [
  z.object({action: z.literal('send')}).strict(),
  z.object({action: z.literal('verify'), code: z.string().max(20)}).strict(),
]);

// PR B: the reviewer proves control of the project's client email before deciding.
// send   -> a 6-digit code goes to the client email the creator set (never one the reviewer types)
// verify -> a correct code returns a short-lived otp_session for the decision request
export async function POST(request: Request, ctx: Ctx) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const {token} = await ctx.params;
    if (!/^[a-f0-9]{64}$/.test(token)) return json({error: 'This review link was not found.'}, 404);
    const row = await db().prepare('SELECT v.id,v.project_id,v.version,v.status,v.content,p.latest,p.require_otp,p.client_email FROM versions v JOIN projects p ON p.id=v.project_id WHERE v.token=? AND v.revoked=0').bind(token).first<Row>();
    if (!row) return json({error: 'This review link was not found.'}, 404);
    if (!row.require_otp) return json({error: 'This scope does not need an email code.', code: 'otp_not_required'}, 409);
    // A code confirms either the decision on a pending version or one on a change order to the approved latest version.
    if (row.version !== row.latest) return json({error: 'This version has been replaced. Ask the creator for the latest link.'}, 409);
    if (row.status !== 'pending') {
      const ledger = row.status === 'approved' ? await loadLedger(row.project_id, {forClient: true}) : null;
      if (!ledger?.agreement || ledger.baseline?.id !== row.id || ledger.agreement.pending === 0) return json({error: 'This version already has a decision and no change order is waiting for you.'}, 409);
    }
    if (!row.client_email) return json({error: 'The creator has not set your email address yet. Ask them to add it, then try again.', code: 'otp_no_email'}, 409);
    if (!await allowWrite('otp:' + row.id, 20)) return json({error: 'Too many attempts. Try again in a minute.'}, 429);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const parsed = input.safeParse(raw);
    if (!parsed.success) return json({error: 'Choose send or verify.'}, 400);
    const now = Date.now();

    if (parsed.data.action === 'send') {
      const recent = await db().prepare('SELECT COUNT(*) AS n FROM review_otps WHERE version_id=? AND created > ?').bind(row.id, new Date(now - OTP_TTL_MS).toISOString()).first<{n: number}>();
      if (Number(recent?.n ?? 0) >= OTP_SENDS_PER_WINDOW) return json({error: 'Three codes were sent in the last 10 minutes. Use the latest one, or wait before asking again.', code: 'otp_send_limit'}, 429);
      const id = crypto.randomUUID(), code = generateCode();
      await db().prepare('INSERT INTO review_otps (id,version_id,email,code_hash,expires,created) VALUES (?,?,?,?,?,?)').bind(id, row.id, row.client_email, await codeHash(id, code), new Date(now + OTP_TTL_MS).toISOString(), new Date(now).toISOString()).run();
      const content = JSON.parse(row.content) as Scope;
      try {
        await deliverCode(row.client_email, otpEmail({code, title: content.title, version: row.version}), {code, version_id: row.id, id});
      } catch (e) {
        await db().prepare('DELETE FROM review_otps WHERE id=?').bind(id).run();
        if (e instanceof OtpUnavailable) return json({error: 'Email codes are not available on this server. Ask the creator to turn off the email check or set up email delivery.', code: 'otp_unavailable'}, 503);
        if (e instanceof MailError) return json({error: e.message, code: 'mail_failed'}, 502);
        throw e;
      }
      return json({sent: true, to: maskEmail(row.client_email), expires_in: OTP_TTL_MS / 1000});
    }

    const code = normalizeCode(parsed.data.code);
    if (!/^\d{6}$/.test(code)) return json({error: 'Enter the 6-digit code from the email.'}, 400);
    const otp = await db().prepare('SELECT id,code_hash,attempts,expires FROM review_otps WHERE version_id=? AND verified IS NULL ORDER BY created DESC LIMIT 1').bind(row.id).first<{id: string; code_hash: string; attempts: number; expires: string}>();
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
    return json({verified: true, otp_session: session, email: maskEmail(row.client_email)});
  } catch (e) { return failure(e); }
}
