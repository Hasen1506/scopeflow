// Regression tests for the 2026-10-07 audit fixes (SF-02..SF-16, the Origin blocker and live UI findings).
// Local-only: disposable fixtures in the local test database and auth fixture.
import assert from 'node:assert/strict';
import {randomUUID, createHash, createPublicKey, verify} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {signIn, localSql, ack} from './support/local.mjs';
import {createConnection} from '../db/connection.mjs';
const base = process.env.SCOPEFLOW_TEST_URL || 'http://localhost:5173';
assert.equal(new URL(base).hostname, 'localhost', 'Local fixtures only.');
let passed = 0;
const ok = (value, message) => { assert.ok(value, message); passed++; };
const eq = (a, b, message) => { assert.deepEqual(a, b, message); passed++; };
async function call(path, {method = 'GET', cookie, token, body, headers = {}} = {}) {
  const h = {...headers};
  if (cookie) h.Cookie = cookie;
  if (token) h.Authorization = 'Bearer ' + token;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(base + path, {method, headers: h, body: body === undefined ? undefined : JSON.stringify(body)});
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return {status: r.status, data, headers: r.headers};
}
const st = (r, n) => { assert.equal(r.status, n, JSON.stringify(r.data)); passed++; };
const scope = (title = 'Fix regression ' + randomUUID()) => ({title, client: 'Fictional Client', deliverables: '', items: [{id: 'i_logo', title: 'Logo suite', qty: 1, unit: '', price: 500, acceptance: 'SVG'}], client_inputs: [], exclusions: 'Website', fee: 500, currency: 'USD', revisions: 2, due: '2027-01-31', notes: 'Fixture.'});
const quote = s => "'" + String(s).replaceAll("'", "''") + "'";
const cookie = await signIn(base, `fixes-${Date.now()}@example.test`);

// ---- Live blocker: Origin resolution behind a proxy --------------------------------------
{
  const proxied = {'X-Forwarded-Host': 'scopeflow-public.example', 'X-Forwarded-Proto': 'https'};
  st(await call('/api/key', {method: 'POST', headers: {...proxied, Origin: 'https://scopeflow-public.example'}}), 401); // origin accepted, then "sign in"
  st(await call('/api/key', {method: 'POST', headers: {...proxied, Origin: 'https://evil.example'}}), 403);
  const signup = await call('/api/auth/sign-up/email', {method: 'POST', headers: {...proxied, Origin: 'https://scopeflow-public.example'}, body: {name: 'Proxy QA', email: `proxy-${Date.now()}@example.test`, password: 'Fictional-password-123'}});
  ok(signup.data?.message !== 'Origin not allowed.', 'auth proxy must not reject the forwarded same origin');
  st(await call('/api/auth/sign-up/email', {method: 'POST', headers: {Origin: 'https://evil.example'}, body: {name: 'X', email: 'x@example.test', password: 'Fictional-password-123'}}), 403);
}

// ---- SF-08: security headers ---------------------------------------------------------------
{
  const home = await fetch(base + '/');
  ok(/frame-ancestors 'none'/.test(home.headers.get('content-security-policy') || ''), 'CSP frame-ancestors');
  eq(home.headers.get('x-frame-options'), 'DENY');
  eq(home.headers.get('x-powered-by'), null);
  ok((home.headers.get('permissions-policy') || '').includes('camera=()'));
  const review = await fetch(base + '/review/' + 'a'.repeat(64));
  eq(review.headers.get('referrer-policy'), 'no-referrer');
}

// ---- SF-02: API tokens never see review links; decisions record their channel --------------
const key = (await call('/api/key', {method: 'POST', cookie, headers: {Origin: base}})).data.token;
let project, reviewToken;
{
  const viaToken = await call('/api/scopes', {method: 'POST', token: key, body: scope()});
  st(viaToken, 201);
  eq(viaToken.data.scope.token, undefined); eq(viaToken.data.review_path, null); ok(/workspace/.test(viaToken.data.review_link));
  const list = await call('/api/scopes', {token: key});
  ok(list.data.scopes.length > 0 && list.data.scopes.every(s => !('token' in s)), 'list hides tokens from API tokens');
  const history = await call('/api/scopes/' + viaToken.data.scope.project_id, {token: key});
  ok(history.data.versions.every(v => !('token' in v)), 'history hides tokens from API tokens');
  const exported = await call('/api/scopes/' + viaToken.data.scope.project_id + '/export', {token: key});
  ok(exported.data.versions.every(v => !('token' in v)), 'export hides tokens from API tokens');
  // SF-14: the Bearer scheme is case-insensitive.
  st(await call('/api/scopes', {headers: {Authorization: 'bearer ' + key}}), 200);
  const viaSession = await call('/api/scopes', {method: 'POST', cookie, headers: {Origin: base}, body: scope()});
  st(viaSession, 201); ok(/^[a-f0-9]{64}$/.test(viaSession.data.scope.token), 'browser session still gets its link');
  project = viaSession.data.scope.project_id; reviewToken = viaSession.data.scope.token;
}

// ---- SF-15: acknowledgement and content hash are required ----------------------------------
{
  const plain = {decision: 'approved', signer: 'Fictional Client', comment: '', version: 1};
  st(await call('/api/review/' + reviewToken, {method: 'POST', headers: {Origin: base}, body: plain}), 400);
  st(await call('/api/review/' + reviewToken, {method: 'POST', headers: {Origin: base}, body: {...plain, acknowledged: true, content_sha256: 'f'.repeat(64)}}), 409);
  // The owner approving from their own signed-in browser is recorded as such (SF-02).
  const approved = await call('/api/review/' + reviewToken, {method: 'POST', cookie, headers: {Origin: base}, body: await ack(base, reviewToken, plain)});
  st(approved, 200);
  // SF-04: the decision comes back with a signed receipt that verifies against the public key.
  const {receipt} = approved.data;
  const keys = (await call('/api/signing-key')).data.keys;
  ok(keys.length === 1 && receipt.signature.startsWith(keys[0].kid + '.'), 'receipt is signed with the published key');
  const publicKey = createPublicKey({key: keys[0], format: 'jwk'});
  ok(verify(null, Buffer.from('scopeflow-anchor-v1:' + receipt.anchor), publicKey, Buffer.from(receipt.signature.split('.')[1], 'base64url')), 'receipt signature verifies');
  const history = await call('/api/scopes/' + project, {cookie});
  eq(history.data.versions[0].decision_context.owner_session, true);
  eq(history.data.versions[0].decision_context.acknowledged, true);
  eq(history.data.versions[0].sealed, true);
}

// ---- SF-04: database-level immutability + signatures detect rewrites ----------------------
{
  const versionId = localSql(`SELECT id FROM versions WHERE project_id=${quote(project)} AND version=1`)[0].results[0].id;
  assert.throws(() => localSql(`UPDATE versions SET content=replace(content,'500','5000') WHERE id=${quote(versionId)}`), /immutable/); passed++;
  assert.throws(() => localSql(`UPDATE versions SET signer='Someone else' WHERE id=${quote(versionId)}`), /immutable/); passed++;
  assert.throws(() => localSql(`DELETE FROM versions WHERE id=${quote(versionId)}`), /immutable/); passed++;
  st(await call(`/api/scopes/${project}/ledger`, {method: 'POST', cookie, headers: {Origin: base}, body: {kind: 'revision_round', baseline_version: 1, payload: {feedback_date: new Date().toISOString().slice(0, 10)}}}), 201); // changed by WS-05: M8 bounds the date by today and the approval date
  assert.throws(() => localSql(`UPDATE ledger_entries SET payload='{}' WHERE project_id=${quote(project)}`), /append-only/); passed++;
  assert.throws(() => localSql(`DELETE FROM ledger_entries WHERE project_id=${quote(project)}`), /append-only/); passed++;
  assert.throws(() => localSql(`TRUNCATE ledger_entries`), /cannot be truncated/); passed++;
  const before = await call('/api/review/' + reviewToken);
  eq(before.data.ledger.seal.state, 'valid');
  // An operator with superuser rights disables the trigger and rewrites the fee: the signatures expose it.
  localSql(`ALTER TABLE versions DISABLE TRIGGER versions_immutable; UPDATE versions SET content=replace(content,'"fee":500','"fee":5000') WHERE id=${quote(versionId)}; ALTER TABLE versions ENABLE TRIGGER versions_immutable;`);
  const after = await call('/api/review/' + reviewToken);
  eq(after.data.scope.content.fee, 5000);
  eq(after.data.ledger.seal.state, 'invalid');
  const owner = await call(`/api/scopes/${project}/ledger`, {cookie});
  eq(owner.data.seal.state, 'invalid');
}

// ---- SF-11: hidden goodwill is salted; revoked previous versions are not disclosed ----------
{
  const created = await call('/api/scopes', {method: 'POST', cookie, headers: {Origin: base}, body: scope()});
  const p = created.data.scope.project_id, t1 = created.data.scope.token;
  st(await call('/api/review/' + t1, {method: 'POST', headers: {Origin: base}, body: await ack(base, t1, {decision: 'approved', signer: 'Fictional Client', comment: '', version: 1})}), 200);
  st(await call(`/api/scopes/${p}/ledger`, {method: 'POST', cookie, headers: {Origin: base}, body: {kind: 'goodwill', baseline_version: 1, payload: {title: 'Private fix', value: 50, visible: false}}}), 201);
  const view = await call('/api/review/' + t1);
  const hidden = view.data.ledger.entries.find(e => e.payload === null);
  const guess = createHash('sha256').update(JSON.stringify({title: 'Private fix', value: 50, hours: 0, note: '', visible: false})).digest('hex');
  ok(hidden && hidden.payload_hash !== guess, 'hidden goodwill hash cannot be confirmed by guessing');
  // SF-06 also: revising needs supersede_agreement once the ledger has entries.
  const blocked = await call('/api/scopes/' + p, {method: 'POST', cookie, headers: {Origin: base}, body: {expected_version: 1, content: {...scope(), fee: 600}}});
  st(blocked, 409); eq(blocked.data.code, 'agreement_has_ledger');
  const v2 = await call('/api/scopes/' + p, {method: 'POST', cookie, headers: {Origin: base}, body: {expected_version: 1, content: {...scope(), fee: 600}, supersede_agreement: true}});
  st(v2, 201);
  ok((await call('/api/review/' + v2.data.scope.token)).data.previous, 'previous shown while v1 link is live');
  st(await call(`/api/scopes/${p}/review-link`, {method: 'POST', cookie, headers: {Origin: base}, body: {version: 1, action: 'revoke'}}), 200);
  eq((await call('/api/review/' + v2.data.scope.token)).data.previous, null);
}

// ---- SF-12: change orders cannot shift a missing delivery date ----------------------------
{
  const created = await call('/api/scopes', {method: 'POST', cookie, headers: {Origin: base}, body: {...scope(), due: ''}});
  const p = created.data.scope.project_id, t = created.data.scope.token;
  st(await call('/api/review/' + t, {method: 'POST', headers: {Origin: base}, body: await ack(base, t, {decision: 'approved', signer: 'Fictional Client', comment: '', version: 1})}), 200);
  const co = await call(`/api/scopes/${p}/ledger`, {method: 'POST', cookie, headers: {Origin: base}, body: {kind: 'change_order', baseline_version: 1, payload: {title: 'Later delivery', days_delta: 5}}});
  st(co, 400); ok(/no delivery date/.test(co.data.error));
  // SF-14: an owner settle replay after the client settled reports "already settled".
  const proposed = await call(`/api/scopes/${p}/ledger`, {method: 'POST', cookie, headers: {Origin: base}, body: {kind: 'change_order', baseline_version: 1, payload: {title: 'Extra', fee_delta: 100}}});
  st(proposed, 201);
  st(await call(`/api/review/${t}/change-order`, {method: 'POST', headers: {Origin: base}, body: {seq: proposed.data.seq, decision: 'declined', signer: 'Fictional Client', comment: 'No'}}), 200);
  const replay = await call(`/api/scopes/${p}/ledger`, {method: 'POST', cookie, headers: {Origin: base}, body: {kind: 'settle', baseline_version: 1, payload: {ref_seq: proposed.data.seq, outcome: 'withdrawn'}, request_id: randomUUID()}});
  st(replay, 409); eq(replay.data.error, 'This change order has already been settled.');
}

// ---- SF-09: the 100-project cap holds under concurrency ----------------------------------
{
  const capCookie = await signIn(base, `cap-${Date.now()}@example.test`);
  const first = await call('/api/scopes', {method: 'POST', cookie: capCookie, headers: {Origin: base}, body: scope()});
  const ownerId = localSql(`SELECT owner FROM projects WHERE id=${quote(first.data.scope.project_id)}`)[0].results[0].owner;
  const values = Array.from({length: 98}, () => `(${quote(randomUUID())},${quote(ownerId)},1,'2026-10-01')`).join(',');
  localSql(`INSERT INTO projects (id,owner,latest,created) VALUES ${values}`);
  localSql('DELETE FROM rate_limits');
  const results = await Promise.all(Array.from({length: 10}, () => call('/api/scopes', {method: 'POST', cookie: capCookie, headers: {Origin: base}, body: scope()})));
  eq(results.filter(r => r.status === 201).length, 1);
  eq(localSql(`SELECT COUNT(*) AS n FROM projects WHERE owner=${quote(ownerId)}`)[0].results[0].n, 100);
}

// ---- SF-05: one tenant's lock no longer blocks another tenant ----------------------------
{
  localSql('DELETE FROM rate_limits');
  const sql = createConnection();
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const holder = sql.begin(async tx => {
    await tx.unsafe('SELECT pg_advisory_xact_lock(1935896439)'); // the old global key
    await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", ['scopeflow:project:' + project]);
    await held;
  });
  await new Promise(r => setTimeout(r, 200));
  const other = await signIn(base, `tenant-b-${Date.now()}@example.test`);
  const started = Date.now();
  const b = await call('/api/scopes', {method: 'POST', cookie: other, headers: {Origin: base}, body: scope()});
  st(b, 201);
  st(await call('/api/review/' + reviewToken), 200); // read batch on the locked project is lock-free
  ok(Date.now() - started < 3000, 'tenant B was not blocked by tenant A');
  release(); await holder; await sql.end();
}

// ---- Live UI findings (server-rendered HTML; the pages hydrate from these states) -----------
{
  const page = async path => (await fetch(base + path)).text();
  for (const path of ['/', '/account', '/connect', '/support', '/privacy', '/terms', '/reviewer-guide']) ok(!/hasenhamesh15@gmail\.com/.test(await page(path)), 'no personal inbox on ' + path); // BUG-8 / SF-17
  const connect = await page('/connect');
  ok(/Connect your AI assistant/.test(connect) && /Claude Desktop/.test(connect) && /href="\/api\/openapi"[^>]*>OpenAPI specification/.test(connect), 'connect page names each assistant and the OpenAPI link label matches its destination');
  ok(/<button class="secondary" disabled=""[^>]*>Revoke token/.test(connect) && /id="token-gate"/.test(connect), 'BUG-12 Revoke disabled with a reason until sign-in is confirmed');
  ok(/id="gate-key"/.test(await page('/account')), 'BUG-9 account controls explain why they are disabled');
  // BUG-13's save-button reason is covered by the saveBlockReason unit test: the signed-out home is now
  // the landing page (features, no editor), so no draft of any account is rendered there.
  { const home = await page('/'); ok(/Everything a scope needs/.test(home) && /Scope-creep radar/.test(home) && !/id="save-reason"/.test(home) && !/Live draft preview/.test(home), 'signed-out home is the landing page, without the editor'); }
  ok(/At least 8 characters/.test(await page('/auth/sign-up')), 'BUG-4 password hint');
  const apiInfo = await (await fetch(base + '/api')).json();
  eq(apiInfo.version, JSON.parse(readFileSync('package.json', 'utf8')).version); // SF-16
}
console.log(JSON.stringify({passed, suite: 'fixes', originBlocker: true, securityHeaders: true, noTokensForAgents: true, acknowledgement: true, immutability: true, signatures: true, salting: true, supersede: true, capRace: true, lockScope: true, liveUi: true}));
