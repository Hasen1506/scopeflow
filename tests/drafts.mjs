// Unsaved scope drafts kept with the account (/api/unsaved-draft): one per account, browser sessions only,
// never readable or writable by another account, writes bound to the account they were typed in,
// removed by account deletion and by the daily job after 90 days without an edit.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {signIn, localSql} from './support/local.mjs';
const base = process.env.SCOPEFLOW_TEST_URL || 'http://localhost:5173';
assert.equal(new URL(base).hostname, 'localhost', 'Local fixtures only.');
let passed = 0;
const eq = (a, b, message) => { assert.deepEqual(a, b, message); passed++; };
const ok = (v, message) => { assert.ok(v, message); passed++; };
async function call(path, {method = 'GET', cookie, body, headers = {}} = {}) {
  const h = {Origin: base, ...headers};
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(base + path, {method, headers: h, body: body === undefined ? undefined : JSON.stringify(body)});
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return {status: r.status, data};
}
const rows = sql => localSql(sql)[0].results;
const q = v => "'" + String(v).replaceAll("'", "''") + "'";
const draft = title => ({title, client: 'Northwind', deliverables: '', items: [{id: 'i1', title: 'Logo', qty: 1, unit: '', price: 500, acceptance: ''}], client_inputs: [], exclusions: '', fee: 500, currency: 'USD', revisions: 2, due: '', notes: ''});
const owner = async tag => { const cookie = await signIn(base, `drafts-${tag}-${randomUUID()}@example.test`); const me = await call('/api/me', {cookie}); return {cookie, account: me.data.account}; };

const a = await owner('a'), b = await owner('b');
ok(/^[0-9a-f]{24}$/.test(a.account) && a.account !== b.account, 'each account has its own opaque key');

// Signed out: no draft service.
eq((await call('/api/unsaved-draft')).status, 401);
eq((await call('/api/unsaved-draft', {method: 'PUT', body: {account: a.account, content: draft('x')}})).status, 401);

// Empty, then saved, then read back (also from a "second device": a fresh sign-in of the same account).
eq((await call('/api/unsaved-draft', {cookie: a.cookie})).data, {draft: null, updated: null});
const put = await call('/api/unsaved-draft', {method: 'PUT', cookie: a.cookie, body: {account: a.account, content: {...draft('Alpha rebrand'), stray: 'dropped', items: [{id: 'i1', title: 'Logo', qty: 1, unit: '', price: 500, acceptance: ''}, {bad: true}]}}});
eq(put.status, 200, JSON.stringify(put.data));
const got = await call('/api/unsaved-draft', {cookie: a.cookie});
eq([got.data.draft.title, got.data.updated, 'stray' in got.data.draft, got.data.draft.items.length], ['Alpha rebrand', put.data.updated, false, 1], 'unknown fields and malformed rows are dropped');
const again = await call('/api/unsaved-draft', {method: 'PUT', cookie: a.cookie, body: {account: a.account, content: draft('Alpha rebrand v2')}});
eq(again.status, 200);
eq(rows(`SELECT COUNT(*) AS n FROM scopeflow.drafts WHERE content LIKE '%Alpha rebrand%'`)[0].n, 1, 'one draft per account');

// Another account sees nothing of it and cannot write into it.
eq((await call('/api/unsaved-draft', {cookie: b.cookie})).data.draft, null, 'B never sees A’s draft');
const cross = await call('/api/unsaved-draft', {method: 'PUT', cookie: b.cookie, body: {account: a.account, content: draft('Beta overwrite')}});
eq([cross.status, cross.data.code], [409, 'account_changed'], 'a write typed in account A is refused once the browser is signed in as B');
eq((await call('/api/unsaved-draft?account=' + a.account, {method: 'DELETE', cookie: b.cookie})).status, 409);
eq((await call('/api/unsaved-draft', {cookie: a.cookie})).data.draft.title, 'Alpha rebrand v2', 'A’s draft is untouched');

// Input checks, cross-site writes and API tokens.
eq((await call('/api/unsaved-draft', {method: 'PUT', cookie: a.cookie, body: {account: a.account, content: {title: 1}}})).status, 400);
eq((await call('/api/unsaved-draft', {method: 'PUT', cookie: a.cookie, body: {account: a.account}})).status, 400);
eq((await call('/api/unsaved-draft', {method: 'PUT', cookie: a.cookie, headers: {Origin: 'https://evil.example'}, body: {account: a.account, content: draft('x')}})).status, 403);
const key = await call('/api/key', {method: 'POST', cookie: a.cookie});
eq(key.status, 200);
eq((await call('/api/unsaved-draft', {headers: {Authorization: 'Bearer ' + key.data.token}})).status, 401, 'API tokens have no draft access');

// Autosave has its own write budget: it never uses up the owner's limit for real changes.
ok(rows(`SELECT COUNT(*) AS n FROM scopeflow.rate_limits WHERE id LIKE 'draft:%'`)[0].n >= 1, 'draft writes are counted separately');

// Discarding it.
eq((await call('/api/unsaved-draft?account=' + a.account, {method: 'DELETE', cookie: a.cookie})).data, {deleted: true});
eq((await call('/api/unsaved-draft', {cookie: a.cookie})).data.draft, null);

// 90 days without an edit: hidden at once, removed by the daily job.
await call('/api/unsaved-draft', {method: 'PUT', cookie: b.cookie, body: {account: b.account, content: draft('Beta stale')}});
localSql(`UPDATE scopeflow.drafts SET updated='2020-01-01T00:00:00.000Z' WHERE content LIKE '%Beta stale%'`);
eq((await call('/api/unsaved-draft', {cookie: b.cookie})).data.draft, null, 'a stale draft is not restored');
const job = spawnSync(process.execPath, ['scripts/redact-expired.mjs'], {encoding: 'utf8', env: process.env});
eq(job.status, 0, job.stderr);
const out = JSON.parse(job.stdout.trim().split('\n').pop());
ok(out.stale_unsaved_drafts >= 1, job.stdout);
eq(rows(`SELECT COUNT(*) AS n FROM scopeflow.drafts WHERE content LIKE '%Beta stale%'`)[0].n, 0);

// Account deletion removes the draft.
await call('/api/unsaved-draft', {method: 'PUT', cookie: a.cookie, body: {account: a.account, content: draft('Alpha before deletion')}});
eq((await call('/api/account', {method: 'DELETE', cookie: a.cookie, body: {confirmation: 'DELETE'}})).status, 200);
eq(rows(`SELECT COUNT(*) AS n FROM scopeflow.drafts WHERE content LIKE ${q('%Alpha before deletion%')}`)[0].n, 0, 'account deletion removes the draft');

console.log(JSON.stringify({passed, suite: 'drafts'}));
