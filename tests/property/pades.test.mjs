// PAdES signatures on Scopeflow PDFs (lib/pades.ts): poppler's pdfsig and openssl cms both verify the
// signature over the exact byte ranges; any later change to the file breaks it; with a timestamp
// authority the signature carries an RFC 3161 token (B-T).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import '../support/ts-resolve.mjs';
import {makeTsa} from '../support/tsa.mjs';

const pades = await import('../../lib/pades.ts');
const {PdfDocument} = await import('../../lib/pdf.ts');
const dir = mkdtempSync(join(tmpdir(), 'pades-'));
const f = name => join(dir, name);
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', f('key.pem'), '-out', f('cert.pem'), '-days', '30', '-subj', '/CN=Scopeflow Test Signer/O=Scopeflow', '-addext', 'keyUsage=critical,digitalSignature,nonRepudiation'], {stdio: 'pipe'});
execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', f('ec.key'), '-out', f('ec.pem'), '-days', '30', '-subj', '/CN=Scopeflow EC Signer'], {stdio: 'pipe'});
const tsa = makeTsa();

const pdf = () => { const d = new PdfDocument({info: {Title: 'Signed test'}}); d.text(48, 780, 'Scopeflow signed PDF', {size: 14}); d.addPage(); d.text(48, 780, 'Page two'); return d.toBytes(); };
function byteRange(bytes) { return /\/ByteRange \[(\d+) (\d+) (\d+) (\d+)\]/.exec(Buffer.from(bytes).toString('latin1')).slice(1).map(Number); }
function opensslVerify(bytes, cert) {
  const [a, b, c, d] = byteRange(bytes);
  const buf = Buffer.from(bytes);
  writeFileSync(f('signed-content.bin'), Buffer.concat([buf.subarray(a, a + b), buf.subarray(c, c + d)]));
  const hexSig = buf.subarray(b + 1, c - 1).toString('latin1').replace(/(00)+$/, '');
  writeFileSync(f('sig.der'), Buffer.from(hexSig.length % 2 ? hexSig + '0' : hexSig, 'hex'));
  try { execFileSync('openssl', ['cms', '-verify', '-binary', '-inform', 'DER', '-in', f('sig.der'), '-content', f('signed-content.bin'), '-CAfile', cert, '-purpose', 'any', '-out', '/dev/null'], {stdio: 'pipe'}); return true; } catch { return false; }
}
const pdfsig = bytes => { writeFileSync(f('s.pdf'), bytes); try { return execFileSync('pdfsig', [f('s.pdf')], {stdio: 'pipe'}).toString(); } catch (e) { return String(e.stdout); } };

test('config: off without both variables; inline PEM or a file path', () => {
  assert.equal(pades.padesConfig({}), null);
  assert.equal(pades.padesConfig({SCOPEFLOW_PDF_SIGN_CERT: f('cert.pem')}), null);
  const c = pades.padesConfig({SCOPEFLOW_PDF_SIGN_CERT: f('cert.pem'), SCOPEFLOW_PDF_SIGN_KEY: readFileSync(f('key.pem'), 'utf8')});
  assert.equal(c.name, 'Scopeflow Test Signer'); assert.equal(c.certs.length, 1);
});

test('RSA signature verifies with pdfsig and openssl; the original bytes are kept; tampering is detected', async () => {
  const original = pdf();
  const config = pades.padesConfig({SCOPEFLOW_PDF_SIGN_CERT: f('cert.pem'), SCOPEFLOW_PDF_SIGN_KEY: f('key.pem')});
  const signed = await pades.signPdf(original, config, {timestamp: null, now: new Date('2026-10-09T10:00:00Z')});
  assert.deepEqual(signed.subarray(0, original.length), original, 'incremental update keeps every original byte');
  const report = pdfsig(signed);
  assert.match(report, /Signature Validation: Signature is Valid/);
  assert.match(report, /Signer Certificate Common Name: Scopeflow Test Signer/);
  assert.match(report, /ETSI\.CAdES\.detached|PAdES/);
  assert.match(report, /Total document signed/);
  assert.ok(opensslVerify(signed, f('cert.pem')), 'openssl cms -verify');
  const [, , c, d] = byteRange(signed);
  assert.equal(c + d, signed.length, 'byte range covers the whole file');
  const tampered = Buffer.from(signed); tampered[200] ^= 1;
  assert.doesNotMatch(pdfsig(tampered), /Signature is Valid/);
  assert.ok(!opensslVerify(tampered, f('cert.pem')));
  // The page still renders.
  writeFileSync(f('render.pdf'), signed);
  execFileSync('pdftoppm', ['-r', '20', '-f', '1', '-l', '1', '-png', f('render.pdf'), f('page')], {stdio: 'pipe'});
});

test('EC keys sign too; with a timestamp authority the signature carries an RFC 3161 token (B-T)', async () => {
  const config = pades.padesConfig({SCOPEFLOW_PDF_SIGN_CERT: f('ec.pem'), SCOPEFLOW_PDF_SIGN_KEY: f('ec.key')});
  const realFetch = globalThis.fetch;
  globalThis.fetch = tsa.fetchImpl;
  try {
    const signed = await pades.signPdf(pdf(), config, {timestamp: {url: 'https://tsa.test/', auth: null}});
    assert.match(pdfsig(signed), /Signature is Valid/);
    assert.ok(opensslVerify(signed, f('ec.pem')));
    const [, b, c] = byteRange(signed);
    const cms = Buffer.from(Buffer.from(signed).subarray(b + 1, c - 1).toString('latin1').replace(/(00)+$/, ''), 'hex');
    const der = await import('../../lib/der.ts');
    assert.ok(der.find(der.parse(cms), n => n.tag === 6 && der.oidString(n) === '1.2.840.113549.1.9.16.2.14'), 'signature timestamp attribute');
  } finally { globalThis.fetch = realFetch; }
});

test('maybeSignPdf: unchanged without configuration', async () => {
  const p = pdf();
  delete process.env.SCOPEFLOW_PDF_SIGN_CERT;
  assert.deepEqual(await pades.maybeSignPdf(p), p);
});
