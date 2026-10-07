// PR C regression suite: currencies from config, tax / deposit / payment terms in the signed
// content, and the project time zone shown with every timestamp.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {signIn} from './support/local.mjs';
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
const scope = extra => ({title: 'Money fixture ' + randomUUID().slice(0, 8), client: 'Fictional Client', deliverables: '', items: [{id: 'i_a', title: 'Design', qty: 1, unit: '', price: 60000, acceptance: ''}, {id: 'i_b', title: 'Build', qty: 1, unit: '', price: 40000, acceptance: ''}], client_inputs: [], exclusions: '', fee: 100000, currency: 'INR', revisions: 2, due: '', notes: '', ...extra});
const cookie = await signIn(base, `money-${Date.now()}@example.test`);

// New currencies and terms are accepted and stored exactly as part of the signed content.
const terms = {currency: 'AED', tax_label: 'VAT', tax_pct: 5, deposit_pct: 30, payment_terms: 'Balance due within 15 days of delivery'};
const created = await call('/api/scopes', {method: 'POST', cookie, body: scope(terms)});
eq(created.status, 201);
for (const [k, v] of Object.entries(terms)) eq(created.data.scope.content[k], v, k);
const {project_id, token} = created.data.scope;
eq((await call('/api/review/' + token)).data.scope.content.payment_terms, terms.payment_terms);

// Invalid terms are refused with a field message.
for (const bad of [{currency: 'XYZ'}, {tax_pct: 150}, {deposit_pct: -5}, {payment_terms: ''}]) {
  const r = await call('/api/scopes', {method: 'POST', cookie, body: scope(bad)});
  eq(r.status, 400, JSON.stringify(bad));
}
// Content without the new fields is unchanged (no defaults are injected into the signed form).
const plain = await call('/api/scopes', {method: 'POST', cookie, body: scope({currency: 'USD'})});
eq(Object.keys(plain.data.scope.content).filter(k => ['tax_label', 'tax_pct', 'deposit_pct', 'payment_terms'].includes(k)), []);

// Project time zone: owner-set, validated, shown to the client's review page.
const S = '/api/scopes/' + project_id;
eq((await call('/api/review/' + token)).data.time_zone, 'UTC');
eq((await call(S, {method: 'PATCH', cookie, body: {timezone: 'Asia/Kolkata'}})).data.project.timezone, 'Asia/Kolkata');
eq((await call(S, {cookie})).data.project.timezone, 'Asia/Kolkata');
eq((await call('/api/review/' + token)).data.time_zone, 'Asia/Kolkata');
eq((await call(S, {method: 'PATCH', cookie, body: {timezone: 'Mars/Olympus_Mons'}})).status, 400);
eq((await call(S, {method: 'PATCH', cookie, body: {timezone: "UTC'; DROP TABLE x;--"}})).status, 400);
eq((await call(S, {method: 'PATCH', cookie, body: {timezone: ''}})).data.project.timezone, null);
eq((await call('/api/review/' + token)).data.time_zone, 'UTC');
console.log(`money: ${passed} checks passed`);
