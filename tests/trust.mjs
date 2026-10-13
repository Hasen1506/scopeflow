// Trust features against a running local server: review-link expiry, SMS codes, countersignatures,
// RFC 3161 timestamps, PAdES-signed PDFs and the dispute pack. Local fixtures only.
// The server needs SCOPEFLOW_OTP_DEV=1 (codes are logged), and for the timestamp and signature checks
// SCOPEFLOW_TSA_URL (tests/support/tsa-service.mjs) and SCOPEFLOW_PDF_SIGN_CERT/KEY; CI sets all of them.
import assert from 'node:assert/strict';
import {randomUUID, createPublicKey, verify, createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {signIn, ack, localSql} from './support/local.mjs';
import './support/ts-resolve.mjs';
const {readToken} = await import('../lib/tsa.ts');

const base = process.env.SCOPEFLOW_TEST_URL || 'http://localhost:5173';
assert.equal(new URL(base).hostname, 'localhost', 'Local fixtures only.');
const LOG = process.env.SCOPEFLOW_OTP_DEV_LOG;
const TSA = !!process.env.SCOPEFLOW_TSA_URL, SIGNING = !!process.env.SCOPEFLOW_PDF_SIGN_CERT;
let passed = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); passed++; };
const ok = (v, m) => { assert.ok(v, m); passed++; };
async function call(path, {method = 'GET', cookie, body, raw = false} = {}) {
  const h = {Origin: base};
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(base + path, {method, headers: h, body: body === undefined ? undefined : JSON.stringify(body)});
  if (raw) return {status: r.status, bytes: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type')};
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return {status: r.status, data};
}
const scope = over => ({title: 'Trust fixture ' + randomUUID().slice(0, 8), client: 'Fictional Client', deliverables: '', items: [{id: 'i_logo', title: 'Logo suite', qty: 1, unit: '', price: 1000, acceptance: ''}], client_inputs: [], exclusions: 'Print', fee: 1000, currency: 'INR', revisions: 2, due: '', notes: 'One round is one consolidated list.', ...over});
const cookie = await signIn(base, `trust-${Date.now()}@example.test`);
const create = async over => (await call('/api/scopes', {method: 'POST', cookie, body: scope(over)})).data.scope;
const patch = (id, body) => call('/api/scopes/' + id, {method: 'PATCH', cookie, body});
const approve = async (token, extra = {}) => call('/api/review/' + token, {method: 'POST', body: {...await ack(base, token, {decision: 'approved', signer: 'Ada Client', comment: '', version: 1}), ...extra}});
const lastCode = id => readFileSync(LOG, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(l => l.version_id === id).at(-1);
const waitFor = async (fn, ms = 8000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 200)); } return v; };

// Review-link expiry: only while undecided; a replaced link starts a new period.
{
  const s = await create();
  const set = await patch(s.project_id, {link_expiry_days: 7});
  eq(set.status, 200); eq(set.data.project.link_expiry_days, 7);
  eq((await patch(s.project_id, {link_expiry_days: 9})).status, 400);
  const got = (await call('/api/scopes/' + s.project_id, {cookie})).data.project;
  ok(Math.abs(Date.parse(got.link_expires) - (Date.parse(s.created) + 7 * 86400000)) < 2000, 'expires 7 days after the version was saved');
  eq((await call('/api/review/' + s.token)).data.link_expires, got.link_expires);
  // changed by WS-02 (H5): expiry is per version (version_links.link_issued), not project-wide.
  const backdate = () => localSql(`INSERT INTO scopeflow.version_links (project_id,version,link_issued) VALUES ('${s.project_id}',1,'2000-01-01T00:00:00.000Z') ON CONFLICT (project_id,version) DO UPDATE SET link_issued='2000-01-01T00:00:00.000Z'`);
  backdate();
  const expired = await call('/api/review/' + s.token);
  eq(expired.status, 410); eq(expired.data.code, 'link_expired');
  eq((await approve(s.token)).status, 410);
  const rotated = await call(`/api/scopes/${s.project_id}/review-link`, {method: 'POST', cookie, body: {version: 1, action: 'rotate'}});
  const fresh = rotated.data.review_path.split('/').pop();
  eq((await call('/api/review/' + fresh)).status, 200);
  eq((await approve(fresh)).status, 200);
  // Decided: the link never expires, whatever the setting.
  backdate();
  eq((await call('/api/review/' + fresh)).status, 200);
  eq((await patch(s.project_id, {link_expiry_days: null})).data.project.link_expiry_days, null);
}

// SMS codes (dev mode logs them): the phone is required, the evidence names the phone.
{
  const s = await create();
  eq((await patch(s.project_id, {client_phone: '98765'})).status, 400);
  const needs = await patch(s.project_id, {otp_channel: 'sms', require_otp: true});
  eq(needs.status, 400); eq(needs.data.code, 'otp_needs_phone');
  const on = await patch(s.project_id, {client_phone: '+919876543210', otp_channel: 'sms', require_otp: true});
  eq(on.status, 200); eq([on.data.project.otp_channel, on.data.project.client_phone, on.data.project.require_otp], ['sms', '+919876543210', true]);
  // changed by WS-02 (C5 §6.2.6): masked as +91 ****3210; the check names the step it is for (M14).
  eq((await call('/api/review/' + s.token)).data.identity_check, {method: 'sms_otp', channel: 'sms', to: '+91 ****3210', action: 'decision'});
  const sent = await call(`/api/review/${s.token}/otp`, {method: 'POST', body: {action: 'send'}});
  eq(sent.status, 200); eq(sent.data.channel, 'sms'); eq(sent.data.to, '+91 ****3210');
  const logged = lastCode(s.id);
  eq([logged.email, logged.channel], ['+919876543210', 'sms']);
  const verified = await call(`/api/review/${s.token}/otp`, {method: 'POST', body: {action: 'verify', code: logged.code}});
  eq(verified.status, 200);
  const decided = await approve(s.token, {otp_session: verified.data.otp_session});
  eq(decided.status, 200); eq(decided.data.receipt.identity.method, 'sms_otp'); eq(decided.data.receipt.identity.phone, '+919876543210');
  const pdf = (await call(`/api/review/${s.token}/receipt`, {raw: true})).bytes.toString('latin1');
  // changed by WS-02 (C5): the receipt names the masked number only.
  ok(pdf.includes('SMS code verified to +91 ****3210'), 'receipt names the SMS check');
  ok(!pdf.includes('+919876543210'), 'never the full number');
}

// Countersignatures: listed roles sign the approved version once each, with their own signature.
// changed by WS-02 (H1): roles sign on their own link (/api/cosign/<token>), never the client's link.
let packProject, packToken;
{
  const s = await create();
  packProject = s.project_id; packToken = s.token;
  eq((await patch(s.project_id, {cosigners: [{id: 'Bad Id', role: 'Finance'}]})).status, 400);
  eq((await patch(s.project_id, {cosigners: [{id: 'a', role: 'One'}, {id: 'a', role: 'Two'}]})).status, 400);
  eq((await patch(s.project_id, {cosigners: [{id: 'finance', role: 'Finance approver'}, {id: 'legal', role: 'Legal'}]})).data.project.cosigners.length, 2);
  const ackBody = async () => ({acknowledged: true, content_sha256: (await ack(base, s.token, {decision: 'approved', signer: 'x', comment: '', version: 1})).content_sha256});
  eq((await call(`/api/review/${s.token}/cosign`, {method: 'POST', body: {cosigner_id: 'finance', signer: 'Fin Ance', ...await ackBody()}})).data.code, 'use_your_cosigner_link');
  const decided = await approve(s.token);
  eq(decided.status, 200);
  const review = (await call('/api/review/' + s.token)).data;
  eq(review.cosign.waiting, 2); eq(review.cosign.roles.map(r => r.id), ['finance', 'legal']);
  const links = (await call('/api/scopes/' + s.project_id, {cookie})).data.cosign_links;
  eq(links.map(l => l.cosigner_id), ['finance', 'legal']);
  const roleToken = id => links.find(l => l.cosigner_id === id).cosign_path.split('/').pop();
  const cosign = (id, body) => call(`/api/cosign/${roleToken(id)}`, {method: 'POST', body});
  eq((await call('/api/cosign/' + 'e'.repeat(64), {method: 'POST', body: {signer: 'Someone', ...await ackBody()}})).status, 404);
  eq((await cosign('finance', {signer: 'Fin Ance', acknowledged: true, content_sha256: '0'.repeat(64)})).status, 409);
  const signed = await cosign('finance', {signer: 'Fin Ance', ...await ackBody()});
  eq(signed.status, 201);
  const c = signed.data.cosign;
  const key = await (await fetch(base + '/api/signing-key')).json();
  const message = `scopeflow-cosign-v1:${c.anchor}:${createHash('sha256').update(JSON.stringify({cosigner_id: c.cosigner_id, role: c.role, signer: c.signer, signed: c.signed})).digest('hex')}`;
  const [kid, sig] = c.signature.split('.');
  eq(kid, key.keys[0].kid);
  ok(verify(null, Buffer.from(message), createPublicKey({key: {kty: 'OKP', crv: 'Ed25519', x: key.keys[0].x}, format: 'jwk'}), Buffer.from(sig, 'base64url')), 'countersignature verifies with the public key');
  eq((await cosign('finance', {signer: 'Again', ...await ackBody()})).data.code, 'already_signed');
  eq((await call('/api/review/' + s.token)).data.cosign.waiting, 1);
  eq((await call('/api/scopes/' + s.project_id, {cookie})).data.cosigns.map(x => x.cosigner_id), ['finance']);
  const refused = (() => { try { localSql(`UPDATE scopeflow.version_cosigns SET signer='Mallory' WHERE project_id='${s.project_id}'`); return 'updated'; } catch { return 'refused'; } })();
  eq(refused, 'refused');
  const pdf = (await call(`/api/review/${s.token}/receipt`, {raw: true})).bytes.toString('latin1');
  ok(pdf.includes('Countersignature') && pdf.includes('Finance approver: Fin Ance'), 'receipt lists the countersignature');

  // RFC 3161 timestamps (server configured with the local TSA).
  if (TSA) {
    const rows = await waitFor(() => localSql(`SELECT subject,digest,token FROM scopeflow.timestamps WHERE project_id='${s.project_id}'`)[0].results.filter(r => r.subject === 'decision' || r.subject === 'cosign:finance').length === 2 ? localSql(`SELECT subject,digest,token FROM scopeflow.timestamps WHERE project_id='${s.project_id}'`)[0].results : null);
    ok(rows, 'decision and countersignature were timestamped');
    const decision = rows.find(r => r.subject === 'decision');
    eq(decision.digest, decided.data.receipt.anchor);
    eq(readToken(Buffer.from(decision.token, 'base64'), decision.digest).digest, decision.digest);
    const withStamp = (await call(`/api/review/${s.token}/receipt`, {raw: true})).bytes.toString('latin1');
    ok(withStamp.includes('RFC 3161 timestamp') && withStamp.includes('Decision timestamped'), 'receipt prints the timestamp');
    eq((() => { try { localSql(`DELETE FROM scopeflow.timestamps WHERE project_id='${s.project_id}'`); return 'deleted'; } catch { return 'refused'; } })(), 'refused');
  }
}

// PAdES: every PDF download is signed when a certificate is configured.
if (SIGNING) {
  const dir = mkdtempSync(join(tmpdir(), 'trust-'));
  const r = await call(`/api/review/${packToken}/receipt`, {raw: true});
  writeFileSync(join(dir, 'receipt.pdf'), r.bytes);
  const report = (() => { try { return execFileSync('pdfsig', [join(dir, 'receipt.pdf')], {stdio: 'pipe'}).toString(); } catch (e) { return String(e.stdout); } })();
  ok(/Signature is Valid/.test(report), 'pdfsig validates the receipt signature');
  ok(/Total document signed/.test(report), 'the signature covers the whole file');
  if (TSA) ok(r.bytes.includes(Buffer.from('/SubFilter /ETSI.CAdES.detached')), 'PAdES subfilter');
}

// Dispute pack: one ZIP, every file listed in SHA256SUMS, the chain proof intact.
{
  eq((await call(`/api/scopes/${packProject}/dispute-pack`)).status, 401);
  const r = await call(`/api/scopes/${packProject}/dispute-pack`, {cookie, raw: true});
  eq(r.status, 200); eq(r.type, 'application/zip');
  const dir = mkdtempSync(join(tmpdir(), 'pack-'));
  writeFileSync(join(dir, 'pack.zip'), r.bytes);
  execFileSync('unzip', ['-q', join(dir, 'pack.zip'), '-d', join(dir, 'x')]);
  const out = join(dir, 'x');
  for (const f of ['README.txt', 'receipt-v1.pdf', 'statement.pdf', 'records.json', 'chain-proof.json', 'section63-certificate.pdf', 'SHA256SUMS.txt']) ok(existsSync(join(out, f)), f);
  execFileSync('sha256sum', ['-c', 'SHA256SUMS.txt'], {cwd: out, stdio: 'pipe'}); passed++;
  const proof = JSON.parse(readFileSync(join(out, 'chain-proof.json'), 'utf8'));
  eq(proof.verification.intact, true); ok(proof.anchors[1] && proof.public_key, 'anchors and the public key');
  const cert = readFileSync(join(out, 'section63-certificate.pdf')).toString('latin1');
  ok(cert.includes('CERTIFICATE UNDER SECTION 63') && cert.includes(createHash('sha256').update(readFileSync(join(out, 'receipt-v1.pdf'))).digest('hex')), 'certificate lists the receipt hash');
  if (TSA) ok(execFileSync('unzip', ['-l', join(dir, 'pack.zip')]).toString().includes('timestamps/decision-'), 'timestamp tokens included');
  const records = JSON.parse(readFileSync(join(out, 'records.json'), 'utf8'));
  ok(!JSON.stringify(records).includes(packToken), 'review link secrets are not in the pack');
}

console.log(`trust: ${passed} checks passed${TSA ? '' : ' (timestamps skipped: SCOPEFLOW_TSA_URL not set)'}${SIGNING ? '' : ' (PDF signing skipped)'}`);
