// PR F regression suite: deposit on signature. CI has no Razorpay API keys (deposits are
// disabled with an explanation) but sets RAZORPAY_WEBHOOK_SECRET, so the verified webhook path
// is exercised end to end: signature check, order and amount matching, idempotency, and the
// signed 'payment' ledger entry that the client's browser re-verifies.
import assert from 'node:assert/strict';
import {randomUUID, createHmac} from 'node:crypto';
import {signIn, ack, localSql} from './support/local.mjs';
const base = process.env.SCOPEFLOW_TEST_URL || 'http://localhost:5173';
assert.equal(new URL(base).hostname, 'localhost', 'Local fixtures only.');
const SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
assert.ok(SECRET && !process.env.RAZORPAY_KEY_ID, 'Run with RAZORPAY_WEBHOOK_SECRET set and no RAZORPAY_KEY_ID (server and tests).');
let passed = 0;
const eq = (a, b, message) => { assert.deepEqual(a, b, message); passed++; };
const ok = (v, message) => { assert.ok(v, message); passed++; };
async function call(path, {method = 'GET', cookie, body, raw, headers = {}} = {}) {
  const h = {Origin: base, ...headers};
  if (cookie) h.Cookie = cookie;
  if (body !== undefined || raw !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(base + path, {method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body))});
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return {status: r.status, data};
}
const webhook = (payload, secret = SECRET) => { const raw = JSON.stringify(payload); return call('/api/payments/razorpay/webhook', {method: 'POST', raw, headers: {'X-Razorpay-Signature': createHmac('sha256', secret).update(raw).digest('hex'), 'X-Razorpay-Event-Id': 'evt_' + randomUUID().slice(0, 8)}}); };
const captured = (order_id, amount, currency = 'INR') => ({event: 'payment.captured', payload: {payment: {entity: {id: 'pay_' + randomUUID().slice(0, 10), order_id, amount, currency, status: 'captured'}}}});

const cookie = await signIn(base, `payments-${Date.now()}@example.test`);
const created = await call('/api/scopes', {method: 'POST', cookie, body: {title: 'Deposit fixture ' + randomUUID().slice(0, 8), client: 'Acme', deliverables: 'Logo design suite', exclusions: '', fee: 100000, currency: 'INR', revisions: 2, due: '', notes: '', deposit_pct: 30}});
eq(created.status, 201); eq(created.data.scope.content.deposit_pct, 30);
const {project_id, token} = created.data.scope;

// Not approved yet: no deposit offered.
eq((await call('/api/review/' + token)).data.deposit, undefined);
eq((await call(`/api/review/${token}/deposit`, {method: 'POST', body: {}})).data.code, 'not_approved');
eq((await call('/api/review/' + token, {method: 'POST', body: await ack(base, token, {decision: 'approved', signer: 'Ada', comment: '', version: 1})})).status, 200);

// Approved, but no API keys: shown as due, disabled with the reason.
{
  const r = await call('/api/review/' + token);
  eq(r.data.deposit, {pct: 30, amount: 30000, currency: 'INR', amount_minor: 3000000, paid: null, enabled: false, provider: null, reason: 'Online payments are not set up on this server (RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are not set).'});
  const d = await call(`/api/review/${token}/deposit`, {method: 'POST', body: {}});
  eq(d.status, 503); eq(d.data.code, 'payments_disabled');
}

// Webhook: signature first, then order and amount must match a stored order.
const order_id = 'order_' + randomUUID().replaceAll('-', '').slice(0, 14);
localSql(`INSERT INTO scopeflow.payments (id,project_id,version,provider,order_id,amount_minor,currency,status,created) VALUES ('${randomUUID()}','${project_id}',1,'razorpay','${order_id}',3000000,'INR','created','${new Date().toISOString()}')`);
eq((await webhook(captured(order_id, 3000000), 'wrong-secret')).status, 400);
eq((await call('/api/payments/razorpay/webhook', {method: 'POST', raw: JSON.stringify(captured(order_id, 3000000))})).status, 400); // unsigned
eq((await webhook({event: 'payment.failed', payload: {}})).data, {ignored: 'event'});
eq((await webhook(captured('order_unknown', 3000000))).data, {ignored: 'unknown_order'});
eq((await webhook(captured(order_id, 100))).data, {ignored: 'amount_mismatch'});
eq((await webhook(captured(order_id, 3000000, 'USD'))).data, {ignored: 'amount_mismatch'});
eq((await call(`/api/scopes/${project_id}/ledger`, {cookie})).data.entries.length, 0);

// A valid capture is recorded once and appended to the signed ledger.
{
  const event = captured(order_id, 3000000);
  const r = await webhook(event);
  eq(r.status, 200); eq(r.data, {recorded: true, ledger: true, seq: 1});
  eq((await webhook(event)).data, {recorded: false, duplicate: true});
  eq((await webhook(captured(order_id, 3000000))).data, {recorded: false, duplicate: true}); // a second payment id for the same order
  const ledger = (await call(`/api/scopes/${project_id}/ledger`, {cookie})).data;
  eq(ledger.entries.length, 1);
  eq(ledger.entries[0].kind, 'payment'); eq(ledger.entries[0].actor, 'client');
  eq(ledger.entries[0].payload, {provider: 'razorpay', purpose: 'deposit', order_id, payment_id: event.payload.payment.entity.id, amount: 30000, currency: 'INR'});
  eq(ledger.chain.intact, true); eq(ledger.seal.state, 'valid');
  const review = (await call('/api/review/' + token)).data;
  eq(review.deposit.paid.amount, 30000); eq(review.deposit.paid.payment_id, event.payload.payment.entity.id);
  ok(review.ledger.entries.some(e => e.kind === 'payment'), 'the client sees the payment in the record');
  const owner = await call(`/api/scopes/${project_id}/ledger`, {method: 'POST', cookie, body: {kind: 'payment', baseline_version: 1, payload: ledger.entries[0].payload}});
  eq(owner.status, 400); // owners can never write a payment entry
  eq((await call(`/api/review/${token}/deposit`, {method: 'POST', body: {}})).status, 503); // still no keys
}

// Account deletion removes payment rows along with the projects.
eq((await call('/api/account', {method: 'DELETE', cookie, body: {confirmation: 'DELETE'}})).status, 200);
eq(localSql(`SELECT COUNT(*)::int AS n FROM scopeflow.payments WHERE project_id='${project_id}'`)[0].results[0].n, 0);
// The privacy notice names Razorpay as the deposit processor and no longer says payments are not collected.
{
  const privacy = await (await fetch(base + '/privacy')).text();
  ok(/Razorpay Payments Private Limited/.test(privacy), 'privacy notice names Razorpay Payments Private Limited as processor');
  ok(privacy.includes('href="https://razorpay.com/privacy/"'), "privacy notice links Razorpay's privacy policy");
  ok(/does not see or store card, UPI or bank details/.test(privacy), 'privacy notice says Scopeflow never sees payment instrument details');
  ok(/Razorpay order ID/.test(privacy) && /payment ID/.test(privacy), 'privacy notice lists the payment identifiers Scopeflow stores');
  ok(!/does not collect payments/.test(privacy), 'privacy notice no longer says payments are not collected');
}
// Deposits are live code, so no served page may still say Scopeflow takes no payments
// (the static source scan is tests/property/payment-copy.test.mjs).
{
  const forbidden = [/\b(?:does not|doesn['’]t|do not|never|no|not)\b[^.'"`<]{0,80}?\b(?:collects?|collecting|process(?:es)?|processing|takes?|accepts?)\s+payments?\b/i, /\bno\b[^.'"`<]{0,60}?\bpayment collection\b/i];
  for (const path of ['/', '/terms', '/privacy', '/reviewer-guide', '/plans', '/support', '/connect', '/verify', '/api/openapi']) {
    const r = await fetch(base + path); eq(r.status, 200, path);
    const text = await r.text();
    for (const re of forbidden) eq(re.exec(text)?.[0] ?? null, null, `${path} says Scopeflow takes no payments`);
  }
  const terms = await (await fetch(base + '/terms')).text();
  ok(terms.includes('Scopeflow itself is free during this beta') && terms.includes('Client deposits') && terms.includes('Razorpay merchant account the server operator configured'), 'terms describe client deposits through Razorpay');
}
console.log(`payments: ${passed} checks passed`);
