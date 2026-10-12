// Helpers for the live suites: a running local server (SCOPEFLOW_TEST_URL, default
// http://localhost:5173), the local auth fixture and the disposable scopeflow_test database.
// Nothing here reaches beyond localhost.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {requireLocalDatabase, signIn} from '../support/local.mjs';
import {SEED} from '../support/property.mjs';

export const base = process.env.SCOPEFLOW_TEST_URL || 'http://localhost:5173';
assert.equal(new URL(base).hostname, 'localhost', 'Live suites run only against a local server.');
requireLocalDatabase();

/** A superuser connection to the test database (the app's own tables live in schema scopeflow). */
export async function database() {
  const client = new pg.Client({connectionString: process.env.DATABASE_URL});
  await client.connect();
  return client;
}
/** A fresh fictional owner per suite and seed, so reruns never collide. */
export async function owner(label) {
  const email = `${label}-${SEED}-${process.pid}@example.test`;
  return {email, cookie: await signIn(base, email)};
}
export async function call(path, {method = 'GET', cookie, body, headers = {}, raw} = {}) {
  const r = await fetch(base + path, {method, redirect: 'manual', headers: {...(cookie ? {cookie} : {}), ...(body !== undefined || raw !== undefined ? {'Content-Type': 'application/json'} : {}), ...headers}, body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined});
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = {text}; }
  return {status: r.status, json};
}
// changed by WS-10 (M26): read limits live in the server's memory, not in scopeflow.rate_limits, so
// clearing the limits also asks the local test server to drop its in-memory read windows.
export async function clearLimits(db) {
  await db.query('DELETE FROM scopeflow.rate_limits');
  const operator = process.env.SCOPEFLOW_ADMIN_TOKEN || process.env.SCOPEFLOW_CRON_SECRET;
  if (operator) await fetch(base + '/api/readiness?scope=read-limits', {method: 'DELETE', headers: {Authorization: 'Bearer ' + operator}}).catch(() => {});
}
export const sha = value => createHash('sha256').update(value).digest('hex');
export const scope = (title, extra = {}) => ({title, client: 'Fictional Client', deliverables: '', items: [{id: 'logo', title: 'Logo suite', qty: 1, unit: '', price: 900, acceptance: ''}, {id: 'guide', title: 'Brand guidelines', qty: 12, unit: 'pages', price: 600, acceptance: ''}], client_inputs: [], exclusions: 'Social media templates', fee: 1500, currency: 'USD', revisions: 2, due: '2027-01-15', notes: 'Fictional test record.', ...extra});

/** Creates a project; with approve=true the client approves it through its review link. */
export async function project(o, title, {approve = false} = {}) {
  const created = await call('/api/scopes', {method: 'POST', cookie: o.cookie, body: scope(title)});
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const {project_id, token} = created.json.scope;
  if (approve) await decide(token, 'approved');
  return {project_id, token};
}
export async function decide(token, decision, signer = 'Fictional Client') {
  const view = await call('/api/review/' + token);
  const r = await call('/api/review/' + token, {method: 'POST', body: {decision, signer, comment: decision === 'approved' ? '' : 'Please change it', version: view.json.scope.version, acknowledged: true, content_sha256: sha(JSON.stringify(view.json.scope.content))}});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json;
}
export async function changeOrder(o, project_id, fee_delta = 400, title = 'Instagram templates') {
  const r = await call(`/api/scopes/${project_id}/ledger`, {method: 'POST', cookie: o.cookie, body: {kind: 'change_order', baseline_version: 1, payload: {title, add_items: [{id: 'co_' + Math.abs(fee_delta) + '_' + title.length, title}], fee_delta}}});
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.seq;
}
