import {createHash, createPrivateKey, createPublicKey, hkdfSync, sign, verify, type KeyObject} from 'node:crypto';

// SF-04: server signatures over every decision anchor and ledger entry hash.
//
// The signing key never lives in the database: it is derived from
// SCOPEFLOW_SIGNING_SECRET. Outside production it falls back to NEON_AUTH_COOKIE_SECRET; in
// production that fallback no longer signs (a leaked or rotated session secret must not be able
// to mint record signatures) unless SCOPEFLOW_ALLOW_COOKIE_SIGNING=1 is set while migrating.
// Records signed earlier with the cookie-derived key still verify. Someone who can rewrite rows and recompute the hash
// chain still cannot produce valid signatures, so the server and the client
// review page both detect the tampering. The public key is published at
// /api/signing-key so a saved receipt can be checked independently.

const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
type Key = {privateKey: KeyObject; publicKey: KeyObject; x: string; kid: string};
const derived = new Map<string, Key>();

function derive(secret: string): Key {
  const known = derived.get(secret);
  if (known) return known;
  const seed = Buffer.from(hkdfSync('sha256', secret, 'scopeflow', 'scopeflow-record-signing-v1', 32));
  const privateKey = createPrivateKey({key: Buffer.concat([PKCS8_ED25519, seed]), format: 'der', type: 'pkcs8'});
  const publicKey = createPublicKey(privateKey);
  const x = (publicKey.export({format: 'jwk'}) as {x: string}).x;
  const key = {privateKey, publicKey, x, kid: createHash('sha256').update(x).digest('hex').slice(0, 16)};
  derived.set(secret, key);
  return key;
}
const usable = (value: string | undefined): value is string => !!value && value.length >= 32;
type Env = Record<string, string | undefined>;
/** Where the signing key comes from: a dedicated secret, the cookie-secret fallback, or nowhere. */
export function signingSource(env: Env = process.env): 'dedicated' | 'cookie_fallback' | 'off' {
  if (usable(env.SCOPEFLOW_SIGNING_SECRET)) return 'dedicated';
  const fallbackAllowed = env.NODE_ENV !== 'production' || env.SCOPEFLOW_ALLOW_COOKIE_SIGNING === '1';
  return fallbackAllowed && usable(env.NEON_AUTH_COOKIE_SECRET) ? 'cookie_fallback' : 'off';
}
/**
 * C1: the signing status. `previous_only` means only retired secrets are set (records still verify,
 * nothing new can be sealed). In production anything but `dedicated` fails closed (signingBlocked).
 */
export function signingStatus(env: Env = process.env): 'dedicated' | 'cookie_fallback' | 'previous_only' | 'off' {
  const source = signingSource(env);
  if (source !== 'off') return source;
  return (env.SCOPEFLOW_SIGNING_SECRET_PREVIOUS ?? '').split(',').map(x => x.trim()).some(usable) ? 'previous_only' : 'off';
}
/** C1: true when a new record must not be created because it could not be sealed with the dedicated key. */
export function signingBlocked(env: Env = process.env) {
  return env.NODE_ENV === 'production' && signingStatus(env) !== 'dedicated';
}
/** The signing key: SCOPEFLOW_SIGNING_SECRET, else (outside production) derived from NEON_AUTH_COOKIE_SECRET. */
function keys() {
  const source = signingSource();
  return source === 'off' ? null : derive((source === 'dedicated' ? process.env.SCOPEFLOW_SIGNING_SECRET : process.env.NEON_AUTH_COOKIE_SECRET)!);
}
type Trust = 'current' | 'legacy';
/**
 * C6: keys accepted for verification, by key id. The current dedicated key and retired dedicated
 * secrets (SCOPEFLOW_SIGNING_SECRET_PREVIOUS, comma-separated) are fully trusted, so rotation never
 * looks like tampering. The NEON_AUTH_COOKIE_SECRET-derived key is accepted only outside production,
 * when SCOPEFLOW_ALLOW_COOKIE_SIGNING=1, or when its key id is listed in SCOPEFLOW_LEGACY_KEY_IDS
 * (records sealed before the dedicated secret existed); it then verifies as `legacy_key`.
 */
export function verificationKeys(env: Env = process.env) {
  const map = new Map<string, {key: Key; trust: Trust}>();
  for (const secret of [env.SCOPEFLOW_SIGNING_SECRET, ...(env.SCOPEFLOW_SIGNING_SECRET_PREVIOUS ?? '').split(',').map(x => x.trim())].filter(usable)) {
    const key = derive(secret); map.set(key.kid, {key, trust: 'current'});
  }
  if (usable(env.NEON_AUTH_COOKIE_SECRET)) {
    const key = derive(env.NEON_AUTH_COOKIE_SECRET);
    const listed = (env.SCOPEFLOW_LEGACY_KEY_IDS ?? '').split(',').map(x => x.trim()).includes(key.kid);
    const allowed = env.NODE_ENV !== 'production' || env.SCOPEFLOW_ALLOW_COOKIE_SIGNING === '1' || listed;
    // Outside production the cookie key is the dev signing key itself: fully trusted there.
    if (allowed && !map.has(key.kid)) map.set(key.kid, {key, trust: env.NODE_ENV !== 'production' && signingSource(env) === 'cookie_fallback' ? 'current' : 'legacy'});
  }
  return map;
}
/** The key id the cookie secret would derive (for SCOPEFLOW_LEGACY_KEY_IDS), or null. */
export function cookieKeyId(env: Env = process.env) { return usable(env.NEON_AUTH_COOKIE_SECRET) ? derive(env.NEON_AUTH_COOKIE_SECRET).kid : null; }

export const anchorMessage = (anchor: string) => 'scopeflow-anchor-v1:' + anchor;
export const entryMessage = (hash: string) => 'scopeflow-entry-v1:' + hash;

/** Base64url Ed25519 signature prefixed with the key id, or null when signing is not configured. */
export function signRecord(message: string) {
  const k = keys();
  if (!k) return null;
  return k.kid + '.' + sign(null, Buffer.from(message), k.privateKey).toString('base64url');
}

export type SignatureState = 'valid' | 'invalid' | 'unsigned';
export type SignatureCheck = 'valid' | 'legacy_key' | 'unknown_key' | 'invalid' | 'unsigned';
/** C6: the full answer: which kind of key sealed it, if any we trust. */
export function verifyRecordDetailed(message: string, signature: string | null | undefined, env: Env = process.env): SignatureCheck {
  if (!signature) return 'unsigned';
  const [kid, value] = signature.split('.');
  const k = verificationKeys(env).get(kid);
  if (!value) return 'invalid';
  if (!k) return 'unknown_key';
  try {
    return verify(null, Buffer.from(message), k.key.publicKey, Buffer.from(value, 'base64url')) ? (k.trust === 'current' ? 'valid' : 'legacy_key') : 'invalid';
  } catch {
    return 'invalid';
  }
}
/** Integrity answer for seals and chains: an allow-listed legacy key still counts as valid; an untrusted key does not. */
export function verifyRecord(message: string, signature: string | null | undefined): SignatureState {
  const state = verifyRecordDetailed(message, signature);
  return state === 'legacy_key' ? 'valid' : state === 'unknown_key' ? 'invalid' : state;
}

export function publicSigningKey() {
  const k = keys();
  return k ? {kty: 'OKP', crv: 'Ed25519', x: k.x, kid: k.kid, alg: 'EdDSA', use: 'sig'} : null;
}
/** Every key a receipt may have been sealed with (current first), each marked current or legacy, for /api/signing-key. */
export function publishedKeys(env: Env = process.env) {
  const current = publicSigningKey();
  const rest = [...verificationKeys(env).entries()].filter(([kid]) => kid !== current?.kid).map(([kid, {key, trust}]) => ({kty: 'OKP', crv: 'Ed25519', x: key.x, kid, alg: 'EdDSA', use: 'sig', status: trust === 'current' ? 'retired' : 'legacy'}));
  return [...(current ? [current] : []), ...rest];
}
export function signingConfigured() { return !!keys(); }
