// SF-01: a small OAuth 2.1 authorization server for the /mcp connector, following
// the MCP authorization spec and https://developers.openai.com/apps-sdk/build/auth:
// RFC 9728 protected-resource metadata, RFC 8414 server metadata, RFC 7591 dynamic
// client registration, Client ID Metadata Documents for allowlisted hosts,
// authorization code + PKCE (S256 only), RFC 8707 resource binding, RFC 9207 `iss`
// in every authorization response, and rotating refresh tokens.
import {db, hash, mcpResource, readText, BODY_LIMITS} from '@/lib/server';
import {appOrigin} from '@/lib/origin';

export const OAUTH_SCOPES = ['scopes:read', 'scopes:write'] as const;
export const SCOPE_TEXT: Record<string, string> = {
  'scopes:read': 'Read your projects, version history and current agreements',
  'scopes:write': 'Save scopes and revisions you have reviewed, and record change orders for your client to approve',
};
const CODE_TTL = 120_000, ACCESS_TTL = 3600_000, REFRESH_TTL = 30 * 86400_000;
const AUTH_METHODS = ['none', 'client_secret_post', 'client_secret_basic'] as const;
type AuthMethod = typeof AUTH_METHODS[number];
/** `kind`: dcr = registered by anyone through /oauth/register (unverified); cimd = a Client ID Metadata Document on an allowlisted host (verified domain). */
export type OAuthClient = {id: string; name: string; redirect_uris: string[]; auth_method: AuthMethod; secret_hash: string | null; kind: 'dcr' | 'cimd'};

export const issuer = (request: Request) => appOrigin(request);
export const resourceMetadataUrl = (request: Request) => appOrigin(request) + '/.well-known/oauth-protected-resource';

export function protectedResourceMetadata(request: Request) {
  return {
    resource: mcpResource(request),
    authorization_servers: [issuer(request)],
    scopes_supported: [...OAUTH_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'Scopeflow',
    resource_documentation: appOrigin(request) + '/connect',
  };
}
export function authorizationServerMetadata(request: Request) {
  const base = issuer(request);
  return {
    issuer: base,
    authorization_endpoint: base + '/oauth/authorize',
    token_endpoint: base + '/oauth/token',
    registration_endpoint: base + '/oauth/register',
    revocation_endpoint: base + '/oauth/revoke',
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: [...AUTH_METHODS],
    revocation_endpoint_auth_methods_supported: [...AUTH_METHODS],
    scopes_supported: [...OAUTH_SCOPES],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: cimdHosts().length > 0,
    service_documentation: base + '/connect',
  };
}

/** WWW-Authenticate challenge pointing clients at the resource metadata (RFC 9728 §5.1). */
export function challenge(request: Request, error?: {code: string; description: string; scope?: string}) {
  const parts = [`resource_metadata="${resourceMetadataUrl(request)}"`, `scope="${error?.scope ?? OAUTH_SCOPES.join(' ')}"`];
  if (error) parts.push(`error="${error.code}"`, `error_description="${error.description.replaceAll('"', "'")}"`);
  return 'Bearer ' + parts.join(', ');
}

export const corsHeaders = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version', 'Access-Control-Max-Age': '600'};
export function oauthJson(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(data, {status, headers: {'Cache-Control': 'no-store', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff', ...corsHeaders, ...headers}});
}
export const oauthError = (error: string, description: string, status = 400, headers: Record<string, string> = {}) => oauthJson({error, error_description: description}, status, headers);

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

function isLoopback(host: string) { return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'; }
export function validRedirectUri(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false;
  try {
    const url = new URL(value);
    if (url.hash || url.username || url.password) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && isLoopback(url.hostname);
  } catch { return false; }
}

export async function registerClient(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {error: 'invalid_client_metadata', description: 'Send client metadata as a JSON object.'} as const;
  const meta = input as Record<string, unknown>;
  const uris = meta.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every(validRedirectUri)) return {error: 'invalid_redirect_uri', description: 'redirect_uris must list 1-10 https URLs (http only for localhost).'} as const;
  const method = (meta.token_endpoint_auth_method ?? 'client_secret_basic') as AuthMethod;
  if (!AUTH_METHODS.includes(method)) return {error: 'invalid_client_metadata', description: 'Unsupported token_endpoint_auth_method.'} as const;
  const grants = (meta.grant_types ?? ['authorization_code', 'refresh_token']) as unknown[];
  if (!Array.isArray(grants) || !grants.every(g => g === 'authorization_code' || g === 'refresh_token')) return {error: 'invalid_client_metadata', description: 'Only authorization_code and refresh_token grants are supported.'} as const;
  const responses = (meta.response_types ?? ['code']) as unknown[];
  if (!Array.isArray(responses) || !responses.every(r => r === 'code')) return {error: 'invalid_client_metadata', description: 'Only the code response type is supported.'} as const;
  const name = typeof meta.client_name === 'string' && meta.client_name.trim() ? meta.client_name.trim().slice(0, 100) : 'MCP client';
  // M22: a dynamically registered client may not call itself ChatGPT, Claude, OpenAI, Anthropic or
  // Scopeflow unless every redirect URI is on that brand's verified domain.
  const reserved = reservedNameViolation(name, uris as string[]);
  if (reserved) return {error: 'reserved_name', description: reserved} as const;
  const id = 'sfc_' + crypto.randomUUID().replaceAll('-', '');
  const secret = method === 'none' ? null : 'sfs_' + crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  const now = Math.floor(Date.now() / 1000);
  await db().prepare('INSERT INTO oauth_clients (id,secret_hash,name,redirect_uris,auth_method,created) VALUES (?,?,?,?,?,?)').bind(id, secret ? await hash(secret) : null, name, JSON.stringify(uris), method, new Date().toISOString()).run();
  return {client: {client_id: id, ...(secret ? {client_secret: secret, client_secret_expires_at: 0} : {}), client_id_issued_at: now, client_name: name, redirect_uris: uris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: method}} as const;
}

// ---------------------------------------------------------------------------------------------
// M22: reserved client names. Each brand maps to the domains its redirect URIs may use.
// ---------------------------------------------------------------------------------------------
const BRANDS: Record<string, string[]> = {
  chatgpt: ['chatgpt.com', 'openai.com'],
  openai: ['openai.com', 'chatgpt.com'],
  claude: ['claude.ai', 'claude.com', 'anthropic.com'],
  anthropic: ['anthropic.com', 'claude.ai', 'claude.com'],
  scopeflow: [],
};
/** Domains whose redirect URIs count as verified for a reserved name (the CIMD allowlist plus OAUTH_VERIFIED_DOMAINS). */
export function verifiedDomains(env: Record<string, string | undefined> = process.env) {
  const list = (env.OAUTH_VERIFIED_DOMAINS ?? 'chatgpt.com,openai.com,claude.ai,claude.com,anthropic.com').split(',');
  return [...new Set([...list, ...cimdHosts(env)].map(x => x.trim().toLowerCase()).filter(Boolean))];
}
const onDomain = (host: string, domain: string) => host === domain || host.endsWith('.' + domain);
/** The reason a client name is refused, or null. Exported for tests. */
export function reservedNameViolation(name: string, redirectUris: string[], env: Record<string, string | undefined> = process.env): string | null {
  const flat = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '').replace(/0/g, 'o').replace(/1/g, 'l');
  const canonical = configuredHost(env);
  for (const [brand, domains] of Object.entries(BRANDS)) {
    if (!flat.includes(brand)) continue;
    const allowed = (brand === 'scopeflow' ? [canonical, 'scope-flow.tech'].filter((d): d is string => !!d) : domains).filter(d => brand === 'scopeflow' || verifiedDomains(env).some(v => onDomain(d, v) || onDomain(v, d)));
    const hosts = redirectUris.map(u => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } });
    if (!allowed.length || !hosts.every(h => allowed.some(d => onDomain(h, d)))) return `The name "${name}" is reserved. Register with your own app name; ${brand === 'scopeflow' ? 'Scopeflow' : brand[0].toUpperCase() + brand.slice(1)} clients connect from their own verified domain.`;
  }
  return null;
}
function configuredHost(env: Record<string, string | undefined>) {
  try { return env.APP_URL ? new URL(env.APP_URL).hostname.toLowerCase() : null; } catch { return null; }
}
/** How the consent page and the connected-apps list name a client: the host it really returns to, and whether that is verified. */
export function clientIdentity(client: OAuthClient, redirectUri?: string) {
  const host = (() => { try { return new URL(client.kind === 'cimd' ? client.id : (redirectUri ?? client.redirect_uris[0])).hostname.toLowerCase(); } catch { return 'unknown'; } })();
  const verified = client.kind === 'cimd';
  return {host, verified, label: verified ? `${client.name} (verified domain ${host})` : `${client.name} (unverified, from ${host})`};
}

function cimdHosts(env: Record<string, string | undefined> = process.env) {
  return (env.OAUTH_CIMD_HOSTS ?? 'chatgpt.com').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
}
const cimdCache = new Map<string, {client: OAuthClient; until: number}>();
/** Client ID Metadata Document: the client_id is an https URL on an allowlisted host. */
async function metadataDocumentClient(clientId: string): Promise<OAuthClient | null> {
  let url: URL;
  try { url = new URL(clientId); } catch { return null; }
  if (url.protocol !== 'https:' || url.port || url.username || url.hash || !cimdHosts().includes(url.hostname.toLowerCase())) return null;
  const cached = cimdCache.get(clientId);
  if (cached && cached.until > Date.now()) return cached.client;
  try {
    const response = await fetch(url, {redirect: 'error', signal: AbortSignal.timeout(5000), headers: {Accept: 'application/json'}});
    if (!response.ok) return null;
    const text = await response.text();
    if (text.length > 65536) return null;
    const doc = JSON.parse(text);
    if (doc.client_id !== clientId || !Array.isArray(doc.redirect_uris) || !doc.redirect_uris.length || !doc.redirect_uris.every(validRedirectUri)) return null;
    const supported: unknown[] = Array.isArray(doc.token_endpoint_auth_methods_supported) ? doc.token_endpoint_auth_methods_supported : [doc.token_endpoint_auth_method ?? 'none'];
    if (!supported.includes('none')) return null; // private_key_jwt is not implemented; PKCE public client only.
    const client: OAuthClient = {id: clientId, name: typeof doc.client_name === 'string' ? doc.client_name.slice(0, 100) : url.hostname, redirect_uris: doc.redirect_uris, auth_method: 'none', secret_hash: null, kind: 'cimd'};
    cimdCache.set(clientId, {client, until: Date.now() + 600_000});
    return client;
  } catch { return null; }
}

export async function getClient(clientId: unknown): Promise<OAuthClient | null> {
  if (typeof clientId !== 'string' || !clientId || clientId.length > 500) return null;
  if (clientId.startsWith('https://')) return metadataDocumentClient(clientId);
  const row = await db().prepare('SELECT id,name,redirect_uris,auth_method,secret_hash FROM oauth_clients WHERE id=?').bind(clientId).first<{id: string; name: string; redirect_uris: string; auth_method: AuthMethod; secret_hash: string | null}>();
  return row ? {...row, redirect_uris: JSON.parse(row.redirect_uris), kind: 'dcr' as const} : null;
}

// ---------------------------------------------------------------------------
// Authorization requests
// ---------------------------------------------------------------------------

export type AuthorizeParams = {client: OAuthClient; redirect_uri: string; state: string | null; scope: string[]; challenge: string; resource: string};
type Validation = {ok: true; params: AuthorizeParams} | {ok: false; redirect: false; message: string} | {ok: false; redirect: true; redirect_uri: string; state: string | null; error: string; description: string};

export async function validateAuthorize(request: Request, query: Record<string, string | undefined>): Promise<Validation> {
  const client = await getClient(query.client_id);
  if (!client) return {ok: false, redirect: false, message: 'This app is not registered with Scopeflow. Reconnect it from the app you came from.'};
  const redirectUri = query.redirect_uri ?? (client.redirect_uris.length === 1 ? client.redirect_uris[0] : undefined);
  if (!redirectUri || !client.redirect_uris.includes(redirectUri)) return {ok: false, redirect: false, message: 'The return address for this app does not match its registration.'};
  const state = query.state ?? null;
  const fail = (error: string, description: string): Validation => ({ok: false, redirect: true, redirect_uri: redirectUri, state, error, description});
  if (query.response_type !== 'code') return fail('unsupported_response_type', 'Only response_type=code is supported.');
  if (query.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(query.code_challenge ?? '')) return fail('invalid_request', 'PKCE with code_challenge_method=S256 is required.');
  const requested = (query.scope ?? OAUTH_SCOPES.join(' ')).split(' ').filter(Boolean);
  const scope = requested.filter(s => (OAUTH_SCOPES as readonly string[]).includes(s));
  if (!scope.length) return fail('invalid_scope', 'Request scopes:read and/or scopes:write.');
  const resource = mcpResource(request);
  if (query.resource && query.resource !== resource && query.resource !== resource + '/') return fail('invalid_target', 'This server only issues tokens for ' + resource + '.');
  return {ok: true, params: {client, redirect_uri: redirectUri, state, scope, challenge: query.code_challenge!, resource}};
}

export function redirectWith(request: Request, redirectUri: string, values: Record<string, string | null>) {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(values)) if (v !== null) url.searchParams.set(k, v);
  url.searchParams.set('iss', issuer(request));
  return url.href;
}

/** M23/M24: each consent starts a grant (token family): its code, access and refresh tokens share the id. */
export async function issueCode(params: AuthorizeParams, owner: string) {
  const code = 'sfa_' + crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  const family = 'sfg_' + crypto.randomUUID().replaceAll('-', '');
  const who = clientIdentity(params.client, params.redirect_uri);
  const now = new Date().toISOString();
  await db().batch([
    db().prepare('INSERT INTO scopeflow.oauth_grants (id,owner,client_id,client_name,domain,verified,scope,resource,created) VALUES (?,?,?,?,?,?,?,?,?)').bind(family, owner, params.client.id, params.client.name, who.host, who.verified, params.scope.join(' '), params.resource, now),
    db().prepare('INSERT INTO oauth_codes (hash,client_id,owner,redirect_uri,challenge,scope,resource,expires,family) VALUES (?,?,?,?,?,?,?,?,?)').bind(await hash(code), params.client.id, owner, params.redirect_uri, params.challenge, params.scope.join(' '), params.resource, new Date(Date.now() + CODE_TTL).toISOString(), family),
  ]);
  return code;
}

/** Revokes every token of a grant and marks it revoked (reason: user, code_replay, refresh_reuse, revoked). */
export async function revokeFamily(family: string, reason: string, owner?: string) {
  const now = new Date().toISOString();
  const where = owner ? ' AND owner=?' : '';
  const args = owner ? [family, owner] : [family];
  const [, , grant] = await db().batch([
    db().prepare('DELETE FROM oauth_tokens WHERE family=?' + where).bind(...args),
    db().prepare('DELETE FROM oauth_codes WHERE family=? AND used IS NULL' + where).bind(...args),
    db().prepare('UPDATE scopeflow.oauth_grants SET revoked=?, revoked_reason=? WHERE id=? AND revoked IS NULL' + where).bind(now, reason, ...args),
  ]);
  return grant.meta.changes > 0;
}

// ---------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------

async function pkce(verifier: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return Buffer.from(digest).toString('base64url');
}

/** Authenticates the client at the token endpoint per its registered method. */
export async function authenticateClient(request: Request, form: URLSearchParams) {
  let id = form.get('client_id'), secretValue = form.get('client_secret'), method: AuthMethod = secretValue ? 'client_secret_post' : 'none';
  const basic = /^basic\s+(.+)$/i.exec(request.headers.get('authorization') ?? '');
  if (basic) {
    const decoded = Buffer.from(basic[1], 'base64').toString('utf8');
    const split = decoded.indexOf(':');
    if (split < 0) return null;
    id = decodeURIComponent(decoded.slice(0, split));
    secretValue = decodeURIComponent(decoded.slice(split + 1));
    method = 'client_secret_basic';
  }
  const client = await getClient(id);
  if (!client) return null;
  if (client.auth_method === 'none') return method === 'none' ? client : null;
  if (method === 'none') return null; // confidential clients must authenticate (post or basic)
  if (!secretValue || !client.secret_hash || await hash(secretValue) !== client.secret_hash) return null;
  return client;
}

async function issueTokens(clientId: string, owner: string, scope: string, resource: string, family: string) {
  const access = 'sfo_' + crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  const refresh = 'sfr_' + crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  const now = new Date();
  await db().batch([
    db().prepare('INSERT INTO oauth_tokens (hash,kind,client_id,owner,scope,resource,expires,created,family) VALUES (?,?,?,?,?,?,?,?,?)').bind(await hash(access), 'access', clientId, owner, scope, resource, new Date(now.getTime() + ACCESS_TTL).toISOString(), now.toISOString(), family),
    db().prepare('INSERT INTO oauth_tokens (hash,kind,client_id,owner,scope,resource,expires,created,family) VALUES (?,?,?,?,?,?,?,?,?)').bind(await hash(refresh), 'refresh', clientId, owner, scope, resource, new Date(now.getTime() + REFRESH_TTL).toISOString(), now.toISOString(), family),
  ]);
  return {access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL / 1000, refresh_token: refresh, scope};
}

export async function exchange(request: Request, form: URLSearchParams) {
  const client = await authenticateClient(request, form);
  if (!client) return oauthError('invalid_client', 'Client authentication failed.', 401, {'WWW-Authenticate': 'Basic realm="scopeflow"'});
  const grant = form.get('grant_type');
  const resource = mcpResource(request);
  const requestedResource = form.get('resource');
  if (requestedResource && requestedResource !== resource && requestedResource !== resource + '/') return oauthError('invalid_target', 'Unknown resource.');
  const now = new Date().toISOString();
  if (grant === 'authorization_code') {
    const code = form.get('code'), verifier = form.get('code_verifier') ?? '';
    if (!code || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return oauthError('invalid_request', 'code and a valid code_verifier are required.');
    const codeHash = await hash(code);
    const row = await db().prepare('SELECT client_id,owner,redirect_uri,challenge,scope,resource,expires,family,used FROM oauth_codes WHERE hash=?').bind(codeHash).first<{client_id: string; owner: string; redirect_uri: string; challenge: string; scope: string; resource: string; expires: string; family: string | null; used: string | null}>();
    if (!row) return oauthError('invalid_grant', 'The authorization code is invalid or expired.');
    // M23: another client presenting the code is refused before anything changes, so the code stays
    // usable by the client it was issued to.
    if (row.client_id !== client.id) return oauthError('invalid_client', 'This authorization code was issued to a different client.', 401);
    const family = row.family ?? 'legacy-' + codeHash.slice(0, 32);
    const replay = () => revokeFamily(family, 'code_replay').then(() => oauthError('invalid_grant', 'This authorization code was already used; the tokens issued for it have been revoked.'));
    // A code that was already exchanged is a replay: every token it produced is revoked.
    if (row.used) return await replay();
    // S8: validate expiry, redirect_uri and PKCE before claiming, so a failed attempt by someone
    // without the verifier cannot burn the legitimate client's code.
    if (row.expires < now) return oauthError('invalid_grant', 'The authorization code is invalid or expired.');
    if (form.get('redirect_uri') !== row.redirect_uri) return oauthError('invalid_grant', 'redirect_uri does not match the authorization request.');
    if (await pkce(verifier) !== row.challenge) return oauthError('invalid_grant', 'PKCE verification failed.');
    // Single use: the first valid exchange claims the code; losing the race is a replay.
    const claimed = await db().prepare('UPDATE oauth_codes SET used=? WHERE hash=? AND used IS NULL RETURNING hash').bind(now, codeHash).first();
    if (!claimed) return await replay();
    return oauthJson(await issueTokens(client.id, row.owner, row.scope, row.resource, family));
  }
  if (grant === 'refresh_token') {
    const refresh = form.get('refresh_token');
    if (!refresh) return oauthError('invalid_request', 'refresh_token is required.');
    const refreshHash = await hash(refresh);
    const row = await db().prepare("SELECT client_id,owner,scope,resource,expires,family,rotated FROM oauth_tokens WHERE hash=? AND kind='refresh'").bind(refreshHash).first<{client_id: string; owner: string; scope: string; resource: string; expires: string; family: string | null; rotated: string | null}>();
    if (!row || row.client_id !== client.id) return oauthError('invalid_grant', 'The refresh token is invalid or expired.');
    const family = row.family ?? 'legacy-' + refreshHash.slice(0, 32);
    // M23: refresh tokens rotate. Presenting one that was already rotated means it leaked (or a
    // client is confused): the whole family is revoked and the user has to connect again.
    if (row.rotated) { await revokeFamily(family, 'refresh_reuse'); return oauthError('invalid_grant', 'This refresh token was already used; the connection has been revoked for safety. Connect again.'); }
    if (row.expires < now) return oauthError('invalid_grant', 'The refresh token is invalid or expired.');
    const requested = (form.get('scope') ?? row.scope).split(' ').filter(Boolean);
    if (!requested.every(s => row.scope.split(' ').includes(s))) return oauthError('invalid_scope', 'A refresh cannot add scopes.');
    const claimed = await db().prepare("UPDATE oauth_tokens SET rotated=? WHERE hash=? AND kind='refresh' AND rotated IS NULL RETURNING hash").bind(now, refreshHash).first();
    if (!claimed) { await revokeFamily(family, 'refresh_reuse'); return oauthError('invalid_grant', 'This refresh token was already used; the connection has been revoked for safety. Connect again.'); }
    return oauthJson(await issueTokens(client.id, row.owner, requested.join(' '), row.resource, family));
  }
  return oauthError('unsupported_grant_type', 'Use authorization_code or refresh_token.');
}

export async function revoke(request: Request, form: URLSearchParams) {
  const client = await authenticateClient(request, form);
  if (!client) return oauthError('invalid_client', 'Client authentication failed.', 401);
  const token = form.get('token');
  if (token) {
    // M23: revoking a refresh token revokes its family (every access token issued with it, RFC 7009 §2.1).
    const row = await db().prepare('SELECT kind,family FROM oauth_tokens WHERE hash=? AND client_id=?').bind(await hash(token), client.id).first<{kind: string; family: string | null}>();
    if (row?.kind === 'refresh' && row.family) await revokeFamily(row.family, 'revoked');
    else if (row) await db().prepare('DELETE FROM oauth_tokens WHERE hash=? AND client_id=?').bind(await hash(token), client.id).run();
  }
  return oauthJson({});
}

export async function readForm(request: Request) {
  const type = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  const text = await readText(request, BODY_LIMITS.oauth); // H1: bounded read
  if (type === 'application/json') {
    const value = JSON.parse(text);
    return new URLSearchParams(Object.entries(value).map(([k, v]) => [k, String(v)]));
  }
  return new URLSearchParams(text);
}

// ---------------------------------------------------------------------------------------------
// M24: the connected-apps list, one row per grant.
// ---------------------------------------------------------------------------------------------
export type GrantView = {id: string; client_id: string; name: string; domain: string; verified: boolean; scopes: string[]; created: string; last_used: string | null};
export async function listGrants(owner: string): Promise<GrantView[]> {
  const now = new Date().toISOString();
  const rows = await db().prepare(`SELECT g.id,g.client_id,g.client_name,g.domain,g.verified,g.scope,g.created,g.last_used FROM scopeflow.oauth_grants g
    WHERE g.owner=? AND g.revoked IS NULL AND EXISTS (SELECT 1 FROM oauth_tokens t WHERE t.family=g.id AND t.expires > ? AND (t.kind='access' OR t.rotated IS NULL))
    ORDER BY g.created DESC LIMIT 100`).bind(owner, now).all<{id: string; client_id: string; client_name: string; domain: string; verified: boolean; scope: string; created: string; last_used: string | null}>();
  return rows.results.map(r => ({id: r.id, client_id: r.client_id, name: r.client_name, domain: r.domain, verified: !!r.verified, scopes: r.scope.split(' ').filter(Boolean), created: r.created, last_used: r.last_used}));
}
