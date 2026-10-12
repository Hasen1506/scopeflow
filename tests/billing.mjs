// Business profile, numbered invoices, review-link opens and automatic reminders, end to end
// against the local preview and the disposable local database.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {signIn, ack, localSql} from './support/local.mjs';
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
  return {status: r.status, data, headers: r.headers};
}
const q = v => "'" + String(v).replaceAll("'", "''") + "'";
const cookie = await signIn(base, `billing-${randomUUID()}@example.test`);
const other = await signIn(base, `billing-other-${randomUUID()}@example.test`);
const scope = {title: 'Billing fixture ' + randomUUID().slice(0, 8), client: 'Kaveri Foods', deliverables: 'Packaging design', exclusions: '', fee: 100000, currency: 'INR', revisions: 2, due: '', notes: '', tax_label: 'GST', tax_pct: 18, deposit_pct: 30};

// ---- Business profile ------------------------------------------------------------------
const empty = await call('/api/profile', {cookie});
eq(empty.status, 200); eq(empty.data.profile.business_name, ''); eq(empty.data.profile.auto_remind_days, null);
eq((await call('/api/profile')).status, 401);
const profile = {...empty.data.profile, business_name: 'Ada Studio', business_address: '12 MG Road, Chennai', tax_id: '33ABCDE1234F1Z5', payment_details: 'UPI ada@okbank', invoice_prefix: 'AS-', default_currency: 'INR', default_tax_label: 'GST', default_tax_pct: 18, default_deposit_pct: 30, default_payment_terms: 'Net 15', auto_remind_days: 5};
eq((await call('/api/profile', {method: 'PUT', cookie, body: {...profile, auto_remind_days: 4}})).status, 400);
eq((await call('/api/profile', {method: 'PUT', cookie, body: {...profile, invoice_prefix: 'bad prefix'}})).status, 400);

// ---- Invoices ----------------------------------------------------------------------------
const created = await call('/api/scopes', {method: 'POST', cookie, body: scope});
eq(created.status, 201);
const {project_id, token} = created.data.scope;
const I = `/api/scopes/${project_id}/invoices`;
eq((await call(I, {method: 'POST', cookie, body: {amount: 100}})).data.code, 'profile_required');
eq((await call('/api/profile', {method: 'PUT', cookie, body: profile})).data.profile, profile);
eq((await call(I, {method: 'POST', cookie, body: {amount: 100}})).data.code, 'not_approved');
eq((await call('/api/review/' + token, {method: 'POST', body: await ack(base, token, {decision: 'approved', signer: 'Ada', comment: '', version: 1})})).status, 200);
// changed by WS-03 (C2): amounts are the taxable value unless includes_tax; over the agreement is 409 exceeds_uninvoiced.
eq((await call(I, {method: 'POST', cookie, body: {amount: 118001, includes_tax: true}})).status, 409); // total with tax is 1,18,000
eq((await call(I, {method: 'POST', cookie, body: {amount: 10.005}})).status, 400);
eq((await call(I, {method: 'POST', cookie, body: {amount: 10, extra: 1}})).status, 400);
eq((await call(I, {method: 'POST', cookie: other, body: {amount: 10}})).status, 404);
const rid = 'inv-' + randomUUID();
// changed by WS-03: the amount entered here includes GST (the default is now the taxable value).
const first = await call(I, {method: 'POST', cookie, body: {amount: 35400, includes_tax: true, description: 'Deposit (30%)', due_days: 7, request_id: rid}});
eq(first.status, 201); eq(first.data.invoice.number, 'AS-0001'); eq(first.data.invoice.amount, 35400);
eq((await call(I, {method: 'POST', cookie, body: {amount: 35400, includes_tax: true, description: 'Deposit (30%)', due_days: 7, request_id: rid}})).data, {invoice: first.data.invoice, replayed: true}); // changed by WS-03: includes_tax
const second = await call(I, {method: 'POST', cookie, body: {amount: 82600, includes_tax: true}}); // changed by WS-03: includes_tax
eq(second.data.invoice.number, 'AS-0002');
eq((await call(I, {cookie})).data.invoices.map(i => i.number), ['AS-0001', 'AS-0002']);
{
  const r = await fetch(base + I + '/1', {headers: {Cookie: cookie}});
  eq(r.status, 200); eq(r.headers.get('content-type'), 'application/pdf');
  const pdf = Buffer.from(await r.arrayBuffer()).toString('latin1').replace(/\\([()])/g, '$1');
  // A GSTIN seller charging GST issues a tax invoice; with no client state on record the place of supply is the seller's own state.
  for (const s of ['TAX INVOICE', 'AS-0001', 'Ada Studio', 'GSTIN: 33ABCDE1234F1Z5', 'Kaveri Foods', 'Deposit (30%)', 'CGST (9%)', 'SGST (9%)', 'Place of supply: Tamil Nadu (33)', 'Rs.35,400.00', 'UPI ada@okbank']) ok(pdf.includes(s), 'invoice PDF states ' + s);
  eq((await call(I + '/1', {cookie: other})).status, 404);
  eq((await call(I + '/99', {cookie})).status, 404);
}
// Issued invoices are frozen: later profile changes do not alter them, and the database refuses edits.
eq((await call('/api/profile', {method: 'PUT', cookie, body: {...profile, business_name: 'Renamed Studio'}})).status, 200);
ok(Buffer.from(await (await fetch(base + I + '/1', {headers: {Cookie: cookie}})).arrayBuffer()).toString('latin1').includes('Ada Studio'), 'an issued invoice keeps the seller details it was issued with');
assert.throws(() => localSql(`UPDATE scopeflow.invoices SET amount=1 WHERE project_id=${q(project_id)}`), /immutable/); passed++;
assert.throws(() => localSql(`DELETE FROM scopeflow.invoices WHERE project_id=${q(project_id)}`), /immutable/); passed++;
// Paid in full: nothing left to invoice.
eq((await call(`/api/scopes/${project_id}/ledger`, {method: 'POST', cookie, body: {kind: 'payment_received', baseline_version: 1, payload: {amount: 118000, method: 'bank_transfer', received: '2026-10-01'}}})).status, 201);
// changed by WS-03 (C2): invoiced in full, so nothing is left to invoice: 409 exceeds_uninvoiced (was 400 on the paid balance).
eq((await call(I, {method: 'POST', cookie, body: {amount: 1}})).data.code, 'exceeds_uninvoiced');

// ---- Review-link opens --------------------------------------------------------------------
const pending = await call('/api/scopes', {method: 'POST', cookie, body: {...scope, title: 'Opens fixture ' + randomUUID().slice(0, 8)}});
const P = pending.data.scope;
const viewed = async () => (await call('/api/overview', {cookie})).data.projects.find(p => p.project_id === P.project_id).viewed;
eq(await viewed(), null);
eq((await call('/api/review/' + P.token, {cookie})).status, 200); // the owner previewing: not counted
eq(await viewed(), null);
await call('/api/review/' + P.token); await call('/api/review/' + P.token);
const v = await viewed();
eq(v.count, 2); ok(v.first <= v.last, 'first open is not after the last');

// ---- Automatic reminders (dry run) ----------------------------------------------------------
eq((await call(`/api/scopes/${P.project_id}`, {method: 'PATCH', cookie, body: {client_email: 'kaveri@example.test'}})).status, 200);
const recent = await call('/api/scopes', {method: 'POST', cookie, body: {...scope, title: 'Recent fixture ' + randomUUID().slice(0, 8)}});
eq((await call(`/api/scopes/${recent.data.scope.project_id}`, {method: 'PATCH', cookie, body: {client_email: 'recent@example.test'}})).status, 200);
const noEmail = await call('/api/scopes', {method: 'POST', cookie, body: {...scope, title: 'No email fixture ' + randomUUID().slice(0, 8)}});
const sixDaysAgo = new Date(Date.now() - 6 * 86400_000).toISOString();
localSql(`UPDATE scopeflow.projects SET last_sent=${q(sixDaysAgo)}, sent_version=1 WHERE id IN (${q(P.project_id)},${q(noEmail.data.scope.project_id)})`);
const dry = () => {
  const r = spawnSync(process.execPath, ['scripts/send-reminders.mjs', '--dry-run'], {encoding: 'utf8', env: {...process.env, APP_URL: base}});
  assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout.trim().split('\n').at(-1)).due.filter(d => [P.project_id, recent.data.scope.project_id, noEmail.data.scope.project_id].includes(d.project_id));
};
eq(dry(), [{project_id: P.project_id, version: 1, to: 'kaveri@example.test'}]);
eq((await call('/api/profile', {method: 'PUT', cookie, body: {...profile, auto_remind_days: 7}})).status, 200);
eq(dry(), []); // waited 6 days, the owner asked for 7
eq((await call('/api/profile', {method: 'PUT', cookie, body: {...profile, auto_remind_days: null}})).status, 200);
eq(dry(), []);
{
  const r = spawnSync(process.execPath, ['scripts/send-reminders.mjs'], {encoding: 'utf8', env: {...process.env, APP_URL: base, RESEND_API_KEY: '', SCOPEFLOW_MAIL_FROM: ''}});
  eq(r.status, 0); ok(/email delivery is not configured/.test(r.stdout), 'without a provider nothing is sent');
}

// ---- New drafts and deletion ------------------------------------------------------------------
// Account deletion removes invoices, opens and the business profile with everything else.
eq((await call('/api/account', {method: 'DELETE', cookie, body: {confirmation: 'DELETE'}})).status, 200);
eq(localSql(`SELECT (SELECT COUNT(*)::int FROM scopeflow.invoices WHERE project_id=${q(project_id)}) + (SELECT COUNT(*)::int FROM scopeflow.review_views WHERE project_id=${q(P.project_id)}) AS n`)[0].results[0].n, 0);
eq((await call('/api/profile', {cookie})).data.profile.business_name, '');
console.log(`billing: ${passed} checks passed`);
