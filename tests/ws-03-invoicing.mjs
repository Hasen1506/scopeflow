// WS-03 end to end against the local preview and the disposable local database: the invoicing cap
// (C2, including concurrent requests), receipt vouchers for advances (H11), credit notes and the
// 16-character number rule (H12), TDS as an explicit input (H19/SF-08), change-order tax display
// (M7), the frozen milestone schedule (M9), MSMED terms, interest and the Samadhaan pack (SF-07),
// the consumer pack (SF-24) and statement/invoice PDF timing (QA-01). Each scenario uses its own
// fictional owner so document numbers start at 0001.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, readFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {signIn, ack, localSql} from './support/local.mjs';

const base = process.env.SCOPEFLOW_TEST_URL || 'http://localhost:5173';
assert.equal(new URL(base).hostname, 'localhost', 'Local fixtures only.');
let passed = 0;
const eq = (a, b, message) => { assert.deepEqual(a, b, message); passed++; };
const ok = (v, message) => { assert.ok(v, message); passed++; };
async function call(path, {method = 'GET', cookie, body, raw = false} = {}) {
  const h = {Origin: base};
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(base + path, {method, headers: h, body: body === undefined ? undefined : JSON.stringify(body)});
  if (raw) return {status: r.status, type: r.headers.get('content-type'), bytes: Buffer.from(await r.arrayBuffer())};
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return {status: r.status, data};
}
const pdfText = async (path, cookie) => {
  const r = await call(path, {cookie, raw: true});
  assert.equal(r.status, 200, path); assert.equal(r.type, 'application/pdf');
  return r.bytes.toString('latin1').replace(/\\([()])/g, '$1');
};
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = n => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
const gstSeller = {business_name: 'TEST Ada Studio', business_address: '12 MG Road, Chennai', tax_id: '33ABCDE1234F1Z7', gst_state: '33', sac_code: '998314', payment_details: 'UPI ada@okbank'}; // integration: checksum-valid GSTIN (WS-08 LT-17 validation)

/** A fresh owner with a business profile and an approved scope. */
async function approved(name, scope, profile = {business_name: 'TEST Studio'}) {
  localSql('DELETE FROM rate_limits');
  const cookie = await signIn(base, `ws03-${name}-${randomUUID()}@example.test`);
  const current = (await call('/api/profile', {cookie})).data.profile;
  eq((await call('/api/profile', {method: 'PUT', cookie, body: {...current, ...profile}})).status, 200, `${name}: profile`);
  const created = await call('/api/scopes', {method: 'POST', cookie, body: {title: `TEST WS-03 ${name} ` + randomUUID().slice(0, 6), client: 'Kaveri Foods', deliverables: 'Packaging design', exclusions: '', fee: 1000, currency: 'INR', revisions: 2, due: '', notes: '', ...scope}});
  eq(created.status, 201, `${name}: scope ${JSON.stringify(created.data)}`);
  const {project_id, token} = created.data.scope;
  eq((await call('/api/review/' + token, {method: 'POST', body: await ack(base, token, {decision: 'approved', signer: 'Meera', comment: '', version: 1})})).status, 200, `${name}: approved`);
  return {cookie, project_id, token, P: `/api/scopes/${project_id}`, I: `/api/scopes/${project_id}/invoices`};
}
const pay = (x, amount, extra = {}) => call(`${x.P}/ledger`, {method: 'POST', cookie: x.cookie, body: {kind: 'payment_received', baseline_version: 1, payload: {amount, method: 'bank_transfer', received: today(), ...extra}}});
async function changeOrder(x, fee_delta, title = 'Extra pack size') {
  const co = await call(`${x.P}/ledger`, {method: 'POST', cookie: x.cookie, body: {kind: 'change_order', baseline_version: 1, payload: {title, fee_delta}}});
  eq(co.status, 201, JSON.stringify(co.data));
  eq((await call(`/api/review/${x.token}/change-order`, {method: 'POST', body: {seq: co.data.seq, decision: 'approved', signer: 'Meera', comment: ''}})).status, 200);
  return co.data.seq;
}

// ---- C2: the cap -----------------------------------------------------------------------------------
// @covers C2
{
  // The live-test scenario: ₹1,000 fee, no tax, three ₹1,000 invoices. Only the first is issued.
  const x = await approved('cap', {fee: 1000});
  eq((await call(x.I, {cookie: x.cookie})).data.invoiceable.total, 1000);
  const first = await call(x.I, {method: 'POST', cookie: x.cookie, body: {amount: 1000}});
  eq([first.status, first.data.invoice.number, first.data.invoice.amount], [201, 'INV-0001', 1000]);
  for (const n of [2, 3]) {
    const r = await call(x.I, {method: 'POST', cookie: x.cookie, body: {amount: 1000}});
    eq([r.status, r.data.code], [409, 'exceeds_uninvoiced'], `invoice ${n} is refused`);
    ok(/invoiced in full/.test(r.data.error), r.data.error);
  }
  eq((await call(x.I, {cookie: x.cookie})).data.invoices.length, 1);
  eq((await call(x.I, {cookie: x.cookie})).data.invoiceable.total, 0);
}
{
  // ₹118 agreement (₹100 + 18% GST): ₹101 is refused with what is left; ₹100 (taxable value) is issued.
  const x = await approved('cap118', {fee: 100, tax_label: 'GST', tax_pct: 18});
  const over = await call(x.I, {method: 'POST', cookie: x.cookie, body: {amount: 101}});
  eq([over.status, over.data.code, over.data.invoiceable], [409, 'exceeds_uninvoiced', 118]);
  ok(over.data.error.includes('Only ₹118.00 is left to invoice on this agreement'), over.data.error);
  const r = await call(x.I, {method: 'POST', cookie: x.cookie, body: {amount: 100}});
  eq([r.status, r.data.invoice.amount, r.data.invoiceable], [201, 118, 0]);
}
{
  // Ten parallel requests for the full amount: exactly one is issued (SELECT … FOR UPDATE on the project row).
  const x = await approved('race', {fee: 1000});
  const results = await Promise.all(Array.from({length: 10}, () => call(x.I, {method: 'POST', cookie: x.cookie, body: {amount: 1000}})));
  const statuses = results.map(r => r.status).sort();
  eq(statuses.filter(s => s === 201).length, 1, JSON.stringify(statuses));
  ok(statuses.every(s => s === 201 || s === 409), JSON.stringify(results.map(r => r.data)));
  eq((await call(x.I, {cookie: x.cookie})).data.invoices.length, 1);
}

// ---- H11: receipt vouchers for advances -------------------------------------------------------------
// @covers H11
{
  // ₹25,000 + 18% intra-state; the client pays a ₹5,900 deposit (₹5,000 + ₹900) before any invoice.
  const x = await approved('advance', {fee: 25000, tax_label: 'GST', tax_pct: 18, deposit_pct: 20}, gstSeller);
  eq((await call(x.P, {method: 'PATCH', cookie: x.cookie, body: {client_state: '33'}})).status, 200);
  eq((await pay(x, 5900, {reference: 'UTR5900', note: 'Deposit'})).status, 201);
  const s = (await call(x.I, {cookie: x.cookie})).data;
  eq(s.receipt_vouchers.map(v => [v.number, v.kind, v.amount, v.adjusted]), [['RV-0001', 'receipt_voucher', 5900, false]]);
  eq([s.invoiceable.total, s.invoiceable.gross_total, s.invoiceable.advances], [23600, 29500, 5900]);
  const rv = await pdfText(`${x.I}/receipt-vouchers/1`, x.cookie);
  for (const t of ['RECEIPT VOUCHER', 'RV-0001', 'CGST (9%)', 'SGST (9%)', 'Rs.450.00', 'Rs.5,000.00', 'Rs.5,900.00', 'UTR5900']) ok(rv.includes(t), 'receipt voucher states ' + t);
  // A GET again issues nothing new.
  eq((await call(x.I, {cookie: x.cookie})).data.receipt_vouchers.length, 1);
  // The final invoice adjusts the advance: tax only on the remaining ₹20,000.
  const fin = await call(x.I, {method: 'POST', cookie: x.cookie, body: {amount: 25000}});
  eq([fin.status, fin.data.invoice.amount, fin.data.invoice.advance_adjusted], [201, 23600, ['RV-0001']]);
  const pdf = await pdfText(`${x.I}/${fin.data.invoice.seq}`, x.cookie);
  for (const t of ['Value of supply', 'Rs.25,000.00', 'Less: advance received vide RV-0001', 'Rs.20,000.00', 'Rs.1,800.00', 'Rs.23,600.00']) ok(pdf.includes(t), 'final invoice states ' + t);
  const after = (await call(x.I, {cookie: x.cookie})).data;
  eq([after.invoiceable.gross_total, after.receipt_vouchers[0].adjusted], [0, true]);
}

// ---- H12: credit notes and the 16-character rule ---------------------------------------------------
// @covers H12
{
  const x = await approved('credit', {fee: 1000});
  eq((await call(x.I, {method: 'POST', cookie: x.cookie, body: {amount: 1000}})).status, 201);
  const CN = `${x.P}/credit-notes`;
  eq((await call(CN, {method: 'POST', cookie: x.cookie, body: {invoice_seq: 1, reason: 'x'}})).status, 400);
  const cn = await call(CN, {method: 'POST', cookie: x.cookie, body: {invoice_seq: 1, reason: 'Cancelled before work started'}});
  eq(cn.status, 201, JSON.stringify(cn.data));
  eq([cn.data.credit_note.number, cn.data.credit_note.full], ['CN-0001', true]);
  const s = (await call(x.I, {cookie: x.cookie})).data;
  eq([s.invoices[0].status, s.invoices[0].cancelled_by, s.invoiceable.total], ['cancelled', ['CN-0001'], 1000]);
  eq((await call(CN, {method: 'POST', cookie: x.cookie, body: {invoice_seq: 1, reason: 'Again please'}})).data.code, 'already_cancelled');
  ok((await pdfText(`${CN}/1`, x.cookie)).includes('CN-0001'), 'credit note PDF');
  ok((await pdfText(`${x.I}/1`, x.cookie)).includes('Cancelled by CN-0001'), 'the invoice shows its cancellation');
  eq((await call(x.I, {method: 'POST', cookie: x.cookie, body: {amount: 1000}})).status, 201, 'the credited amount can be invoiced again');
  assert.throws(() => localSql(`UPDATE scopeflow.credit_notes SET reason='edited' WHERE project_id='${x.project_id}'`), /immutable/); passed++;
  // GST rule 46: an invoice prefix that makes numbers longer than 16 characters is refused at profile save.
  const p = (await call('/api/profile', {cookie: x.cookie})).data.profile;
  eq((await call('/api/profile', {method: 'PUT', cookie: x.cookie, body: {...p, invoice_prefix: 'SCOPEFLOW-2026-27/'}})).status, 400);
}

// ---- H19 / SF-08: TDS -------------------------------------------------------------------------------
// @covers H19 SF-08
{
  const x = await approved('tds', {fee: 100000, tax_label: 'GST', tax_pct: 18}, gstSeller);
  eq((await call(x.I, {method: 'POST', cookie: x.cookie, body: {amount: 100000, tds: {section_2025: '393(1) Sl.6(iii)-professional'}}})).status, 400, 'a section without a rate is refused');
  const inv = await call(x.I, {method: 'POST', cookie: x.cookie, body: {amount: 100000, tds: {section_2025: '393(1) Sl.6(iii)-professional', rate_pct: 10}}});
  eq(inv.status, 201, JSON.stringify(inv.data));
  eq([inv.data.invoice.amount, inv.data.invoice.tds.amount, inv.data.invoice.tds.net_receivable], [118000, 10000, 108000]);
  ok((await pdfText(`${x.I}/1`, x.cookie)).includes('TDS expected Rs.10,000.00'), 'the invoice states the TDS expected');
  eq((await pay(x, 108000, {reference: 'UTR108000'})).status, 201);
  const s = (await call(x.I, {cookie: x.cookie})).data;
  eq([s.invoices[0].status, s.invoices[0].open, s.invoices[0].open_with_tds], ['paid_net_of_tds', 0, 10000]);
  eq(s.tds.pending.map(p => [p.number, p.amount]), [['INV-0001', 10000]]);
  const client = (await call('/api/review/' + x.token)).data.ledger.invoices;
  eq(client[0].status, 'paid_net_of_tds');
  // The certificate closes it.
  const T = `${x.I}/1/tds-credit`;
  eq((await call(T, {method: 'POST', cookie: x.cookie, body: {amount: 10001, certificate_no: 'CERT-16A-1', form: '16A', quarter: 'Q3 FY 2026-27', received: today()}})).data.code, 'tds_exceeds');
  const credited = await call(T, {method: 'POST', cookie: x.cookie, body: {amount: 10000, certificate_no: 'CERT-16A-1', form: '16A', quarter: 'Q3 FY 2026-27', received: today()}});
  eq([credited.status, credited.data.invoice.status], [201, 'tds_credited']);
  // Reminders never chase the TDS part (the job reads statuses; nothing here is overdue either way).
  const run = spawnSync(process.execPath, ['scripts/send-reminders.mjs', '--dry-run'], {encoding: 'utf8', env: process.env});
  eq(run.status, 0, run.stderr);
  ok(!run.stdout.includes(x.project_id), 'no reminder for an invoice paid net of TDS');
}

// ---- M7: change-order tax display and invoicing -----------------------------------------------------
// @covers M7
{
  const x = await approved('co', {fee: 50000, tax_label: 'GST', tax_pct: 18});
  const seq = await changeOrder(x, 10000);
  const co = (await call(x.I, {cookie: x.cookie})).data.change_orders.find(c => c.seq === seq);
  eq([co.display, co.total], ['+₹10,000.00 + GST ₹1,800.00 = ₹11,800.00', 11800]);
  const r = await call(x.I, {method: 'POST', cookie: x.cookie, body: {change_order_seq: seq}});
  eq([r.status, r.data.invoice.amount, r.data.invoice.change_order], [201, 11800, seq]);
  eq((await call(x.I, {method: 'POST', cookie: x.cookie, body: {change_order_seq: seq}})).data.code, 'change_order_invoiced');
  const odd = await changeOrder(x, 7500.50, 'Odd paisa');
  eq((await call(x.I, {cookie: x.cookie})).data.change_orders.find(c => c.seq === odd).display, '+₹7,500.50 + GST ₹1,350.09 = ₹8,850.59');
}

// ---- M9: frozen milestone schedule ------------------------------------------------------------------
// @covers M9
{
  const x = await approved('milestones', {fee: 100000, tax_label: 'GST', tax_pct: 18, milestones: [{id: 'm_start', title: 'Start', pct: 50, due: ''}, {id: 'm_end', title: 'Handover', pct: 50, due: ''}]});
  const m1 = await call(x.I, {method: 'POST', cookie: x.cookie, body: {milestone_id: 'm_start'}});
  eq([m1.status, m1.data.invoice.amount], [201, 59000]);
  const seq = await changeOrder(x, 10000);
  const s = (await call(x.I, {cookie: x.cookie})).data;
  eq(s.schedule.map(m => [m.id, m.amount, m.invoiced]), [['m_start', 59000, 59000], ['m_end', 59000, 0]]);
  eq((await call(x.I, {method: 'POST', cookie: x.cookie, body: {milestone_id: 'm_start'}})).data.code, 'milestone_invoiced');
  const co = await call(x.I, {method: 'POST', cookie: x.cookie, body: {change_order_seq: seq}});
  eq([co.status, co.data.invoice.amount], [201, 11800]);
  // A partial milestone invoice entered tax-inclusive.
  const part = await call(x.I, {method: 'POST', cookie: x.cookie, body: {milestone_id: 'm_end', amount: 29500, includes_tax: true}});
  eq([part.status, part.data.invoice.amount], [201, 29500]);
}

// ---- SF-07: MSMED terms, interest and the Samadhaan pack -------------------------------------------
// @covers SF-07
{
  const x = await approved('msmed', {fee: 100000}, gstSeller);
  const terms = `${x.I}/terms`;
  eq((await call(terms, {method: 'PUT', cookie: x.cookie, body: {msme_profile: {udyam_number: 'UDYAM-TN-02-1', registered_on: '2026-01-01', category: 'micro'}}})).status, 400);
  eq((await call(terms, {method: 'PUT', cookie: x.cookie, body: {msme_profile: {udyam_number: 'UDYAM-TN-02-0012345', registered_on: '2026-01-01', category: 'micro'}, msmed: {agreed_days: 30}}})).status, 200);
  eq((await call(terms, {method: 'PUT', cookie: x.cookie, body: {msmed: {agreed_days: 60}}})).status, 400, 'at most 45 days');
  eq((await call(x.I, {method: 'POST', cookie: x.cookie, body: {amount: 100000}})).status, 201);
  // Delivered and accepted 60 days ago, 30 days agreed: overdue, interest runs.
  const acc = await call(`${x.P}/acceptance`, {method: 'POST', cookie: x.cookie, body: {delivered_on: daysAgo(62), accepted_on: daysAgo(60), evidence: 'Email from the client accepting the final files'}});
  eq(acc.status, 201, JSON.stringify(acc.data));
  eq([acc.data.acceptance.basis, acc.data.pay_by], ['accepted', new Date(Date.parse(daysAgo(60)) + 30 * 86400_000).toISOString().slice(0, 10)]);
  const s = (await call(x.I, {cookie: x.cookie})).data.msmed;
  ok(/^Interest under MSMED s\.16: ₹[\d,]+\.\d\d \(estimate — confirm with your CA\)$/.test(s.invoices[0]?.text ?? ''), JSON.stringify(s));
  ok(s.interest_total > 0, 'interest accrues');
  eq((await call(`${x.P}/acceptance`, {method: 'POST', cookie: x.cookie, body: {delivered_on: '2099-01-01'}})).data.code, 'future_date');
  // Regression (audit): a recorded acceptance is mirrored to the signed ledger as a delivery_accepted entry in the
  // ledger's own shape (it used to go through the money-only writer and always failed, so none ever landed).
  const accepted = async () => (await call(`${x.P}/ledger`, {cookie: x.cookie})).data.entries.filter(e => e.kind === 'delivery_accepted').map(e => ({actor: e.actor, payload: e.payload}));
  eq(await accepted(), [{actor: 'owner', payload: {accepted: daysAgo(60), deemed: false, item_ids: [], evidence: 'Email from the client accepting the final files', note: `Delivered on ${daysAgo(62)}.`}}]);
  eq((await call(`${x.P}/acceptance`, {method: 'POST', cookie: x.cookie, body: {delivered_on: daysAgo(3), objection_on: daysAgo(2), objection_removed_on: daysAgo(1), milestone_id: 'm1'}})).status, 201);
  eq((await accepted())[1], {actor: 'owner', payload: {accepted: daysAgo(1), deemed: false, item_ids: [], evidence: '', note: `Delivered on ${daysAgo(3)}; milestone m1; objection on ${daysAgo(2)}, removed on ${daysAgo(1)}.`}});
  // Delivered but not yet accepted (inside the objection window): nothing new on the ledger.
  eq((await call(`${x.P}/acceptance`, {method: 'POST', cookie: x.cookie, body: {delivered_on: today()}})).status, 201);
  eq((await accepted()).length, 2);
  // Registration after the agreement: the pack warns.
  const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
  eq((await call(terms, {method: 'PUT', cookie: x.cookie, body: {msme_profile: {udyam_number: 'UDYAM-TN-02-0012345', registered_on: tomorrow, category: 'micro'}}})).status, 200);
  const pack = await call(`${x.P}/dispute-pack?variant=msmed`, {cookie: x.cookie, raw: true});
  eq([pack.status, pack.type], [200, 'application/zip']);
  const dir = mkdtempSync(join(tmpdir(), 'ws03-pack-'));
  writeFileSync(join(dir, 'pack.zip'), pack.bytes);
  execFileSync('unzip', ['-q', join(dir, 'pack.zip'), '-d', join(dir, 'x')]);
  for (const f of ['msme-samadhaan-field-sheet.txt', 'msmed-interest.csv', 'msmed-interest.json', 'acceptance.json', 'section63-certificate.pdf', 'SHA256SUMS.txt']) ok(existsSync(join(dir, 'x', f)), f);
  const sheet = readFileSync(join(dir, 'x', 'msme-samadhaan-field-sheet.txt'), 'utf8');
  ok(sheet.includes('UDYAM-TN-02-0012345') && /MSMED benefits may not apply to work agreed before your Udyam registration/.test(sheet), sheet);
  execFileSync('sha256sum', ['-c', 'SHA256SUMS.txt'], {cwd: join(dir, 'x'), stdio: 'pipe'}); passed++;
  eq((await call(`${x.P}/dispute-pack?variant=nope`, {cookie: x.cookie})).status, 400);
  // The public calculator page.
  const page = await fetch(base + '/msme-interest');
  eq(page.status, 200);
  ok(/estimate — confirm with your CA/i.test(await page.text()), 'calculator carries the CA disclaimer');
}

// ---- SF-24: consumer evidence pack ------------------------------------------------------------------
// @covers SF-24
{
  const x = await approved('consumer', {fee: 400000});
  eq((await pay(x, 100000, {reference: 'UTR-STAGE-1'})).status, 201);
  const pack = await call(`${x.P}/dispute-pack?variant=consumer`, {cookie: x.cookie, raw: true});
  eq(pack.status, 200);
  const dir = mkdtempSync(join(tmpdir(), 'ws03-consumer-'));
  writeFileSync(join(dir, 'pack.zip'), pack.bytes);
  execFileSync('unzip', ['-q', join(dir, 'pack.zip'), '-d', join(dir, 'x')]);
  for (const f of ['MANIFEST.txt', 'summary.txt', 'scope.json', 'acceptance/receipt-v1.pdf', 'change-orders.csv', 'payments.csv', 'inspections.csv', 'timeline.txt', 'statement.pdf']) ok(existsSync(join(dir, 'x', f)), f);
  ok(readFileSync(join(dir, 'x', 'payments.csv'), 'utf8').includes('UTR-STAGE-1'), 'stage payments carry their UTR');
  ok(/edaakhil\.nic\.in/.test(readFileSync(join(dir, 'x', 'summary.txt'), 'utf8')), 'summary explains e-Daakhil');
}

// ---- QA-01: statement and invoice PDFs, p95 < 3 s ---------------------------------------------------
// @covers QA-01
{
  const x = await approved('timing', {fee: 50000, tax_label: 'GST', tax_pct: 18}, gstSeller);
  eq((await call(x.I, {method: 'POST', cookie: x.cookie, body: {amount: 10000}})).status, 201);
  const p95 = async path => {
    const times = [];
    for (let i = 0; i < 12; i++) {
      const t = performance.now();
      const r = await call(path, {cookie: x.cookie, raw: true});
      assert.equal(r.status, 200, path);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    return times[Math.ceil(times.length * 0.95) - 1];
  };
  for (const path of [`${x.P}/statement`, `${x.I}/1`, `/api/review/${x.token}/statement`]) {
    const t = await p95(path);
    ok(t < 3000, `${path} p95 ${Math.round(t)} ms`);
    console.log(`ws-03 timing: ${path.replace(x.project_id, ':id').replace(x.token, ':token')} p95 ${Math.round(t)} ms`);
  }
}

console.log(`ws-03-invoicing: ${passed} checks passed`);
