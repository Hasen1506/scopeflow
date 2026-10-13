// RFC 3161 timestamps (lib/tsa.ts, lib/der.ts) against a real openssl TSA: our request is accepted,
// the token is read and its signature verified, and openssl independently verifies the same token.
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fc} from '../support/property.mjs';
import {makeTsa} from '../support/tsa.mjs';

const der = await import('../../lib/der.ts');
const tsa = await import('../../lib/tsa.ts');
const authority = makeTsa();

test('DER: integers, OIDs and lengths round-trip through the parser', () => {
  fc.assert(fc.property(fc.bigInt({min: 0n, max: 2n ** 200n}), n => {
    const node = der.parse(der.int(n));
    assert.equal(node.tag, 2);
    assert.equal(BigInt('0x' + (der.hex(der.content(node)) || '0')), n);
  }));
  assert.equal(der.oidString(der.parse(der.oid('1.2.840.113549.1.9.16.1.4'))), '1.2.840.113549.1.9.16.1.4');
  const long = der.octets(new Uint8Array(70000));
  assert.equal(der.parse(long).length, 70000);
  assert.throws(() => der.parse(Uint8Array.of(0x30, 0x05, 0x01)), /beyond/);
});

test('config: off without SCOPEFLOW_TSA_URL; only http(s) URLs', () => {
  assert.equal(tsa.tsaConfig({}), null);
  assert.equal(tsa.tsaConfig({SCOPEFLOW_TSA_URL: 'ftp://x'}), null);
  assert.deepEqual(tsa.tsaConfig({SCOPEFLOW_TSA_URL: 'https://freetsa.org/tsr', SCOPEFLOW_TSA_AUTH: 'Basic abc'}), {url: 'https://freetsa.org/tsr', auth: 'Basic abc'});
});

test('a token from an RFC 3161 authority covers the fingerprint, verifies here and with openssl', async () => {
  const digest = createHash('sha256').update('scopeflow-anchor').digest('hex');
  const t = await tsa.requestTimestamp(digest, {url: 'https://tsa.test/', auth: null}, authority.fetchImpl);
  assert.equal(t.digest, digest);
  assert.equal(t.policy, '1.2.3.4.1');
  assert.match(t.tsa, /Scopeflow Test TSA/);
  assert.ok(Math.abs(Date.parse(t.gen_time) - Date.now()) < 120000, t.gen_time);
  assert.ok(tsa.verifyToken(t.token));
  assert.ok(authority.opensslVerify(t.token, digest), 'openssl ts -verify accepts the token');
  assert.ok(!authority.opensslVerify(t.token, digest.replace(/^./, c => c === 'a' ? 'b' : 'a')), 'and rejects another fingerprint');
  assert.throws(() => tsa.readToken(t.token, '0'.repeat(64)), /different fingerprint/);
  // Any flipped byte in the signed content breaks our signature check.
  const tampered = Uint8Array.from(t.token);
  const at = Buffer.from(tampered).indexOf(Buffer.from(digest, 'hex'));
  tampered[at] ^= 1;
  assert.equal(tsa.verifyToken(tampered), false);
});

test('authority failures become safe TsaErrors', async () => {
  const digest = 'ab'.repeat(32);
  await assert.rejects(tsa.requestTimestamp(digest, null), /No timestamp authority/);
  await assert.rejects(tsa.requestTimestamp(digest, {url: 'https://tsa.test/', auth: null}, async () => { throw new Error('ECONNRESET'); }), /could not be reached/);
  await assert.rejects(tsa.requestTimestamp(digest, {url: 'https://tsa.test/', auth: null}, async () => new Response('no', {status: 500})), /HTTP 500/);
  await assert.rejects(tsa.requestTimestamp(digest, {url: 'https://tsa.test/', auth: null}, async () => new Response(Uint8Array.of(1, 2, 3))), /unreadable|did not grant/);
});
