// WS-10 end to end against the local server, the local doubles and the disposable database:
// spoofed X-Forwarded-For (H3), reads without writes (M26), one session lookup per request and warm
// review latency (M27), idempotent retries (M28), health vs readiness and the canonical host
// (M30, H16), the cron runner (M31), the signed head digest and timestamps (C7), analytics (SF-14)
// and the new MCP tools (SF-26). Run by tests/run-local.mjs; needs the server started with the CI
// env (SCOPEFLOW_TRUSTED_HOPS=1, SCOPEFLOW_CRON_SECRET, SCOPEFLOW_TSA_URL).
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import pg from 'pg';
import {signIn, ack, requireLocalDatabase} from './support/local.mjs';

const base = process.env.SCOPEFLOW_TEST_URL || 'http://localhost:5173';
assert.equal(new URL(base).hostname, 'localhost', 'Local fixtures only.');
requireLocalDatabase();
for (const k of ['SCOPEFLOW_CRON_SECRET', 'SCOPEFLOW_TSA_URL']) assert.ok(process.env[k], `Run with ${k} set (see .github/workflows/ci.yml).`);
assert.equal(process.env.SCOPEFLOW_TRUSTED_HOPS, '1', 'Run the server and this suite with SCOPEFLOW_TRUSTED_HOPS=1 (as on Render).');
const admin = {Authorization: 'Bearer ' + process.env.SCOPEFLOW_CRON_SECRET};
let passed = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); passed++; };
const ok = (v, m) => { assert.ok(v, m); passed++; };
async function call(path, {method = 'GET', cookie, body, headers = {}, url = base} = {}) {
  const h = {Origin: url, ...headers};
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(url + path, {method, headers: h, redirect: 'manual', body: body === undefined ? undefined : JSON.stringify(body)});
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return {status: r.status, data, headers: r.headers};
}
const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const scope = (title, extra = {}) => ({title, client: 'Fictional Client', deliverables: '', items: [{id: 'logo', title: 'Logo suite', qty: 1, unit: '', price: 1000, acceptance: ''}], client_inputs: [], exclusions: 'Print', fee: 1000, currency: 'INR', revisions: 1, due: '', notes: 'TEST WS-10 record.', ...extra});
async function project(cookie, title, {approve = false} = {}) {
  const r = await call('/api/scopes', {method: 'POST', cookie, body: scope(title)});
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const {project_id, token} = r.data.scope;
  if (approve) {
    const d = await call('/api/review/' + token, {method: 'POST', body: await ack(base, token, {decision: 'approved', signer: 'Fictional Client', comment: '', version: 1})});
    assert.equal(d.status, 200, JSON.stringify(d.data));
  }
  return {project_id, token};
}
const owner = await signIn(base, `ws10-${Date.now()}@example.test`);

// ---------------------------------------------------------------------------------------------
// @covers H3 — live-test scenario #8: 330 GETs with a changing spoofed first X-Forwarded-For hop.
// Before the fix every one was keyed on the attacker-chosen first entry and returned 200.
// ---------------------------------------------------------------------------------------------
{
  const {token} = await project(owner, 'TEST WS-10 spoofed XFF');
  const real = `198.51.100.${Math.floor(Math.random() * 200) + 20}`;
  const statuses = [];
  for (let i = 0; i < 330; i += 30) {
    const batch = await Promise.all(Array.from({length: Math.min(30, 330 - i)}, (_, j) => fetch(base + '/api/review/' + token, {headers: {'X-Forwarded-For': `10.${(i + j) % 250}.${j}.7, ${real}`}}).then(r => r.status)));
    statuses.push(...batch);
  }
  const limited = statuses.filter(s => s === 429).length;
  ok(limited >= 30, `expected >= 30 x 429, got ${limited} (${JSON.stringify(Object.groupBy(statuses, s => s))})`);
  eq(statuses.filter(s => s === 200).length + limited, 330);
  // Another client (a different real address) is unaffected by that client's limit.
  eq((await fetch(base + '/api/review/' + token, {headers: {'X-Forwarded-For': '6.6.6.6, 203.0.113.250'}})).status, 200);
}

// ---------------------------------------------------------------------------------------------
// @covers M26 — GET /api/scopes x 50 writes nothing (no rate-limit upsert, no redaction on list).
// ---------------------------------------------------------------------------------------------
{
  await project(owner, 'TEST WS-10 read-only list');
  // Backends flush table statistics lazily: a backend that flushed less than a second ago holds the
  // next counts until it has been idle for up to 10 s (PGSTAT_IDLE_INTERVAL). So a reading only
  // counts once the counters have not moved for longer than that, before and after the reads.
  const read = async () => { await db.query('SELECT pg_stat_clear_snapshot()'); const rows = (await db.query("SELECT relname, n_tup_ins::bigint AS ins, n_tup_upd::bigint AS upd, n_tup_del::bigint AS del FROM pg_stat_user_tables WHERE schemaname='scopeflow'")).rows; return Object.fromEntries(rows.map(r => [r.relname, {ins: Number(r.ins), upd: Number(r.upd), del: Number(r.del)}])); };
  const counters = async () => { let last = await read(), since = Date.now(); const deadline = Date.now() + 60_000; while (Date.now() < deadline) { await sleep(1000); const now = await read(); if (JSON.stringify(now) !== JSON.stringify(last)) { last = now; since = Date.now(); } else if (Date.now() - since > 11_000) break; } return last; };
  const total = c => Object.values(c).reduce((t, r) => ({ins: t.ins + r.ins, upd: t.upd + r.upd, del: t.del + r.del}), {ins: 0, upd: 0, del: 0});
  const changed = (a, b) => Object.fromEntries(Object.entries(b).map(([t, r]) => [t, {ins: r.ins - (a[t]?.ins ?? 0), upd: r.upd - (a[t]?.upd ?? 0), del: r.del - (a[t]?.del ?? 0)}]).filter(([, d]) => d.ins || d.upd || d.del));
  await call('/api/scopes', {cookie: owner}); // warm
  const before = await counters();
  for (let i = 0; i < 50; i++) eq((await call('/api/scopes', {cookie: owner})).status, 200);
  const after = await counters();
  const [b, a] = [total(before), total(after)];
  eq({ins: a.ins - b.ins, upd: a.upd - b.upd, del: a.del - b.del}, {ins: 0, upd: 0, del: 0}, 'GET /api/scopes x 50 wrote to the database: ' + JSON.stringify(changed(before, after)));
}

// ---------------------------------------------------------------------------------------------
// @covers M27 — warm review GET p95 under 300 ms (one session lookup per request, cookie cache for reads).
// ---------------------------------------------------------------------------------------------
{
  const {token} = await project(owner, 'TEST WS-10 latency', {approve: true});
  for (let i = 0; i < 5; i++) await fetch(base + '/api/review/' + token, {headers: {Cookie: owner, 'X-Forwarded-For': '203.0.113.77'}});
  const times = [];
  for (let i = 0; i < 40; i++) {
    const t = performance.now();
    const r = await fetch(base + '/api/review/' + token, {headers: {Cookie: owner, 'X-Forwarded-For': '203.0.113.77'}});
    await r.arrayBuffer();
    times.push(performance.now() - t);
    eq(r.status, 200);
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(times.length * 0.95) - 1];
  ok(p95 < 300, `p95 GET /api/review/<t> = ${p95.toFixed(1)} ms`);
}

// ---------------------------------------------------------------------------------------------
// @covers C7 — the decision anchor gets an RFC 3161 token from the local TSA double, and the daily
// head digest is signed, timestamped, immutable and verifiable.
// ---------------------------------------------------------------------------------------------
{
  const {project_id} = await project(owner, 'TEST WS-10 timestamped', {approve: true});
  let stamp;
  for (let i = 0; i < 40 && !stamp; i++) { stamp = await one("SELECT subject, tsa, token FROM scopeflow.timestamps WHERE project_id=$1 AND subject='decision'", [project_id]); if (!stamp) await sleep(250); }
  ok(stamp && stamp.token.length > 100, 'decision anchor carries a TSA token');
  const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
  eq((await call(`/api/heads/${new Date().toISOString().slice(0, 10)}`)).status, 409, 'today is not final');
  eq((await call('/api/heads/2026-13-01')).status, 400);
  eq((await call(`/api/heads/${yesterday}`, {method: 'POST'})).status, 401, 'publishing needs the operator token');
  const published = await call(`/api/heads/${yesterday}`, {method: 'POST', headers: admin});
  eq(published.status, 201, JSON.stringify(published.data));
  ok(published.data.signature && published.data.tsa_token, 'signed and timestamped');
  const again = await call(`/api/heads/${yesterday}`, {method: 'POST', headers: admin});
  eq(again.data.digest, published.data.digest, 'publishing is idempotent');
  const read = await call(`/api/heads/${yesterday}?project=${project_id}`);
  eq([read.status, read.data.published, read.data.signature_state, read.data.digest], [200, true, 'valid', published.data.digest]);
  ok(read.headers.get('cache-control').includes('immutable'));
  const lines = read.data.heads.map(h => `${h.p} ${h.seq} ${h.hash}`).sort();
  eq(createHash('sha256').update(lines.join('\n')).digest('hex'), read.data.digest, 'anyone can recompute the digest');
  await assert.rejects(db.query('UPDATE scopeflow.head_digests SET digest=$1 WHERE date=$2', ['0'.repeat(64), yesterday]), /immutable/); passed++;
}

// ---------------------------------------------------------------------------------------------
// @covers SF-14 — a decision records exactly one analytics event, with no email or IP in it; an
// owner who opts out records nothing more.
// ---------------------------------------------------------------------------------------------
{
  const {project_id, token} = await project(owner, 'TEST WS-10 analytics');
  await fetch(base + '/api/review/' + token, {headers: {'X-Forwarded-For': '203.0.113.88'}});
  const d = await call('/api/review/' + token, {method: 'POST', headers: {'X-Forwarded-For': '203.0.113.88'}, body: await ack(base, token, {decision: 'approved', signer: 'Ada Client', comment: '', version: 1})});
  eq(d.status, 200);
  const events = (await db.query('SELECT event, owner, project_id, props::text AS props FROM scopeflow.analytics_events WHERE project_id=$1 ORDER BY id', [project_id])).rows;
  eq(events.filter(e => e.event === 'decision').length, 1, JSON.stringify(events));
  ok(events.some(e => e.event === 'link_opened'), 'link_opened recorded');
  const text = JSON.stringify(events);
  ok(!text.includes('@') && !text.includes('203.0.113.88') && !text.includes('Ada Client') && !text.includes('Fictional Client'), text);
  const mine = await call('/api/analytics', {cookie: owner});
  eq([mine.status, mine.data.opted_out], [200, false]);
  ok(mine.data.funnel.find(f => f.event === 'decision').count >= 1);
  const funnel = await call('/api/analytics', {headers: admin});
  ok(funnel.data.funnel.find(f => f.event === 'decision').owners >= 1);
  eq((await call('/api/analytics', {method: 'PATCH', cookie: owner, body: {opt_out: true}})).data, {opted_out: true});
  eq(Number((await one('SELECT COUNT(*) AS n FROM scopeflow.analytics_events WHERE project_id=$1', [project_id])).n), 0, 'opting out deletes the account events');
  const later = await project(owner, 'TEST WS-10 analytics after opt-out', {approve: true});
  eq(Number((await one('SELECT COUNT(*) AS n FROM scopeflow.analytics_events WHERE project_id=$1', [later.project_id])).n), 0);
  await call('/api/analytics', {method: 'PATCH', cookie: owner, body: {opt_out: false}});
}

// ---------------------------------------------------------------------------------------------
// @covers SF-26 M28 — the new MCP tools: listed, invoices respect the cap, a payment retried with the
// same request_id is recorded once (the replay returns the first reply), identity fields never leave.
// ---------------------------------------------------------------------------------------------
{
  const key = await call('/api/key', {method: 'POST', cookie: owner});
  eq(key.status, 200);
  const auth = {Authorization: 'Bearer ' + key.data.token};
  const rpc = async (name, args) => { const r = await fetch(base + '/mcp', {method: 'POST', headers: {'Content-Type': 'application/json', ...auth}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name, arguments: args}})}); return (await r.json()).result; };
  const list = await (await fetch(base + '/mcp', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/list'})})).json();
  const names = list.result.tools.map(t => t.name);
  for (const n of ['list_rate_card', 'propose_retainer_usage', 'list_invoices', 'issue_invoice', 'record_payment_received']) ok(names.includes(n), n);
  for (const t of list.result.tools.filter(t => ['propose_retainer_usage', 'issue_invoice', 'record_payment_received'].includes(t.name))) { ok(t.inputSchema.required.includes('user_confirmed'), t.name); eq(t.securitySchemes, [{type: 'oauth2', scopes: ['scopes:write']}]); }
  const rate = await rpc('list_rate_card', {});
  ok(!rate.isError && Array.isArray(rate.structuredContent.items), JSON.stringify(rate));
  const {project_id} = await project(owner, 'TEST WS-10 MCP money', {approve: true});
  await db.query("UPDATE scopeflow.projects SET client_email='client-ws10@example.test' WHERE id=$1", [project_id]);
  const empty = (await call('/api/profile', {cookie: owner})).data.profile;
  eq((await call('/api/profile', {method: 'PUT', cookie: owner, body: {...empty, business_name: 'TEST Studio'}})).status, 200);
  // C2: the invoice tool goes through the invoice route, so an amount beyond the agreement is refused.
  const over = await rpc('issue_invoice', {project_id, amount: 5000, request_id: 'ws10-inv-over-' + Date.now(), user_confirmed: true});
  ok(over.isError && over.structuredContent.status >= 400, JSON.stringify(over));
  const inv = await rpc('issue_invoice', {project_id, amount: 400, description: 'TEST first part', request_id: 'ws10-inv-ok-' + Date.now(), user_confirmed: true});
  ok(!inv.isError && inv.structuredContent.invoice.amount === 400, JSON.stringify(inv));
  const invoices = await rpc('list_invoices', {project_id});
  ok(!invoices.isError && invoices.structuredContent.invoices.length === 1);
  ok(!JSON.stringify(invoices).includes('client-ws10@example.test'), 'no client email in MCP results');
  // M28: the same request_id twice -> the same 200-equivalent reply, one ledger entry.
  const request_id = 'ws10-pay-' + randomUUID().slice(0, 8);
  const args = {project_id, baseline_version: 1, amount: 300, method: 'upi', received: new Date().toISOString().slice(0, 10), reference: 'TEST-UTR', request_id, user_confirmed: true};
  const first = await rpc('record_payment_received', args);
  const second = await rpc('record_payment_received', args);
  ok(!first.isError && !second.isError, JSON.stringify([first, second]));
  eq(second.structuredContent.seq, first.structuredContent.seq);
  eq(second.structuredContent.replayed, true);
  eq(Number((await one("SELECT COUNT(*) AS n FROM scopeflow.ledger_entries WHERE project_id=$1 AND kind='payment_received'", [project_id])).n), 1);
  const reused = await rpc('record_payment_received', {...args, amount: 301});
  ok(reused.isError, 'a request_id reused for a different payment is refused');
  eq(Number((await one("SELECT COUNT(*) AS n FROM scopeflow.idempotency_keys WHERE key=$1 AND status=200", [request_id])).n), 1);
  const usage = await rpc('propose_retainer_usage', {project_id, baseline_version: 1, item_id: 'logo', qty: 1, request_id: 'ws10-use-' + Date.now(), user_confirmed: true});
  ok(usage.isError && usage.structuredContent.code === 'retainer_unavailable', 'usage waits for WS-05 to enable retainers: ' + JSON.stringify(usage));
  eq((await rpc('issue_invoice', {project_id, amount: 1, request_id: 'x', user_confirmed: true})) === undefined, true, 'invalid arguments are a JSON-RPC error, not a tool result');
}

// ---------------------------------------------------------------------------------------------
// @covers M30 — health stays 200 with mail off; readiness reports mail "off" and needs the operator token.
// ---------------------------------------------------------------------------------------------
{
  eq((await call('/api/health')).status, 200);
  eq((await call('/api/readiness')).status, 401);
  eq((await call('/api/readiness', {headers: {Authorization: 'Bearer wrong-token-0123456789'}})).status, 401);
  const r = await call('/api/readiness', {headers: admin});
  eq(r.status, 200, JSON.stringify(r.data));
  eq(r.data.summary.mail, 'off');
  eq(r.data.checks.signing.status, 'ok');
  eq(r.data.checks.tsa.status, 'ok');
  ok(['ok', 'warn', 'fail'].includes(r.data.checks.cron.status));
  ok(!JSON.stringify(r.data).includes(process.env.SCOPEFLOW_SIGNING_SECRET), 'no secrets in readiness');
}

// ---------------------------------------------------------------------------------------------
// @covers M31 OP-03 — the reminders job throws; reconcile still runs in its own process; cron_runs
// records the failure and readiness shows it.
// ---------------------------------------------------------------------------------------------
{
  const {runJobs} = await import('../scripts/cron.mjs');
  const since = new Date().toISOString();
  const results = await runJobs(['reminders', 'reconcile', 'housekeeping'], {scripts: {reminders: 'tests/fixtures/cron/throws.mjs'}});
  eq(results.map(r => [r.job, r.status]), [['reminders', 'failed'], ['reconcile', 'ok'], ['housekeeping', 'ok']]);
  const rows = (await db.query('SELECT job, status, exit_code, detail FROM scopeflow.cron_runs WHERE started >= $1 ORDER BY started', [since])).rows;
  eq(rows.map(r => [r.job, r.status]), [['reminders', 'failed'], ['reconcile', 'ok'], ['housekeeping', 'ok']]);
  ok(rows[0].detail.includes('TEST reminders job failed on purpose'));
  const r = await call('/api/readiness', {headers: admin});
  eq([r.data.checks.cron.jobs.reminders.status, r.data.checks.cron.jobs.reconcile.status, r.data.checks.cron.status], ['failed', 'ok', 'fail']);
  // A clean run clears the failure for readiness.
  await runJobs(['reminders'], {scripts: {reminders: 'tests/fixtures/cron/ok.mjs'}});
  eq((await call('/api/readiness', {headers: admin})).data.checks.cron.jobs.reminders.status, 'ok');
}

// ---------------------------------------------------------------------------------------------
// @covers M30 H16 OP-01 — a second production server: no signing secret -> /api/health 503; with
// APP_URL=https://scope-flow.tech the onrender host is redirected (308) for pages and refused (421)
// for APIs, while the health check is not redirected.
// ---------------------------------------------------------------------------------------------
async function server(port, env) {
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {env: {...process.env, NODE_ENV: 'production', ...env}, stdio: ['ignore', 'pipe', 'pipe']});
  let log = ''; child.stdout.on('data', c => { log += c; }); child.stderr.on('data', c => { log += c; });
  for (let i = 0; i < 120; i++) { try { await fetch(`http://127.0.0.1:${port}/api/health`); return {child, log: () => log}; } catch { await sleep(500); } }
  child.kill(); throw new Error('second server did not start: ' + log);
}
function raw(port, path, host) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({host: '127.0.0.1', port, path, headers: {Host: host}}, res => { res.resume(); res.on('end', () => resolve({status: res.statusCode, location: res.headers.location})); });
    req.on('error', reject); req.end();
  });
}
{
  const port = Number(new URL(base).port || 5173) + 37;
  const env = {...process.env};
  delete env.SCOPEFLOW_SIGNING_SECRET;
  const s = await server(port, {SCOPEFLOW_SIGNING_SECRET: '', SCOPEFLOW_ALLOW_COOKIE_SIGNING: '', APP_URL: 'https://scope-flow.tech'});
  try {
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    const body = await health.json();
    eq([health.status, body.reason], [503, 'signing_not_dedicated'], 'signing off in production -> /api/health 503');
    eq(await raw(port, '/review/x', 'scopeflow-qnng.onrender.com'), {status: 308, location: 'https://scope-flow.tech/review/x'});
    eq(await raw(port, '/.well-known/oauth-protected-resource', 'scopeflow-qnng.onrender.com'), {status: 308, location: 'https://scope-flow.tech/.well-known/oauth-protected-resource'});
    eq((await raw(port, '/api/scopes', 'scopeflow-qnng.onrender.com')).status, 421);
    eq((await raw(port, '/mcp', 'scopeflow-qnng.onrender.com')).status, 421);
    eq((await raw(port, '/api/health', 'scopeflow-qnng.onrender.com')).status, 503, 'health is answered (not redirected) on any host');
    const prm = await fetch(`http://127.0.0.1:${port}/.well-known/oauth-protected-resource`, {headers: {}});
    eq((await prm.json()).resource, 'https://scope-flow.tech/mcp', 'well-known metadata derives from APP_URL');
  } finally { s.child.kill(); }
}

await db.end();
console.log(JSON.stringify({passed, suite: 'ws-10-platform'}));
