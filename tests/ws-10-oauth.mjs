// M22/M23/M24: OAuth hygiene for the MCP connector, against the local server.
//   M22  reserved client names cannot be registered dynamically for a foreign redirect host.
//   M23  a wrong client cannot burn a victim's code; a replayed code revokes what it issued;
//        reusing a rotated refresh token revokes the whole family; revoking a refresh token
//        revokes its access tokens.
//   M24  grants are listed one by one and disconnected one by one.
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {signIn} from './support/local.mjs';

const base = process.env.SCOPEFLOW_TEST_URL || 'http://localhost:5173';
assert.equal(new URL(base).hostname, 'localhost', 'Local fixtures only.');
let passed = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); passed++; };
const ok = (v, m) => { assert.ok(v, m); passed++; };
const json = async r => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const register = body => fetch(base + '/oauth/register', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
const token = body => fetch(base + '/oauth/token', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(body)});
const rpc = access => fetch(base + '/mcp', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + access}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'list_scopes', arguments: {}}})});

// ---------------------------------------------------------------------------------------------
// @covers M22 — DCR client_name "ChatGPT" with a redirect to evil.example -> 400 reserved_name.
// ---------------------------------------------------------------------------------------------
for (const name of ['ChatGPT', 'chat gpt connector', 'Claude', 'OpenAI Codex', 'Anthropic', 'Scopeflow official', 'ChatGPT (via evil)']) {
  const r = await register({client_name: name, redirect_uris: ['https://evil.example/callback'], token_endpoint_auth_method: 'none'});
  eq(r.status, 400, name);
  eq((await json(r)).error, 'reserved_name', name);
}
// The real ChatGPT and Claude redirect hosts may use their names; any other name is fine anywhere.
eq((await register({client_name: 'ChatGPT', redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'], token_endpoint_auth_method: 'none'})).status, 201);
eq((await register({client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], token_endpoint_auth_method: 'none'})).status, 201);
eq((await register({client_name: 'ChatGPT', redirect_uris: ['https://chatgpt.com/cb', 'https://evil.example/cb'], token_endpoint_auth_method: 'none'})).status, 400, 'every redirect URI must be on the brand domain');
eq((await register({client_name: 'Acme Notes', redirect_uris: ['https://evil.example/callback'], token_endpoint_auth_method: 'none'})).status, 201);

// ---------------------------------------------------------------------------------------------
// Two clients and a signed-in owner for the token tests.
// ---------------------------------------------------------------------------------------------
const redirect = 'https://agent.example/callback';
const victim = await json(await register({client_name: 'TEST victim client', redirect_uris: [redirect], token_endpoint_auth_method: 'none'}));
const attacker = await json(await register({client_name: 'TEST attacker client', redirect_uris: ['https://attacker.example/cb'], token_endpoint_auth_method: 'none'}));
const cookie = await signIn(base, `ws10-oauth-${Date.now()}@example.test`);
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
async function code(clientId = victim.client_id, uri = redirect) {
  const params = {response_type: 'code', client_id: clientId, redirect_uri: uri, state: 's', scope: 'scopes:read scopes:write', code_challenge: challenge, code_challenge_method: 'S256', resource: base + '/mcp', decision: 'approve'};
  const r = await fetch(base + '/api/oauth/authorize', {method: 'POST', redirect: 'manual', headers: {Cookie: cookie, Origin: base, 'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(params)});
  assert.equal(r.status, 303);
  return new URL(r.headers.get('location')).searchParams.get('code');
}
const exchange = (c, clientId = victim.client_id, uri = redirect) => token({grant_type: 'authorization_code', code: c, code_verifier: verifier, redirect_uri: uri, client_id: clientId, resource: base + '/mcp'});

// ---------------------------------------------------------------------------------------------
// @covers M23 — a wrong client presenting the victim's code gets 401, and the code still works
// for the client it was issued to.
// ---------------------------------------------------------------------------------------------
{
  const c = await code();
  const stolen = await exchange(c, attacker.client_id, redirect);
  eq(stolen.status, 401);
  eq((await json(stolen)).error, 'invalid_client');
  const good = await exchange(c);
  eq(good.status, 200, 'the code was not burned by the wrong client');
  ok((await json(good)).access_token.startsWith('sfo_'));
}

// ---------------------------------------------------------------------------------------------
// @covers M23 — a replayed code revokes the tokens of the first exchange.
// ---------------------------------------------------------------------------------------------
{
  const c = await code();
  const first = await json(await exchange(c));
  eq((await rpc(first.access_token)).status, 200);
  const replay = await exchange(c);
  eq(replay.status, 400);
  eq((await json(replay)).error, 'invalid_grant');
  eq((await rpc(first.access_token)).status, 401, 'access token from the first exchange revoked');
  eq((await token({grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: victim.client_id})).status, 400, 'refresh token revoked too');
}

// ---------------------------------------------------------------------------------------------
// @covers M23 — reuse of a rotated refresh token revokes the whole family.
// ---------------------------------------------------------------------------------------------
{
  const t0 = await json(await exchange(await code()));
  const t1 = await json(await token({grant_type: 'refresh_token', refresh_token: t0.refresh_token, client_id: victim.client_id}));
  ok(t1.access_token && t1.refresh_token !== t0.refresh_token, 'rotation');
  eq((await rpc(t1.access_token)).status, 200);
  const reuse = await token({grant_type: 'refresh_token', refresh_token: t0.refresh_token, client_id: victim.client_id});
  eq(reuse.status, 400);
  eq((await rpc(t1.access_token)).status, 401, 'the current access token of the family is revoked');
  eq((await token({grant_type: 'refresh_token', refresh_token: t1.refresh_token, client_id: victim.client_id})).status, 400, 'and its current refresh token');
  eq((await rpc(t0.access_token)).status, 401);
}

// ---------------------------------------------------------------------------------------------
// @covers M23 — revoking a refresh token revokes its access tokens (RFC 7009 §2.1).
// ---------------------------------------------------------------------------------------------
{
  const t = await json(await exchange(await code()));
  eq((await rpc(t.access_token)).status, 200);
  eq((await fetch(base + '/oauth/revoke', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({token: t.refresh_token, client_id: victim.client_id})})).status, 200);
  eq((await rpc(t.access_token)).status, 401);
}

// ---------------------------------------------------------------------------------------------
// @covers M24 M22 — the connected-apps list has one entry per grant with its unverified domain;
// disconnecting one leaves the other working.
// ---------------------------------------------------------------------------------------------
{
  const owner2 = await signIn(base, `ws10-grants-${Date.now()}@example.test`);
  const grantFor = async () => {
    const params = {response_type: 'code', client_id: victim.client_id, redirect_uri: redirect, state: 's', scope: 'scopes:read', code_challenge: challenge, code_challenge_method: 'S256', resource: base + '/mcp', decision: 'approve'};
    const r = await fetch(base + '/api/oauth/authorize', {method: 'POST', redirect: 'manual', headers: {Cookie: owner2, Origin: base, 'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(params)});
    return json(await exchange(new URL(r.headers.get('location')).searchParams.get('code')));
  };
  const a = await grantFor(), b = await grantFor();
  const listed = await json(await fetch(base + '/api/oauth/grants', {headers: {Cookie: owner2}}));
  eq(listed.grants.length, 2);
  eq(listed.grants.map(g => [g.name, g.domain, g.verified, g.scopes]), [['TEST victim client', 'agent.example', false, ['scopes:read']], ['TEST victim client', 'agent.example', false, ['scopes:read']]]);
  ok(listed.grants[0].id !== listed.grants[1].id && listed.grants.every(g => g.created));
  await rpc(a.access_token);
  const lastUsed = (await json(await fetch(base + '/api/oauth/grants', {headers: {Cookie: owner2}}))).grants.filter(g => g.last_used);
  eq(lastUsed.length, 1, 'last used is tracked per grant');
  const target = lastUsed[0].id;
  eq((await fetch(base + '/api/oauth/grants?grant=' + target, {method: 'DELETE', headers: {Cookie: owner2, Origin: base}})).status, 200);
  eq((await rpc(a.access_token)).status, 401, 'the disconnected grant stops working');
  eq((await rpc(b.access_token)).status, 200, 'the other grant still works');
  const after = await json(await fetch(base + '/api/oauth/grants', {headers: {Cookie: owner2}}));
  eq(after.grants.map(g => g.id).includes(target), false);
  eq(after.grants.length, 1);
  // Another owner cannot disconnect it; an unknown id is 404.
  eq((await fetch(base + '/api/oauth/grants?grant=' + after.grants[0].id, {method: 'DELETE', headers: {Cookie: cookie, Origin: base}})).status, 404);
  eq((await rpc(b.access_token)).status, 200);
}

console.log(JSON.stringify({passed, suite: 'ws-10-oauth'}));
