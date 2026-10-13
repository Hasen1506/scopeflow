import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { signIn } from './support/local.mjs';
const base = process.env.SCOPEFLOW_TEST_URL || 'http://localhost:5173';
assert.equal(new URL(base).hostname, 'localhost');
let passed = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); passed++; };
const email = 'qa-' + randomUUID() + '@example.test';
const password = 'Fictional-password-123';
const headers = { 'Content-Type': 'application/json', Origin: base };
const signup = await fetch(base + '/api/auth/sign-up/email', { method: 'POST', headers, body: JSON.stringify({ name: 'Fictional User', email, password }) });
check(signup.status, 200);
const cookie = await signIn(base, email, password);
const me = await fetch(base + '/api/me', { headers: { Cookie: cookie } });
check(me.status, 200); const meBody = await me.json(); check(meBody.signedIn, true);
// The browser keys unsaved drafts by this opaque per-account value (never the user id or email).
check(/^[0-9a-f]{24}$/.test(meBody.account), true);
const unauthorized = await fetch(base + '/api/scopes', { headers: { 'oai-authenticated-user-id': 'spoofed', 'oai-authenticated-user-email': email, Cookie: '__sites_local_auth=1' } });
check(unauthorized.status, 401);
const wrong = await fetch(base + '/api/auth/sign-in/email', { method: 'POST', headers, body: JSON.stringify({ email, password: 'Wrong-password-123' }) });
check(wrong.status, 401);
const forged = await fetch(base + '/api/scopes', { headers: { Cookie: '__Secure-neon-auth.session_token=forged; __Secure-neon-auth.local.session_data=forged' } });
check(forged.status, 401);
const crossOrigin = await fetch(base + '/api/auth/sign-in/email', { method: 'POST', headers: { ...headers, Origin: 'https://untrusted.example' }, body: JSON.stringify({ email, password }) });
check(crossOrigin.status, 403);
const signout = await fetch(base + '/api/auth/sign-out', { method: 'POST', headers: { ...headers, Cookie: cookie }, body: '{}' });
check(signout.status, 200);
// Replay both original signed cookies after logout: state-changing routes verify
// the upstream session instead of accepting the still-valid cached user data.
// changed by WS-10 (M27): reads may use Neon Auth's signed session cache for up to 60 s
// (SESSION_CACHE_SECONDS), so the revocation check is a write; every write still asks Neon.
const replay = await fetch(base + '/api/scopes', { method: 'POST', headers: { ...headers, Cookie: cookie }, body: JSON.stringify({ title: 'TEST replay after sign-out' }) });
check(replay.status, 401);
const page = await fetch(base + '/auth/sign-in?return_to=https://untrusted.example');
check(page.status, 200); assert.ok((await page.text()).includes('Welcome back')); passed++;
console.log(JSON.stringify({ passed, suite: 'auth', signupAndLogin: true, logoutRevocation: true, forgedIdentityRejected: true, originProtection: true }));
