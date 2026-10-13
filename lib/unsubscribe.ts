import {createHmac, timingSafeEqual} from 'node:crypto';

// One-click unsubscribe for bulk mail (M19; RFC 8058). The link carries the address and an HMAC
// of it under a key derived from SCOPEFLOW_SIGNING_SECRET (or SCOPEFLOW_MAIL_UNSUBSCRIBE_SECRET),
// so nobody can unsubscribe an address they did not receive mail at. Unsubscribing suppresses
// bulk mail (reminders) only; codes, review links and change-order notices still arrive.

type Env = Record<string, string | undefined>;
function key(env: Env) {
  const secret = env.SCOPEFLOW_MAIL_UNSUBSCRIBE_SECRET?.trim() || env.SCOPEFLOW_SIGNING_SECRET?.trim() || env.NEON_AUTH_COOKIE_SECRET?.trim() || '';
  return createHmac('sha256', 'scopeflow-unsubscribe-v1').update(secret).digest();
}
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
export function unsubscribeToken(address: string, env: Env = process.env) {
  const a = address.trim().toLowerCase();
  return `${b64(a)}.${createHmac('sha256', key(env)).update(a).digest('base64url').slice(0, 32)}`;
}
/** The address a valid token names, or null. */
export function verifyUnsubscribe(token: string | null | undefined, env: Env = process.env) {
  const [enc, mac] = (token ?? '').split('.');
  if (!enc || !mac) return null;
  let address = '';
  try { address = Buffer.from(enc, 'base64url').toString('utf8'); } catch { return null; }
  if (!address.includes('@') || address.length > 254) return null;
  const expected = Buffer.from(unsubscribeToken(address, env).split('.')[1]), given = Buffer.from(mac);
  return expected.length === given.length && timingSafeEqual(expected, given) ? address : null;
}
export const unsubscribeUrl = (address: string, origin: string, env: Env = process.env) => `${origin.replace(/\/+$/, '')}/api/mail/unsubscribe?t=${unsubscribeToken(address, env)}`;
