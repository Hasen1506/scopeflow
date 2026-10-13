import {appendFileSync} from 'node:fs';
import {cloudConfig, sendCloud, WhatsAppError} from './whatsapp';
import {providerConfigs, routeMail, parseRoutes, type MailRoutes} from './mail-router';
import {sendMail, type MailConfig, type MailProvider} from './mail';

// Optional SMS and WhatsApp delivery for one-time codes, next to email (lib/otp.ts).
//
// MSG91 (India; needs a DLT-registered template): MSG91_AUTH_KEY and MSG91_OTP_TEMPLATE_ID, with the
// template's code variable named by MSG91_OTP_VAR (default "otp"). Sent through the Flow API.
// Twilio: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_SMS_FROM for SMS; TWILIO_WHATSAPP_FROM for
// WhatsApp, with TWILIO_WHATSAPP_CONTENT_SID for an approved template whose {{1}} is the code
// (needed outside the 24-hour session window). SCOPEFLOW_SMS_PROVIDER=msg91|twilio picks one when
// both are configured. Nothing is sent without a provider; the key never appears in an error.

export type SmsChannel = 'sms' | 'whatsapp';
export type SmsConfig =
  | {provider: 'msg91'; authKey: string; templateId: string; codeVar: string; channels: SmsChannel[]}
  | {provider: 'twilio'; sid: string; token: string; smsFrom: string | null; whatsappFrom: string | null; contentSid: string | null; channels: SmsChannel[]};
type Env = Record<string, string | undefined>;

export const phoneSchemaPattern = /^\+[1-9]\d{7,14}$/;

export function smsConfig(env: Env = process.env): SmsConfig | null {
  const forced = env.SCOPEFLOW_SMS_PROVIDER?.trim().toLowerCase();
  const msg91 = env.MSG91_AUTH_KEY?.trim() && env.MSG91_OTP_TEMPLATE_ID?.trim()
    ? {provider: 'msg91' as const, authKey: env.MSG91_AUTH_KEY!.trim(), templateId: env.MSG91_OTP_TEMPLATE_ID!.trim(), codeVar: env.MSG91_OTP_VAR?.trim() || 'otp', channels: ['sms' as const]}
    : null;
  const sid = env.TWILIO_ACCOUNT_SID?.trim(), token = env.TWILIO_AUTH_TOKEN?.trim();
  const smsFrom = env.TWILIO_SMS_FROM?.trim() || null, whatsappFrom = env.TWILIO_WHATSAPP_FROM?.trim() || null;
  const twilio = sid && token && (smsFrom || whatsappFrom)
    ? {provider: 'twilio' as const, sid, token, smsFrom, whatsappFrom, contentSid: env.TWILIO_WHATSAPP_CONTENT_SID?.trim() || null, channels: [...(smsFrom ? ['sms' as const] : []), ...(whatsappFrom ? ['whatsapp' as const] : [])]}
    : null;
  if (forced === 'twilio') return twilio;
  if (forced === 'msg91') return msg91;
  return msg91 ?? twilio;
}
/** Channels this server can deliver codes on, besides email. */
export function smsChannels(env: Env = process.env): SmsChannel[] { return smsConfig(env)?.channels ?? []; }

/** "+919876543210" -> "+91******3210". */
export function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) return '***';
  const cc = digits.length > 10 ? digits.slice(0, digits.length - 10) : '';
  return `+${cc}${'*'.repeat(Math.max(2, digits.length - cc.length - 4))}${digits.slice(-4)}`;
}

/** The text of a code message. Pure; header-free, one line, no link (SMS templates rarely allow one). */
export function otpSms({code, title}: {code: string; title: string}) {
  const t = title.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 60);
  return `${code} is your Scopeflow code to confirm your decision on "${t}". It expires in 10 minutes. Do not share it.`;
}

export class SmsError extends Error {}

/** The HTTP request for one message. Pure, so the request shapes are unit tested without the network. */
export function smsRequest(config: SmsConfig, channel: SmsChannel, to: string, text: string, code: string): {url: string; init: RequestInit} {
  if (config.provider === 'msg91') {
    return {url: 'https://control.msg91.com/api/v5/flow', init: {method: 'POST', headers: {authkey: config.authKey, 'Content-Type': 'application/json', accept: 'application/json'},
      body: JSON.stringify({template_id: config.templateId, short_url: '0', recipients: [{mobiles: to.replace(/^\+/, ''), [config.codeVar]: code}]})}};
  }
  const from = channel === 'whatsapp' ? `whatsapp:${config.whatsappFrom}` : config.smsFrom!;
  const form = new URLSearchParams({To: channel === 'whatsapp' ? `whatsapp:${to}` : to, From: from});
  if (channel === 'whatsapp' && config.contentSid) { form.set('ContentSid', config.contentSid); form.set('ContentVariables', JSON.stringify({1: code})); }
  else form.set('Body', text);
  return {url: `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.sid)}/Messages.json`, init: {method: 'POST',
    headers: {Authorization: 'Basic ' + Buffer.from(`${config.sid}:${config.token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded'}, body: form.toString()}};
}

export async function sendSms(config: SmsConfig, channel: SmsChannel, to: string, text: string, code: string, fetchImpl: typeof fetch = fetch) {
  if (!config.channels.includes(channel)) throw new SmsError(`${channel === 'whatsapp' ? 'WhatsApp' : 'SMS'} delivery is not configured on this server.`);
  const {url, init} = smsRequest(config, channel, to, text, code);
  let response: Response;
  try { response = await fetchImpl(url, {...init, signal: AbortSignal.timeout(10000)}); } catch { throw new SmsError('The SMS provider could not be reached.'); }
  const data = await response.json().catch(() => ({})) as {sid?: string; request_id?: string; type?: string; message?: string};
  if (!response.ok || data.type === 'error') throw new SmsError(`The SMS provider refused the message (HTTP ${response.status}).`);
  return {id: data.sid ?? data.request_id ?? null};
}

// ---- WS-06: one-time-code transport for WS-02 (SF-10) ------------------------------------------
// sendOtpMessage(channel, to, code) delivers a code on the channel WS-02 chose (WS-02 picks the
// channel per owner, WhatsApp -> email -> SMS by default, and enforces the limits). WhatsApp goes
// through ScopeFlow's own WABA (Meta Cloud API "authentication" template with a copy-code button)
// and falls back to Twilio's WhatsApp sender when only that is configured; SMS uses MSG91 or
// Twilio; email uses the mail router's `auth` class (Postmark first). When a delivery fails, the
// `fallbacks` the caller passes (for example {channel: 'email', to: client_email}) are tried in
// order. The destination is always one the caller passed: nothing here can change it.
// In local dev mode (SCOPEFLOW_OTP_DEV=1 on a localhost APP_URL) with no provider, the code is
// appended to SCOPEFLOW_OTP_DEV_LOG instead of being sent.

export type OtpTransportChannel = 'email' | SmsChannel;
export type OtpAttempt = {channel: OtpTransportChannel; provider: string | null; ok: boolean; error: string | null};
export type OtpDelivery = {channel: OtpTransportChannel; to: string; provider: string; id: string | null; attempts: OtpAttempt[]};
export class OtpTransportError extends Error { attempts: OtpAttempt[]; constructor(message: string, attempts: OtpAttempt[]) { super(message); this.attempts = attempts; } }

function devMode(env: Env) {
  if (env.SCOPEFLOW_OTP_DEV !== '1') return false;
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.APP_URL ?? '').hostname); } catch { return false; }
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]!));
/** The default code email when the caller passes none. */
export function otpCodeEmail(code: string, title = '') {
  const t = title.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 120);
  return {subject: `${code} is your Scopeflow code${t ? ` for "${t}"` : ''}`, text: `Your Scopeflow code is ${code}. It expires in 10 minutes. If you did not ask for it, ignore this email.\n\nSent with Scopeflow`,
    html: `<p>Your Scopeflow code is:</p><p style="font-size:24px;letter-spacing:4px"><strong>${escapeHtml(code)}</strong></p><p style="color:#666;font-size:13px">It expires in 10 minutes. If you did not ask for it, ignore this email.<br>Sent with Scopeflow</p>`};
}

type OtpOptions = {
  title?: string;
  /** Rendered code email (WS-02's otpEmail) for the email channel. */
  email?: {subject: string; text: string; html: string};
  /** Tried in order when delivery on `channel` fails. */
  fallbacks?: {channel: OtpTransportChannel; to: string}[];
  env?: Env; fetchImpl?: typeof fetch;
  /** Mail router overrides (tests). */
  mailConfigs?: Partial<Record<MailProvider, MailConfig>>; routes?: MailRoutes;
  idempotencyKey?: string; fromName?: string | null; replyTo?: string | null;
};

async function deliverOnce(channel: OtpTransportChannel, to: string, code: string, o: OtpOptions, env: Env): Promise<{provider: string; id: string | null}> {
  const fetchImpl = o.fetchImpl ?? fetch;
  if (channel === 'whatsapp') {
    const cloud = cloudConfig(env);
    if (cloud?.otpTemplate) {
      try { return {provider: 'meta', ...(await sendCloud(cloud, to, {type: 'otp', code}, fetchImpl))}; }
      catch (e) { throw new SmsError(e instanceof WhatsAppError ? e.message : 'WhatsApp delivery failed.'); }
    }
  }
  if (channel === 'email') {
    const configs = o.mailConfigs ?? providerConfigs(env);
    const result = await routeMail({cls: 'auth', to, message: o.email ?? otpCodeEmail(code, o.title), configs, routes: o.routes ?? parseRoutes(env.SCOPEFLOW_MAIL_ROUTES), idempotencyKey: o.idempotencyKey, fromName: o.fromName, replyTo: o.replyTo,
      send: o.fetchImpl ? (config, rcpt, message, opts) => sendMail(config, rcpt, message, opts.idempotencyKey, {fromName: opts.fromName, replyTo: opts.replyTo, headers: opts.headers, fetchImpl}) : undefined});
    if (result.status === 'sent') return {provider: result.provider, id: result.id};
    if (result.status !== 'no_provider') throw new SmsError(result.error);
  } else {
    const config = smsConfig(env);
    if (config?.channels.includes(channel)) return {provider: config.provider, ...(await sendSms(config, channel, to, otpSms({code, title: o.title ?? ''}), code, fetchImpl))};
  }
  if (devMode(env)) {
    console.info(`[scopeflow:otp-dev] code for ${channel === 'email' ? to.replace(/^(.).*@/, '$1***@') : maskPhone(to)} by ${channel}; not sent: dev mode`);
    if (env.SCOPEFLOW_OTP_DEV_LOG) appendFileSync(env.SCOPEFLOW_OTP_DEV_LOG, JSON.stringify({email: to, channel, code, transport: 'ws-06', at: new Date().toISOString()}) + '\n');
    return {provider: 'dev_log', id: null};
  }
  throw new SmsError(`${channel === 'whatsapp' ? 'WhatsApp' : channel === 'sms' ? 'SMS' : 'Email'} delivery is not configured on this server.`);
}

/** Delivers a one-time code on `channel`, then on each fallback in order. Throws OtpTransportError when all fail. */
export async function sendOtpMessage(channel: OtpTransportChannel, to: string, code: string, options: OtpOptions = {}): Promise<OtpDelivery> {
  const env = options.env ?? process.env;
  if (!/^\d{4,10}$/.test(code)) throw new OtpTransportError('A code is 4–10 digits.', []);
  const attempts: OtpAttempt[] = [];
  for (const step of [{channel, to}, ...(options.fallbacks ?? [])]) {
    try {
      const r = await deliverOnce(step.channel, step.to, code, options, env);
      attempts.push({channel: step.channel, provider: r.provider, ok: true, error: null});
      return {channel: step.channel, to: step.to, provider: r.provider, id: r.id, attempts};
    } catch (e) {
      attempts.push({channel: step.channel, provider: null, ok: false, error: e instanceof Error ? e.message : 'failed'});
    }
  }
  throw new OtpTransportError('The code could not be delivered on any channel.', attempts);
}
