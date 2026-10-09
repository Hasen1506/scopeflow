// A throwaway RFC 3161 timestamp authority for tests, built on the openssl CLI: a self-signed TSA
// certificate (extendedKeyUsage timeStamping) and `openssl ts -reply`. Local files only.
import {execFileSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export function makeTsa() {
  const dir = mkdtempSync(join(tmpdir(), 'tsa-'));
  const f = name => join(dir, name);
  writeFileSync(f('ext.cnf'), 'basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=critical,timeStamping\nsubjectKeyIdentifier=hash\n');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', f('tsa.key'), '-out', f('tsa.crt'), '-days', '30', '-subj', '/CN=Scopeflow Test TSA', '-addext', 'extendedKeyUsage=critical,timeStamping', '-addext', 'keyUsage=critical,digitalSignature', '-addext', 'basicConstraints=CA:FALSE'], {stdio: 'pipe'});
  writeFileSync(f('serial'), '01\n');
  writeFileSync(f('ts.cnf'), `[ tsa ]\ndefault_tsa = tsa_config\n[ tsa_config ]\ndir = ${dir}\nserial = $dir/serial\nsigner_cert = $dir/tsa.crt\nsigner_key = $dir/tsa.key\nsigner_digest = sha256\ndefault_policy = 1.2.3.4.1\ndigests = sha256\naccuracy = secs:1\nordering = no\ntsa_name = no\ness_cert_id_chain = no\ness_cert_id_alg = sha256\n`);
  let n = 0;
  /** Reply bytes for a DER TimeStampReq. */
  const reply = query => {
    const q = f(`q${++n}.tsq`), r = f(`r${n}.tsr`);
    writeFileSync(q, query);
    execFileSync('openssl', ['ts', '-reply', '-config', f('ts.cnf'), '-queryfile', q, '-out', r], {stdio: 'pipe'});
    return readFileSync(r);
  };
  /** A fetch stub that answers like a TSA over HTTP. */
  const fetchImpl = async (_url, init) => new Response(reply(Buffer.from(init.body)), {status: 200, headers: {'Content-Type': 'application/timestamp-reply'}});
  /** `openssl ts -verify` of a token against a digest, trusting this TSA's certificate. */
  const opensslVerify = (token, digestHex) => {
    const t = f(`t${++n}.der`);
    writeFileSync(t, token);
    try { execFileSync('openssl', ['ts', '-verify', '-digest', digestHex, '-in', t, '-token_in', '-CAfile', f('tsa.crt'), '-untrusted', f('tsa.crt')], {stdio: 'pipe'}); return true; } catch { return false; }
  };
  return {dir, reply, fetchImpl, opensslVerify, cert: f('tsa.crt'), key: f('tsa.key')};
}
