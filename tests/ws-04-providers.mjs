// WS-04 provider suite (test:local, localhost and scopeflow_test only). Spawns its OWN production
// server (`next start`, the build CI already made) on another port, pointed at local Razorpay,
// Razorpay OAuth and Stripe doubles (tests/support/ws-04-doubles.mjs) that log every request, so
// each test can assert who was called, with which credentials, and how often. A test clock
// (tests/support/ws-04-clock.mjs, loaded with --import into that server only) moves the server's
// Date forward without waiting. Fictional TEST data only; no retries.
//
// Covers: C3 (zero provider calls on operator keys; BYO keys and OAuth sub-merchant routing),
// SF-20 (OAuth connect), H7 x2 (no webhook secret -> disabled; Checkout verify before the webhook),
// H8 x2 (61-minute clock shift -> same Stripe session; capture on a superseded order -> excess),
// M20, M21/H6, H9 x3 (same request id, different request ids, killed mid-refund), H14, L4, L5.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash, createHmac, randomUUID} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {signIn, localSql, requireLocalDatabase} from './support/local.mjs';
import {startDoubles} from './support/ws-04-doubles.mjs';

requireLocalDatabase();
const PORT = Number(process.env.WS04_PROVIDER_PORT || 5734);
const base = `http://localhost:${PORT}`;
assert.equal(new URL(base).hostname, 'localhost', 'Local fixtures only.');
let passed = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); passed++; };
const ok = (v, m) => { assert.ok(v, m); passed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hmac = (secret, s) => createHmac('sha256', secret).update(s).digest('hex');
const sql = q => localSql(q)[0].results;
const esc = s => "'" + String(s).replaceAll("'", "''") + "'";

const D = await startDoubles();
const clockDir = join(process.cwd(), 'test-results');
mkdirSync(clockDir, {recursive: true});
const CLOCK = join(clockDir, 'ws-04-clock');
const setClock = ms => writeFileSync(CLOCK, String(ms));
setClock(0);
const PARTNER_HOOK = 'ci-only-partner-webhook-secret';
const OPERATOR_HOOK = process.env.RAZORPAY_WEBHOOK_SECRET || 'ci-only-razorpay-webhook-secret';
const serverEnv = {
  ...process.env,
  NODE_ENV: 'production', PORT: String(PORT), APP_URL: base, SCOPEFLOW_TEST_URL: base,
  // The operator's own keys are present: in production they must never take a client's money (C3).
  RAZORPAY_KEY_ID: 'rzp_test_operator01', RAZORPAY_KEY_SECRET: 'operator-secret-01', RAZORPAY_WEBHOOK_SECRET: OPERATOR_HOOK,
  STRIPE_SECRET_KEY: 'sk_test_operator01', STRIPE_WEBHOOK_SECRET: 'whsec_operator01',
  RAZORPAY_API_URL: D.base + '/razorpay', RAZORPAY_OAUTH_URL: D.base + '/oauth', STRIPE_API_URL: D.base + '/stripe',
  RAZORPAY_PARTNER_CLIENT_ID: 'partner_client_test', RAZORPAY_PARTNER_CLIENT_SECRET: 'partner_secret_test', RAZORPAY_PARTNER_WEBHOOK_SECRET: PARTNER_HOOK,
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(resolve('tests/support/ws-04-clock.mjs')).href}`.trim(),
  WS04_CLOCK_FILE: CLOCK,
};
delete serverEnv.SCOPEFLOW_ALLOW_OPERATOR_COLLECTION;
delete serverEnv.SCOPEFLOW_ROUTE_ENABLED;
delete serverEnv.STRIPE_CURRENCIES;

let server = null;
async function startServer() {
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', 'localhost', '--port', String(PORT)], {env: serverEnv, stdio: ['ignore', 'pipe', 'pipe']});
  const out = [];
  server.stdout.on('data', c => out.push(String(c))); server.stderr.on('data', c => out.push(String(c)));
  server.logs = out;
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(base + '/api/health')).ok) return; } catch { /* starting */ }
    if (server.exitCode !== null) break;
    await sleep(500);
  }
  throw new Error('The WS-04 provider server did not start:\n' + out.join('').slice(-4000));
}
async function stopServer(signal = 'SIGTERM') {
  if (!server || server.exitCode !== null) return;
  const done = new Promise(r => server.once('exit', r));
  server.kill(signal);
  await done;
}
async function finish(code) {
  await stopServer().catch(() => {});
  await D.close().catch(() => {});
  setClock(0);
  process.exit(code);
}
process.on('uncaughtException', e => { console.error(e); if (server?.logs) console.error(server.logs.join('').slice(-4000)); void finish(1); });
process.on('unhandledRejection', e => { console.error(e); if (server?.logs) console.error(server.logs.join('').slice(-4000)); void finish(1); });

async function call(path, {method = 'GET', cookie, body, raw, headers = {}} = {}) {
  const h = {Origin: base, ...headers};
  if (cookie) h.Cookie = cookie;
  if (body !== undefined || raw !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(base + path, {method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)), redirect: 'manual'});
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return {status: r.status, data};
}
async function approve(token) {
  const {scope} = (await call('/api/review/' + token)).data;
  const content_sha256 = createHash('sha256').update(JSON.stringify(scope.content)).digest('hex');
  return (await call('/api/review/' + token, {method: 'POST', body: {decision: 'approved', signer: 'TEST Client', comment: '', version: scope.version, acknowledged: true, content_sha256}})).status;
}
const scope = extra => ({title: 'TEST WS-04 providers ' + randomUUID().slice(0, 8), client: 'TEST Client', deliverables: 'Logo design suite', exclusions: '', fee: 10000, currency: 'INR', revisions: 2, due: '', notes: '', deposit_pct: 30, ...extra});
async function project(cookie, extra, {approved = true} = {}) {
  const c = await call('/api/scopes', {method: 'POST', cookie, body: scope(extra)});
  assert.equal(c.status, 201, JSON.stringify(c.data));
  const {project_id, token} = c.data.scope;
  if (approved) assert.equal(await approve(token), 200);
  return {project_id, token};
}
const ledger = async (cookie, id) => (await call(`/api/scopes/${id}/ledger`, {cookie})).data;
const record = (cookie, id, version, amount) => call(`/api/scopes/${id}/ledger`, {method: 'POST', cookie, body: {kind: 'payment_received', baseline_version: version, payload: {amount, method: 'bank_transfer', received: new Date().toISOString().slice(0, 10), reference: 'TEST' + randomUUID().slice(0, 6), note: ''}}});
const reconcile = () => call('/api/payments/razorpay/reconcile', {method: 'POST', headers: {Authorization: 'Bearer ' + process.env.SCOPEFLOW_CRON_SECRET}});
const rzEvent = (payment, extra = {}) => ({event: 'payment.captured', ...extra, payload: {payment: {entity: {id: payment.id, order_id: payment.order_id, amount: payment.amount, currency: payment.currency, status: 'captured'}}}});
const rzHook = (path, payload, secret) => { const raw = JSON.stringify(payload); return call(path, {method: 'POST', raw, headers: {'X-Razorpay-Signature': hmac(secret, raw), 'X-Razorpay-Event-Id': 'evt_' + randomUUID().replaceAll('-', '').slice(0, 14)}}); };
const excessEnabled = /excess_payment:\s*excessPaymentSchema/.test(readFileSync('lib/ledger.ts', 'utf8'));
async function supersede(cookie, id, version) {
  const s = (await call(`/api/scopes/${id}`, {cookie})).data.versions[0].content;
  const r = await call(`/api/scopes/${id}`, {method: 'POST', cookie, body: {expected_version: version, content: {...s, notes: `v${version + 1}: TEST revised terms`}, supersede_agreement: true}});
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const token = r.data.scope.token;
  assert.equal(await approve(token), 200);
  return token;
}

await startServer();

// Owners with their own Razorpay keys (with and without a webhook secret).
const KEY_ID = 'rzp_test_byo' + randomUUID().replaceAll('-', '').slice(0, 10), KEY_SECRET = 'byo-key-secret-' + randomUUID().slice(0, 8), BYO_HOOK = 'byo-webhook-secret-01';
async function rzOwner(label, {hook = true} = {}) {
  const cookie = await signIn(base, `ws04-prov-${label}-${randomUUID()}@example.test`);
  const r = await call('/api/payment-accounts', {method: 'POST', cookie, body: {kind: 'razorpay_keys', key_id: KEY_ID, key_secret: KEY_SECRET, ...(hook ? {webhook_secret: BYO_HOOK} : {})}});
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return {cookie, account: r.data.account.id, hook: `/api/payments/razorpay/webhook/${r.data.account.id}`};
}
/** Pays the open deposit through the client's Checkout and the verify route; returns the ledger seq of the payment. */
async function paidDeposit(o, extra) {
  const p = await project(o.cookie, {deposit_pct: 100, ...extra});
  const start = await call(`/api/review/${p.token}/deposit`, {method: 'POST', body: {}});
  assert.equal(start.status, 200, JSON.stringify(start.data));
  const pay = D.capture(start.data.order_id);
  const v = await call(`/api/review/${p.token}/payments/razorpay/verify`, {method: 'POST', body: {razorpay_order_id: pay.order_id, razorpay_payment_id: pay.id, razorpay_signature: hmac(KEY_SECRET, `${pay.order_id}|${pay.id}`)}});
  assert.equal(v.data.recorded, true, JSON.stringify(v.data));
  return {...p, seq: v.data.seq, pay};
}
const refundCalls = paymentId => D.count('razorpay', 'POST', new RegExp(`^/v1/payments/${paymentId}/refund$`));

try {
  // ---- C3: production, only the operator's keys: refused, and no provider is ever called ------------
  {
    // @covers C3
    const cookie = await signIn(base, `ws04-prov-op-${randomUUID()}@example.test`);
    for (const currency of ['INR', 'EUR']) {
      const p = await project(cookie, {currency});
      const before = D.log.length;
      const view = (await call('/api/review/' + p.token)).data.deposit;
      eq([view.enabled, view.status], [false, 'operator_refused'], currency);
      const r = await call(`/api/review/${p.token}/deposit`, {method: 'POST', body: {}});
      eq([r.status, r.data.code], [409, 'payment_account_required'], currency);
      eq(D.log.length, before, 'no request reached Razorpay or Stripe for ' + currency);
      eq(sql(`SELECT COUNT(*)::int AS n FROM scopeflow.payments WHERE project_id=${esc(p.project_id)}`)[0].n, 0);
    }
  }

  // ---- H7: own keys without a webhook secret: not enabled, readiness says misconfigured ---------------
  {
    // @covers H7
    const o = await rzOwner('nohook', {hook: false});
    const accounts = (await call('/api/payment-accounts', {cookie: o.cookie})).data;
    eq(accounts.readiness.payments, 'misconfigured');
    ok(accounts.readiness.warnings.some(w => /webhook secret/.test(w)), JSON.stringify(accounts.readiness));
    const p = await project(o.cookie);
    const view = (await call('/api/review/' + p.token)).data.deposit;
    eq([view.enabled, view.status], [false, 'misconfigured']);
    eq((await call(`/api/review/${p.token}/deposit`, {method: 'POST', body: {}})).data.code, 'payments_disabled');
    eq(sql(`SELECT COUNT(*)::int AS n FROM scopeflow.payment_accounts WHERE id=${esc(o.account)} AND webhook_secret_box IS NULL`)[0].n, 1, 'no webhook secret box');
  }

  // ---- C3 (BYO keys) + H7: order on the freelancer's own keys; verify records before the webhook ------
  const rz = await rzOwner('keys');
  {
    // @covers C3 H7 SF-20
    eq(sql(`SELECT (secret_enc LIKE 'v1.%') AS sealed, (webhook_secret_box LIKE 'v1.%') AS hook, (secret_enc NOT LIKE ${esc('%' + KEY_SECRET + '%')}) AS opaque FROM scopeflow.payment_accounts WHERE id=${esc(rz.account)}`)[0], {sealed: true, hook: true, opaque: true}, 'secrets sealed at rest, webhook secret in its own box');
    const p = await project(rz.cookie);
    const start = await call(`/api/review/${p.token}/deposit`, {method: 'POST', body: {}});
    eq([start.status, start.data.provider, start.data.key_id, start.data.amount_minor], [200, 'razorpay', KEY_ID, 300000]);
    const order = D.rz.orders.get(start.data.order_id);
    eq(order.auth, 'Basic ' + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64'), 'the order is created with the freelancer’s own keys');
    eq((await call(`/api/review/${p.token}/deposit`, {method: 'POST', body: {}})).data.order_id, start.data.order_id, 'a second click reuses the open order');
    const pay = D.capture(start.data.order_id);
    eq((await call(`/api/review/${p.token}/payments/razorpay/verify`, {method: 'POST', body: {razorpay_order_id: pay.order_id, razorpay_payment_id: pay.id, razorpay_signature: hmac('wrong', `${pay.order_id}|${pay.id}`)}})).data.code, 'bad_signature');
    const v = await call(`/api/review/${p.token}/payments/razorpay/verify`, {method: 'POST', body: {razorpay_order_id: pay.order_id, razorpay_payment_id: pay.id, razorpay_signature: hmac(KEY_SECRET, `${pay.order_id}|${pay.id}`)}});
    eq([v.status, v.data.recorded, v.data.ledger], [200, true, true], 'recorded by the Checkout handler, before any webhook');
    // The webhook arrives later (signed with the account's own secret): no second entry.
    eq((await rzHook(rz.hook, rzEvent(pay), 'not-the-secret')).status, 400);
    eq((await rzHook('/api/payments/razorpay/webhook', rzEvent(pay), OPERATOR_HOOK)).data, {ignored: 'account_mismatch'}, 'the operator webhook cannot touch a freelancer’s order');
    const late = await rzHook(rz.hook, rzEvent(pay), BYO_HOOK);
    eq([late.status, late.data.duplicate], [200, true]);
    const l = await ledger(rz.cookie, p.project_id);
    eq(l.entries.filter(e => e.kind === 'payment').map(e => [e.payload.amount, e.payload.payment_id]), [[3000, pay.id]]);
    eq(l.chain.intact, true);
    eq((await call('/api/review/' + p.token)).data.deposit.paid.amount, 3000);
    const operatorAuth = 'Basic ' + Buffer.from('rzp_test_operator01:operator-secret-01').toString('base64');
    eq([...D.rz.orders.values()].some(o => o.auth === operatorAuth), false, 'the operator keys never created an order');
  }

  // ---- SF-20 + C3: Razorpay Technology Partner OAuth: sub-merchant bearer token, partner webhook -------
  {
    // @covers SF-20 C3
    const cookie = await signIn(base, `ws04-prov-oauth-${randomUUID()}@example.test`);
    const connect = await call('/api/payment-accounts/razorpay/connect?format=json', {cookie});
    eq(connect.status, 200);
    const url = new URL(connect.data.url);
    eq([url.origin + url.pathname, url.searchParams.get('client_id')], [D.base + '/oauth/authorize', 'partner_client_test']);
    const state = url.searchParams.get('state');
    eq((await call(`/api/payment-accounts/razorpay/callback?code=good-code&state=${'0'.repeat(48)}&format=json`, {cookie})).data.code, 'oauth_state');
    const cb = await call(`/api/payment-accounts/razorpay/callback?code=good-code&state=${state}&format=json`, {cookie});
    eq([cb.status, cb.data.account.kind, cb.data.account.status, cb.data.account.public.razorpay_account_id], [201, 'razorpay_oauth', 'active', 'acc_SUBMERCH01']);
    eq((await call(`/api/payment-accounts/razorpay/callback?code=good-code&state=${state}&format=json`, {cookie})).data.code, 'oauth_state', 'state is single use');
    const listed = (await call('/api/payment-accounts', {cookie})).data;
    eq([listed.readiness.payments, listed.routes.INR.online], ['ready', {provider: 'razorpay', via: 'oauth'}]);
    const p = await project(cookie);
    const start = await call(`/api/review/${p.token}/deposit`, {method: 'POST', body: {}});
    eq([start.status, start.data.key_id], [200, 'rzp_test_oauth_PUBLIC1']);
    eq(D.rz.orders.get(start.data.order_id).auth, 'Bearer oauth-access-1', 'the order is created with the sub-merchant access token');
    const pay = D.capture(start.data.order_id);
    eq((await rzHook('/api/payments/razorpay/webhook', rzEvent(pay, {account_id: 'acc_OTHER0001'}), PARTNER_HOOK)).data, {ignored: 'unknown_account'});
    const r = await rzHook('/api/payments/razorpay/webhook', rzEvent(pay, {account_id: 'acc_SUBMERCH01'}), PARTNER_HOOK);
    eq([r.status, r.data.recorded, r.data.ledger], [200, true, true], 'verified with the partner webhook secret, recorded for that account');
    eq((await ledger(cookie, p.project_id)).entries.filter(e => e.kind === 'payment').length, 1);
  }

  // ---- H8 (Stripe) + L5: 61 minutes later the same session; return page finds the payment --------------
  {
    // @covers H8 L5 C3
    const cookie = await signIn(base, `ws04-prov-stripe-${randomUUID()}@example.test`);
    const KEY = 'sk_test_byo' + randomUUID().replaceAll('-', '').slice(0, 12), HOOK = 'whsec_byo' + randomUUID().replaceAll('-', '').slice(0, 12);
    eq((await call('/api/payment-accounts', {method: 'POST', cookie, body: {kind: 'stripe_keys', secret_key: 'rk_test_badkey00'}})).data.code, 'provider_refused');
    const acct = await call('/api/payment-accounts', {method: 'POST', cookie, body: {kind: 'stripe_keys', secret_key: KEY, webhook_secret: HOOK, currencies: ['EUR']}});
    eq(acct.status, 201);
    const p = await project(cookie, {currency: 'EUR', fee: 1000});
    const sessions = () => D.count('stripe', 'POST', /^\/v1\/checkout\/sessions$/);
    const before = sessions();
    const first = await call(`/api/review/${p.token}/deposit`, {method: 'POST', body: {}});
    eq([first.status, first.data.provider, first.data.amount_minor], [200, 'stripe', 30000]);
    const sid = first.data.url.split('/').pop();
    const s = D.st.sessions.get(sid);
    eq(s.auth, 'Bearer ' + KEY, 'the session is created on the freelancer’s own Stripe key');
    ok(Math.abs(s.expires_at - (Date.now() / 1000 + 1800)) < 120, 'sessions expire after 30 minutes: ' + s.expires_at);
    ok(/\/payment-return\?status=success&ref=[a-f0-9]{32}&session_id=\{CHECKOUT_SESSION_ID\}$/.test(s.success_url) && !s.success_url.includes(p.token), s.success_url);
    setClock(61 * 60_000);
    const later = await call(`/api/review/${p.token}/deposit`, {method: 'POST', body: {}});
    setClock(0);
    eq(later.data.url, first.data.url, 'two checkouts 61 minutes apart, same amount: the same session');
    eq(sessions() - before, 1, 'one session was created');
    // L5: the client comes back in a new tab: the server looks the session up and records the payment.
    D.payStripe(sid);
    const ref = new URL(s.success_url.replace('{CHECKOUT_SESSION_ID}', sid)).searchParams.get('ref');
    eq((await call(`/api/payments/stripe/return?session_id=${sid}&ref=${'0'.repeat(32)}`)).status, 404);
    const back = await call(`/api/payments/stripe/return?session_id=${sid}&ref=${ref}`);
    eq([back.status, back.data.paid, back.data.token], [200, true, p.token]);
    eq((await ledger(cookie, p.project_id)).entries.filter(e => e.kind === 'payment').map(e => [e.payload.provider, e.payload.amount, e.payload.currency]), [['stripe', 300, 'EUR']]);
  }

  // ---- H8 (Razorpay): the open amount changes; a capture on the old order is excess, with an alert -----
  {
    // @covers H8 H6
    const rz = await rzOwner('h8'); // a fresh owner: write limits are per owner per minute
    const p = await project(rz.cookie);
    const a = await call(`/api/review/${p.token}/deposit`, {method: 'POST', body: {}});
    eq(a.data.amount_minor, 300000);
    eq((await record(rz.cookie, p.project_id, 1, 1000)).status, 201);
    const b = await call(`/api/review/${p.token}/deposit`, {method: 'POST', body: {}});
    eq(b.data.amount_minor, 200000);
    ok(b.data.order_id !== a.data.order_id, 'a new order for the new open amount');
    eq(sql(`SELECT (superseded_at IS NOT NULL) AS s FROM scopeflow.payments WHERE order_id=${esc(a.data.order_id)}`)[0].s, true);
    const late = D.capture(a.data.order_id);
    const r = await rzHook(rz.hook, rzEvent(late), BYO_HOOK);
    eq([r.status, r.data.recorded, r.data.outcome, r.data.excess_minor], [200, true, 'excess', 100000]);
    const l = await ledger(rz.cookie, p.project_id);
    eq(l.entries.filter(e => e.kind === 'payment').map(e => e.payload.amount), [3000], 'what was paid is recorded, never dropped');
    if (excessEnabled) eq(l.entries.filter(e => e.kind === 'excess_payment').map(e => [e.payload.amount_minor, e.payload.reason]), [[100000, 'superseded_order']]);
    eq(sql(`SELECT outcome,excess_minor::int AS x FROM scopeflow.payments WHERE order_id=${esc(a.data.order_id)}`)[0], {outcome: 'excess', x: 100000});
    const alert = (await call('/api/payments/alerts', {cookie: rz.cookie})).data.alerts.find(x => x.kind === 'excess_payment' && x.detail.order_id === a.data.order_id);
    ok(alert && alert.detail.reason === 'superseded_order' && alert.detail.refund.body.amount === 1000, JSON.stringify(alert));
    // The one-click refund in the alert is a ready refund request.
    const refund = await call(alert.detail.refund.path, {method: 'POST', cookie: rz.cookie, body: alert.detail.refund.body});
    eq(refund.status, 201, JSON.stringify(refund.data));
    eq((await call(`/api/review/${p.token}/payments`)).data.money.deposit.covered, true);
  }

  // ---- M20: captured 5,000 against an order of 5,900: 5,000 recorded and the owner alerted ------------
  {
    // @covers M20
    const rz = await rzOwner('m20'); // a fresh owner: write limits are per owner per minute
    const p = await project(rz.cookie, {fee: 5000, tax_pct: 18, tax_label: 'GST', deposit_pct: 100});
    const start = await call(`/api/review/${p.token}/deposit`, {method: 'POST', body: {}});
    eq(start.data.amount_minor, 590000);
    const pay = D.capture(start.data.order_id, 500000);
    const r = await rzHook(rz.hook, rzEvent(pay), BYO_HOOK);
    eq([r.status, r.data.recorded, r.data.outcome, r.data.short_minor], [200, true, 'short', 90000]);
    eq((await ledger(rz.cookie, p.project_id)).entries.filter(e => e.kind === 'payment').map(e => e.payload.amount), [5000]);
    const alert = (await call('/api/payments/alerts', {cookie: rz.cookie})).data.alerts.find(x => x.kind === 'short_payment' && x.detail.order_id === start.data.order_id);
    ok(alert && alert.detail.expected_minor === 590000 && alert.detail.captured_minor === 500000, JSON.stringify(alert));
    eq((await call(`/api/review/${p.token}/payments`)).data.money.deposit, {due: 590000, paid: 500000, covered: false});
  }

  // ---- M21 + H6: recording fails -> event stored, 500, owner alerted; reconcile processes it -----------
  {
    // @covers M21 H6
    const rz = await rzOwner('m21'); // a fresh owner: write limits are per owner per minute
    const p = await project(rz.cookie, {}, {approved: false});
    const order = 'order_' + randomUUID().replaceAll('-', '').slice(0, 14);
    localSql(`INSERT INTO scopeflow.payments (id,project_id,version,provider,order_id,amount_minor,currency,status,created,purpose,account_id) VALUES ('${randomUUID()}',${esc(p.project_id)},1,'razorpay',${esc(order)},300000,'INR','created','${new Date().toISOString()}','deposit',${esc(rz.account)})`);
    D.rz.orders.set(order, {id: order, amount: 300000, currency: 'INR', auth: 'test'});
    const pay = D.capture(order);
    const raw = JSON.stringify(rzEvent(pay)), eventId = 'evt_m21' + randomUUID().replaceAll('-', '').slice(0, 10);
    const r = await call(rz.hook, {method: 'POST', raw, headers: {'X-Razorpay-Signature': hmac(BYO_HOOK, raw), 'X-Razorpay-Event-Id': eventId}});
    eq([r.status, r.data.code], [500, 'record_failed'], 'not 200: Razorpay retries');
    const stored = sql(`SELECT processed_at,attempts FROM scopeflow.payment_events WHERE event_id=${esc(rz.account + ':' + eventId)}`);
    eq([stored.length, stored[0].processed_at, stored[0].attempts], [1, null, 1], 'the verified event is stored before anything else');
    ok((await call('/api/payments/alerts', {cookie: rz.cookie})).data.alerts.some(x => x.kind === 'payment_unrecorded' && x.detail.order_id === order), 'the owner is alerted (H6)');
    eq(await approve(p.token), 200);
    const rec = await reconcile();
    eq(rec.status, 200);
    ok(rec.data.inbox.processed >= 1, JSON.stringify(rec.data.inbox));
    eq(sql(`SELECT (processed_at IS NOT NULL) AS done FROM scopeflow.payment_events WHERE event_id=${esc(rz.account + ':' + eventId)}`)[0].done, true);
    eq((await ledger(rz.cookie, p.project_id)).entries.filter(e => e.kind === 'payment').map(e => [e.payload.order_id, e.payload.amount]), [[order, 3000]]);
    // A normal event is stored before its 200.
    const ok200 = await rzHook(rz.hook, {event: 'payment.failed', payload: {}}, BYO_HOOK);
    eq(ok200.data, {ignored: 'event'});
  }

  // ---- H9: concurrent refunds -------------------------------------------------------------------------
  {
    // @covers H9
    const rz = await rzOwner('h9'); // a fresh owner: write limits are per owner per minute
    const p = await paidDeposit(rz, {fee: 1000});
    const R = `/api/scopes/${p.project_id}/refunds`;
    const calls0 = refundCalls(p.pay.id);
    const same = 'h9-same-' + randomUUID().slice(0, 8);
    const twin = await Promise.all([1, 2].map(() => call(R, {method: 'POST', cookie: rz.cookie, body: {payment_seq: p.seq, amount: 100, request_id: same}})));
    ok(twin.some(r => r.status === 201), JSON.stringify(twin.map(r => [r.status, r.data])));
    ok(twin.every(r => r.status === 201 || r.data.replayed || r.data.code === 'refund_in_progress'), JSON.stringify(twin.map(r => r.data)));
    eq(refundCalls(p.pay.id) - calls0, 1, 'same request_id twice at once: exactly one provider call');
    eq((await ledger(rz.cookie, p.project_id)).entries.filter(e => e.kind === 'refund').length, 1);
    // Two different requests, each for everything that is left (900), at the same time.
    const both = await Promise.all(['a', 'b'].map(x => call(R, {method: 'POST', cookie: rz.cookie, body: {payment_seq: p.seq, amount: 900, request_id: `h9-${x}-${randomUUID().slice(0, 8)}`}})));
    eq(both.filter(r => r.status === 201).length, 1, JSON.stringify(both.map(r => [r.status, r.data])));
    const refused = both.find(r => r.status !== 201);
    ok([409, 400].includes(refused.status) && refused.data.code === 'refund_exceeds_paid', JSON.stringify(refused));
    eq(refundCalls(p.pay.id) - calls0, 2, 'the refused request never reached the provider');
    const refunds = (await ledger(rz.cookie, p.project_id)).entries.filter(e => e.kind === 'refund');
    eq(refunds.map(e => e.payload.amount).sort((x, y) => x - y), [100, 900]);
  }

  // ---- H9: killed between the provider call and the append -> reconcile finalises the refund ----------
  {
    // @covers H9 H14
    const rz = await rzOwner('kill'); // a fresh owner: write limits are per owner per minute
    const p = await paidDeposit(rz, {fee: 1000});
    let issued = null;
    D.rz.onRefund = async r => { issued = r; await stopServer('SIGKILL'); };
    const crashed = await call(`/api/scopes/${p.project_id}/refunds`, {method: 'POST', cookie: rz.cookie, body: {payment_seq: p.seq, amount: 250, request_id: 'h9-kill-' + randomUUID().slice(0, 8)}}).catch(e => ({status: 0, error: String(e)}));
    eq(crashed.status, 0, 'the server died mid-refund');
    ok(issued?.id, 'the provider made the refund');
    await startServer();
    eq(sql(`SELECT status FROM scopeflow.refunds_pending WHERE project_id=${esc(p.project_id)}`).map(r => r.status), ['pending']);
    eq((await ledger(rz.cookie, p.project_id)).entries.filter(e => e.kind === 'refund').length, 0);
    setClock(3 * 60_000); // past the two-minute grace for an in-flight refund
    const rec = await reconcile();
    setClock(0);
    eq(rec.status, 200);
    ok(rec.data.refunds.some(r => r.status === 'recorded'), JSON.stringify(rec.data.refunds));
    const refunds = (await ledger(rz.cookie, p.project_id)).entries.filter(e => e.kind === 'refund');
    eq(refunds.map(e => [e.payload.amount, e.payload.provider_refund_id, e.payload.refund_of]), [[250, issued.id, p.seq]]);
    eq(refundCalls(p.pay.id), 1, 'reconcile looked the refund up; it never refunded again');
  }

  // ---- H14: the baseline changes between the provider refund and the append -> still recorded ----------
  {
    // @covers H14 C4
    const rz = await rzOwner('h14'); // a fresh owner: write limits are per owner per minute
    const p = await paidDeposit(rz, {fee: 1000});
    let token2 = null;
    D.rz.onRefund = async () => { token2 = await supersede(rz.cookie, p.project_id, 1); };
    const r = await call(`/api/scopes/${p.project_id}/refunds`, {method: 'POST', cookie: rz.cookie, body: {payment_seq: p.seq, amount: 400, request_id: 'h14-' + randomUUID().slice(0, 8)}});
    eq(r.status, 201, JSON.stringify(r.data));
    ok(token2, 'v2 was approved while the refund was at the provider');
    const refund = (await ledger(rz.cookie, p.project_id)).entries.find(e => e.kind === 'refund');
    eq([refund.payload.amount, refund.baseline_version], [400, 2]);
    const money = (await call(`/api/review/${token2}/payments`)).data.money;
    eq([money.received_minor, money.refunded_minor, money.net_minor], [100000, 40000, 60000], 'the statement figures show the refund');
  }

  // ---- L4: 250 unreconciled orders: newest 200 first, the cursor resumes ------------------------------
  {
    // @covers L4
    const rz = await rzOwner('l4'); // a fresh owner: write limits are per owner per minute
    const p = await project(rz.cookie);
    const now = Date.now();
    const ids = Array.from({length: 250}, (_, i) => 'order_L4' + String(i).padStart(4, '0') + randomUUID().replaceAll('-', '').slice(0, 6));
    // Timestamped just ahead of every other order in the database, so "newest first" means these.
    const values = ids.map((o, i) => `('${randomUUID()}',${esc(p.project_id)},1,'razorpay',${esc(o)},300000,'INR','created','${new Date(now + 600_000 - i * 1000).toISOString()}','deposit',${esc(rz.account)})`);
    for (const o of ids) D.rz.orders.set(o, {id: o, amount: 300000, currency: 'INR', auth: 'test'});
    localSql(`DELETE FROM scopeflow.payment_cursors WHERE name='reconcile:orders'; INSERT INTO scopeflow.payments (id,project_id,version,provider,order_id,amount_minor,currency,status,created,purpose,account_id) VALUES ${values.join(',')}`);
    const looked = () => new Set(D.log.filter(l => l.service === 'razorpay' && l.method === 'GET' && /^\/v1\/orders\/order_L4/.test(l.path)).map(l => l.path.split('/')[3]));
    const one = await reconcile();
    eq([one.status, one.data.cursor], [200, 'continues'], JSON.stringify(one.data).slice(0, 500));
    const first = looked();
    eq(first.size, 200);
    ok(ids.slice(0, 200).every(o => first.has(o)), 'the newest 200 orders are looked up first');
    const two = await reconcile();
    eq(two.status, 200);
    const all = looked();
    ok(ids.every(o => all.has(o)), 'the next run continues with the rest');
    eq(D.log.filter(l => l.service === 'razorpay' && l.method === 'GET' && /^\/v1\/orders\/order_L4/.test(l.path)).length, 250, 'each order looked up once');
    localSql(`DELETE FROM scopeflow.payments WHERE order_id LIKE 'order_L4%'; DELETE FROM scopeflow.payment_cursors WHERE name='reconcile:orders'`);
  }
} catch (e) {
  console.error(e);
  if (server?.logs) console.error(server.logs.join('').slice(-6000));
  await finish(1);
}
console.log(`ws-04-providers: ${passed} checks passed`);
await finish(0);
