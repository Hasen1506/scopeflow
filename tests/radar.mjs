// PR E regression suite: the scope-creep radar endpoint. Keyword engine in CI (no AI key):
// verdicts cite numbered clauses, work before and after approval, and the drafted change
// order is accepted by the ledger as-is (the one-click "Draft change order" path).
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {signIn, ack} from './support/local.mjs';
const base = process.env.SCOPEFLOW_TEST_URL || 'http://localhost:5173';
assert.equal(new URL(base).hostname, 'localhost', 'Local fixtures only.');
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
const cookie = await signIn(base, `radar-${Date.now()}@example.test`), other = await signIn(base, `radar-other-${Date.now()}@example.test`);
const created = await call('/api/scopes', {method: 'POST', cookie, body: {title: 'Radar fixture ' + randomUUID().slice(0, 8), client: 'Acme', deliverables: '', items: [{id: 'i_design', title: 'Responsive page designs', qty: 5, unit: 'pages', price: null, acceptance: ''}, {id: 'i_logo', title: 'Logo refresh', qty: 1, unit: '', price: null, acceptance: ''}], client_inputs: [], exclusions: 'Hosting, SEO and printed business cards', fee: 1000, currency: 'USD', revisions: 2, due: '', notes: 'Extra work needs a change order.'}});
eq(created.status, 201);
const {project_id, token} = created.data.scope;
const R = `/api/scopes/${project_id}/radar`;

// Before approval: checks against the latest version.
{
  const r = await call(R, {method: 'POST', cookie, body: {message: 'Could you also print the business cards?'}});
  eq(r.status, 200); eq(r.data.basis, 'latest_version'); eq(r.data.ai, {enabled: false, provider: null, model: null, quality: null});
  eq(r.data.result.engine, 'keyword'); eq(r.data.result.covered, 'no');
  eq(r.data.result.citations.map(c => [c.id, c.text]), [['X3', 'printed business cards']]);
  eq(r.data.clauses.map(c => c.id), ['D1', 'D2', 'X1', 'X2', 'X3', 'T1', 'R1']);
}

// After approval: checks against the agreement; the drafted change order goes straight into the ledger.
eq((await call('/api/review/' + token, {method: 'POST', body: await ack(base, token, {decision: 'approved', signer: 'Ada', comment: '', version: 1})})).status, 200);
{
  const r = await call(R, {method: 'POST', cookie, body: {message: 'Can we get 8 page designs instead of five?'}});
  eq(r.data.basis, 'agreement'); eq(r.data.result.verdict, 'out_of_scope');
  eq(r.data.result.citations.map(c => c.id), ['D1']);
  const co = r.data.result.change_order;
  eq(co.add_items[0].qty, 3);
  const entry = await call(`/api/scopes/${project_id}/ledger`, {method: 'POST', cookie, body: {kind: 'change_order', baseline_version: 1, payload: {...co, fee_delta: 300}}});
  eq(entry.status, 201);
  ok(entry.data.agreement.change_orders.some(c => c.status === 'proposed' && c.request_quote.includes('8 page designs')), 'change order proposed from the radar draft');
  const covered = await call(R, {method: 'POST', cookie, body: {message: 'When will the responsive page designs be ready?'}});
  eq(covered.data.result.covered, 'yes'); eq(covered.data.result.citations.map(c => c.id), ['D1']);
  const revision = await call(R, {method: 'POST', cookie, body: {message: 'Please make the logo a bit darker'}});
  eq(revision.data.result.verdict, 'revision'); eq(revision.data.result.citations.map(c => c.id), ['D2', 'R1']);
}

// Access and validation.
eq((await call(R, {method: 'POST', body: {message: 'Anything at all here'}})).status, 401);
eq((await call(R, {method: 'POST', cookie: other, body: {message: 'Anything at all here'}})).status, 404);
eq((await call(R, {method: 'POST', cookie, body: {message: 'hi'}})).status, 400);
eq((await call(R, {method: 'POST', cookie, body: {message: 'x'.repeat(4001)}})).status, 400);
eq((await call(R, {method: 'POST', cookie, body: {message: 'Valid message here', extra: 1}})).status, 400);
console.log(`radar: ${passed} checks passed`);
