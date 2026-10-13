import {test, expect, type APIRequestContext} from '@playwright/test';
import {createHash, randomBytes} from 'node:crypto';

// M22: the consent page names the host the code goes to and marks dynamically registered apps as
// unverified. M24: connected apps are listed per grant; disconnecting one leaves the other.
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const redirect = 'https://agent.example/callback';

async function signUp(request: APIRequestContext, baseURL: string, email: string) {
  const headers = {'Content-Type': 'application/json', Origin: baseURL};
  await request.post('/api/auth/sign-up/email', {headers, data: {name: 'Fictional QA', email, password: 'Fictional-password-123'}});
  const r = await request.post('/api/auth/sign-in/email', {headers, data: {email, password: 'Fictional-password-123'}});
  expect(r.status()).toBe(200);
}
async function registerClient(request: APIRequestContext, name: string) {
  const r = await request.post('/oauth/register', {data: {client_name: name, redirect_uris: [redirect], token_endpoint_auth_method: 'none'}});
  expect(r.status()).toBe(201);
  return (await r.json()).client_id as string;
}
const authorizeQuery = (clientId: string, baseURL: string) => new URLSearchParams({response_type: 'code', client_id: clientId, redirect_uri: redirect, state: 'st', scope: 'scopes:read', code_challenge: challenge, code_challenge_method: 'S256', resource: baseURL + '/mcp'});

// @covers M22
test('consent page: headline names the return host, DCR clients carry an "unverified" badge', async ({page, baseURL}) => {
  await signUp(page.request, baseURL!, `ws10-consent-${Date.now()}@example.test`);
  const clientId = await registerClient(page.request, 'Totally Legit Helper');
  await page.goto('/oauth/authorize?' + authorizeQuery(clientId, baseURL!));
  await expect(page.getByRole('heading', {level: 1})).toHaveText('Allow agent.example to use your Scopeflow account?');
  await expect(page.getByTestId('client-unverified')).toHaveText(/Unverified · from agent\.example/);
  await expect(page.getByTestId('consent-client')).toContainText('Totally Legit Helper');
  await expect(page.getByTestId('client-verified')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Allow access'})).toBeVisible();
});

// @covers M24
test('connected apps: two grants from the same client name are listed separately; disconnecting one leaves the other', async ({page, baseURL}) => {
  await signUp(page.request, baseURL!, `ws10-grants-${Date.now()}@example.test`);
  // Two different registrations that share a name (as two devices of the same app would).
  const tokens: string[] = [];
  for (let i = 0; i < 2; i++) {
    const clientId = await registerClient(page.request, 'TEST Pocket Agent');
    const form = Object.fromEntries([...authorizeQuery(clientId, baseURL!)]);
    const approve = await page.request.post('/api/oauth/authorize', {headers: {Origin: baseURL!}, form: {...form, decision: 'approve'}, maxRedirects: 0});
    expect(approve.status()).toBe(303);
    const code = new URL(approve.headers().location).searchParams.get('code')!;
    const t = await page.request.post('/oauth/token', {form: {grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect, client_id: clientId, resource: baseURL + '/mcp'}});
    expect(t.status()).toBe(200);
    tokens.push((await t.json()).access_token);
  }
  const mcp = (token: string) => page.request.post('/mcp', {headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'}, data: {jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'list_scopes', arguments: {}}}});
  await page.goto('/connect');
  const apps = page.getByTestId('connected-app');
  await expect(apps).toHaveCount(2);
  await expect(apps.first()).toContainText('TEST Pocket Agent');
  await expect(apps.first()).toContainText('Unverified · agent.example');
  await expect(apps.nth(1)).toContainText('TEST Pocket Agent');
  const firstGrant = await apps.first().getAttribute('data-grant');
  await apps.first().getByRole('button', {name: /^Disconnect TEST Pocket Agent/}).click();
  await expect(page.getByRole('status')).toContainText('disconnected');
  await expect(apps).toHaveCount(1);
  await expect(apps.first()).not.toHaveAttribute('data-grant', firstGrant!);
  await page.reload();
  await expect(page.getByTestId('connected-app')).toHaveCount(1);
  // Exactly one of the two tokens still works.
  const statuses = (await Promise.all(tokens.map(mcp))).map(r => r.status()).sort();
  expect(statuses).toEqual([200, 401]);
});
