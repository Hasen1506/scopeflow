// MCP Streamable HTTP, OAuth discovery and auth-required checks. Local server only.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {signIn} from './support/local.mjs';
const base = process.env.SCOPEFLOW_TEST_URL || 'http://localhost:5173';
assert.equal(new URL(base).hostname, 'localhost');
let passed = 0;
const ok = (v, m) => { assert.ok(v, m); passed++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); passed++; };
async function rpc(method, params, headers = {}, accept = 'application/json') {
  const response = await fetch(base + '/mcp', {method: 'POST', headers: {'Content-Type': 'application/json', Accept: accept, ...headers}, body: JSON.stringify({jsonrpc: '2.0', id: 7, method, params})});
  const text = await response.text();
  let value;
  if ((response.headers.get('content-type') || '').includes('text/event-stream')) {
    const line = text.split('\n').find(l => l.startsWith('data: '));
    value = line ? JSON.parse(line.slice(6)) : text;
  } else {
    try { value = JSON.parse(text); } catch { value = text; }
  }
  return {status: response.status, headers: response.headers, value, text};
}

const init = await rpc('initialize', {protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'mcp-http', version: '1'}});
eq(init.status, 200);
eq(init.value.result.protocolVersion, '2025-11-25');
const sid = init.headers.get('mcp-session-id');
ok(sid && sid.length > 10, 'initialize returns Mcp-Session-Id');
eq((await fetch(base + '/mcp')).status, 405);
const stream = await fetch(base + '/mcp', {headers: {'Mcp-Session-Id': sid}});
eq(stream.status, 200);
ok((stream.headers.get('content-type') || '').includes('text/event-stream'));
eq((await fetch(base + '/mcp', {method: 'DELETE', headers: {'Mcp-Session-Id': sid}})).status, 200);
eq((await fetch(base + '/mcp', {headers: {'Mcp-Session-Id': sid}})).status, 404);

const listed = await rpc('tools/list', {});
const names = listed.value.result.tools.map(t => t.name);
for (const name of ['draft_scope', 'list_projects', 'read_project', 'create_share_link']) {
  const tool = listed.value.result.tools.find(t => t.name === name);
  ok(tool && tool.description.length > 40, name);
}
ok(names.includes('list_scopes') && names.includes('create_scope'));

const draft = await rpc('tools/call', {name: 'draft_scope', arguments: {brief: 'Logo and a one-page brand guide\nTwo concepts\nOne PDF'}});
eq(draft.status, 200);
eq(draft.value.result.structuredContent.saved, false);
ok(draft.value.result.structuredContent.outline.deliverables.length >= 1);

const denied = await rpc('tools/call', {name: 'list_projects', arguments: {}});
eq(denied.status, 401);
ok((denied.headers.get('www-authenticate') || '').includes('resource_metadata='));

const sse = await rpc('tools/list', {}, {}, 'text/event-stream');
eq(sse.status, 200);
ok((sse.headers.get('content-type') || '').includes('text/event-stream'));
ok(Array.isArray(sse.value.result.tools));

const prm = await (await fetch(base + '/.well-known/oauth-protected-resource')).json();
eq(prm.resource, base + '/mcp');
const asm = await (await fetch(base + '/.well-known/oauth-authorization-server')).json();
ok(asm.code_challenge_methods_supported.includes('S256'));
ok(asm.registration_endpoint.endsWith('/oauth/register'));
const reg = await fetch(asm.registration_endpoint, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({client_name: 'MCP conformance', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code']})});
eq(reg.status, 201);
const client = await reg.json();
ok(client.client_id);
const token = await fetch(asm.token_endpoint, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({grant_type: 'authorization_code', code: 'missing', code_verifier: 'not-the-verifier', redirect_uri: 'https://claude.ai/api/mcp/auth_callback', client_id: client.client_id, resource: base + '/mcp'})});
eq(token.status, 400);

const cookie = await signIn(base, `mcp-http-${Date.now()}@example.test`);
const scope = {title: 'MCP HTTP ' + randomUUID().slice(0, 6), client: 'Fictional Client', deliverables: 'One page', exclusions: 'Print', fee: 100, currency: 'USD', revisions: 1, due: '', notes: 'Fixture.'};
const created = await rpc('tools/call', {name: 'create_scope', arguments: {content: scope, request_id: randomUUID(), user_confirmed: true}}, {Cookie: cookie});
eq(created.status, 200, JSON.stringify(created.value));
const project = created.value.result.structuredContent.scope.project_id;
const share = await rpc('tools/call', {name: 'create_share_link', arguments: {project_id: project, user_confirmed: true}}, {Cookie: cookie});
eq(share.status, 200, JSON.stringify(share.value));
eq(share.value.result.structuredContent.review_path, null);
ok(!JSON.stringify(share.value).includes('/review/'));
const projects = await rpc('tools/call', {name: 'list_projects', arguments: {}}, {Cookie: cookie});
ok(projects.value.result.structuredContent.projects.some(p => p.project_id === project));
const read = await rpc('tools/call', {name: 'read_project', arguments: {project_id: project}}, {Cookie: cookie});
eq(read.value.result.structuredContent.status, 'pending');
eq(read.value.result.structuredContent.latest_version, 1);
ok(!JSON.stringify(read.value).includes('/review/'));

console.log(JSON.stringify({passed, protocol: true, oauthDiscovery: true, authRequired: true, shareLinkHidden: true}));
