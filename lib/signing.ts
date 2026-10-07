import {createHash, createPrivateKey, createPublicKey, hkdfSync, sign, verify, type KeyObject} from 'node:crypto';

// SF-04: server signatures over every decision anchor and ledger entry hash.
//
// The signing key never lives in the database: it is derived from
// SCOPEFLOW_SIGNING_SECRET (preferred) or, when that is unset, from the existing
// NEON_AUTH_COOKIE_SECRET. Someone who can rewrite rows and recompute the hash
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
/** The signing key: SCOPEFLOW_SIGNING_SECRET, else derived from NEON_AUTH_COOKIE_SECRET. */
function keys() {
  const primary = [process.env.SCOPEFLOW_SIGNING_SECRET, process.env.NEON_AUTH_COOKIE_SECRET].find(usable);
  return primary ? derive(primary) : null;
}
/**
 * Keys accepted for verification, by key id: the current key, the cookie-secret-derived
 * key (records signed before SCOPEFLOW_SIGNING_SECRET was set) and any retired secrets in
 * SCOPEFLOW_SIGNING_SECRET_PREVIOUS (comma-separated), so rotation never looks like tampering.
 */
function verificationKeys() {
  const secrets = [process.env.SCOPEFLOW_SIGNING_SECRET, process.env.NEON_AUTH_COOKIE_SECRET, ...(process.env.SCOPEFLOW_SIGNING_SECRET_PREVIOUS ?? '').split(',').map(x => x.trim())].filter(usable);
  return new Map(secrets.map(secret => { const key = derive(secret); return [key.kid, key] as const; }));
}

export const anchorMessage = (anchor: string) => 'scopeflow-anchor-v1:' + anchor;
export const entryMessage = (hash: string) => 'scopeflow-entry-v1:' + hash;

/** Base64url Ed25519 signature prefixed with the key id, or null when signing is not configured. */
export function signRecord(message: string) {
  const k = keys();
  if (!k) return null;
  return k.kid + '.' + sign(null, Buffer.from(message), k.privateKey).toString('base64url');
}

export type SignatureState = 'valid' | 'invalid' | 'unsigned';
export function verifyRecord(message: string, signature: string | null | undefined): SignatureState {
  if (!signature) return 'unsigned';
  const [kid, value] = signature.split('.');
  const k = verificationKeys().get(kid);
  if (!k || !value) return 'invalid';
  try {
    return verify(null, Buffer.from(message), k.publicKey, Buffer.from(value, 'base64url')) ? 'valid' : 'invalid';
  } catch {
    return 'invalid';
  }
}

export function publicSigningKey() {
  const k = keys();
  return k ? {kty: 'OKP', crv: 'Ed25519', x: k.x, kid: k.kid, alg: 'EdDSA', use: 'sig'} : null;
}
export function signingConfigured() { return !!keys(); }
