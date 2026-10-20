// SF-01: OAuth 2.1 for the MCP connector, end to end against the local server.
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {signIn} from './support/local.mjs';
const base = process.env.SCOPEFLOW_TEST_URL || 'http://localhost:5173';
assert.equal(new URL(base).hostname, 'localhost', 'Local fixtures only.');
let passed = 0;
const ok = (v, m) => { assert.ok(v, m); passed++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); passed++; };
const json = async r => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const rpc = (method, params, headers = {}) => fetch(base + '/mcp', {method: 'POST', headers: {'Content-Type': 'application/json', ...headers}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})});

// Discovery: 401 challenge -> protected resource metadata -> authorization server metadata.
const unauth = await rpc('tools/call', {name: 'list_scopes', arguments: {}});
eq(unauth.status, 401);
const www = unauth.headers.get('www-authenticate') || '';
ok(www.startsWith('Bearer ') && www.includes(`resource_metadata="${base}/.well-known/oauth-protected-resource"`), www);
const unauthBody = await json(unauth);
ok(unauthBody.result.isError && unauthBody.result._meta['mcp/www_authenticate'][0].includes('error="invalid_request"'), 'tool result carries _meta mcp/www_authenticate');
const prm = await json(await fetch(base + '/.well-known/oauth-protected-resource'));
eq(prm.resource, base + '/mcp'); eq(prm.authorization_servers, [base]);
eq((await json(await fetch(base + '/.well-known/oauth-protected-resource/mcp'))).resource, base + '/mcp');
const asm = await json(await fetch(base + '/.well-known/oauth-authorization-server'));
eq(asm.issuer, base); ok(asm.code_challenge_methods_supported.includes('S256')); eq(asm.authorization_response_iss_parameter_supported, true);
ok(asm.registration_endpoint && asm.token_endpoint && asm.authorization_endpoint);
const tools = await json(await rpc('tools/list', {}));
ok(tools.result.tools.filter(t => !['lint_scope', 'list_scope_templates', 'draft_scope'].includes(t.name)).every(t => t.securitySchemes[0].type === 'oauth2'), 'oauth2 security schemes');

// Dynamic client registration (public client, PKCE).
const redirect = 'https://chatgpt.com/connector_platform_oauth_redirect';
const reg = await fetch(asm.registration_endpoint, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({client_name: 'ChatGPT (local QA)', redirect_uris: [redirect], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code']})});
eq(reg.status, 201);
const client = await json(reg);
ok(client.client_id && !client.client_secret);
eq((await fetch(asm.registration_endpoint, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({redirect_uris: ['http://evil.example/cb']})})).status, 400);

// Authorization request: signed out -> sign-in redirect; signed in -> consent page.
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const params = {response_type: 'code', client_id: client.client_id, redirect_uri: redirect, state: 'st-123', scope: 'scopes:read scopes:write', code_challenge: challenge, code_challenge_method: 'S256', resource: base + '/mcp'};
const authUrl = asm.authorization_endpoint + '?' + new URLSearchParams(params);
const signedOut = await fetch(authUrl, {redirect: 'manual'});
ok([303, 307, 308].includes(signedOut.status) || (await signedOut.clone().text()).includes('/auth/sign-in'), 'signed-out users are sent to sign in');
const cookie = await signIn(base, `oauth-${Date.now()}@example.test`);
const consent = await fetch(authUrl, {headers: {Cookie: cookie}});
eq(consent.status, 200);
ok((await consent.text()).includes('ChatGPT (local QA)'), 'consent names the client');
// Missing PKCE is refused with a redirect carrying iss (RFC 9207).
const noPkce = await fetch(asm.authorization_endpoint + '?' + new URLSearchParams({...params, code_challenge: '', code_challenge_method: ''}), {headers: {Cookie: cookie}, redirect: 'manual'});
const noPkceLocation = noPkce.headers.get('location') || '';
ok(noPkceLocation.startsWith(redirect) && new URL(noPkceLocation).searchParams.get('error') === 'invalid_request' && new URL(noPkceLocation).searchParams.get('iss') === base, noPkceLocation);
// Cross-site consent POST is refused.
eq((await fetch(base + '/api/oauth/authorize', {method: 'POST', headers: {Cookie: cookie, Origin: 'https://evil.example', 'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({...params, decision: 'approve'})})).status, 403);
const approve = await fetch(base + '/api/oauth/authorize', {method: 'POST', redirect: 'manual', headers: {Cookie: cookie, Origin: base, 'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({...params, decision: 'approve'})});
eq(approve.status, 303);
const callback = new URL(approve.headers.get('location'));
eq(callback.origin + callback.pathname, redirect); eq(callback.searchParams.get('state'), 'st-123'); eq(callback.searchParams.get('iss'), base);
const code = callback.searchParams.get('code'); ok(code);

const token = body => fetch(asm.token_endpoint, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(body)});
eq((await token({grant_type: 'authorization_code', code, code_verifier: randomBytes(32).toString('base64url'), redirect_uri: redirect, client_id: client.client_id, resource: base + '/mcp'})).status, 400); // wrong verifier burns the code
const approve2 = await fetch(base + '/api/oauth/authorize', {method: 'POST', redirect: 'manual', headers: {Cookie: cookie, Origin: base, 'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({...params, decision: 'approve'})});
const code2 = new URL(approve2.headers.get('location')).searchParams.get('code');
const issued = await token({grant_type: 'authorization_code', code: code2, code_verifier: verifier, redirect_uri: redirect, client_id: client.client_id, resource: base + '/mcp'});
eq(issued.status, 200);
const replayed = await json(issued);
ok(replayed.access_token.startsWith('sfo_') && replayed.refresh_token && replayed.token_type === 'Bearer');
eq((await token({grant_type: 'authorization_code', code: code2, code_verifier: verifier, redirect_uri: redirect, client_id: client.client_id})).status, 400); // single use
// changed by WS-10 (M23): replaying a code also revokes the tokens of its first exchange, so the rest of the suite uses a fresh grant.
eq((await rpc('tools/call', {name: 'list_scopes', arguments: {}}, {Authorization: 'Bearer ' + replayed.access_token})).status, 401);
const approve3 = await fetch(base + '/api/oauth/authorize', {method: 'POST', redirect: 'manual', headers: {Cookie: cookie, Origin: base, 'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({...params, decision: 'approve'})});
const tokens = await json(await token({grant_type: 'authorization_code', code: new URL(approve3.headers.get('location')).searchParams.get('code'), code_verifier: verifier, redirect_uri: redirect, client_id: client.client_id, resource: base + '/mcp'}));
ok(tokens.access_token.startsWith('sfo_') && tokens.refresh_token);

// The access token works on /mcp, not on the REST API (audience-bound), and agents get no review links.
const listed = await json(await rpc('tools/call', {name: 'list_scopes', arguments: {}}, {Authorization: 'Bearer ' + tokens.access_token}));
ok(Array.isArray(listed.result.structuredContent.scopes), JSON.stringify(listed));
eq((await fetch(base + '/api/scopes', {headers: {Authorization: 'Bearer ' + tokens.access_token}})).status, 401);
const content = {title: 'OAuth created scope', client: 'Fictional Client', deliverables: 'One logo\nOne guide', exclusions: 'Print', fee: 100, currency: 'USD', revisions: 1, due: '', notes: 'Fixture.'};
const created = await json(await rpc('tools/call', {name: 'create_scope', arguments: {content, request_id: 'oauth-' + Date.now(), user_confirmed: true}}, {Authorization: 'Bearer ' + tokens.access_token}));
ok(created.result.structuredContent.workspace_url.startsWith(base + '/?project=') && !JSON.stringify(created).includes('/review/'), JSON.stringify(created));

// Read-only grant cannot write (insufficient_scope).
const roParams = {...params, scope: 'scopes:read'};
const roApprove = await fetch(base + '/api/oauth/authorize', {method: 'POST', redirect: 'manual', headers: {Cookie: cookie, Origin: base, 'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({...roParams, decision: 'approve'})});
const ro = await json(await token({grant_type: 'authorization_code', code: new URL(roApprove.headers.get('location')).searchParams.get('code'), code_verifier: verifier, redirect_uri: redirect, client_id: client.client_id}));
const denied = await rpc('tools/call', {name: 'create_scope', arguments: {content, request_id: 'oauth-ro-' + Date.now(), user_confirmed: true}}, {Authorization: 'Bearer ' + ro.access_token});
eq(denied.status, 403); ok((denied.headers.get('www-authenticate') || '').includes('insufficient_scope'));

// Refresh rotation; the old refresh token stops working; revocation; invalid tokens get a challenge.
const refreshed = await json(await token({grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.client_id}));
ok(refreshed.access_token && refreshed.access_token !== tokens.access_token);
eq((await token({grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.client_id})).status, 400);
eq((await fetch(asm.revocation_endpoint, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({token: refreshed.access_token, client_id: client.client_id})})).status, 200);
const revoked = await rpc('tools/call', {name: 'list_scopes', arguments: {}}, {Authorization: 'Bearer ' + refreshed.access_token});
eq(revoked.status, 401); ok((revoked.headers.get('www-authenticate') || '').includes('invalid_token'));
// Unknown or non-allowlisted metadata-document clients are refused.
eq((await fetch(asm.authorization_endpoint + '?' + new URLSearchParams({...params, client_id: 'https://evil.example/client.json'}), {headers: {Cookie: cookie}})).status, 200); // renders an error page, never redirects
// Disconnect all apps from the website.
eq((await fetch(base + '/api/oauth/grants', {method: 'DELETE', headers: {Cookie: cookie, Origin: base}})).status, 200);
eq((await rpc('tools/call', {name: 'list_scopes', arguments: {}}, {Authorization: 'Bearer ' + ro.access_token})).status, 401);
console.log(JSON.stringify({passed, suite: 'oauth', discovery: true, dcr: true, pkce: true, consent: true, resourceBinding: true, scopes: true, refreshRotation: true, revocation: true}));
