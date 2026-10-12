// WS-04 integration suite against the running server (test:local, localhost and scopeflow_test
// only). Payments without custody: project-scoped money across a supersede (C4, LT-21), operator
// keys refused for client charges in production (C3), UPI direct with "I've paid" claims the owner
// confirms (LT-02, SF-02), and the owner's payment accounts. Provider flows that need Razorpay and
// Stripe doubles with request counting run in tests/ws-04-providers.mjs.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {signIn, ack, localSql} from './support/local.mjs';
const base = process.env.SCOPEFLOW_TEST_URL || 'http://localhost:5173';
assert.equal(new URL(base).hostname, 'localhost', 'Local fixtures only.');
let passed = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); passed++; };
const ok = (v, m) => { assert.ok(v, m); passed++; };
async function call(path, {method = 'GET', cookie, body} = {}) {
  const h = {Origin: base};
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(base + path, {method, headers: h, body: body === undefined ? undefined : JSON.stringify(body)});
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return {status: r.status, data};
}
const scope = extra => ({title: 'WS-04 fixture ' + randomUUID().slice(0, 8), client: 'Acme', deliverables: 'Logo design suite', exclusions: '', fee: 10000, currency: 'INR', revisions: 2, due: '', notes: '', deposit_pct: 30, ...extra});
const approve = async token => (await call('/api/review/' + token, {method: 'POST', body: await ack(base, token, {decision: 'approved', signer: 'Ada Client', comment: '', version: (await call('/api/review/' + token)).data.scope.version})})).status;
const record = (cookie, project, version, amount, extra = {}) => call(`/api/scopes/${project}/ledger`, {method: 'POST', cookie, body: {kind: 'payment_received', baseline_version: version, payload: {amount, method: 'upi', received: '2026-10-01', reference: 'UTR' + amount, note: '', ...extra}}});

const owner = await signIn(base, `ws04-${Date.now()}@example.test`);

// ---- C4 + LT-21: the live-test scenario (fee ₹10,000, deposit 30%, ₹3,000 by UPI, v2 supersede) ----
{
  // @covers C4 LT-21
  const created = await call('/api/scopes', {method: 'POST', cookie: owner, body: scope()});
  eq(created.status, 201);
  const {project_id, token} = created.data.scope;
  eq(await approve(token), 200);
  eq((await record(owner, project_id, 1, 3000)).status, 201);
  // LT-21: the recorded ₹3,000 equals the deposit, so the deposit is paid (the old view looked only at online orders).
  const v1 = (await call('/api/review/' + token)).data.deposit;
  ok(v1.paid && v1.paid.amount === 3000, 'deposit.paid after a recorded ₹3,000: ' + JSON.stringify(v1));
  eq([v1.amount, v1.amount_minor, v1.open_minor], [3000, 300000, 0]);
  // Supersede with v2 and approve it.
  const s = (await call(`/api/scopes/${project_id}`, {cookie: owner})).data.versions[0].content;
  const revised = await call(`/api/scopes/${project_id}`, {method: 'POST', cookie: owner, body: {expected_version: 1, content: {...s, notes: 'v2: new working terms'}, supersede_agreement: true}});
  eq(revised.status, 201);
  const token2 = revised.data.scope.token;
  eq(await approve(token2), 200);
  // C4: after v2 the ₹3,000 is still on the record: deposit covered, never asked again, balance ₹7,000.
  const v2 = (await call('/api/review/' + token2)).data;
  ok(v2.deposit.paid && v2.deposit.paid.amount === 3000, 'deposit covered after supersede: ' + JSON.stringify(v2.deposit));
  eq((await call(`/api/review/${token2}/deposit`, {method: 'POST', body: {}})).data.code, 'already_paid');
  const pay = (await call(`/api/review/${token2}/payments`)).data;
  eq([pay.money.received_minor, pay.money.net_minor, pay.money.total_minor, pay.money.balance_minor], [300000, 300000, 1000000, 700000], 'Total received ₹3,000.00 and balance ₹7,000.00');
  eq(pay.money.deposit, {due: 300000, paid: 300000, covered: true});
  eq(pay.targets.map(t => [t.purpose, t.open_minor]), [['deposit', 0], ['balance', 700000]]);
}

// ---- C3: operator keys are refused for a client charge in production -------------------------------
{
  // @covers C3
  // CI runs `next start` (production) with only the operator's STRIPE_SECRET_KEY (EUR, GBP).
  const created = await call('/api/scopes', {method: 'POST', cookie: owner, body: scope({currency: 'EUR'})});
  const {token} = created.data.scope;
  eq(await approve(token), 200);
  const view = (await call('/api/review/' + token)).data;
  eq([view.deposit.enabled, view.deposit.provider, view.deposit.status, view.deposit.upi], [false, null, 'operator_refused', false]);
  const r = await call(`/api/review/${token}/deposit`, {method: 'POST', body: {}});
  eq([r.status, r.data.code], [409, 'payment_account_required']);
  eq(localSql(`SELECT COUNT(*)::int AS n FROM scopeflow.payments WHERE project_id='${created.data.scope.project_id}'`)[0].results[0].n, 0, 'no order or session was created');
}

// ---- LT-02 / SF-02: UPI direct, "I've paid" claim, owner confirms -> deposit covered ----------------
{
  // @covers LT-02 SF-02 C3
  const owner = await signIn(base, `ws04-upi-${Date.now()}@example.test`); // changed: a fresh owner per block (write limits are per owner per minute)
  const accounts = await call('/api/payment-accounts', {cookie: owner});
  eq([accounts.status, accounts.data.readiness.payments], [200, 'none']);
  eq((await call('/api/payment-accounts', {method: 'POST', cookie: owner, body: {kind: 'upi', vpa: 'not-a-vpa', payee_name: 'Asha Design'}})).status, 400);
  const upi = await call('/api/payment-accounts', {method: 'POST', cookie: owner, body: {kind: 'upi', vpa: 'asha.design@okhdfcbank', payee_name: 'Asha Design'}});
  eq([upi.status, upi.data.account.kind, upi.data.account.public.vpa], [201, 'upi', 'asha.design@okhdfcbank']);
  eq((await call('/api/payment-accounts')).status, 401);
  // ₹25,000 + 18% GST, 100% deposit: ₹29,500.00 due.
  const created = await call('/api/scopes', {method: 'POST', cookie: owner, body: scope({fee: 25000, tax_pct: 18, tax_label: 'GST', deposit_pct: 100})});
  const {project_id, token} = created.data.scope;
  eq((await call(`/api/review/${token}/payments`)).data.code, 'not_approved');
  eq(await approve(token), 200);
  const options = (await call(`/api/review/${token}/payments`)).data;
  eq([options.upi, options.online.enabled, options.online.status], [{vpa: 'asha.design@okhdfcbank', payee_name: 'Asha Design'}, false, 'upi_only']);
  const deposit = options.targets.find(t => t.purpose === 'deposit');
  eq(deposit.open_minor, 2950000);
  ok(deposit.upi_uri.startsWith('upi://pay?pa=asha.design@okhdfcbank&pn=Asha%20Design&am=29500.00&cu=INR&tn='), deposit.upi_uri);
  // Card checkout is not offered without the freelancer's own account; the client is pointed to UPI.
  const card = await call(`/api/review/${token}/deposit`, {method: 'POST', body: {}});
  eq([card.status, card.data.code, card.data.upi], [409, 'payment_account_required', true]);
  // The client says "I've paid" with the UTR.
  const claim = body => call(`/api/review/${token}/payment-claim`, {method: 'POST', body});
  eq((await claim({purpose: 'deposit', amount_minor: 2950000, method: 'upi', utr: '12345'})).data.code, 'invalid_utr');
  const c = await claim({purpose: 'deposit', amount_minor: 2950000, method: 'upi', utr: '4123 5678 9012', payer_name: 'Ada Client'});
  eq([c.status, c.data.claim.status, c.data.claim.utr], [201, 'pending', '••••••••9012']);
  eq((await claim({purpose: 'deposit', amount_minor: 2950000, method: 'upi', utr: '412356789012'})).data.code, 'duplicate_claim');
  // Nothing counts until the owner confirms.
  eq((await call(`/api/review/${token}/payments`)).data.money.deposit.covered, false);
  eq((await call('/api/review/' + token)).data.deposit.paid, null);
  const inbox = (await call(`/api/payments/claims?project_id=${project_id}`, {cookie: owner})).data.claims;
  eq(inbox.map(x => [x.amount_minor, x.method, x.utr, x.payer_name]), [[2950000, 'upi', '412356789012', 'Ada Client']]);
  const other = await signIn(base, `ws04-other-${Date.now()}@example.test`);
  eq((await call(`/api/payments/claims/${inbox[0].id}`, {method: 'POST', cookie: other, body: {action: 'confirm'}})).status, 404, 'another owner cannot confirm');
  const confirmed = await call(`/api/payments/claims/${inbox[0].id}`, {method: 'POST', cookie: owner, body: {action: 'confirm'}});
  eq(confirmed.status, 201);
  eq((await call(`/api/payments/claims/${inbox[0].id}`, {method: 'POST', cookie: owner, body: {action: 'confirm'}})).data.replayed, true, 'confirming twice records once');
  const ledger = (await call(`/api/scopes/${project_id}/ledger`, {cookie: owner})).data;
  const entry = ledger.entries.find(e => e.kind === 'payment_received');
  eq([entry.payload.amount, entry.payload.method, entry.payload.reference, entry.actor], [29500, 'upi', '412356789012', 'owner']);
  eq(ledger.entries.filter(e => e.kind === 'payment_received').length, 1);
  eq(ledger.chain.intact, true);
  eq((await call(`/api/review/${token}/payments`)).data.money.deposit.covered, true);
  eq((await call('/api/review/' + token)).data.deposit.paid.amount, 29500);
  // A rejected claim never touches the record.
  const created2 = await call('/api/scopes', {method: 'POST', cookie: owner, body: scope({deposit_pct: 50})});
  eq(await approve(created2.data.scope.token), 200);
  const c2 = await call(`/api/review/${created2.data.scope.token}/payment-claim`, {method: 'POST', body: {purpose: 'deposit', amount_minor: 500000, method: 'bank_transfer', utr: 'HDFCN52026101299'}});
  eq(c2.status, 201);
  eq((await call(`/api/payments/claims/${c2.data.claim.id}`, {method: 'POST', cookie: owner, body: {action: 'reject'}})).data.status, 'rejected');
  eq((await call(`/api/scopes/${created2.data.scope.project_id}/ledger`, {cookie: owner})).data.entries.length, 0);
  // Non-INR scopes never get a UPI option.
  const usd = await call('/api/scopes', {method: 'POST', cookie: owner, body: scope({currency: 'USD'})});
  eq(await approve(usd.data.scope.token), 200);
  const usdOptions = (await call(`/api/review/${usd.data.scope.token}/payments`)).data;
  eq([usdOptions.upi, usdOptions.targets.every(t => t.upi_uri === null)], [null, true]);
  // Disconnecting the UPI ID removes it from the client page.
  const id = upi.data.account.id;
  eq((await call('/api/payment-accounts/' + id, {method: 'DELETE', cookie: other})).status, 404);
  eq((await call('/api/payment-accounts/' + id, {method: 'DELETE', cookie: owner})).data.disconnected, true);
  eq((await call(`/api/review/${created2.data.scope.token}/payments`)).data.upi, null);
}

// ---- Stripe BYO validation: keys are checked before they are stored --------------------------------
{
  // @covers SF-20
  const owner = await signIn(base, `ws04-accounts-${Date.now()}@example.test`);
  eq((await call('/api/payment-accounts', {method: 'POST', cookie: owner, body: {kind: 'stripe_keys', secret_key: 'pk_test_wrong'}})).status, 400);
  eq((await call('/api/payment-accounts', {method: 'POST', cookie: owner, body: {kind: 'razorpay_route', linked_account_id: 'acc_ABCDEF123'}})).data.code, 'route_disabled', 'Route stays off without SCOPEFLOW_ROUTE_ENABLED');
  const oauth = await fetch(base + '/api/payment-accounts/razorpay/connect', {headers: {Cookie: owner}, redirect: 'manual'});
  eq([oauth.status, (await oauth.json()).code], [409, 'oauth_unavailable'], 'OAuth connect needs the Partner credentials');
}

console.log(`ws-04-payments: ${passed} checks passed`);
