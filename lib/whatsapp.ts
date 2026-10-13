import {createHmac, timingSafeEqual} from 'node:crypto';

// WhatsApp (WS-06): wa.me share links for the owner (LT-03, SF-01) and the Meta WhatsApp Cloud API
// client for ScopeFlow's own number (OTP templates, SF-10; the forward-to-bot, SF-04).
//
// Share links open the owner's own WhatsApp with a prefilled message; ScopeFlow sends nothing.
// The Cloud API is configured with WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN (the bot
// also needs WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN; OTP needs WHATSAPP_OTP_TEMPLATE, an
// approved "authentication" template with a copy-code button, and optionally WHATSAPP_OTP_LANG).
// WHATSAPP_API_URL replaces https://graph.facebook.com (local doubles). This module is pure apart
// from the injected fetch, and isomorphic except for the signature check.

export * from './whatsapp-share';
import {waDigits} from './whatsapp-share';

// ---- Cloud API ----------------------------------------------------------------------------------

type Env = Record<string, string | undefined>;
export type CloudConfig = {phoneNumberId: string; token: string; apiUrl: string; version: string; otpTemplate: string | null; otpLang: string};
export function cloudConfig(env: Env = process.env): CloudConfig | null {
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim(), token = env.WHATSAPP_ACCESS_TOKEN?.trim();
  if (!phoneNumberId || !/^\d{5,20}$/.test(phoneNumberId) || !token) return null;
  return {phoneNumberId, token, apiUrl: env.WHATSAPP_API_URL?.trim().replace(/\/+$/, '') || 'https://graph.facebook.com', version: env.WHATSAPP_API_VERSION?.trim() || 'v21.0', otpTemplate: env.WHATSAPP_OTP_TEMPLATE?.trim() || null, otpLang: env.WHATSAPP_OTP_LANG?.trim() || 'en'};
}

export type CloudMessage =
  | {type: 'text'; text: string}
  | {type: 'list'; body: string; button: string; rows: {id: string; title: string; description?: string}[]}
  | {type: 'otp'; code: string};

/** The Graph API request body for one message to `to` (E.164). Pure. */
export function cloudBody(config: Pick<CloudConfig, 'otpTemplate' | 'otpLang'>, to: string, message: CloudMessage) {
  const base = {messaging_product: 'whatsapp', recipient_type: 'individual', to: waDigits(to)};
  if (message.type === 'text') return {...base, type: 'text', text: {preview_url: false, body: message.text.slice(0, 4096)}};
  if (message.type === 'list') return {...base, type: 'interactive', interactive: {type: 'list', body: {text: message.body.slice(0, 1024)}, action: {button: message.button.slice(0, 20), sections: [{title: 'Projects', rows: message.rows.slice(0, 10).map(r => ({id: r.id.slice(0, 200), title: r.title.slice(0, 24), ...(r.description ? {description: r.description.slice(0, 72)} : {})}))}]}}};
  if (!config.otpTemplate) throw new WhatsAppError('No WhatsApp authentication template is configured (WHATSAPP_OTP_TEMPLATE).');
  // Meta's authentication templates: the code fills the body variable and the copy-code button.
  return {...base, type: 'template', template: {name: config.otpTemplate, language: {code: config.otpLang}, components: [
    {type: 'body', parameters: [{type: 'text', text: message.code}]},
    {type: 'button', sub_type: 'url', index: '0', parameters: [{type: 'text', text: message.code}]},
  ]}};
}

export class WhatsAppError extends Error {
  retryable: boolean;
  constructor(message: string, retryable = false) { super(message); this.retryable = retryable; }
}

/** Sends one message through the Cloud API. Throws WhatsAppError with a safe message (never the token). */
export async function sendCloud(config: CloudConfig, to: string, message: CloudMessage, fetchImpl: typeof fetch = fetch) {
  if (!waDigits(to)) throw new WhatsAppError('That is not a WhatsApp number in international format.');
  let response: Response;
  try {
    response = await fetchImpl(`${config.apiUrl}/${config.version}/${config.phoneNumberId}/messages`, {method: 'POST', headers: {Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json'}, body: JSON.stringify(cloudBody(config, to, message)), signal: AbortSignal.timeout(10000)});
  } catch { throw new WhatsAppError('WhatsApp could not be reached.', true); }
  const data = await response.json().catch(() => ({})) as {messages?: {id?: string}[]; error?: {code?: number}};
  if (!response.ok || data.error) throw new WhatsAppError(`WhatsApp refused the message (HTTP ${response.status}${data.error?.code ? `, code ${data.error.code}` : ''}).`, response.status >= 500);
  return {id: data.messages?.[0]?.id ?? null};
}

// ---- Webhook ------------------------------------------------------------------------------------

/** X-Hub-Signature-256 ("sha256=<hex HMAC of the raw body with the app secret>"), constant time. */
export function validSignature(rawBody: string, header: string | null, appSecret: string) {
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header?.trim() ?? '');
  if (!m || !appSecret) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest();
  const given = Buffer.from(m[1].toLowerCase(), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
export const signBody = (rawBody: string, appSecret: string) => 'sha256=' + createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');

export type InboundWa = {id: string; from: string; kind: 'text' | 'choice' | 'audio' | 'other'; text: string; choice: string | null; forwarded: boolean};
/** The messages in a Cloud API webhook payload (statuses and other changes are ignored). */
export function parseWebhook(raw: unknown): InboundWa[] {
  const out: InboundWa[] = [];
  const entries = (raw as {entry?: unknown[]})?.entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) for (const change of ((entry as {changes?: unknown[]})?.changes ?? [])) {
    const messages = (change as {value?: {messages?: unknown[]}})?.value?.messages;
    if (!Array.isArray(messages)) continue;
    for (const m of messages.slice(0, 20)) {
      const r = m as {id?: unknown; from?: unknown; type?: unknown; text?: {body?: unknown}; interactive?: {list_reply?: {id?: unknown}; button_reply?: {id?: unknown}}; button?: {payload?: unknown}; context?: {forwarded?: unknown; frequently_forwarded?: unknown}};
      if (typeof r.id !== 'string' || typeof r.from !== 'string') continue;
      const type = String(r.type ?? '');
      const choice = type === 'interactive' ? String(r.interactive?.list_reply?.id ?? r.interactive?.button_reply?.id ?? '') : type === 'button' ? String(r.button?.payload ?? '') : '';
      out.push({id: r.id.slice(0, 200), from: '+' + r.from.replace(/\D/g, '').slice(0, 15), kind: type === 'text' ? 'text' : choice ? 'choice' : type === 'audio' || type === 'voice' ? 'audio' : 'other',
        text: typeof r.text?.body === 'string' ? r.text.body.slice(0, 4000) : '', choice: choice || null, forwarded: r.context?.forwarded === true || r.context?.frequently_forwarded === true});
    }
  }
  return out;
}
