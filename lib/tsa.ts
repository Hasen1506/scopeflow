import {createHash, randomBytes, verify as verifySignature, X509Certificate} from 'node:crypto';
import {concat, content, find, fromHex, hex, int, nul, oid, oidString, parse, seq, bool, octets, type Node} from './der';

// RFC 3161 trusted timestamps. With SCOPEFLOW_TSA_URL set (any RFC 3161 timestamp authority, e.g.
// https://freetsa.org/tsr or a commercial TSA), Scopeflow asks the authority to timestamp a record
// fingerprint (SHA-256). The token is the authority's own signature over that fingerprint and a
// time, so anyone can check with `openssl ts -verify` that the record existed then, without
// trusting Scopeflow. SCOPEFLOW_TSA_AUTH (optional) is sent as the Authorization header.

const SHA256 = '2.16.840.1.101.3.4.2.1';
const TST_INFO = '1.2.840.113549.1.9.16.1.4';
const MESSAGE_DIGEST = '1.2.840.113549.1.9.4';
const HASHES: Record<string, string> = {'2.16.840.1.101.3.4.2.1': 'sha256', '2.16.840.1.101.3.4.2.2': 'sha384', '2.16.840.1.101.3.4.2.3': 'sha512', '1.3.14.3.2.26': 'sha1'};
type Env = Record<string, string | undefined>;

export function tsaConfig(env: Env = process.env) {
  const url = env.SCOPEFLOW_TSA_URL?.trim();
  if (!url) return null;
  try { const u = new URL(url); if (!['https:', 'http:'].includes(u.protocol)) return null; } catch { return null; }
  return {url, auth: env.SCOPEFLOW_TSA_AUTH?.trim() || null};
}

/** DER TimeStampReq for a SHA-256 digest (hex), with a nonce and certReq so the token carries the TSA certificate. */
export function timestampRequest(digestHex: string, nonce: Uint8Array = randomBytes(8)) {
  return seq(int(1), seq(seq(oid(SHA256), nul()), octets(fromHex(digestHex))), int(nonce), bool(true));
}

export class TsaError extends Error {}
export type TimestampToken = {token: Uint8Array; gen_time: string; digest: string; policy: string; serial: string; tsa: string | null};

/** Reads a TimeStampToken (CMS ContentInfo): its TSTInfo fields, and checks that it covers `digestHex`. */
export function readToken(token: Uint8Array, digestHex?: string): TimestampToken {
  const root = parse(token);
  const tstOid = find(root, n => n.tag === 6 && oidString(n) === TST_INFO);
  if (!tstOid) throw new TsaError('Not a timestamp token.');
  // encapContentInfo: SEQUENCE { OID id-ct-TSTInfo, [0] EXPLICIT OCTET STRING (TSTInfo DER) }
  const encap = find(root, n => n.tag === 16 && n.children?.[0] === tstOid) ?? find(root, n => !!n.children?.includes(tstOid));
  const wrapped = encap?.children?.[1]?.children?.[0];
  if (!wrapped) throw new TsaError('Timestamp token has no TSTInfo.');
  const info = parse(content(wrapped));
  const [, policy, imprint, serial, genTime] = info.children ?? [];
  const algo = oidString(imprint.children![0].children![0]);
  const digest = hex(content(imprint.children![1]));
  if (algo !== SHA256) throw new TsaError('Timestamp token does not use SHA-256.');
  if (digestHex && digest !== digestHex) throw new TsaError('Timestamp token covers a different fingerprint.');
  const g = new TextDecoder().decode(content(genTime));
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d+)?Z$/.exec(g);
  if (!m) throw new TsaError('Timestamp token has an unreadable time.');
  const gen_time = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ?? ''}Z`).toISOString();
  // The TSA's name, when its certificate is included.
  let tsa: string | null = null;
  const cert = certificateOf(root);
  if (cert) { try { tsa = new X509Certificate(cert).subject.replace(/\n/g, ', '); } catch { tsa = null; } }
  return {token, gen_time, digest, policy: oidString(policy), serial: hex(content(serial)), tsa};
}

function certificateOf(root: Node): Uint8Array | null {
  // SignedData ::= SEQUENCE { version, digestAlgorithms SET, encapContentInfo, [0] certificates, ..., signerInfos SET }
  const signedData = root.children?.[1]?.children?.[0];
  const certs = signedData?.children?.find(c => c.cls === 2 && c.tag === 0);
  return certs?.children?.[0]?.bytes ?? null;
}

/**
 * Checks the TSA's signature on the token with the certificate it carries: the signed messageDigest
 * matches the TSTInfo and the signature verifies. It does not check that the certificate chains to
 * a trusted root (use `openssl ts -verify -CAfile` for that).
 */
export function verifyToken(token: Uint8Array): boolean {
  try {
    const root = parse(token);
    const signedData = root.children![1].children![0];
    const encap = signedData.children![2];
    const tstInfo = content(encap.children![1].children![0]);
    const signer = signedData.children!.at(-1)!.children![0];
    const digestAlg = HASHES[oidString(signer.children![2].children![0])];
    const attrs = signer.children!.find(c => c.cls === 2 && c.tag === 0 && c.constructed);
    const sig = signer.children!.find(c => c.tag === 4 && c.cls === 0);
    const cert = certificateOf(root);
    if (!digestAlg || !attrs || !sig || !cert) return false;
    const md = attrs.children!.find(a => oidString(a.children![0]) === MESSAGE_DIGEST);
    if (!md || hex(content(md.children![1].children![0])) !== createHash(digestAlg).update(tstInfo).digest('hex')) return false;
    // Signed attributes are signed as an explicit SET OF (tag 0x31), not the [0] IMPLICIT form stored.
    const signed = concat(Uint8Array.of(0x31), attrs.bytes.subarray(1));
    return verifySignature(digestAlg, signed, new X509Certificate(cert).publicKey, content(sig));
  } catch { return false; }
}

/** Asks the configured TSA to timestamp `digestHex`. Throws TsaError with a safe message. */
export async function requestTimestamp(digestHex: string, config = tsaConfig(), fetchImpl: typeof fetch = fetch): Promise<TimestampToken & {tsa_url: string}> {
  if (!config) throw new TsaError('No timestamp authority is configured (SCOPEFLOW_TSA_URL).');
  const nonce = randomBytes(8);
  let response: Response;
  try {
    response = await fetchImpl(config.url, {method: 'POST', headers: {'Content-Type': 'application/timestamp-query', Accept: 'application/timestamp-reply', ...(config.auth ? {Authorization: config.auth} : {})}, body: Buffer.from(timestampRequest(digestHex, nonce)), signal: AbortSignal.timeout(15000)});
  } catch { throw new TsaError('The timestamp authority could not be reached.'); }
  if (!response.ok) throw new TsaError(`The timestamp authority refused the request (HTTP ${response.status}).`);
  const reply = new Uint8Array(await response.arrayBuffer());
  let root: Node;
  try { root = parse(reply); } catch { throw new TsaError('The timestamp authority returned an unreadable reply.'); }
  const status = root.children?.[0]?.children?.[0];
  if (!status || content(status)[0] > 1) throw new TsaError('The timestamp authority did not grant the request.');
  const tokenNode = root.children?.[1];
  if (!tokenNode) throw new TsaError('The timestamp authority returned no token.');
  const token = reply.slice(tokenNode.start, tokenNode.end);
  const read = readToken(token, digestHex);
  if (!verifyToken(token)) throw new TsaError('The timestamp token signature did not verify.');
  return {...read, tsa_url: config.url};
}
