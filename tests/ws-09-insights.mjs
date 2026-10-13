// WS-09 SF-16 route suite: /api/insights folds every approved baseline (C4 family), so a supersede keeps
// the earlier change order and payment; the ₹ recovered hero, money figures, filters and CSV export come
// from the same route. Localhost fixtures only; fictional accounts.
// @covers SF-16
import assert from 'node:assert/strict';
import {signIn, ack} from './support/local.mjs';
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
  return {status: r.status, data, type: r.headers.get('content-type') ?? ''};
}
const st = (r, s) => eq(r.status, s, JSON.stringify(r.data).slice(0, 300));
const cookie = await signIn(base, `ws09-insights-${Date.now()}@example.test`);
const today = new Date().toISOString().slice(0, 10);
const scope = (fee = 10000) => ({title: 'TEST WS-09 insights', client: 'Kaveri Foods', deliverables: '', items: [{id: 'logo', title: 'Logo suite', qty: 1, unit: '', price: null, acceptance: ''}], client_inputs: [], exclusions: 'Print', fee, currency: 'INR', revisions: 2, due: '', notes: '', tax_label: 'GST', tax_pct: 18});
const approve = async token => st(await call('/api/review/' + token, {method: 'POST', body: await ack(base, token, {decision: 'approved', signer: 'Fictional Client', comment: '', version: (await call('/api/review/' + token)).data.scope.version})}), 200);
const changeOrder = async (p, v, token, fee) => {
  const co = await call(`/api/scopes/${p}/ledger`, {method: 'POST', cookie, body: {kind: 'change_order', baseline_version: v, payload: {title: 'Extra work ' + fee, fee_delta: fee}}});
  st(co, 201);
  st(await call('/api/review/' + token + '/change-order', {method: 'POST', body: {seq: co.data.seq, decision: 'approved', signer: 'Fictional Client', comment: ''}}), 200);
};
const pay = async (p, v, amount) => st(await call(`/api/scopes/${p}/ledger`, {method: 'POST', cookie, body: {kind: 'payment_received', baseline_version: v, payload: {amount, method: 'bank_transfer', received: today}}}), 201);

// v1 ₹10,000 + CO-1 ₹5,000 approved; the client pays ₹17,700 (= ₹15,000 + GST): base fee first, then the CO.
const created = await call('/api/scopes', {method: 'POST', cookie, body: scope()});
st(created, 201);
const p = created.data.scope.project_id, t1 = created.data.scope.token;
await approve(t1);
await changeOrder(p, 1, t1, 5000);
await pay(p, 1, 17700);
let ins = (await call('/api/insights', {cookie})).data;
eq(ins.recovered.last_12, {INR: 5000}); eq(ins.recovered.this_month, {INR: 5000}); eq(ins.recovered.change_orders, 1);
eq(ins.money.received, {INR: 17700});

// Supersede: v2 folds CO-1 in (₹15,000). While v2 is pending the v1 agreement still counts.
const v2 = await call('/api/scopes/' + p, {method: 'POST', cookie, body: {expected_version: 1, content: scope(15000), supersede_agreement: true}});
st(v2, 201);
ins = (await call('/api/insights', {cookie})).data;
eq(ins.projects, 1, 'a pending revision does not hide the approved agreement');
await approve(v2.data.scope.token);
await changeOrder(p, 2, v2.data.scope.token, 2000);
ins = (await call('/api/insights', {cookie})).data;
// Before SF-16 the route folded only the latest baseline: 1 approved CO, ₹2,000, and the v1 payment lost.
eq(ins.change_orders.approved, 2, 'the v1 change order survives the supersede');
eq(ins.fee_at_approval, {INR: 10000}); eq(ins.fee_now, {INR: 17000});
eq(ins.recovered.last_12, {INR: 5000}, 'CO-2 is not recovered until it is paid');
eq(ins.money.outstanding, {INR: 2360});
await pay(p, 2, 2360);
ins = (await call('/api/insights', {cookie})).data;
eq(ins.recovered.last_12, {INR: 7000}); eq(ins.recovered.change_orders, 2); eq(ins.money.received, {INR: 20060});
ok(ins.observations.some(o => /Recovered from change orders/.test(o)), 'recovered observation');
for (const k of ['fee_at_approval', 'fee_now', 'change_order_value', 'creep', 'goodwill_value', 'revision_rounds', 'clients', 'series', 'flow', 'options']) ok(k in ins, k);
eq(ins.options.clients, ['Kaveri Foods']);

// Filters and CSV.
eq((await call('/api/insights?currency=USD', {cookie})).data.projects, 0);
eq((await call('/api/insights?client=kaveri%20foods&period=month', {cookie})).data.projects, 1);
const csv = await call('/api/insights?format=csv', {cookie});
st(csv, 200); ok(csv.type.startsWith('text/csv'), csv.type);
ok(csv.data.startsWith('section,metric,currency,value\r\n') && /recovered,last_12_months,INR,7000\r\n/.test(csv.data), 'csv rows');
st(await call('/api/insights'), 401);
console.log(JSON.stringify({passed, suite: 'ws-09-insights'}));
