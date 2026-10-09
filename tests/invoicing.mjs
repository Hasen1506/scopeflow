// Money features end to end against the local preview and the disposable local database: GST tax
// invoices (CGST + SGST / IGST, place of supply), payment milestones invoiced by share, Net-X due
// dates, payment status on invoices for owner and client, reference exchange rates locked into the
// signed scope, the revision bank, overdue-invoice reminders and Razorpay reconciliation.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {signIn, ack, localSql} from './support/local.mjs';
const base = process.env.SCOPEFLOW_TEST_URL || 'http://localhost:5173';
assert.equal(new URL(base).hostname, 'localhost', 'Local fixtures only.');
assert.ok(process.env.SCOPEFLOW_CRON_SECRET && process.env.SCOPEFLOW_FX_URL, 'Run with SCOPEFLOW_CRON_SECRET and SCOPEFLOW_FX_URL set (server and tests).');
let passed = 0;
const eq = (a, b, message) => { assert.deepEqual(a, b, message); passed++; };
const ok = (v, message) => { assert.ok(v, message); passed++; };
async function call(path, {method = 'GET', cookie, body, headers = {}} = {}) {
  const h = {Origin: base, ...headers};
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(base + path, {method, headers: h, body: body === undefined ? undefined : JSON.stringify(body)});
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return {status: r.status, data, headers: r.headers};
}
const pdfText = async (path, cookie) => {
  const r = await fetch(base + path, {headers: cookie ? {Cookie: cookie} : {}});
  assert.equal(r.status, 200, path); assert.equal(r.headers.get('content-type'), 'application/pdf');
  return Buffer.from(await r.arrayBuffer()).toString('latin1').replace(/\\([()])/g, '$1');
};
const q = v => "'" + String(v).replaceAll("'", "''") + "'";
const cookie = await signIn(base, `invoicing-${randomUUID()}@example.test`);

// ---- Reference exchange rates ------------------------------------------------------------------
eq((await call('/api/fx?from=USD&to=INR')).status, 401);
{
  const r = await call('/api/fx?from=USD&to=INR', {cookie});
  eq(r.status, 200); eq(r.data, {rate: 83.25, as_of: '2026-10-01', source: 'Reference rate'});
  eq((await call('/api/fx?from=USD&to=USD', {cookie})).data.code, 'invalid_currency');
  eq((await call('/api/fx?from=USD&to=XYZ', {cookie})).status, 400);
}

// ---- Scope terms: schedule, second currency, revision bank -------------------------------------
const terms = {
  title: 'Invoicing fixture ' + randomUUID().slice(0, 8), client: 'Nilgiri Tea Co', deliverables: 'Website redesign', exclusions: '', fee: 200000, currency: 'INR', revisions: 2, due: '', notes: '',
  tax_label: 'GST', tax_pct: 18, payment_terms: 'Net 30 from each invoice',
  milestones: [{id: 'm_sign', title: 'On signature', pct: 40, due: ''}, {id: 'm_beta', title: 'Beta site', pct: 35, due: '2026-12-01'}, {id: 'm_live', title: 'Launch', pct: 25, due: ''}],
  fx: {currency: 'USD', rate: 0.012012, as_of: '2026-10-01', source: 'Reference rate'},
  revision_bank: {unit: 'hours', amount: 10, overage_rate: 2500},
};
eq((await call('/api/scopes', {method: 'POST', cookie, body: {...terms, milestones: terms.milestones.slice(0, 2)}})).status, 400); // 75%
eq((await call('/api/scopes', {method: 'POST', cookie, body: {...terms, deposit_pct: 20}})).status, 400); // deposit and schedule
eq((await call('/api/scopes', {method: 'POST', cookie, body: {...terms, fx: {...terms.fx, currency: 'INR'}}})).status, 400);
eq((await call('/api/scopes', {method: 'POST', cookie, body: {...terms, revision_bank: {unit: 'days', amount: 3}}})).status, 400);
const created = await call('/api/scopes', {method: 'POST', cookie, body: terms});
eq(created.status, 201);
const {project_id, token} = created.data.scope;
eq(created.data.scope.content.milestones, terms.milestones);
eq(created.data.scope.content.fx, terms.fx);

// ---- GST profile and client billing details ----------------------------------------------------
const profile = (await call('/api/profile', {cookie})).data.profile;
eq([profile.gst_state, profile.sac_code, profile.lut_arn], ['', '', '']);
eq((await call('/api/profile', {method: 'PUT', cookie, body: {...profile, business_name: 'Ada Studio', tax_id: '33ABCDE1234F1Z5', gst_state: '99'}})).status, 400);
eq((await call('/api/profile', {method: 'PUT', cookie, body: {...profile, business_name: 'Ada Studio', tax_id: '33ABCDE1234F1Z5', sac_code: '99A'}})).status, 400);
const saved = await call('/api/profile', {method: 'PUT', cookie, body: {...profile, business_name: 'Ada Studio', business_address: '12 MG Road, Chennai', tax_id: '33ABCDE1234F1Z5', invoice_prefix: 'NT-', gst_state: '33', sac_code: '998314', lut_arn: 'AD330925000123X'}});
eq(saved.status, 200); eq(saved.data.profile.sac_code, '998314');
// An older client that sends the profile without the GST fields still saves (they default to empty).
{
  const {gst_state: _a, sac_code: _b, lut_arn: _c, ...legacy} = saved.data.profile;
  void _a; void _b; void _c;
  eq((await call('/api/profile', {method: 'PUT', cookie, body: legacy})).data.profile.gst_state, '');
  eq((await call('/api/profile', {method: 'PUT', cookie, body: saved.data.profile})).data.profile.gst_state, '33');
}
const P = `/api/scopes/${project_id}`;
eq((await call(P, {method: 'PATCH', cookie, body: {client_gstin: 'NOT-A-GSTIN'}})).status, 400);
eq((await call(P, {method: 'PATCH', cookie, body: {client_state: '00'}})).status, 400);
{
  const r = await call(P, {method: 'PATCH', cookie, body: {client_gstin: '29aaacn1234f1z5', client_address: '4 Residency Road, Bengaluru'}});
  eq(r.status, 200); eq([r.data.project.client_gstin, r.data.project.client_state, r.data.project.client_address], ['29AAACN1234F1Z5', '', '4 Residency Road, Bengaluru']);
  eq((await call(P, {cookie})).data.project.client_gstin, '29AAACN1234F1Z5');
}

// ---- Approval, then milestone invoices ---------------------------------------------------------
eq((await call('/api/review/' + token, {method: 'POST', body: await ack(base, token, {decision: 'approved', signer: 'Meera', comment: '', version: 1})})).status, 200);
const I = `${P}/invoices`;
{
  const r = await call(I, {cookie});
  eq(r.data.net_days, 30);
  eq(r.data.schedule.map(m => [m.id, m.amount, m.invoiced]), [['m_sign', 94400, 0], ['m_beta', 82600, 0], ['m_live', 59000, 0]]); // 2,36,000 total
}
eq((await call(I, {method: 'POST', cookie, body: {milestone_id: 'nope'}})).data.code, 'unknown_milestone');
eq((await call(I, {method: 'POST', cookie, body: {}})).status, 400);
const first = await call(I, {method: 'POST', cookie, body: {milestone_id: 'm_sign'}});
eq(first.status, 201); eq([first.data.invoice.number, first.data.invoice.amount, first.data.invoice.tax_invoice, first.data.invoice.milestone], ['NT-0001', 94400, true, 'm_sign']);
eq(first.data.invoice.due, new Date(Date.parse(first.data.invoice.issued + 'T00:00:00Z') + 30 * 86400_000).toISOString().slice(0, 10)); // Net 30
eq((await call(I, {method: 'POST', cookie, body: {milestone_id: 'm_sign'}})).data.code, 'milestone_invoiced');
{
  const pdf = await pdfText(`${I}/1`, cookie);
  // Bengaluru client of a Chennai seller: inter-state, so IGST.
  for (const s of ['TAX INVOICE', 'GSTIN: 33ABCDE1234F1Z5', 'State: Tamil Nadu (33)', 'GSTIN: 29AAACN1234F1Z5', 'Place of supply: Karnataka (29)', 'Reverse charge: No', 'SAC 998314', 'Taxable value', 'Rs.80,000.00', 'IGST (18%)', 'Rs.14,400.00', 'Rs.94,400.00',
    'Amount in words: Ninety-four thousand four hundred rupees only', 'On signature (40% milestone)', 'In USD at the agreed 0.012012', '$1,133.93', 'Authorised signatory', 'Net 30 from each invoice']) ok(pdf.includes(s), 'tax invoice states ' + s);
  ok(!pdf.includes('CGST'), 'inter-state invoice has no CGST');
}
// Same state: CGST + SGST. A partial milestone invoice leaves the rest open for the next one.
eq((await call(P, {method: 'PATCH', cookie, body: {client_gstin: '', client_state: '33'}})).status, 200);
const second = await call(I, {method: 'POST', cookie, body: {milestone_id: 'm_beta', amount: 50000, due_days: 0}});
eq(second.status, 201); eq(second.data.invoice.due, second.data.invoice.issued);
{
  const pdf = await pdfText(`${I}/2`, cookie);
  for (const s of ['CGST (9%)', 'SGST (9%)', 'Rs.3,813.56', 'Rs.42,372.88', 'Place of supply: Tamil Nadu (33)']) ok(pdf.includes(s), 'intra-state invoice states ' + s);
  ok(!pdf.includes('IGST'), 'intra-state invoice has no IGST');
  const plan = (await call(I, {cookie})).data.schedule;
  eq(plan.find(m => m.id === 'm_beta').invoiced, 50000);
  const rest = await call(I, {method: 'POST', cookie, body: {milestone_id: 'm_beta'}});
  eq(rest.data.invoice.amount, 32600);
}
// Export: a client outside India under the seller's LUT.
eq((await call(P, {method: 'PATCH', cookie, body: {client_state: '96'}})).status, 200);
{
  const r = await call(I, {method: 'POST', cookie, body: {amount: 1000, description: 'Export check'}});
  const pdf = await pdfText(`${I}/${r.data.invoice.seq}`, cookie);
  for (const s of ['Place of supply: Outside India (export)', 'Supply meant for export on payment of IGST.']) ok(pdf.includes(s), 'export invoice states ' + s);
}

// ---- Payment status for owner and client -------------------------------------------------------
eq((await call(`${P}/ledger`, {method: 'POST', cookie, body: {kind: 'payment_received', baseline_version: 1, payload: {amount: 100000, method: 'bank_transfer', received: new Date().toISOString().slice(0, 10), reference: 'UTR123'}}})).status, 201);
{
  const list = (await call(I, {cookie})).data.invoices;
  eq(list.map(i => [i.number, i.status, i.covered]), [['NT-0001', 'paid', 94400], ['NT-0002', 'part', 5600], ['NT-0003', 'open', 0], ['NT-0004', 'open', 0]]);
  ok(list.every(i => !i.overdue), 'nothing is overdue on the day it is issued');
  const client = (await call('/api/review/' + token)).data.ledger.invoices;
  eq(client.map(i => [i.number, i.status]), list.map(i => [i.number, i.status]));
  ok((await pdfText(`/api/review/${token}/invoices/1`)).includes('NT-0001'), 'client downloads the invoice PDF');
  eq((await call(`/api/review/${token}/invoices/99`)).status, 404);
  eq((await call(`/api/review/${'0'.repeat(64)}/invoices/1`)).status, 404);
}

// ---- Revision bank ------------------------------------------------------------------------------
const L = `${P}/ledger`;
eq((await call(L, {method: 'POST', cookie, body: {kind: 'revision_round', baseline_version: 1, payload: {feedback_date: '2026-10-02', note: 'Hero copy'}}})).status, 400); // hours required
eq((await call(L, {method: 'POST', cookie, body: {kind: 'revision_round', baseline_version: 1, payload: {feedback_date: '2026-10-02', note: 'Hero copy', used: 6.5}}})).status, 201);
eq((await call(L, {method: 'POST', cookie, body: {kind: 'revision_round', baseline_version: 1, payload: {feedback_date: '2026-10-05', note: 'Footer', used: 5}}})).status, 201);
{
  const a = (await call(L, {cookie})).data.agreement;
  eq(a.bank, {unit: 'hours', allowed: 10, used: 11.5, left: 0, over: 1.5, overage_rate: 2500, overage_value: 3750});
  eq((await call('/api/review/' + token)).data.ledger.agreement.bank.over, 1.5);
}
eq((await call(L, {method: 'POST', cookie, body: {kind: 'change_order', baseline_version: 1, payload: {title: 'Too big a cut', bank_delta: -20}}})).status, 400);
const topUp = await call(L, {method: 'POST', cookie, body: {kind: 'change_order', baseline_version: 1, payload: {title: 'Top up revision hours', bank_delta: 5, fee_delta: 12500}}});
eq(topUp.status, 201);
{
  const view = await call('/api/review/' + token);
  ok(view.data.ledger.entries.some(e => e.kind === 'change_order' && e.payload.bank_delta === 5), 'client sees the bank top-up');
  eq((await call(`/api/review/${token}/change-order`, {method: 'POST', body: {seq: topUp.data.seq, decision: 'approved', signer: 'Meera', comment: ''}})).status, 200);
  eq((await call(L, {cookie})).data.agreement.bank.allowed, 15);
  const statement = await pdfText(`${P}/statement`, cookie);
  for (const s of ['PAYMENT SCHEDULE', 'On signature (40%)', 'REVISION HOURS', '11.5h of 15h used']) ok(statement.includes(s), 'statement states ' + s);
}

// ---- Overdue invoice reminders (daily job, dry run) --------------------------------------------
{
  // An invoice issued 40 days ago with Net 30 (inserted directly: issued invoices cannot be backdated through the API).
  const issued = new Date(Date.now() - 40 * 86400_000).toISOString().slice(0, 10), due = new Date(Date.now() - 10 * 86400_000).toISOString().slice(0, 10);
  const owner = localSql(`SELECT owner FROM scopeflow.projects WHERE id=${q(project_id)}`)[0].results[0].owner;
  const content = {number: 'OLD-1', issued, due, seller: {name: 'Ada Studio', address: '', tax_id: '', payment_details: ''}, client: {name: 'Nilgiri Tea Co', email: ''}, project: {id: project_id, title: terms.title, version: 1}, currency: 'INR', line: {description: 'Old', amount: 1000}, tax: null, total: 1000, agreement: {total: 1000, paid_before: 0, balance_before: 1000, balance_after: 0}, payment_terms: ''};
  const other = await signIn(base, `invoicing-late-${randomUUID()}@example.test`);
  const late = await call('/api/scopes', {method: 'POST', cookie: other, body: {title: 'Late payer ' + randomUUID().slice(0, 6), client: 'Slow Co', deliverables: 'Logo work', exclusions: '', fee: 1000, currency: 'INR', revisions: 1, due: '', notes: ''}});
  eq((await call('/api/review/' + late.data.scope.token, {method: 'POST', body: await ack(base, late.data.scope.token, {decision: 'approved', signer: 'Slow', comment: '', version: 1})})).status, 200);
  const lateOwner = localSql(`SELECT owner FROM scopeflow.projects WHERE id=${q(late.data.scope.project_id)}`)[0].results[0].owner;
  ok(owner !== lateOwner, 'second owner');
  localSql(`UPDATE scopeflow.projects SET client_email='slow@example.test' WHERE id=${q(late.data.scope.project_id)}`);
  localSql(`INSERT INTO scopeflow.business_profiles (owner,business_name,auto_remind_days,updated) VALUES (${q(lateOwner)},'Late Studio',5,${q(new Date().toISOString())})`);
  localSql(`INSERT INTO scopeflow.invoices (id,owner,project_id,seq,number,version,amount,currency,issued,content) VALUES (${q(randomUUID())},${q(lateOwner)},${q(late.data.scope.project_id)},1,'OLD-1',1,1000,'INR',${q(issued + 'T10:00:00Z')},${q(JSON.stringify({...content, project: {...content.project, id: late.data.scope.project_id}}))})`);
  const run = spawnSync(process.execPath, ['scripts/send-reminders.mjs', '--dry-run'], {encoding: 'utf8', env: process.env});
  eq(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout.trim().split('\n').pop());
  const mine = out.invoices.filter(i => i.project_id === late.data.scope.project_id);
  eq(mine, [{project_id: late.data.scope.project_id, number: 'OLD-1', to: 'slow@example.test', days_overdue: 10}]);
  ok(!out.invoices.some(i => i.project_id === project_id), 'owners without automatic reminders get none');
}

// ---- Razorpay reconciliation -------------------------------------------------------------------
eq((await call('/api/payments/razorpay/reconcile', {method: 'POST'})).status, 401);
eq((await call('/api/payments/razorpay/reconcile', {method: 'POST', headers: {Authorization: 'Bearer wrong'}})).status, 401);
{
  // An order the webhook marked paid but whose ledger entry was lost.
  const order_id = 'order_' + randomUUID().replaceAll('-', '').slice(0, 14);
  localSql(`INSERT INTO scopeflow.payments (id,project_id,version,provider,order_id,amount_minor,currency,status,payment_id,paid_at,created) VALUES (${q(randomUUID())},${q(project_id)},1,'razorpay',${q(order_id)},500000,'INR','paid','pay_lost123',${q(new Date().toISOString())},${q(new Date().toISOString())})`);
  const auth = {Authorization: 'Bearer ' + process.env.SCOPEFLOW_CRON_SECRET};
  const r = await call('/api/payments/razorpay/reconcile', {method: 'POST', headers: auth});
  eq(r.status, 200); ok(r.data.lookups.startsWith(process.env.RAZORPAY_KEY_ID || process.env.STRIPE_SECRET_KEY ? 'on' : 'off'), 'lookups need Razorpay or Stripe keys');
  const mine = r.data.results.find(x => x.order_id === order_id);
  eq([mine.recorded, mine.ledger], [false, true]);
  const entry = (await call(L, {cookie})).data.entries.find(e => e.kind === 'payment' && e.payload.order_id === order_id);
  eq([entry.actor, entry.payload.amount, entry.payload.payment_id], ['system', 5000, 'pay_lost123']);
  const again = await call('/api/payments/razorpay/reconcile', {method: 'POST', headers: auth});
  ok(!again.data.results.some(x => x.order_id === order_id), 'a repaired order is not repaired twice');
}

console.log(`invoicing: ${passed} checks passed`);
