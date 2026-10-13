// WS-05 integration suite: scope ledger, change orders, retainers and the rate card, against the
// local production build and the disposable scopeflow_test database (fictional TEST data only).
// Run by tests/run-local.mjs (auto-discovered as tests/ws-*.mjs).
// @covers H6 H17 M5 M8 LT-08 LT-14 SF-05 SF-06
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {randomUUID, createHmac} from 'node:crypto';
import {signIn, ack, localSql, requireLocalDatabase} from './support/local.mjs';

const base = process.env.SCOPEFLOW_TEST_URL || 'http://localhost:5173';
assert.equal(new URL(base).hostname, 'localhost', 'This suite creates disposable LOCAL fixtures only.');
requireLocalDatabase();

// The H6 hooks (appendMoneyEntry, onBaselineApproved) are server functions WS-04 and WS-02 call;
// they are exercised in-process against the same local database. This resolver maps the app's
// "@/" alias and extensionless imports, and stubs "server-only" (a Next.js build marker).
const root = pathToFileURL(process.cwd() + '/').href;
registerHooks({resolve(specifier, context, next) {
  if (specifier === 'server-only') return {url: 'data:text/javascript,', shortCircuit: true};
  const s = specifier.startsWith('@/') ? root + specifier.slice(2) : specifier;
  try { return next(s, context); } catch (e) {
    for (const ext of ['.ts', '.tsx', '/index.ts', '.js']) { try { return next(s + ext, context); } catch { /* next */ } }
    throw e;
  }
}});
const L = await import(root + 'lib/ledger.ts');
const hooks = await import(root + 'lib/ledger-hooks.ts');

let passed = 0;
const eq = (a, b, message) => { assert.deepEqual(a, b, message); passed++; };
const ok = (v, message) => { assert.ok(v, message); passed++; };
async function call(path, method = 'GET', data, {auth, headers = {}} = {}) {
  const r = await fetch(base + path, {method, headers: {...(auth ? {cookie: auth} : {}), Origin: base, ...(data !== undefined ? {'Content-Type': 'application/json'} : {}), ...headers}, body: data !== undefined ? JSON.stringify(data) : undefined});
  const text = await r.text(); let value; try { value = JSON.parse(text); } catch { value = text; }
  return {status: r.status, value};
}
const status = (r, n, what = '') => { assert.equal(r.status, n, what + ' ' + JSON.stringify(r.value)); passed++; return r; };
const resetLimits = () => localSql('DELETE FROM rate_limits');
const q = v => "'" + String(v).replaceAll("'", "''") + "'";
const today = new Date().toISOString().slice(0, 10); // projects without a time zone use UTC (CI runs in UTC)
const plusDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

async function project(cookie, scope) {
  const created = status(await call('/api/scopes', 'POST', scope, {auth: cookie}), 201, 'create scope');
  const {project_id, token} = created.value.scope;
  status(await call('/api/review/' + token, 'POST', await ack(base, token, {decision: 'approved', signer: 'TEST Reviewer', comment: '', version: 1})), 200, 'approve v1');
  return {project_id, token, ledger: '/api/scopes/' + project_id + '/ledger'};
}
const entry = (cookie, path, kind, payload, extra = {}) => call(path, 'POST', {kind, baseline_version: 1, payload, ...extra}, {auth: cookie});
const coPayload = (title, more = {}) => ({title, reason: '', request_quote: '', add_items: [], remove_item_ids: [], fee_delta: 0, days_delta: 0, revisions_delta: 0, ...more});

const owner = await signIn(base, 'ws05-' + randomUUID() + '@example.test');

// ---------------------------------------------------------------------------------------------
// H17 + M5 + LT-14 + SF-06: an INR agreement with 18% GST; CO-1 +₹7,500.50 approved with its
// content proof, CO-2 declined: fee ₹32,500.50 (the golden scenario, end to end).
// ---------------------------------------------------------------------------------------------
resetLimits();
const inr = {title: 'TEST WS-05 brand ' + Date.now(), client: 'TEST Client', deliverables: '', items: [{id: 'logo', title: 'Logo suite', qty: 1, unit: '', price: 25000, acceptance: ''}], client_inputs: [{id: 'copy', title: 'Final copy', due: plusDays(today, 30)}], exclusions: 'Print', fee: 25000, currency: 'INR', revisions: 2, due: plusDays(today, 60), notes: '', tax_label: 'GST', tax_pct: 18};
const P = await project(owner, inr);
{
  // @covers M5: a change order's fee change and added prices carry at most the currency's decimals.
  const bad = status(await entry(owner, P.ledger, 'change_order', coPayload('TEST three decimals', {fee_delta: 10.005})), 400, 'decimal fee_delta');
  assert.match(bad.value.error, /Fee change: Use at most 2 decimals/); passed++;
  const badItem = status(await entry(owner, P.ledger, 'change_order', coPayload('TEST priced item', {add_items: [{id: 'x1', title: 'Extra', qty: 1, unit: '', price: 1.234, acceptance: ''}], fee_delta: 1})), 400, 'decimal item price');
  assert.match(badItem.value.error, /Added deliverable 1 price: Use at most 2 decimals/); passed++;
  status(await entry(owner, P.ledger, 'change_order', coPayload('TEST below zero', {fee_delta: -30000})), 400, 'fee below zero');
}
const co1 = status(await entry(owner, P.ledger, 'change_order', coPayload('Instagram templates', {add_items: [{id: 'tpl', title: 'Instagram templates', qty: 6, unit: 'templates', price: 7500.5, acceptance: ''}], fee_delta: 7500.5}), {request_id: randomUUID()}), 201, 'CO-1');
eq(co1.value.seq, 1);
const co2 = status(await entry(owner, P.ledger, 'change_order', coPayload('Extra landing page', {fee_delta: 4000})), 201, 'CO-2');
eq(co2.value.seq, 2);
{
  // @covers H17: the client decision carries acknowledged + co_sha256 of the CO as rendered.
  const shown = (await call('/api/review/' + P.token)).value;
  const c1 = shown.ledger.agreement.change_orders.find(c => c.seq === 1);
  const hash = await L.coSha256(c1, shown.scope.content);
  ok(/^[a-f0-9]{64}$/.test(hash));
  const decide = body => call('/api/review/' + P.token + '/change-order', 'POST', {seq: 1, decision: 'approved', signer: 'TEST Client', comment: '', ...body});
  const missing = status(await decide({acknowledged: true}), 400, 'proof without co_sha256');
  eq(missing.value.code, 'co_proof_required');
  eq((status(await decide({co_sha256: hash}), 400, 'proof without acknowledgement')).value.code, 'co_proof_required');
  // A hash of a different rendering (here: the fee the owner might have shown before a change).
  const stale = await L.coSha256({...c1, fee_delta: 7500}, shown.scope.content);
  eq((status(await decide({acknowledged: true, co_sha256: stale}), 409, 'stale hash')).value.code, 'co_changed');
  eq((await call(P.ledger, 'GET', undefined, {auth: owner})).value.agreement.change_orders[0].status, 'proposed'); // nothing recorded
  const approved = status(await decide({acknowledged: true, co_sha256: hash}), 200, 'approve with proof');
  eq(approved.value.receipt.change_order, 'CO-1');
  eq(approved.value.receipt.co_sha256, hash);
  eq(approved.value.receipt.total_incl_tax_minor, 750050 + 135009); // ₹7,500.50 + 18% GST, half-up in paise
  eq(approved.value.receipt.proof_recorded, true);
  const view = (await call(P.ledger, 'GET', undefined, {auth: owner})).value;
  const settle = view.entries.find(e => e.kind === 'settle' && e.payload.ref_seq === 1);
  eq(settle.payload, {ref_seq: 1, outcome: 'approved', signer: 'TEST Client', comment: '', acknowledged: true, co_sha256: hash, total_incl_tax_minor: 885059});
  eq(view.chain.intact, true); eq(view.seal.state, 'valid');
  // Compat (SCOPEFLOW_CO_PROOF unset in CI): the pre-WS-05 request shape is still accepted and recorded
  // exactly as before; SCOPEFLOW_CO_PROOF=strict refuses it with 400 co_proof_required (docs/ws-05.md).
  const legacy = status(await call('/api/review/' + P.token + '/change-order', 'POST', {seq: 2, decision: 'declined', signer: 'TEST Client', comment: 'Not needed now'}), 200, 'legacy decline');
  eq(legacy.value.receipt.proof_recorded, false);
  ok(/^[a-f0-9]{64}$/.test(legacy.value.receipt.co_sha256), 'the receipt still reports the served CO hash');
  const after = (await call(P.ledger, 'GET', undefined, {auth: owner})).value;
  eq(after.entries.find(e => e.kind === 'settle' && e.payload.ref_seq === 2).payload, {ref_seq: 2, outcome: 'declined', signer: 'TEST Client', comment: 'Not needed now'});
  eq(after.agreement.fee, 32500.5);
  // @covers LT-14: the approved CO deliverable is folded into the agreement's deliverables.
  ok(after.agreement.items.some(i => i.id === 'tpl' && i.source === 1), 'CO-1 item is in force');
  ok(after.agreement.deliverables.split('\n').some(l => l.includes('Instagram templates') && l.endsWith('[CO-1]')), after.agreement.deliverables);
  ok(!after.agreement.deliverables.includes('Extra landing page'), 'a declined CO adds nothing');
  const client = (await call('/api/review/' + P.token)).value.ledger.agreement;
  eq(client.deliverables, after.agreement.deliverables);
}
{
  // @covers SF-06: a CO from the rate-card item "extra reel" prefills ₹2,500 + GST.
  resetLimits();
  const card = {items: [
    {id: 'reel', title: 'Extra reel', unit: 'reel', unit_price_minor: 250000, currency: 'INR', tax_pct: 18, tags: ['video']},
    {id: 'post', title: 'Instagram post', unit: 'post', unit_price_minor: 150000, currency: 'INR', tax_pct: 18, tags: ['social', 'item:post']},
  ], multipliers: [{id: 'rush', label: 'Rush delivery', pct: 25}]};
  status(await call('/api/rate-card', 'PUT', {...card, items: [...card.items, card.items[0]]}, {auth: owner}), 400, 'duplicate ids');
  status(await call('/api/rate-card', 'PUT', {items: [{...card.items[0], unit_price_minor: 2500.5}], multipliers: []}, {auth: owner}), 400, 'fractional minor units');
  status(await call('/api/rate-card', 'PUT', card, {auth: owner}), 200, 'save rate card');
  eq((await call('/api/rate-card', 'GET', undefined, {auth: owner})).value.rate_card.items.map(i => i.id), ['reel', 'post']);
  const quote = status(await call('/api/rate-card/quote', 'POST', {item_id: 'reel', qty: 1, project_id: P.project_id}, {auth: owner}), 200, 'quote');
  eq([quote.value.line.subtotal_minor, quote.value.line.tax.pct, quote.value.line.tax.amount_minor, quote.value.line.total_minor], [250000, 18, 45000, 295000]);
  eq(quote.value.tax_label, 'GST');
  eq(quote.value.change_order.fee_delta, 2500);
  eq(quote.value.change_order.add_items.map(i => [i.title, i.price]), [['Extra reel', 2500]]);
  eq(quote.value.change_order.rate_card, {item_id: 'reel', qty: 1, unit_price_minor: 250000, multipliers: []});
  const rush = (await call('/api/rate-card/quote', 'POST', {item_id: 'reel', qty: 1, multipliers: ['rush'], project_id: P.project_id}, {auth: owner})).value.line;
  eq([rush.subtotal_minor, rush.tax.amount_minor, rush.total_minor], [312500, 56250, 368750]);
  status(await call('/api/rate-card/quote', 'POST', {item_id: 'nope'}, {auth: owner}), 404, 'unknown item');
  status(await call('/api/rate-card/quote', 'POST', {item_id: 'reel'}), 401, 'signed out');
  const recorded = status(await entry(owner, P.ledger, 'change_order', quote.value.change_order), 201, 'CO from rate card');
  const co = recorded.value.agreement.change_orders.find(c => c.seq === recorded.value.seq);
  eq([co.fee_delta, co.rate_card.item_id], [2500, 'reel']);
  eq(L.coTotals(co, inr).total_incl_tax_minor, 295000);
}

// ---------------------------------------------------------------------------------------------
// M8: client-input and feedback dates are bounded by today (+1 day) and the approval date.
// ---------------------------------------------------------------------------------------------
{
  resetLimits();
  const before = (await call(P.ledger, 'GET', undefined, {auth: owner})).value.agreement;
  const late = status(await entry(owner, P.ledger, 'client_input', {input_id: 'copy', received: plusDays(today, 2), shift: true, note: ''}), 400, 'received in the future');
  assert.match(late.value.error, /cannot be in the future/); passed++;
  status(await entry(owner, P.ledger, 'client_input', {input_id: 'copy', received: '2020-01-01', shift: true, note: ''}), 400, 'received before approval');
  status(await entry(owner, P.ledger, 'revision_round', {feedback_date: plusDays(today, 2), note: ''}), 400, 'feedback in the future');
  const afterBad = (await call(P.ledger, 'GET', undefined, {auth: owner})).value.agreement;
  eq([afterBad.due, afterBad.days_shift, afterBad.delays.length], [before.due, before.days_shift, 0]); // due date unchanged
  status(await entry(owner, P.ledger, 'client_input', {input_id: 'copy', received: plusDays(today, 1), shift: true, note: ''}), 201, 'tomorrow (zone tolerance)');
  status(await entry(owner, P.ledger, 'revision_round', {feedback_date: today, note: ''}), 201, 'feedback today');
}

// ---------------------------------------------------------------------------------------------
// LT-08: "Revise CO" withdraws CO-n and proposes CO-m (revises: n) in one transaction; withdraw is
// idempotent and does not wait on the project lock.
// ---------------------------------------------------------------------------------------------
{
  resetLimits();
  const R = await project(owner, {...inr, title: 'TEST WS-05 revise ' + Date.now()});
  status(await entry(owner, R.ledger, 'change_order', coPayload('TEST approved first', {fee_delta: 100})), 201);
  status(await call('/api/review/' + R.token + '/change-order', 'POST', {seq: 1, decision: 'approved', signer: 'TEST Client', comment: ''}), 200);
  status(await entry(owner, R.ledger, 'change_order', coPayload('TEST to revise', {fee_delta: 500})), 201); // CO-3 (seq 2 is the settle)
  const count = async () => (await call(R.ledger, 'GET', undefined, {auth: owner})).value.entries.length;
  const n0 = await count();
  const revised = status(await entry(owner, R.ledger, 'change_order', coPayload('TEST revised', {fee_delta: 450, revises: 3})), 201, 'revise CO-3');
  eq([revised.value.withdrawn, revised.value.seq], [3, n0 + 2]);
  const v = (await call(R.ledger, 'GET', undefined, {auth: owner})).value;
  const [settle, replacement] = v.entries.slice(-2);
  eq([settle.seq, settle.kind, settle.payload.ref_seq, settle.payload.outcome], [n0 + 1, 'settle', 3, 'withdrawn']);
  eq([replacement.seq, replacement.kind, replacement.payload.revises], [n0 + 2, 'change_order', 3]);
  eq(v.agreement.change_orders.map(c => [c.seq, c.status]), [[1, 'approved'], [3, 'withdrawn'], [n0 + 2, 'proposed']]);
  eq(v.chain.intact, true);
  // Atomic: a revise that cannot apply writes nothing (neither the withdrawal nor the new CO).
  const n1 = await count();
  eq((status(await entry(owner, R.ledger, 'change_order', coPayload('TEST revise approved', {fee_delta: 1, revises: 1})), 409, 'revise approved CO')).value.code, 'not_revisable');
  status(await entry(owner, R.ledger, 'change_order', coPayload('TEST revise missing', {fee_delta: 1, revises: 99})), 400, 'revise missing CO');
  status(await entry(owner, R.ledger, 'change_order', coPayload('TEST revise below zero', {fee_delta: -100000, revises: n0 + 2})), 400, 'invalid replacement');
  eq(await count(), n1);
  eq((await call(R.ledger, 'GET', undefined, {auth: owner})).value.agreement.change_orders.at(-1).status, 'proposed');
  // Withdraw: fast, idempotent, and a double submit records one settle.
  const target = n0 + 2;
  const withdraw = () => entry(owner, R.ledger, 'settle', {ref_seq: target, outcome: 'withdrawn'});
  const t0 = Date.now();
  const [a, b] = await Promise.all([withdraw(), withdraw()]);
  ok(Date.now() - t0 < 2000, 'withdraw answers in under 2 s');
  eq([a.status, b.status].sort(), [200, 201], JSON.stringify([a.value, b.value]));
  eq((status(await withdraw(), 200, 'repeat withdraw')).value.replayed, true);
  const w = (await call(R.ledger, 'GET', undefined, {auth: owner})).value;
  eq(w.entries.filter(e => e.kind === 'settle' && e.payload.ref_seq === target).length, 1);
  eq(w.agreement.change_orders.find(c => c.seq === target).status, 'withdrawn');
}

// ---------------------------------------------------------------------------------------------
// SF-05: a retainer with 12 posts a month. 11 used → 11/12 (owner and client); the 13th post
// proposes exactly one overage CO at the rate-card price (₹1,500), even when the request repeats.
// ---------------------------------------------------------------------------------------------
{
  resetLimits();
  const retainer = {title: 'TEST WS-05 retainer ' + Date.now(), client: 'TEST Client', deliverables: '', items: [{id: 'post', title: 'Instagram post', qty: 12, unit: 'posts', price: 30000, acceptance: ''}], client_inputs: [], exclusions: '', fee: 30000, currency: 'INR', revisions: 1, due: '', notes: '', tax_label: 'GST', tax_pct: 18, engagement: 'retainer', retainer: {period: 'monthly', quotas: [{item_id: 'post', qty: 12}], carry_over: 'none', renewal: 'manual'}};
  const S = await project(owner, retainer);
  const periods = '/api/scopes/' + S.project_id + '/periods';
  const usage = (qty, extra = {}) => call(periods, 'POST', {action: 'usage', baseline_version: 1, item_id: 'post', qty, date: today, note: '', ...extra}, {auth: owner});
  status(await call('/api/scopes/' + P.project_id + '/periods', 'GET', undefined, {auth: owner}), 409, 'project engagement');
  status(await usage(1, {date: plusDays(today, 3)}), 400, 'usage in the future');
  const first = status(await usage(11), 201, 'log 11');
  eq(first.value.entries.map(e => e.kind), ['period_open', 'usage']);
  eq(first.value.overage, null);
  const line = r => r.periods.find(p => p.period === today.slice(0, 7)).lines.find(l => l.item_id === 'post');
  const owned = (await call(periods, 'GET', undefined, {auth: owner})).value;
  eq([line(owned.retainer).used, line(owned.retainer).allowance, line(owned.retainer).left], [11, 12, 1]);
  const seen = (await call('/api/review/' + S.token)).value.ledger.agreement.retainer;
  eq([line(seen).used, line(seen).allowance], [11, 12]); // the client sees the same counter
  status(await usage(1), 201, 'the 12th post');
  eq((await call(S.ledger, 'GET', undefined, {auth: owner})).value.agreement.change_orders.length, 0);
  const id = randomUUID();
  const over = status(await usage(1, {request_id: id}), 201, 'the 13th post');
  eq(over.value.overage, {qty: 1, priced: 'rate_card'});
  eq(over.value.entries.map(e => e.kind), ['usage', 'change_order']);
  eq((status(await usage(1, {request_id: id}), 200, 'replayed usage')).value.replayed, true);
  const v = (await call(S.ledger, 'GET', undefined, {auth: owner})).value;
  const cos = v.agreement.change_orders.filter(c => c.overage);
  eq(cos.length, 1); // exactly one proposed CO per overage event
  eq([cos[0].status, cos[0].fee_delta, cos[0].overage.qty, cos[0].rate_card.unit_price_minor], ['proposed', 1500, 1, 150000]);
  eq(line(v.agreement.retainer).used, 13); eq(line(v.agreement.retainer).over, 1);
  // Owners cannot hand-write an overage CO; it comes from the usage log only.
  status(await entry(owner, S.ledger, 'change_order', {...coPayload('TEST fake overage', {fee_delta: 1}), overage: {period: today.slice(0, 7), item_id: 'post', qty: 1, usage_seq: 1}}), 400, 'hand-written overage');
  const statement = status(await call(periods + '?period=' + today.slice(0, 7), 'GET', undefined, {auth: owner}), 200, 'statement');
  eq(statement.value.statement.period, today.slice(0, 7));
  ok(statement.value.statement.overage.some(o => o.seq === cos[0].seq), 'the statement lists the overage CO');
  status(await call(periods + '?period=1999-01', 'GET', undefined, {auth: owner}), 404, 'unopened period');
  const closed = status(await call(periods, 'POST', {action: 'close', baseline_version: 1, period: today.slice(0, 7)}, {auth: owner}), 201, 'close');
  eq(closed.value.entries.map(e => e.kind), ['period_close']);
  status(await usage(1), 409, 'usage after close');
  eq(v.chain.intact, true);
}

// ---------------------------------------------------------------------------------------------
// H6: money is never dropped. A project at the 200-entry beta cap still records a verified payment
// (webhook) and an owner TDS credit; the cap still applies to owner-authored non-money entries.
// ---------------------------------------------------------------------------------------------
{
  resetLimits();
  const C = await project(owner, {...inr, title: 'TEST WS-05 at cap ' + Date.now(), client_inputs: []});
  // Fill the ledger to the cap directly (a chained but unsigned filler; only the count matters here).
  localSql(`INSERT INTO ledger_entries (id,project_id,seq,kind,baseline_version,actor,payload,ref,prev_hash,hash,created)
    SELECT 'ws05-fill-' || ${q(C.project_id)} || '-' || g, ${q(C.project_id)}, g, 'goodwill', 1, 'owner', '{"title":"TEST filler","value":0,"hours":0,"note":"","visible":true}', NULL,
      CASE WHEN g = 1 THEN repeat('0', 64) ELSE encode(sha256(convert_to(${q(C.project_id)} || ':' || (g - 1), 'UTF8')), 'hex') END,
      encode(sha256(convert_to(${q(C.project_id)} || ':' || g, 'UTF8')), 'hex'), ${q(new Date().toISOString())}
    FROM generate_series(1, 200) g`);
  eq(Number(localSql(`SELECT COUNT(*)::int AS n FROM ledger_entries WHERE project_id=${q(C.project_id)}`)[0].results[0].n), 200);
  const capped = status(await entry(owner, C.ledger, 'goodwill', {title: 'TEST over the cap', value: 1}), 429, 'owner entry at cap');
  assert.match(capped.value.error, /supports 200 ledger entries/); passed++;
  // A verified Razorpay capture still lands (CI sets RAZORPAY_WEBHOOK_SECRET; no API keys).
  const SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
  assert.ok(SECRET, 'RAZORPAY_WEBHOOK_SECRET is required (see .github/workflows/ci.yml)');
  const order_id = 'order_' + randomUUID().replaceAll('-', '').slice(0, 14);
  localSql(`INSERT INTO scopeflow.payments (id,project_id,version,provider,order_id,amount_minor,currency,status,created) VALUES (${q(randomUUID())},${q(C.project_id)},1,'razorpay',${q(order_id)},3000000,'INR','created',${q(new Date().toISOString())})`);
  const raw = JSON.stringify({event: 'payment.captured', payload: {payment: {entity: {id: 'pay_' + randomUUID().slice(0, 10), order_id, amount: 3000000, currency: 'INR', status: 'captured'}}}});
  const hook = await fetch(base + '/api/payments/razorpay/webhook', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Razorpay-Signature': createHmac('sha256', SECRET).update(raw).digest('hex'), 'X-Razorpay-Event-Id': 'evt_' + randomUUID().slice(0, 8)}, body: raw});
  eq(hook.status, 200);
  // integration: WS-04 adds outcome/excess_minor to the webhook reply; this test only checks the capture lands past the cap
  const hj = await hook.json(); eq({recorded: hj.recorded, ledger: hj.ledger, seq: hj.seq}, {recorded: true, ledger: true, seq: 201});
  // Owner-recorded money is exempt from the cap too.
  status(await entry(owner, C.ledger, 'tds_credit', {amount_minor: 250000, currency: 'INR', credited: today, section: '194J(b)', certificate: '', note: ''}), 201, 'TDS credit at cap');
  const v = (await call(C.ledger, 'GET', undefined, {auth: owner})).value;
  // integration: WS-04 records the ₹500 over the balance as its own excess_payment entry right after the payment
  eq(v.entries.slice(-3).map(e => [e.seq, e.kind]), [[201, 'payment'], [202, 'excess_payment'], [203, 'tds_credit']]);
  const pdf = await fetch(base + '/api/scopes/' + C.project_id + '/statement', {headers: {cookie: owner}});
  eq(pdf.status, 200);
  ok(Buffer.from(await pdf.arrayBuffer()).toString('latin1').includes('Rs.30,000'), 'the statement shows the payment');
}

// ---------------------------------------------------------------------------------------------
// H6 hooks in-process: appendMoneyEntry records against the CURRENT approved baseline with
// order_baseline, is idempotent by ref and fails loudly (MoneyEntryError); onBaselineApproved
// writes one baseline_superseded entry carrying the money on record (C4 support).
// ---------------------------------------------------------------------------------------------
{
  resetLimits();
  const M = await project(owner, {...inr, title: 'TEST WS-05 money ' + Date.now(), client_inputs: []});
  const pay = (ref, amount) => ({provider: 'razorpay', purpose: 'deposit', order_id: 'order_' + ref, payment_id: 'pay_' + ref, amount, currency: 'INR'});
  const onV1 = await hooks.appendMoneyEntry({baseline: {project_id: M.project_id, version: 1}, kind: 'payment', actor: 'system', ref: 'payment:TEST-a-' + M.project_id, payload: pay('a', 10000)});
  eq([onV1.baseline_version, onV1.payload.order_baseline], [1, undefined]);
  // A new version (superseding the agreement that now has a payment on it) is approved.
  const v2 = status(await call('/api/scopes/' + M.project_id, 'POST', {content: {...inr, title: inr.title + ' v2', fee: 26000}, expected_version: 1, supersede_agreement: true}, {auth: owner}), 201, 'v2');
  const token2 = v2.value.scope.token;
  status(await call('/api/review/' + token2, 'POST', await ack(base, token2, {decision: 'approved', signer: 'TEST Reviewer', comment: '', version: 2})), 200, 'approve v2');
  // The order was created on v1; its payment arrives after v2 was approved.
  const late = await hooks.appendMoneyEntry({baseline: {project_id: M.project_id, version: 1}, kind: 'payment', actor: 'system', ref: 'payment:TEST-b-' + M.project_id, payload: pay('b', 5000)});
  eq([late.baseline_version, late.payload.order_baseline, late.order_baseline], [2, 1, 1]);
  const again = await hooks.appendMoneyEntry({baseline: {project_id: M.project_id, version: 1}, kind: 'payment', actor: 'system', ref: 'payment:TEST-b-' + M.project_id, payload: pay('b', 5000)});
  eq([again.duplicate, again.seq], [true, late.seq]);
  await hooks.onBaselineApproved(M.project_id, 1, 2);
  await hooks.onBaselineApproved(M.project_id, 1, 2); // idempotent
  const rows = localSql(`SELECT kind,baseline_version,actor,payload FROM ledger_entries WHERE project_id=${q(M.project_id)} ORDER BY seq`)[0].results;
  // integration: once merged, approving v2 through the review route already fires onBaselineApproved, so the
  // superseded entry lands before the late payment; the explicit calls above stay idempotent no-ops.
  eq(rows.map(r => [r.kind, r.baseline_version, r.actor]), [['payment', 1, 'system'], ['baseline_superseded', 2, 'system'], ['payment', 2, 'system']]);
  // integration: it carries the money on record at approval time (the ₹10,000 on v1; the late ₹5,000 came after)
  const superseded = JSON.parse(rows[1].payload);
  eq([superseded.from, superseded.to, superseded.currency, superseded.received_minor, superseded.paid_minor], [1, 2, 'INR', 1000000, 1000000]);
  // Failures are thrown, never swallowed (WS-04 turns them into a 500 + payment alert).
  const fails = async (opts, code) => { await assert.rejects(hooks.appendMoneyEntry(opts), e => e instanceof hooks.MoneyEntryError && e.code === code); passed++; };
  await fails({baseline: {project_id: M.project_id, version: 2}, kind: 'goodwill', actor: 'owner', payload: {title: 'TEST', value: 1}}, 'not_money_kind');
  await fails({baseline: {project_id: M.project_id, version: 2}, kind: 'payment', actor: 'system', ref: 'payment:TEST-bad', payload: {...pay('c', 1), currency: 'inr'}}, 'invalid_payload');
  const draft = status(await call('/api/scopes', 'POST', {...inr, title: 'TEST WS-05 draft ' + Date.now()}, {auth: owner}), 201, 'draft');
  await fails({baseline: {project_id: draft.value.scope.project_id, version: 1}, kind: 'payment', actor: 'system', ref: 'payment:TEST-draft', payload: pay('d', 1)}, 'no_approved_baseline');
  const view = (await call('/api/scopes/' + M.project_id + '/ledger', 'GET', undefined, {auth: owner})).value;
  eq(view.chain.intact, true); eq(view.seal.state, 'valid');
}

console.log(JSON.stringify({passed, suite: 'ws-05-ledger'}));
process.exit(0); // the in-process database pool (H6 hooks) would otherwise keep the process alive
