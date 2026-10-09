// Retention for client network data and editable wording. Live: account settings API, the
// redaction of IP/user agent on records older than the retention period (decisions and client
// ledger entries) with every signed field untouched, the database rule that only a redaction
// may change a decided context, the owner's email wording in "Send for signature", and cleanup.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {signIn, ack, requireLocalDatabase} from './support/local.mjs';
const base = process.env.SCOPEFLOW_TEST_URL || 'http://localhost:5173';
assert.equal(new URL(base).hostname, 'localhost', 'Local fixtures only.');
requireLocalDatabase();
let passed = 0;
const eq = (a, b, message) => { assert.deepEqual(a, b, message); passed++; };
const ok = (v, message) => { assert.ok(v, message); passed++; };
async function call(path, {method = 'GET', cookie, body} = {}) {
  const h = {Origin: base};
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(base + path, {method, headers: h, body: body === undefined ? undefined : JSON.stringify(body)});
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return {status: r.status, data};
}
const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
const cookie = await signIn(base, `retention-${Date.now()}@example.test`);

// Settings: defaults, validation, save.
const empty = await call('/api/settings', {cookie});
eq(empty.data.settings, {context_retention_days: null, email_subject: '', email_body: '', default_exclusions: '', default_terms: '', draft_expiry_days: null});
eq((await call('/api/settings')).status, 401);
const wording = {context_retention_days: null, email_subject: 'Sign {title} (v{version})', email_body: 'Hi {client},\n\nYour scope: {link}', default_exclusions: 'Hosting and SEO', default_terms: 'Balance due within 15 days.', draft_expiry_days: null};
eq((await call('/api/settings', {method: 'PUT', cookie, body: {...wording, email_body: 'no link'}})).status, 400);
eq((await call('/api/settings', {method: 'PUT', cookie, body: {...wording, context_retention_days: 0}})).status, 400);
eq((await call('/api/settings', {method: 'PUT', cookie, body: wording})).data.settings, wording);

// A fresh decision through the API, plus fixtures decided long ago for the same owner.
const created = await call('/api/scopes', {method: 'POST', cookie, body: {title: 'Retention fixture ' + randomUUID().slice(0, 8), client: 'Acme', deliverables: 'Logo design suite', exclusions: '', fee: 100, currency: 'USD', revisions: 1, due: '', notes: ''}});
const {project_id, token} = created.data.scope;
eq((await call('/api/review/' + token, {method: 'POST', body: await ack(base, token, {decision: 'approved', signer: 'Ada', comment: '', version: 1}), headers: {}})).status, 200);
const owner = (await db.query('SELECT owner FROM scopeflow.projects WHERE id=$1', [project_id])).rows[0].owner;
const old = 'old-' + randomUUID();
const oldContext = JSON.stringify({channel: 'review_link', ip: '203.0.113.9', user_agent: 'Old Browser/1.0', owner_session: false, via_api: false, acknowledged: true});
await db.query(`INSERT INTO scopeflow.projects (id,owner,latest,created) VALUES ($1,$2,1,'2025-01-01T00:00:00.000Z')`, [old, owner]);
await db.query(`INSERT INTO scopeflow.versions (id,project_id,version,token,content,status,signer,comment,created,decided,signature,decision_context) VALUES ($1||'-v1',$1,1,md5($1)||md5($1||'x'),'{"title":"Old"}','approved','Old Signer','','2025-01-01T00:00:00.000Z','2025-01-02T00:00:00.000Z','kid.sig',$2)`, [old, oldContext]);
await db.query(`INSERT INTO scopeflow.ledger_entries (id,project_id,seq,kind,baseline_version,actor,payload,ref,prev_hash,hash,created,signature,context) VALUES ($1||'-e1',$1,1,'settle',1,'client','{"ref_seq":1}','settle:1',repeat('0',64),repeat('a',64),'2025-01-03T00:00:00.000Z','kid.s1',$2)`, [old, oldContext]);
const snapshot = async () => (await db.query(`SELECT v.content,v.signer,v.decided,v.signature,v.status,v.decision_context,e.payload,e.hash,e.signature AS esig,e.context FROM scopeflow.versions v JOIN scopeflow.ledger_entries e ON e.project_id=v.project_id WHERE v.project_id=$1`, [old])).rows[0];
const before = await snapshot();

// Database rule: without the redact flag nothing changes; with it, only a redaction is accepted.
async function attempt(sqlText, params, redact) {
  await db.query('BEGIN');
  try { if (redact) await db.query(`SELECT set_config('scopeflow.redact','on',true)`); await db.query(sqlText, params); return 'ok'; }
  catch (e) { return e.code; } finally { await db.query('ROLLBACK'); }
}
const redacted = JSON.stringify({...JSON.parse(oldContext), ip: 'redacted', user_agent: 'redacted', redacted_at: '2026-10-07T00:00:00.000Z'});
eq(await attempt('UPDATE scopeflow.versions SET decision_context=$1 WHERE id=$2', [redacted, old + '-v1'], false), 'P0001');
eq(await attempt('UPDATE scopeflow.versions SET decision_context=$1 WHERE id=$2', [redacted, old + '-v1'], true), 'ok');
eq(await attempt('UPDATE scopeflow.versions SET decision_context=$1 WHERE id=$2', [JSON.stringify({...JSON.parse(redacted), owner_session: true}), old + '-v1'], true), 'P0001');
eq(await attempt('UPDATE scopeflow.versions SET decision_context=$1 WHERE id=$2', [JSON.stringify({...JSON.parse(oldContext), ip: '198.51.100.1'}), old + '-v1'], true), 'P0001');
eq(await attempt('UPDATE scopeflow.versions SET decision_context=$1 WHERE id=$2', ['not json', old + '-v1'], true), 'P0001');
eq(await attempt('UPDATE scopeflow.versions SET signer=$1 WHERE id=$2', ['Forged', old + '-v1'], true), 'P0001');
eq(await attempt('UPDATE scopeflow.ledger_entries SET context=$1 WHERE id=$2', [redacted, old + '-e1'], false), 'P0001');
eq(await attempt('UPDATE scopeflow.ledger_entries SET context=$1 WHERE id=$2', [redacted, old + '-e1'], true), 'ok');
eq(await attempt('UPDATE scopeflow.ledger_entries SET context=$1, payload=$2 WHERE id=$3', [redacted, '{"ref_seq":2}', old + '-e1'], true), 'P0001');

// No retention set: nothing is redacted. Then 30 days: old records are redacted, the fresh one is not.
await call('/api/scopes', {cookie});
eq((await snapshot()).decision_context, before.decision_context);
const saved = await call('/api/settings', {method: 'PUT', cookie, body: {...wording, context_retention_days: 30}});
eq(saved.status, 200); eq(saved.data.redacted, {versions: 1, entries: 1});
{
  const after = await snapshot();
  for (const k of ['content', 'signer', 'decided', 'signature', 'status', 'payload', 'hash', 'esig']) eq(after[k], before[k], k + ' unchanged');
  const ctx = JSON.parse(after.decision_context), ectx = JSON.parse(after.context);
  eq([ctx.ip, ctx.user_agent, ectx.ip, ectx.user_agent], ['redacted', 'redacted', 'redacted', 'redacted']);
  eq(ctx.acknowledged, true); ok(!!ctx.redacted_at, 'redacted_at');
  const fresh = JSON.parse((await db.query('SELECT decision_context FROM scopeflow.versions WHERE project_id=$1', [project_id])).rows[0].decision_context);
  ok(fresh.ip !== 'redacted' && fresh.user_agent !== 'redacted', 'recent decision keeps its network details');
  eq((await call('/api/settings', {method: 'PUT', cookie, body: {...wording, context_retention_days: 30}})).data.redacted, {versions: 0, entries: 0}); // idempotent
}

// The owner's wording is used by "Send for signature" (mailto fallback in CI).
{
  const second = await call('/api/scopes', {method: 'POST', cookie, body: {title: 'Wording fixture', client: 'Acme Co', deliverables: 'Logo design suite', exclusions: '', fee: 100, currency: 'USD', revisions: 1, due: '', notes: ''}});
  const send = await call(`/api/scopes/${second.data.scope.project_id}/send`, {method: 'POST', cookie, body: {version: 1, email: 'client@example.test'}});
  eq(send.status, 200); eq(send.data.sent, false);
  const mailto = new URL(send.data.mailto);
  eq(mailto.searchParams.get('subject'), 'Sign Wording fixture (v1)');
  eq(mailto.searchParams.get('body'), `Hi Acme Co,\n\nYour scope: ${send.data.review_url}\n\nSent with Scopeflow`);
}

// Account deletion removes the settings row (and the fixtures).
eq((await call('/api/account', {method: 'DELETE', cookie, body: {confirmation: 'DELETE'}})).status, 200);
eq((await db.query('SELECT COUNT(*)::int AS n FROM scopeflow.account_settings WHERE owner=$1', [owner])).rows[0].n, 0);
await db.end();
console.log(`retention: ${passed} checks passed`);
