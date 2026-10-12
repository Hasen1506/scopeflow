// WS-02 regression suite against the running local server (CI: next start on :5173, production
// build, SCOPEFLOW_OTP_DEV=1 with codes in SCOPEFLOW_OTP_DEV_LOG). Fictional accounts and TEST data
// on the disposable scopeflow_test database only. Each block names the matrix item it covers.
import assert from 'node:assert/strict';
import {randomUUID, createHash, createPublicKey, verify} from 'node:crypto';
import {readFileSync, existsSync} from 'node:fs';
import {signIn, ack, localSql} from './support/local.mjs';
import './support/ts-resolve.mjs';

const base = process.env.SCOPEFLOW_TEST_URL || 'http://localhost:5173';
assert.equal(new URL(base).hostname, 'localhost', 'Local fixtures only.');
const LOG = process.env.SCOPEFLOW_OTP_DEV_LOG;
assert.ok(LOG && process.env.SCOPEFLOW_OTP_DEV === '1', 'Run with SCOPEFLOW_OTP_DEV=1 and SCOPEFLOW_OTP_DEV_LOG set (server and tests).');
let passed = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); passed++; };
const ok = (v, m) => { assert.ok(v, m); passed++; };
async function call(path, {method = 'GET', cookie, body, headers = {}, raw = false} = {}) {
  const h = {Origin: base, ...headers};
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(base + path, {method, headers: h, body: body === undefined ? undefined : JSON.stringify(body)});
  if (raw) return {status: r.status, bytes: Buffer.from(await r.arrayBuffer()), headers: r.headers};
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return {status: r.status, data, headers: r.headers};
}
const q = s => `'${String(s).replaceAll("'", "''")}'`;
// One fictional owner writes all through this suite; each block starts with fresh rate-limit windows so
// the owner's per-minute write limit (30) never answers before the check a block is about.
const freshLimits = () => localSql('DELETE FROM scopeflow.rate_limits');
const logLines = () => existsSync(LOG) ? readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const lastCode = versionId => logLines().filter(l => l.version_id === versionId && l.code).at(-1);
const pastCooldown = versionId => localSql(`UPDATE scopeflow.review_otps SET created=to_char((created::timestamptz - interval '11 minutes') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE version_id=${q(versionId)}`);
const content = over => ({title: 'TEST WS-02 ' + randomUUID().slice(0, 8), client: 'Fictional Client', deliverables: '', items: [{id: 'i_logo', title: 'Logo suite', qty: 1, unit: '', price: 5000, acceptance: ''}], client_inputs: [], exclusions: '', fee: 5000, currency: 'INR', revisions: 2, due: '', notes: '', ...over});

const cookie = await signIn(base, `ws02-${Date.now()}@example.test`);
const create = async over => { const r = await call('/api/scopes', {method: 'POST', cookie, body: content(over)}); assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data.scope; };
const revise = async (projectId, expected, over) => { const r = await call('/api/scopes/' + projectId, {method: 'POST', cookie, body: {expected_version: expected, content: content(over)}}); assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data.scope; };
const patch = (id, body, opts = {}) => call('/api/scopes/' + id, {method: 'PATCH', cookie, body, ...opts});
const share = (id, version) => call(`/api/scopes/${id}/review-link`, {method: 'POST', cookie, body: {version, action: 'shared'}});
const decide = async (token, extra = {}, opts = {}) => call('/api/review/' + token, {method: 'POST', ...opts, body: {...await ack(base, token, {decision: 'approved', signer: 'Ada Client', comment: '', version: 1}), ...extra}});
const otp = (token, body) => call(`/api/review/${token}/otp`, {method: 'POST', body});
const session = async (token, versionId, path = `/api/review/${token}/otp`) => {
  const sent = await call(path, {method: 'POST', body: {action: 'send'}});
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  const v = await call(path, {method: 'POST', body: {action: 'verify', code: lastCode(versionId).code}});
  assert.equal(v.status, 200, JSON.stringify(v.data));
  return v.data.otp_session;
};
const key = (await (await fetch(base + '/api/signing-key')).json()).keys[0];
const pub = createPublicKey({key: {kty: 'OKP', crv: 'Ed25519', x: key.x}, format: 'jwk'});
/** Text drawn on the PDF pages (Tj strings, line breaks as spaces), so wrapped lines still match. */
const pdfText = bytes => [...bytes.toString('latin1').matchAll(/\((?:[^()\\]|\\[()\\]|\\[0-7]{3})*\) Tj/g)].map(m => m[0].slice(1, -4).replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))).replace(/\\([()\\])/g, '$1')).join(' ');

// ---- H2 (live-test repro #5): an unsent draft never leaks through a later version's link ----------
// @covers H2
freshLimits();
{
  const v1 = await create({fee: 5000, items: [{id: 'i_logo', title: 'Logo suite', qty: 1, unit: '', price: 5000, acceptance: ''}], notes: 'TEST internal: floor price 3,500'});
  const v2 = await revise(v1.project_id, 1, {fee: 4000, items: [{id: 'i_logo', title: 'Logo suite', qty: 1, unit: '', price: 4000, acceptance: ''}]});
  const r = await call('/api/review/' + v2.token);
  eq(r.status, 200);
  eq(r.data.previous, null);
  eq(r.data.previous_version, null);
  eq(r.data.compare_versions, []);
  ok(!JSON.stringify(r.data).includes('3,500') && !JSON.stringify(r.data).includes('floor price'), 'no internal note anywhere in the JSON');
  eq((await call(`/api/review/${v2.token}?compare=1`)).data.previous, null);
}

// ---- M29: diff base = last version this client approved, else last sent; drafts never offered ----
// @covers M29 H2
freshLimits();
{
  const v1 = await create();
  eq((await decide(v1.token, {decision: 'changes_requested', comment: 'TEST more logos'})).status, 200);
  const v2 = await revise(v1.project_id, 1, {fee: 6000});
  eq((await decide(v2.token, {version: 2})).status, 200);
  await revise(v1.project_id, 2, {fee: 7000, notes: 'TEST internal draft v3'}); // never sent, never opened
  const v4 = await revise(v1.project_id, 3, {fee: 8000});
  eq((await share(v1.project_id, 4)).status, 200);
  const r = (await call('/api/review/' + v4.token)).data;
  eq(r.previous_version, 2);
  eq(r.previous.fee, 6000);
  eq(r.compare_versions.map(c => c.version), [1, 2]);
  ok(!JSON.stringify(r).includes('internal draft v3'), 'unsent v3 never shown');
  eq((await call(`/api/review/${v4.token}?compare=1`)).data.previous_version, 1);
  eq((await call(`/api/review/${v4.token}?compare=3`)).data.previous, null);
}

// ---- L12: deciding a replaced version answers 409 with a pointer to the newer one --------------
// @covers L12
freshLimits();
{
  const v1 = await create();
  const body = await ack(base, v1.token, {decision: 'approved', signer: 'Ada Client', comment: 'TEST typed comment', version: 1});
  const v2 = await revise(v1.project_id, 1, {fee: 4500});
  eq((await share(v1.project_id, 2)).status, 200);
  const r = await call('/api/review/' + v1.token, {method: 'POST', body});
  eq(r.status, 409);
  eq(r.data.newer_version, 2);
  eq(r.data.newer_url, '/review/' + v2.token);
  const view = (await call('/api/review/' + v1.token)).data;
  eq([view.newer_version, view.newer_url], [2, '/review/' + v2.token]);
}

// ---- L1: the rendered content's fingerprint must match the stored content ---------------------
// @covers L1
freshLimits();
{
  const s = await create();
  const r = await decide(s.token, {content_sha256: createHash('sha256').update(JSON.stringify({...content(), title: 'tampered'})).digest('hex')});
  eq(r.status, 409); eq(r.data.code, 'content_changed');
  const good = await decide(s.token);
  eq(good.status, 200);
  ok(good.data.evidence.content_sha256 === good.data.receipt.content_sha256, 'fingerprint of what the page rendered');
}

// ---- C5: owner self-approval is allowed and flagged everywhere --------------------------------------
// @covers C5
freshLimits();
{
  const s = await create();
  const r = await decide(s.token, {}, {cookie});
  eq(r.status, 200);
  eq(r.data.evidence.owner_session, true);
  ok(r.data.evidence.statement.includes('⚠ Submitted from a browser signed in to the creator’s account.'), 'statement flags it');
  const view = (await call('/api/review/' + s.token)).data;
  eq(view.evidence.owner_session, true);
  ok(view.evidence.statement.startsWith('Approved by whoever held this link.'), 'honest statement on the client page');
  const owner = (await call('/api/scopes/' + s.project_id, {cookie})).data;
  eq(owner.project.owner_session_versions, [1]);
  eq(owner.versions[0].decision_context.owner_session, true);
  const pdf = pdfText((await call(`/api/scopes/${s.project_id}/receipt?version=1`, {cookie, raw: true})).bytes);
  ok(pdf.includes('Submitted from a browser signed in to the creator'), 'receipt PDF flags it');
}

// ---- C5: contact lock after first send; two-step change notifies the old address; signed record ---
// @covers C5 M16
freshLimits();
{
  const s = await create();
  eq((await patch(s.project_id, {client_email: 'old.client@example.test'})).status, 200); // not sent yet: editable
  eq((await share(s.project_id, 1)).status, 200);
  const locked = await patch(s.project_id, {client_email: 'attacker@example.test'});
  eq(locked.status, 409); eq(locked.data.code, 'contact_locked');
  eq((await patch(s.project_id, {client_email: 'old.client@example.test'})).status, 200); // unchanged value is fine
  const apiKey = (await call('/api/key', {method: 'POST', cookie, body: {}})).data.token;
  ok(/^sf_/.test(apiKey), 'api token');
  const viaToken = await call(`/api/scopes/${s.project_id}/contact-change`, {method: 'POST', headers: {Authorization: 'Bearer ' + apiKey}, body: {email: 'new.client@example.test', reason: 'TEST moved', confirm: true}});
  eq(viaToken.status, 403); eq(viaToken.data.code, 'session_required');
  eq((await call(`/api/scopes/${s.project_id}/contact-change`, {method: 'POST', cookie, body: {email: 'new.client@example.test', reason: 'TEST moved'}})).status, 400); // confirm: true required
  const changed = await call(`/api/scopes/${s.project_id}/contact-change`, {method: 'POST', cookie, body: {email: 'new.client@example.test', reason: 'TEST client moved teams', confirm: true}});
  eq(changed.status, 200);
  eq(changed.data.contact_history.from_masked, 'o***@e***.test');
  eq(changed.data.contact_history.to_masked, 'n***@e***.test');
  const notice = logLines().filter(l => l.kind === 'notice' && l.project_id === s.project_id).at(-1);
  ok(notice && notice.to === 'old.client@example.test' && notice.text.includes('n***@e***.test'), 'old-address notice in the mail stub log');
  const row = localSql(`SELECT field,from_masked,to_masked,reason,at,signature FROM scopeflow.contact_history WHERE project_id=${q(s.project_id)}`)[0].results[0];
  const message = 'scopeflow-contact-v1:' + createHash('sha256').update(JSON.stringify({project_id: s.project_id, field: row.field, from_masked: row.from_masked, to_masked: row.to_masked, reason: row.reason, at: row.at})).digest('hex');
  ok(verify(null, Buffer.from(message), pub, Buffer.from(row.signature.split('.')[1], 'base64url')), 'signed contact_history record');
  eq((() => { try { localSql(`UPDATE scopeflow.contact_history SET reason='x' WHERE project_id=${q(s.project_id)}`); return 'updated'; } catch { return 'refused'; } })(), 'refused');
  const owner = (await call('/api/scopes/' + s.project_id, {cookie})).data.project;
  eq([owner.client_email, owner.contact_locked, owner.contact_since], ['new.client@example.test', true, row.at]);
  const timeline = (await call('/api/review/' + s.token)).data.contact_history;
  eq(timeline.map(c => [c.field, c.from_masked, c.to_masked]), [['email', 'o***@e***.test', 'n***@e***.test']]);
  ok(!JSON.stringify(timeline).includes('new.client@example.test'), 'masked in the client timeline');
}

// ---- C5 (E-equivalent at the API): code verified to a masked address, on the receipt too --------
// @covers C5
freshLimits();
{
  const s = await create();
  eq((await patch(s.project_id, {client_email: 'sam@example.test', require_otp: true})).status, 200);
  const view = (await call('/api/review/' + s.token)).data;
  eq(view.identity_check.to, 's***@e***.test');
  const r = await decide(s.token, {otp_session: await session(s.token, s.id)});
  eq(r.status, 200);
  eq(r.data.evidence.code_to, 's***@e***.test');
  ok(r.data.evidence.statement.includes('after entering a code sent to s***@e***.test, the address on file for this client since'), 'statement names the masked address and since when');
  const pdf = pdfText((await call(`/api/review/${s.token}/receipt`, {raw: true})).bytes);
  ok(pdf.includes('code verified to s***@e***.test'), 'client receipt line');
  ok(!pdf.includes('sam@example.test'), 'receipt never prints the full address');
}

// ---- M14: a code session backs one record only -------------------------------------------------
// @covers M14
freshLimits();
{
  const s = await create();
  eq((await patch(s.project_id, {client_email: 'm14@example.test', require_otp: true})).status, 200);
  const otpSession = await session(s.token, s.id);
  eq((await decide(s.token, {otp_session: otpSession})).status, 200);
  ok(localSql(`SELECT consumed FROM scopeflow.review_otps WHERE version_id=${q(s.id)} AND verified IS NOT NULL`)[0].results.every(r => r.consumed), 'consumed on use');
  const co = {title: 'TEST banner', reason: '', request_quote: '', add_items: [{id: 'i_banner', title: 'Web banner', qty: 1, unit: '', price: 100, acceptance: ''}], remove_item_ids: [], fee_delta: 100, days_delta: 0, revisions_delta: 0};
  const proposed = await call(`/api/scopes/${s.project_id}/ledger`, {method: 'POST', cookie, body: {kind: 'change_order', baseline_version: 1, payload: co, request_id: 'ws02-m14-' + randomUUID().slice(0, 8)}});
  eq(proposed.status, 201);
  const reused = await call(`/api/review/${s.token}/change-order`, {method: 'POST', body: {seq: proposed.data.seq, decision: 'approved', signer: 'Ada Client', comment: '', otp_session: otpSession}});
  // 401 through checkDecisionProof (WS-05 moves the change-order route onto it); the base route answers 403. Either way: refused, code otp_required.
  ok([401, 403].includes(reused.status), 'second use refused: ' + reused.status); eq(reused.data.code, 'otp_required');
  eq(Number(localSql(`SELECT COUNT(*) AS n FROM scopeflow.ledger_entries WHERE project_id=${q(s.project_id)} AND kind='settle'`)[0].results[0].n), 0);
  eq((await call('/api/review/' + s.token)).data.identity_check.action, 'change_order');
}

// ---- M15: cooldown, 5 codes per version per day, metering -----------------------------------------
// @covers M15
freshLimits();
{
  const s = await create();
  eq((await patch(s.project_id, {client_email: 'm15@example.test', require_otp: true})).status, 200);
  eq((await otp(s.token, {action: 'send'})).status, 200);
  const cool = await otp(s.token, {action: 'send'});
  eq(cool.status, 429); eq(cool.data.code, 'otp_cooldown'); ok(cool.data.retry_after >= 1 && cool.data.retry_after <= 30, 'retry_after within 30 s');
  ok(Number(cool.headers.get('retry-after')) >= 1, 'Retry-After header');
  for (let i = 2; i <= 5; i++) { pastCooldown(s.id); eq((await otp(s.token, {action: 'send'})).status, 200); }
  pastCooldown(s.id);
  const sixth = await otp(s.token, {action: 'send'});
  eq(sixth.status, 429); eq(sixth.data.code, 'otp_send_limit'); ok(sixth.data.retry_after > 0, 'retry_after');
  const spend = (await call('/api/scopes/' + s.project_id, {cookie})).data.project.otp_spend_today;
  ok(spend.codes >= 5 && spend.units >= 5, 'today’s spend is metered');
}

// ---- M16: API tokens cannot weaken identity checks ----------------------------------------------
// @covers M16
freshLimits();
{
  const s = await create();
  eq((await patch(s.project_id, {client_email: 'm16@example.test', require_otp: true})).status, 200);
  const apiKey = (await call('/api/key', {method: 'POST', cookie, body: {}})).data.token;
  const bearer = {headers: {Authorization: 'Bearer ' + apiKey}};
  for (const body of [{require_otp: false}, {client_email: 'agent@example.test'}, {cosigners: []}, {otp_channel: 'sms'}]) {
    const r = await call('/api/scopes/' + s.project_id, {method: 'PATCH', body, ...bearer});
    eq(r.status, 403); eq(r.data.code, 'session_required');
  }
  eq((await call('/api/scopes/' + s.project_id, {method: 'PATCH', body: {timezone: 'Asia/Kolkata'}, ...bearer})).status, 200); // other settings still work
  eq((await call('/api/scopes/' + s.project_id, {cookie})).data.project.require_otp, true);
}

// ---- H1 + M17 + M14: each countersigner has their own link and code; roles frozen at first send ---
// @covers H1 M17 M14
freshLimits();
let h1;
{
  const s = await create();
  eq((await patch(s.project_id, {cosigners: [{id: 'finance', role: 'Finance approver', name: 'Fin Ance', email: 'finance@example.test'}]})).status, 200);
  eq((await decide(s.token)).status, 200);
  const frozen = await patch(s.project_id, {cosigners: [{id: 'finance', role: 'Finance approver'}, {id: 'ceo', role: 'CEO'}]});
  eq(frozen.status, 409); eq(frozen.data.code, 'roles_frozen');
  const viaClient = await call(`/api/review/${s.token}/cosign`, {method: 'POST', body: {cosigner_id: 'finance', signer: 'Anyone', ...(await ack(base, s.token, {})), decision: undefined}});
  eq(viaClient.status, 403); eq(viaClient.data.code, 'use_your_cosigner_link');
  const links = (await call('/api/scopes/' + s.project_id, {cookie})).data.cosign_links;
  eq(links.map(l => [l.cosigner_id, l.to]), [['finance', 'f***@e***.test']]);
  const ct = links[0].cosign_path.split('/').pop();
  const page = (await call('/api/cosign/' + ct)).data;
  eq(page.identity_check.to, 'f***@e***.test');
  ok(!JSON.stringify(page).includes('finance@example.test'), 'the role page never shows the full address');
  const sha = (await ack(base, s.token, {})).content_sha256;
  const noCode = await call('/api/cosign/' + ct, {method: 'POST', body: {signer: 'Fin Ance', acknowledged: true, content_sha256: sha}});
  eq(noCode.status, 403); eq(noCode.data.code, 'otp_required');
  // A client-link code for this version cannot back a countersignature.
  const sent = await call(`/api/cosign/${ct}/otp`, {method: 'POST', body: {action: 'send'}});
  eq(sent.status, 200); eq(sent.data.to, 'f***@e***.test');
  const logged = lastCode(s.id);
  eq(logged.email, 'finance@example.test');
  const v = await call(`/api/cosign/${ct}/otp`, {method: 'POST', body: {action: 'verify', code: logged.code}});
  eq(v.status, 200);
  const signed = await call('/api/cosign/' + ct, {method: 'POST', body: {signer: 'Fin Ance', acknowledged: true, content_sha256: sha, otp_session: v.data.otp_session}});
  eq(signed.status, 201);
  eq(signed.data.cosign.verified_to, 'f***@e***.test');
  const again = await call('/api/cosign/' + ct, {method: 'POST', body: {signer: 'Fin Ance', acknowledged: true, content_sha256: sha, otp_session: v.data.otp_session}});
  eq(again.status, 401); eq(again.data.code, 'otp_required'); // M14: used once
  const client = (await call('/api/review/' + s.token)).data;
  eq(client.cosign.roles.map(r => [r.role, r.cosign?.signer, r.cosign?.verified_to]), [['Finance approver', 'Fin Ance', 'f***@e***.test']]);
  ok(!JSON.stringify(client).includes('finance@example.test'), 'client page shows the masked address only');
  const pdf = pdfText((await call(`/api/review/${s.token}/receipt`, {raw: true})).bytes);
  ok(pdf.includes('code verified to f***@e***.test'), 'receipt shows the countersigner’s masked address');
  h1 = {...s, ct};
}

// ---- H4: revoking a decided version keeps the client's record, read-only -------------------------
// @covers H4
freshLimits();
{
  const co = {title: 'TEST extra', reason: '', request_quote: '', add_items: [{id: 'i_extra', title: 'Extra', qty: 1, unit: '', price: 100, acceptance: ''}], remove_item_ids: [], fee_delta: 100, days_delta: 0, revisions_delta: 0};
  const proposed = await call(`/api/scopes/${h1.project_id}/ledger`, {method: 'POST', cookie, body: {kind: 'change_order', baseline_version: 1, payload: co, request_id: 'ws02-h4-' + randomUUID().slice(0, 8)}});
  eq(proposed.status, 201);
  eq((await call(`/api/scopes/${h1.project_id}/review-link`, {method: 'POST', cookie, body: {version: 1, action: 'revoke'}})).data.readonly, true);
  const view = await call('/api/review/' + h1.token);
  eq(view.status, 200);
  eq([view.data.readonly, view.data.readonly_reason, view.data.kept_until], [true, 'revoked', null]);
  ok(view.data.ledger && view.data.evidence && view.data.cosign, 'record, ledger, evidence and countersignatures still shown');
  eq(view.data.identity_check, undefined);
  eq((await call(`/api/review/${h1.token}/receipt`, {raw: true})).status, 200);
  const dec = await call('/api/review/' + h1.token, {method: 'POST', body: {decision: 'approved', signer: 'X', comment: '', version: 1, acknowledged: true, content_sha256: '0'.repeat(64)}});
  eq(dec.status, 403); eq(dec.data.code, 'link_readonly');
  const coDecision = await call(`/api/review/${h1.token}/change-order`, {method: 'POST', body: {seq: proposed.data.seq, decision: 'approved', signer: 'Ada Client', comment: ''}});
  ok([403, 404].includes(coDecision.status), 'no change-order decision through a revoked link: ' + coDecision.status); // 403 link_readonly once WS-05 uses resolveReviewToken
  eq(Number(localSql(`SELECT COUNT(*) AS n FROM scopeflow.ledger_entries WHERE project_id=${q(h1.project_id)} AND kind='settle'`)[0].results[0].n), 0);
  eq((await call(`/api/review/${h1.token}/otp`, {method: 'POST', body: {action: 'send'}})).data.code, 'link_readonly');
  eq((await call(`/api/cosign/${h1.ct}`, {method: 'POST', body: {signer: 'Late', acknowledged: true, content_sha256: '0'.repeat(64)}})).data.code, 'link_readonly');
  // Rotating a decided version: a new working token; the old one stays a read-only alias.
  const rotated = await call(`/api/scopes/${h1.project_id}/review-link`, {method: 'POST', cookie, body: {version: 1, action: 'rotate'}});
  eq(rotated.status, 200);
  const fresh = rotated.data.review_path.split('/').pop();
  eq((await call('/api/review/' + fresh)).data.readonly, false);
  const old = await call('/api/review/' + h1.token);
  eq([old.status, old.data.readonly, old.data.readonly_reason], [200, true, 'rotated']);
  // A pending version: revoke still means 404.
  const p = await create();
  eq((await call(`/api/scopes/${p.project_id}/review-link`, {method: 'POST', cookie, body: {version: 1, action: 'revoke'}})).data.readonly, false);
  eq((await call('/api/review/' + p.token)).status, 404);
  eq((await call(`/api/review/${p.token}/receipt`)).status, 404);
}

// ---- H5: rotating one version's link never restarts another version's expiry ----------------------
// @covers H5
freshLimits();
{
  const v1 = await create();
  eq((await patch(v1.project_id, {link_expiry_days: 7})).status, 200);
  await revise(v1.project_id, 1, {fee: 5100});
  const v3 = await revise(v1.project_id, 2, {fee: 5200});
  const before = (await call('/api/scopes/' + v1.project_id, {cookie})).data.project.link_expires;
  const reviewBefore = (await call('/api/review/' + v3.token)).data.link_expires;
  ok(before && before === reviewBefore, 'v3 expiry');
  await new Promise(r => setTimeout(r, 1100));
  eq((await call(`/api/scopes/${v1.project_id}/review-link`, {method: 'POST', cookie, body: {version: 1, action: 'rotate'}})).status, 200);
  eq((await call('/api/scopes/' + v1.project_id, {cookie})).data.project.link_expires, before);
  eq((await call('/api/review/' + v3.token)).data.link_expires, reviewBefore);
}

// ---- L3: the expiry names the project's zone ("13 Oct 2026, 1:30 am IST") ------------------------
// @covers L3
freshLimits();
{
  const s = await create();
  eq((await patch(s.project_id, {link_expiry_days: 7, timezone: 'Asia/Kolkata'})).status, 200);
  localSql(`INSERT INTO scopeflow.version_links (project_id,version,link_issued) VALUES (${q(s.project_id)},1,'2026-10-05T20:00:00.000Z') ON CONFLICT (project_id,version) DO UPDATE SET link_issued='2026-10-05T20:00:00.000Z'`);
  const r = await call('/api/review/' + s.token);
  if (r.status === 410) {
    ok(r.data.error.includes('13 Oct 2026, 1:30 am IST'), r.data.error);
    eq(r.data.expired_text, '13 Oct 2026, 1:30 am IST');
    ok(r.data.sender && 'email' in r.data.sender && 'name' in r.data.sender, 'WS-07: who to ask for a new link');
  } else {
    eq(r.data.link_expires_text, '13 Oct 2026, 1:30 am IST');
  }
}

// ---- LT-09: verify with the 16-character short form plus the project --------------------------------
// @covers LT-09
freshLimits();
{
  const s = await create();
  const r = await decide(s.token);
  const anchor = r.data.receipt.anchor;
  const short = await call(`/api/verify?p=${s.project_id}&v=1&a=${anchor.slice(0, 16)}`);
  eq([short.status, short.data.record, short.data.signature, short.data.anchor], [200, 'match', 'valid', anchor]);
  eq(short.data.evidence.chip, 'Verified · sealed by ScopeFlow');
  eq((await call(`/api/verify?p=${s.project_id}&v=1&a=${'0'.repeat(16)}`)).data.record, 'mismatch');
  eq((await call(`/api/verify?p=${s.project_id}&v=1&a=${anchor.slice(0, 15)}`)).status, 400);
  const view = (await call('/api/review/' + s.token)).data.evidence;
  eq(view.fingerprint, anchor);
  eq(view.verify_url, `/verify?p=${encodeURIComponent(s.project_id)}&v=1&a=${anchor}`);
}

// ---- C6: a record sealed with the cookie-derived key does not verify as "valid" in production ------
// @covers C6
freshLimits();
{
  const s = await create();
  const S = await import('../lib/signing.ts');
  const L = await import('../lib/ledger.ts');
  const decided = new Date().toISOString();
  const stored = JSON.parse(localSql(`SELECT content FROM scopeflow.versions WHERE id=${q(s.id)}`)[0].results[0].content);
  const anchor = await L.anchorHash({project_id: s.project_id, version: 1, content: stored, signer: 'Legacy Client', decided});
  const saved = {...process.env};
  delete process.env.SCOPEFLOW_SIGNING_SECRET; process.env.NODE_ENV = 'development';
  const sig = S.signRecord(S.anchorMessage(anchor));
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  ok(sig.startsWith(S.cookieKeyId(process.env) + '.'), 'signed with the cookie-derived key');
  localSql(`UPDATE scopeflow.versions SET status='approved',signer='Legacy Client',decided=${q(decided)},signature=${q(sig)},comment='' WHERE id=${q(s.id)}`);
  const r = await call(`/api/verify?p=${s.project_id}&v=1&a=${anchor}`);
  eq(r.data.record, 'match');
  ok(r.data.signature !== 'valid', 'not valid in production');
  eq(r.data.signature, 'unknown_key');
}

// ---- WS-10 request (M28): a retried decision with the same Idempotency-Key is not applied twice ----
// @covers M28
freshLimits();
{
  const s = await create();
  const body = await ack(base, s.token, {decision: 'approved', signer: 'Ada Client', comment: '', version: 1});
  const k = 'ws02-idem-' + randomUUID();
  const first = await call('/api/review/' + s.token, {method: 'POST', body, headers: {'Idempotency-Key': k}});
  eq(first.status, 200);
  const retry = await call('/api/review/' + s.token, {method: 'POST', body, headers: {'Idempotency-Key': k}});
  eq(retry.status, 200);
  eq(retry.headers.get('idempotency-replayed'), 'true');
  eq(retry.data.receipt, first.data.receipt);
  eq((await call('/api/review/' + s.token, {method: 'POST', body: {...body, signer: 'Someone Else'}, headers: {'Idempotency-Key': k}})).status, 422);
  eq((await call('/api/review/' + s.token, {method: 'POST', body})).status, 409); // without a key: already decided
}

console.log(`ws-02-identity: ${passed} checks passed`);
