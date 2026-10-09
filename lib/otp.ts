import {randomInt} from 'node:crypto';
import {appendFileSync} from 'node:fs';
import {mailConfig, sendMail, type SignatureEmail} from './mail';
import {sha256} from './ledger';
import {signRecord, verifyRecord, type SignatureState} from './signing';
import {maskPhone, otpSms, sendSms, smsChannels, smsConfig, SmsError, type SmsChannel} from './sms';

export type OtpChannel = 'email' | SmsChannel;

// PR B: email one-time code before a client signs.
//
// Delivery goes through the existing Resend path (RESEND_API_KEY + SCOPEFLOW_MAIL_FROM).
// Without a provider the feature is unavailable, except in an explicit local dev mode
// (SCOPEFLOW_OTP_DEV=1 on a localhost APP_URL) where the code is logged instead of emailed,
// so tests and local development can complete the flow without sending anything.

export const OTP_TTL_MS = 10 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_SESSION_TTL_MS = 30 * 60_000;
export const OTP_SENDS_PER_WINDOW = 3;

type Env = Record<string, string | undefined>;

/** Local-only dev mode: logs codes instead of emailing them. Refused for non-localhost deployments. */
export function otpDevMode(env: Env = process.env) {
  if (env.SCOPEFLOW_OTP_DEV !== '1') return false;
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.APP_URL ?? '').hostname); } catch { return false; }
}
/** Can this server deliver codes on `channel` (email by default)? */
export function otpAvailable(env: Env = process.env, channel: OtpChannel = 'email') {
  if (otpDevMode(env)) return true;
  return channel === 'email' ? mailConfig(env) !== null : smsChannels(env).includes(channel);
}
/** Every channel this server can deliver codes on. */
export function otpChannels(env: Env = process.env): OtpChannel[] { return (['email', 'sms', 'whatsapp'] as const).filter(c => otpAvailable(env, c)); }
/** The masked destination shown on the review page. */
export function maskDestination(channel: OtpChannel, to: string) { return channel === 'email' ? maskEmail(to) : maskPhone(to); }

export function generateCode() { return String(randomInt(0, 1_000_000)).padStart(6, '0'); }
/** Salted by the OTP row id, so equal codes never share a hash. */
export function codeHash(id: string, code: string) { return sha256(`scopeflow-otp-v1|${id}|${code}`); }
export function normalizeCode(input: unknown) { return typeof input === 'string' ? input.replace(/[\s-]/g, '') : ''; }

/** "ada@example.com" -> "a**@example.com"; never reveals the full address to the review page. */
export function maskEmail(email: string) {
  const [user, domain] = email.split('@');
  if (!domain) return '***';
  return (user.length <= 1 ? '*' : user[0] + '*'.repeat(Math.min(6, user.length - 1))) + '@' + domain;
}

const oneLine = (value: string, max: number) => value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]!));
/** The code email. Pure, so it is unit tested. */
export function otpEmail({code, title, version}: {code: string; title: string; version: number}): SignatureEmail & {sms: string} {
  const t = oneLine(title, 160);
  return {
    subject: `${code} is your Scopeflow code for "${t}"`,
    sms: otpSms({code, title}),
    text: [`Your code to confirm your decision on "${t}" (version ${version}) is:`, '', code, '', 'It expires in 10 minutes. If you did not ask for it, ignore this email.', '', 'Sent with Scopeflow'].join('\n'),
    html: `<p>Your code to confirm your decision on <strong>${escapeHtml(t)}</strong> (version ${version}) is:</p><p style="font-size:24px;letter-spacing:4px"><strong>${code}</strong></p><p style="color:#666;font-size:13px">It expires in 10 minutes. If you did not ask for it, ignore this email.<br>Sent with Scopeflow</p>`,
  };
}

export class OtpUnavailable extends Error {}

/** Sends the code by email, SMS or WhatsApp, or in dev mode logs it (and appends a JSON line to SCOPEFLOW_OTP_DEV_LOG). */
export async function deliverCode(to: string, message: SignatureEmail & {sms?: string}, meta: {code: string; version_id: string; id: string}, env: Env = process.env, channel: OtpChannel = 'email', sender: {fromName?: string | null; replyTo?: string | null} = {}) {
  if (channel === 'email') {
    const config = mailConfig(env);
    if (config) return {delivered: 'email' as const, ...(await sendMail(config, to, message, `scopeflow-otp-${meta.id}`, sender))};
  } else {
    const config = smsConfig(env);
    if (config?.channels.includes(channel)) {
      try { return {delivered: channel, ...(await sendSms(config, channel, to, message.sms ?? message.text, meta.code))}; }
      catch (e) { if (e instanceof SmsError) throw new OtpDeliveryError(e.message); throw e; }
    }
  }
  if (!otpDevMode(env)) throw new OtpUnavailable(channel === 'email' ? 'Email delivery is not configured on this server.' : `${channel === 'whatsapp' ? 'WhatsApp' : 'SMS'} delivery is not configured on this server.`);
  console.info(`[scopeflow:otp-dev] code ${meta.code} for version ${meta.version_id} (${maskDestination(channel, to)} by ${channel}); not sent: dev mode`);
  if (env.SCOPEFLOW_OTP_DEV_LOG) appendFileSync(env.SCOPEFLOW_OTP_DEV_LOG, JSON.stringify({version_id: meta.version_id, email: to, channel, code: meta.code, at: new Date().toISOString()}) + '\n');
  return {delivered: 'dev_log' as const, id: null};
}
export class OtpDeliveryError extends Error {}

/**
 * Identity evidence recorded with an OTP-verified decision. It is committed to by its own
 * Ed25519 signature over the decision's anchor, so it is part of the signed record without
 * changing the anchor format that existing receipts verify against.
 */
export type IdentityEvidence =
  | {method: 'email_otp'; email: string; verified_at: string; otp_id: string}
  | {method: 'sms_otp' | 'whatsapp_otp'; phone: string; verified_at: string; otp_id: string};
export async function evidenceMessage(anchor: string, evidence: IdentityEvidence) {
  // The email form is unchanged since PR B, so receipts issued then still verify.
  const canonical = evidence.method === 'email_otp'
    ? JSON.stringify({method: evidence.method, email: evidence.email, verified_at: evidence.verified_at, otp_id: evidence.otp_id})
    : JSON.stringify({method: evidence.method, phone: evidence.phone, verified_at: evidence.verified_at, otp_id: evidence.otp_id});
  return `scopeflow-evidence-v1:${anchor}:${await sha256(canonical)}`;
}
export async function signEvidence(anchor: string, evidence: IdentityEvidence) { return signRecord(await evidenceMessage(anchor, evidence)); }
export async function verifyEvidence(anchor: string, evidence: IdentityEvidence, signature: string | null | undefined): Promise<SignatureState> {
  return verifyRecord(await evidenceMessage(anchor, evidence), signature);
}
