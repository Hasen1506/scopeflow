import {db} from './server';
import {cloudConfig, sendCloud, type CloudMessage} from './whatsapp';
import {mailDevMode} from './mail-outbox';

// Outbound messages from ScopeFlow's own WhatsApp number (WS-06). Only ever to the owner who wrote
// to the bot (a reply inside the 24-hour service window) or to a number that asked for a code:
// never to a client. Rows in scopeflow.wa_outbox record what was sent (codes are never stored).
// Without the Cloud API configured, local dev mode records the message as `dev_log` (the tests'
// WhatsApp double); otherwise it is `not_configured`.

type Env = Record<string, string | undefined>;
export const DEV_APP_SECRET = 'scopeflow-dev-whatsapp-app-secret';
/** The webhook's app secret: WHATSAPP_APP_SECRET, or a fixed local secret in dev mode only. */
export function appSecret(env: Env = process.env) {
  return env.WHATSAPP_APP_SECRET?.trim() || (mailDevMode(env) ? DEV_APP_SECRET : null);
}
export function botConfigured(env: Env = process.env) { return !!appSecret(env); }

export async function sendWa(owner: string | null, to: string, kind: 'reply' | 'onboarding' | 'otp' | 'link_code', message: CloudMessage, {store = true, env = process.env}: {store?: boolean; env?: Env} = {}) {
  const config = cloudConfig(env);
  let status: 'sent' | 'failed' | 'dev_log' | 'not_configured' = 'not_configured', id: string | null = null, error: string | null = null;
  if (config) {
    try { id = (await sendCloud(config, to, message)).id; status = 'sent'; } catch (e) { status = 'failed'; error = e instanceof Error ? e.message : 'failed'; }
  } else if (mailDevMode(env)) {
    status = 'dev_log';
    console.info(`[scopeflow:whatsapp-dev] ${kind} to ${to.slice(0, 4)}…${to.slice(-2)} recorded, not sent (dev mode)`);
  }
  // A code is never stored; the row only says one was sent.
  const body = message.type === 'otp' ? {type: 'otp'} : message;
  if (store) await db().prepare('INSERT INTO scopeflow.wa_outbox (id,owner,to_phone,kind,body,status,provider_message_id,error,created) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), owner, to, kind, JSON.stringify(body), status, id, error, new Date().toISOString()).run();
  return {status, id, error};
}
