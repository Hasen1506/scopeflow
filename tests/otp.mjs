// PR B regression suite: client email one-time code before signing.
// Needs the server started with SCOPEFLOW_OTP_DEV=1 and SCOPEFLOW_OTP_DEV_LOG=<file> (CI sets
// both): with no mail provider, codes are written to that file instead of being emailed.
import assert from 'node:assert/strict';
import {randomUUID, createPublicKey, verify, createHash} from 'node:crypto';
import {readFileSync, existsSync} from 'node:fs';
import {signIn, ack, localSql} from './support/local.mjs';
const base = process.env.SCOPEFLOW_TEST_URL || 'http://localhost:5173';
assert.equal(new URL(base).hostname, 'localhost', 'Local fixtures only.');
const LOG = process.env.SCOPEFLOW_OTP_DEV_LOG;
assert.ok(LOG && process.env.SCOPEFLOW_OTP_DEV === '1', 'Run with SCOPEFLOW_OTP_DEV=1 and SCOPEFLOW_OTP_DEV_LOG set (server and tests).');
let passed = 0;
const eq = (a, b, message) => { assert.deepEqual(a, b, message); passed++; };
const ok = (value, message) => { assert.ok(value, message); passed++; };
async function call(path, {method = 'GET', cookie, body} = {}) {
  const h = {Origin: base};
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(base + path, {method, headers: h, body: body === undefined ? undefined : JSON.stringify(body)});
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return {status: r.status, data};
}
const lastCode = versionId => {
  if (!existsSync(LOG)) return null;
  const lines = readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(l => l.version_id === versionId);
  return lines.at(-1) ?? null;
};
const scope = () => ({title: 'OTP fixture ' + randomUUID().slice(0, 8), client: 'Fictional Client', deliverables: '', items: [{id: 'i_logo', title: 'Logo suite', qty: 1, unit: '', price: 500, acceptance: ''}], client_inputs: [], exclusions: '', fee: 500, currency: 'USD', revisions: 2, due: '', notes: ''});

const cookie = await signIn(base, `otp-${Date.now()}@example.test`);
const me = await call('/api/me', {cookie});
eq(me.data.otp, true); // dev mode on a localhost APP_URL
const created = await call('/api/scopes', {method: 'POST', cookie, body: scope()});
eq(created.status, 201);
const {project_id, token, id: versionId} = created.data.scope;
const S = '/api/scopes/' + project_id;

// Owner toggle: needs a client email first; the project reports the setting.
{
  const noEmail = await call(S, {method: 'PATCH', cookie, body: {require_otp: true}});
  eq(noEmail.status, 400); eq(noEmail.data.code, 'otp_needs_email');
  eq((await call(S, {method: 'PATCH', cookie, body: {client_email: 'ada.client@example.test', require_otp: true}})).data.project, {id: project_id, archived: null, client_email: 'ada.client@example.test', require_otp: true});
  eq((await call(S, {cookie})).data.project.require_otp, true);
  const clear = await call(S, {method: 'PATCH', cookie, body: {client_email: ''}});
  eq(clear.status, 400); // cannot remove the address the code is sent to while the check is on
  eq((await call(S, {method: 'PATCH', cookie, body: {require_otp: 'yes'}})).status, 400);
}

// The review page learns that a code is needed, with a masked address only.
{
  const r = await call('/api/review/' + token);
  eq(r.data.identity_check, {method: 'email_otp', to: 'a******@example.test'});
  ok(!JSON.stringify(r.data).includes('ada.client@example.test'), 'full client email never reaches the review page');
}

// Without a verified code, the decision is refused.
const decide = async extra => call('/api/review/' + token, {method: 'POST', body: {...await ack(base, token, {decision: 'approved', signer: 'Ada Client', comment: '', version: 1}), ...extra}});
{
  const r = await decide({});
  eq(r.status, 403); eq(r.data.code, 'otp_required');
  eq((await decide({otp_session: 'f'.repeat(64)})).status, 403);
  eq((await decide({otp_session: 'not-a-session'})).status, 400);
}

// Send a code; wrong guesses are counted and lock the code after five.
{
  const sent = await call(`/api/review/${token}/otp`, {method: 'POST', body: {action: 'send'}});
  eq(sent.status, 200); eq(sent.data.sent, true); eq(sent.data.to, 'a******@example.test');
  const {code, email} = lastCode(versionId);
  eq(email, 'ada.client@example.test');
  ok(/^\d{6}$/.test(code), 'six digit code in the dev log');
  const stored = localSql(`SELECT code_hash FROM scopeflow.review_otps WHERE version_id='${versionId}'`)[0].results;
  ok(!JSON.stringify(stored).includes(code) && /^[0-9a-f]{64}$/.test(stored[0].code_hash), 'only a hash is stored');
  const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
  for (let i = 4; i >= 1; i--) { const r = await call(`/api/review/${token}/otp`, {method: 'POST', body: {action: 'verify', code: wrong}}); eq(r.status, 400); eq(r.data.attempts_left, i); }
  eq((await call(`/api/review/${token}/otp`, {method: 'POST', body: {action: 'verify', code: wrong}})).status, 429);
  const locked = await call(`/api/review/${token}/otp`, {method: 'POST', body: {action: 'verify', code}});
  eq(locked.status, 429); eq(locked.data.code, 'otp_locked'); // even the right code, once locked
  eq((await call(`/api/review/${token}/otp`, {method: 'POST', body: {action: 'verify', code: '12'}})).status, 400);
}

// Expired codes are refused.
{
  eq((await call(`/api/review/${token}/otp`, {method: 'POST', body: {action: 'send'}})).status, 200);
  localSql(`UPDATE scopeflow.review_otps SET expires='2000-01-01T00:00:00.000Z' WHERE version_id='${versionId}'`);
  const r = await call(`/api/review/${token}/otp`, {method: 'POST', body: {action: 'verify', code: lastCode(versionId).code}});
  eq(r.status, 410); eq(r.data.code, 'otp_expired');
}

// Three sends per 10 minutes.
{
  eq((await call(`/api/review/${token}/otp`, {method: 'POST', body: {action: 'send'}})).status, 200);
  const limited = await call(`/api/review/${token}/otp`, {method: 'POST', body: {action: 'send'}});
  eq(limited.status, 429); eq(limited.data.code, 'otp_send_limit');
}

// The right code verifies once and the decision records signed identity evidence.
let session;
{
  const {code} = lastCode(versionId);
  const r = await call(`/api/review/${token}/otp`, {method: 'POST', body: {action: 'verify', code: ' ' + code.slice(0, 3) + '-' + code.slice(3) + ' '}});
  eq(r.status, 200); eq(r.data.verified, true);
  session = r.data.otp_session;
  ok(/^[0-9a-f]{64}$/.test(session), 'session token');
  eq((await call(`/api/review/${token}/otp`, {method: 'POST', body: {action: 'verify', code}})).status, 410); // single use: nothing left to verify
}
{
  const r = await decide({otp_session: session});
  eq(r.status, 200);
  const {receipt} = r.data;
  eq(receipt.identity.method, 'email_otp'); eq(receipt.identity.email, 'ada.client@example.test');
  const key = await (await fetch(base + '/api/signing-key')).json();
  const pub = createPublicKey({key: {kty: 'OKP', crv: 'Ed25519', x: key.keys[0].x}, format: 'jwk'});
  const ev = receipt.identity;
  const message = `scopeflow-evidence-v1:${receipt.anchor}:${createHash('sha256').update(JSON.stringify({method: ev.method, email: ev.email, verified_at: ev.verified_at, otp_id: ev.otp_id})).digest('hex')}`;
  const [kid, sig] = receipt.identity_signature.split('.');
  eq(kid, key.keys[0].kid);
  ok(verify(null, Buffer.from(message), pub, Buffer.from(sig, 'base64url')), 'identity evidence verifies with the public key alone');
  const versions = (await call(S, {cookie})).data.versions;
  eq(versions[0].decision_context.identity, ev);
  eq(versions[0].decision_context.identity_signature, receipt.identity_signature);
  // Evidence is immutable like the rest of the decision.
  const tamper = await (async () => { try { localSql(`UPDATE scopeflow.versions SET decision_context='{}' WHERE id='${versionId}'`); return 'updated'; } catch { return 'refused'; } })();
  eq(tamper, 'refused');
  eq((await call(`/api/review/${token}/otp`, {method: 'POST', body: {action: 'send'}})).status, 409); // decided: no more codes
}

// A project without the setting is unaffected; the OTP endpoint says so.
{
  const plain = await call('/api/scopes', {method: 'POST', cookie, body: scope()});
  eq((await call('/api/review/' + plain.data.scope.token)).data.identity_check, undefined);
  const r = await call(`/api/review/${plain.data.scope.token}/otp`, {method: 'POST', body: {action: 'send'}});
  eq(r.status, 409); eq(r.data.code, 'otp_not_required');
  const d = await call('/api/review/' + plain.data.scope.token, {method: 'POST', body: await ack(base, plain.data.scope.token, {decision: 'approved', signer: 'Ada', comment: '', version: 1})});
  eq(d.status, 200); eq(d.data.receipt.identity, undefined);
}
console.log(`otp: ${passed} checks passed`);
