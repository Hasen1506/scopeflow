// WS-01 integration suite (auto-discovered by tests/run-local.mjs): money validation at the API
// (M5), the yen deposit end to end (M4), the FX route's manual answer (L6) and the exact minor-unit
// columns on issued invoices (M3, migration 0015). Localhost and the disposable database only.
// @covers M3 M4 M5 L6
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {signIn, ack, localSql as runSql} from './support/local.mjs';
// tests/support/sql.mjs answers one {results} object per statement; these checks run one statement each.
const localSql = command => runSql(command)[0].results;
const base = process.env.SCOPEFLOW_TEST_URL || 'http://localhost:5173';
assert.equal(new URL(base).hostname, 'localhost', 'Local fixtures only.');
let passed = 0;
const eq = (a, b, message) => { assert.deepEqual(a, b, message); passed++; };
async function call(path, {method = 'GET', cookie, body} = {}) {
  const h = {Origin: base};
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(base + path, {method, headers: h, body: body === undefined ? undefined : JSON.stringify(body)});
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return {status: r.status, data};
}
const scope = extra => ({title: 'TEST WS-01 ' + randomUUID().slice(0, 8), client: 'Fictional Client', deliverables: 'Logo design', exclusions: '', fee: 1000, currency: 'INR', revisions: 2, due: '', notes: '', ...extra});
const cookie = await signIn(base, `ws01-${randomUUID()}@example.test`);

// ---- M5: money decimals per currency, with a field-level message ---------------------------------
{
  const r = await call('/api/scopes', {method: 'POST', cookie, body: scope({fee: 100.0049})});
  eq(r.status, 400); eq(r.data.error, 'fee: Use at most 2 decimals');
  const jpy = await call('/api/scopes', {method: 'POST', cookie, body: scope({currency: 'JPY', fee: 10.5})});
  eq(jpy.status, 400); eq(jpy.data.error, 'fee: Use whole amounts: JPY has no decimals');
  const item = await call('/api/scopes', {method: 'POST', cookie, body: scope({deliverables: '', items: [{id: 'i1', title: 'Pages', qty: 12, unit: 'pages', price: null, acceptance: '', unit_price: 600.005}]})});
  eq(item.status, 400); eq(item.data.error, 'items.0.unit_price: Use at most 2 decimals');
  eq((await call('/api/scopes', {method: 'POST', cookie, body: scope({fee: 100.01})})).status, 201);
}

// ---- M4 / M6: a yen deposit is whole yen, and a unit price survives in the signed content --------
{
  const created = await call('/api/scopes', {method: 'POST', cookie, body: scope({currency: 'JPY', fee: 1000, deposit_pct: 33.333, deliverables: '', items: [{id: 'i_g', title: 'Guide pages', qty: 2, unit: 'pages', price: null, acceptance: '', unit_price: 500}]})});
  eq(created.status, 201);
  eq(created.data.scope.content.items[0].unit_price, 500);
  const {project_id, token} = created.data.scope;
  eq((await call('/api/review/' + token, {method: 'POST', body: await ack(base, token, {decision: 'approved', signer: 'Kenji', comment: '', version: 1})})).status, 200);
  const review = await call('/api/review/' + token);
  eq([review.data.deposit.amount, review.data.deposit.amount_minor, review.data.deposit.currency], [333, 333, 'JPY']);
  eq((await call(`/api/scopes/${project_id}/ledger`, {method: 'POST', cookie, body: {kind: 'payment_received', baseline_version: 1, payload: {amount: 333, method: 'bank_transfer', received: new Date().toISOString().slice(0, 10), reference: 'TEST'}}})).status, 201);
}

// ---- L6: when no provider has a rate the owner is asked for rate, source and date -----------------
{
  const r = await call('/api/fx?from=LKR&to=EUR', {cookie});
  eq(r.status, 502); eq(r.data.code, 'fx_unavailable');
  eq(r.data.manual.required, ['rate', 'source', 'as_of']);
  assert.match(r.data.error, /Enter the rate, its source and its date yourself/); passed++;
  eq((await call('/api/fx?from=USD&to=INR', {cookie})).data, {rate: 83.25, as_of: '2026-10-01', source: 'Reference rate'});
}

// ---- M3: issued invoices carry exact minor units (generated columns from migration 0015) ----------
{
  const cols = localSql("SELECT column_name, data_type, is_generated FROM information_schema.columns WHERE table_schema='scopeflow' AND table_name='invoices' AND column_name IN ('amount_minor','currency_exponent') ORDER BY column_name");
  eq(cols.map(c => [c.column_name, c.data_type, c.is_generated]), [['amount_minor', 'bigint', 'ALWAYS'], ['currency_exponent', 'smallint', 'ALWAYS']]);
  const bad = localSql("SELECT count(*)::int AS n FROM scopeflow.invoices WHERE amount_minor <> round(amount::numeric * 10 ^ currency_exponent) OR currency_exponent <> (CASE WHEN currency = 'JPY' THEN 0 ELSE 2 END)");
  eq(bad[0].n, 0);
  eq(localSql("SELECT scopeflow.currency_exponent('JPY') AS j, scopeflow.currency_exponent('INR') AS i, scopeflow.currency_exponent('KWD') AS k")[0], {j: 0, i: 2, k: 3});
}
console.log(`ws-01 money: ${passed} checks passed`);
