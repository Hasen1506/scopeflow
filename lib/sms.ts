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
