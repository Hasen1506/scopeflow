import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

export function requireLocalDatabase() {
  assert.ok(process.env.DATABASE_URL, 'Set DATABASE_URL to a disposable local PostgreSQL database');
  const destination = new URL(process.env.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(destination.hostname), 'Tests must not modify a remote database');
  assert.equal(destination.pathname, '/scopeflow_test', 'Use the dedicated scopeflow_test database');
}
export async function signIn(base, email = 'scopeflow-qa@example.test', password = 'Fictional-password-123') {
  assert.equal(new URL(base).hostname, 'localhost');
  const config = new URL(process.env.NEON_AUTH_BASE_URL || '');
  assert.ok(['localhost', '127.0.0.1'].includes(config.hostname), 'Use the local auth fixture, not real accounts');
  const headers = { 'Content-Type': 'application/json', Origin: base };
  const created = await fetch(base + '/api/auth/sign-up/email', {
    method: 'POST', headers, body: JSON.stringify({ name: 'Fictional QA', email, password }),
  });
  assert.ok([200, 400, 422].includes(created.status), 'Auth fixture signup failed');
  const response = await fetch(base + '/api/auth/sign-in/email', { method: 'POST', headers, body: JSON.stringify({ email, password }) });
  assert.equal(response.status, 200, await response.clone().text());
  const cookie = response.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ');
  assert.ok(cookie.includes('session_token='));
  return cookie;
}
export function localSql(command) {
  requireLocalDatabase();
  const result = spawnSync(process.execPath, ['tests/support/sql.mjs'], { input: command, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return JSON.parse(result.stdout);
}
