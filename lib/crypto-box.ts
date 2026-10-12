// Envelope encryption for secrets kept at rest (BYO payment keys for WS-04, provider tokens).
//
// SCOPEFLOW_ENCRYPTION_KEY is a 32-byte key (base64) — the key-encryption key (KEK). Each value gets
// its own random 32-byte data key; the value is sealed with AES-256-GCM under the data key and the
// data key is wrapped with AES-256-GCM under the KEK. The box names the KEK id (first 8 hex of
// SHA-256 of the KEK), so SCOPEFLOW_ENCRYPTION_KEY_PREVIOUS (comma-separated) keeps old boxes
// readable during rotation, and `rewrap()` moves a box to the current key without the plaintext
// ever leaving the process. `aad` binds a box to its row (e.g. 'payment_accounts:<id>:key_secret'),
// so a box copied to another row does not open.
//
// Format: sfbox1.<kid>.<wrapped data key>.<value iv>.<ciphertext+tag>   (base64url parts)
// Pure node:crypto; no '@/' imports, so it is unit-tested directly.
import {createCipheriv, createDecipheriv, createHash, randomBytes} from 'node:crypto';

type Env = Record<string, string | undefined>;
export class CryptoBoxError extends Error {}

type Kek = {kid: string; key: Buffer};
function parseKey(value: string): Kek {
  const key = Buffer.from(value.trim(), 'base64');
  if (key.length !== 32) throw new CryptoBoxError('SCOPEFLOW_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32).');
  return {kid: createHash('sha256').update(key).digest('hex').slice(0, 8), key};
}
/** The current KEK and every KEK that may still open old boxes. */
export function keyring(env: Env = process.env): {current: Kek | null; all: Map<string, Kek>} {
  const current = env.SCOPEFLOW_ENCRYPTION_KEY?.trim() ? parseKey(env.SCOPEFLOW_ENCRYPTION_KEY) : null;
  const all = new Map<string, Kek>();
  if (current) all.set(current.kid, current);
  for (const old of (env.SCOPEFLOW_ENCRYPTION_KEY_PREVIOUS ?? '').split(',').map(s => s.trim()).filter(Boolean)) { const k = parseKey(old); all.set(k.kid, k); }
  return {current, all};
}
export const encryptionConfigured = (env: Env = process.env) => { try { return keyring(env).current !== null; } catch { return false; } };

const b64 = (b: Buffer) => b.toString('base64url');
function gcmSeal(key: Buffer, plain: Buffer, aad: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad, 'utf8'));
  const out = Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
  return {iv, out};
}
function gcmOpen(key: Buffer, iv: Buffer, sealed: Buffer, aad: string) {
  if (iv.length !== 12 || sealed.length < 16) throw new CryptoBoxError('This encrypted value is damaged.');
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAAD(Buffer.from(aad, 'utf8'));
  d.setAuthTag(sealed.subarray(sealed.length - 16));
  try { return Buffer.concat([d.update(sealed.subarray(0, sealed.length - 16)), d.final()]); }
  catch { throw new CryptoBoxError('This encrypted value does not open with the configured key (wrong key, wrong row or tampered).'); }
}

/** Seals `plaintext` for the row named by `aad`. Throws when no key is configured. */
export function seal(plaintext: string, aad: string, env: Env = process.env): string {
  const {current} = keyring(env);
  if (!current) throw new CryptoBoxError('Set SCOPEFLOW_ENCRYPTION_KEY before storing secrets.');
  const dek = randomBytes(32);
  const wrapped = gcmSeal(current.key, dek, 'sfbox1:dek:' + aad);
  const value = gcmSeal(dek, Buffer.from(plaintext, 'utf8'), 'sfbox1:value:' + aad);
  return ['sfbox1', current.kid, b64(Buffer.concat([wrapped.iv, wrapped.out])), b64(value.iv), b64(value.out)].join('.');
}

export function isBox(value: unknown): value is string { return typeof value === 'string' && /^sfbox1\.[0-9a-f]{8}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value); }

/** Opens a box sealed for the same `aad`. */
export function open(box: string, aad: string, env: Env = process.env): string {
  if (!isBox(box)) throw new CryptoBoxError('Not an encrypted value.');
  const [, kid, wrapped, iv, sealed] = box.split('.');
  const kek = keyring(env).all.get(kid);
  if (!kek) throw new CryptoBoxError(`This value was encrypted with key ${kid}, which is not configured (add it to SCOPEFLOW_ENCRYPTION_KEY_PREVIOUS).`);
  const w = Buffer.from(wrapped, 'base64url');
  const dek = gcmOpen(kek.key, w.subarray(0, 12), w.subarray(12), 'sfbox1:dek:' + aad);
  return gcmOpen(dek, Buffer.from(iv, 'base64url'), Buffer.from(sealed, 'base64url'), 'sfbox1:value:' + aad).toString('utf8');
}

/** Re-wraps a box's data key under the current KEK (the value itself is not re-encrypted). */
export function rewrap(box: string, aad: string, env: Env = process.env): string {
  if (!isBox(box)) throw new CryptoBoxError('Not an encrypted value.');
  const [, kid, wrapped, iv, sealed] = box.split('.');
  const {current, all} = keyring(env);
  if (!current) throw new CryptoBoxError('Set SCOPEFLOW_ENCRYPTION_KEY before storing secrets.');
  if (kid === current.kid) return box;
  const kek = all.get(kid);
  if (!kek) throw new CryptoBoxError(`Key ${kid} is not configured.`);
  const w = Buffer.from(wrapped, 'base64url');
  const dek = gcmOpen(kek.key, w.subarray(0, 12), w.subarray(12), 'sfbox1:dek:' + aad);
  const next = gcmSeal(current.key, dek, 'sfbox1:dek:' + aad);
  return ['sfbox1', current.kid, b64(Buffer.concat([next.iv, next.out])), iv, sealed].join('.');
}
