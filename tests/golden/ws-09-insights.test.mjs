// SF-16 (WS-09): computeInsights golden for fixture ledgers, including a supersede. The ₹ recovered hero,
// money (received / outstanding / overdue / MSMED interest / TDS pending), flow and the monthly series are
// pinned; every earlier figure (fees, change orders, creep, goodwill, rounds, clients) is still present.
// Regenerate deliberately with UPDATE_GOLDEN=1.
// @covers SF-16
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import '../support/property.mjs';

const {computeAgreement} = await import('../../lib/ledger.ts');
const {computeInsights, mergeBaselines, recoveredOf, msmedInterest, filterProjects, insightsCsv, lastMonths} = await import('../../lib/insights.ts');

const TODAY = '2026-10-13';
const scope = (over = {}) => ({title: 'Fixture', client: 'Kaveri Foods', deliverables: 'Logo suite', items: [], client_inputs: [], exclusions: '', fee: 10000, currency: 'INR', revisions: 2, due: '', notes: '', tax_label: 'GST', tax_pct: 18, ...over});
let n = 0;
const e = (baseline_version, kind, payload, created) => ({seq: ++n, kind, baseline_version, actor: 'owner', created: created + 'T10:00:00.000Z', payload, payload_hash: '', prev_hash: '', hash: ''});
const co = (v, fee, created) => e(v, 'change_order', {title: 'CO ' + fee, add_items: [], remove_item_ids: [], fee_delta: fee, days_delta: 0, revisions_delta: 0, reason: '', request_quote: ''}, created);
const settle = (v, ref, outcome, created) => e(v, 'settle', {ref_seq: ref.seq, outcome, signer: 'Client', comment: ''}, created);
const paid = (v, amount, received) => e(v, 'payment_received', {amount, method: 'bank_transfer', received, reference: '', note: ''}, received);

// A: INR + 18% GST. v1 ₹10,000 with CO-1 +₹5,000 approved, ₹11,800 paid; superseded by v2 (₹15,000, CO-1 folded in)
// with CO-2 +₹2,000 approved; ₹5,900 and ₹2,360 paid later. Payments go to the base fee first.
const a1 = co(1, 5000, '2026-08-01'), a1s = settle(1, a1, 'approved', '2026-08-03'), a1p = paid(1, 11800, '2026-08-05');
const a2 = co(2, 2000, '2026-09-10'), a2s = settle(2, a2, 'approved', '2026-09-12'), a2p = paid(2, 5900, '2026-09-20'), a2p2 = paid(2, 2360, '2026-10-02');
const gw = e(2, 'goodwill', {title: 'Extra mockup', value: 1500, hours: 3, note: '', visible: false}, '2026-09-15');
const A = mergeBaselines([computeAgreement(scope(), 1, [a1, a1s, a1p]), computeAgreement(scope({fee: 15000}), 2, [a2, a2s, a2p, gw, a2p2])]);
const payA = [a1p, a2p, a2p2].map(x => ({date: x.payload.received, amount: x.payload.amount}));

// B: USD with a locked INR rate, no tax. CO +$500 approved, $1,500 paid this month.
const b1 = co(1, 500, '2026-09-29'), b1s = settle(1, b1, 'approved', '2026-10-01');
const B = computeAgreement(scope({client: 'Harbour Dental', currency: 'USD', fee: 1000, tax_label: undefined, tax_pct: undefined, fx: {currency: 'INR', rate: 85, as_of: '2026-09-01', source: 'ECB reference rate'}}), 1, [b1, b1s]);

// C: INR under MSMED terms (30 days) with TDS; one invoice half paid and overdue; a declined CO.
const c1 = co(1, 3000, '2026-08-10'), c1s = settle(1, c1, 'declined', '2026-08-14');
const C = computeAgreement(scope({client: 'Kaveri Foods', msmed: {agreed_days: 30}}), 1, [c1, c1s]);

const rows = [
  {project_id: 'a', title: 'A', client: 'Kaveri Foods', agreement: A, approved_at: '2026-07-20', tax_pct: 18, total: 20060, payments: payA, invoices: [], msmed_days: null, tds: false, fx_inr: null, radar: {catches: 2, acted: 1}},
  {project_id: 'b', title: 'B', client: 'Harbour Dental', agreement: B, approved_at: '2026-09-25', tax_pct: 0, total: 1500, payments: [{date: '2026-10-05', amount: 1500}], invoices: [], msmed_days: null, tds: false, fx_inr: 85, radar: {catches: 0, acted: 0}},
  {project_id: 'c', title: 'C', client: 'kaveri foods ', agreement: C, approved_at: '2026-07-30', tax_pct: 18, total: 11800, payments: [{date: '2026-08-20', amount: 5900}], invoices: [{seq: 1, total: 11800, issued: '2026-08-01T09:00:00.000Z', due: '2026-08-16', paid_before: 0}], msmed_days: 30, tds: true, fx_inr: null, radar: {catches: 1, acted: 0}},
];

test('SF-16: supersede keeps earlier change orders, goodwill and fees in one agreement', () => {
  assert.equal(A.change_orders.length, 2);
  assert.equal(A.fee_base, 10000, 'fee at approval is the first baseline');
  assert.equal(A.fee, 17000, 'fee now is the latest baseline plus its change orders');
  assert.equal(A.goodwill_value, 1500);
});

test('SF-16: recovered counts change-order value only once the money for it has arrived', () => {
  const r = recoveredOf({agreement: A, payments: payA, tax_pct: 18});
  assert.deepEqual(r, {events: [{date: '2026-09-20', value: 5000}, {date: '2026-10-02', value: 2000}], total: 7000, change_orders: 2});
  assert.deepEqual(recoveredOf({agreement: A, payments: payA.slice(0, 1), tax_pct: 18}), {events: [], total: 0, change_orders: 0}, 'the first ₹11,800 only covers the base fee');
  assert.equal(recoveredOf({agreement: A, payments: [], tax_pct: 18}).total, 0);
});

test('SF-16: computeInsights golden (hero, money, flow, series, and every earlier figure)', () => {
  const out = computeInsights(rows, {today: TODAY, bankRatePct: 5.75});
  assert.deepEqual(out.recovered.last_12, {INR: 7000, USD: 500});
  assert.deepEqual(out.recovered.this_month, {INR: 2000, USD: 500});
  assert.equal(out.recovered.change_orders, 3);
  assert.equal(out.recovered.inr.value, 7000 + 500 * 85);
  assert.deepEqual(out.money.overdue, {INR: 5900});
  assert.equal(out.money.msmed_interest.INR, msmedInterest(5900, 58, 5.75));
  assert.equal(out.money.tds_pending, 1);
  assert.equal(out.flow.co_latency_days, 2, 'median of 2, 2, 2 and 4 days');
  assert.deepEqual(out.flow.radar, {catches: 3, acted: 1, change_orders: 4, approved: 3});
  assert.equal(out.series.length, 12);
  assert.equal(out.series.at(-1).month, '2026-10');
  // Earlier cards are still there, unchanged in shape.
  for (const k of ['fee_at_approval', 'fee_now', 'change_order_value', 'creep', 'goodwill_value', 'revision_rounds', 'clients', 'observations']) assert.ok(k in out, k);
  assert.deepEqual(out.change_order_value, {INR: 7000, USD: 500});
  assert.equal(out.clients[0].client, 'Kaveri Foods');
  const file = new URL('./ws-09-insights.golden.json', import.meta.url), text = JSON.stringify(out, null, 2) + '\n';
  if (process.env.UPDATE_GOLDEN === '1' || !existsSync(file)) writeFileSync(file, text);
  assert.equal(text, readFileSync(file, 'utf8'), 'ws-09-insights changed; run with UPDATE_GOLDEN=1 only if the change is intended');
});

test('SF-16: agreements without money facts give the same earlier figures', () => {
  const bare = rows.map(({project_id, title, client, agreement}) => ({project_id, title, client, agreement}));
  const full = computeInsights(rows, {today: TODAY}), plain = computeInsights(bare, {today: TODAY});
  for (const k of ['projects', 'fee_at_approval', 'fee_now', 'change_order_value', 'goodwill_value', 'goodwill_hours', 'change_orders', 'revision_rounds', 'client_delays', 'creep', 'clients']) assert.deepEqual(plain[k], full[k], k);
  assert.deepEqual(plain.recovered.last_12, {});
});

test('SF-16: filters, months and CSV', () => {
  assert.deepEqual(filterProjects(rows, {period: 'month'}, TODAY).map(r => r.project_id), []);
  assert.deepEqual(filterProjects(rows, {period: '12m'}, TODAY).map(r => r.project_id), ['a', 'b', 'c']);
  assert.deepEqual(filterProjects(rows, {period: 'fy', currency: 'USD'}, TODAY).map(r => r.project_id), ['b']);
  assert.deepEqual(filterProjects(rows, {client: 'KAVERI FOODS'}, TODAY).map(r => r.project_id), ['a', 'c']);
  assert.deepEqual(lastMonths('2026-01-31', 3), ['2025-11', '2025-12', '2026-01']);
  const csv = insightsCsv(computeInsights(rows, {today: TODAY}));
  assert.match(csv, /^section,metric,currency,value\r\n/);
  assert.match(csv, /recovered,last_12_months,INR,7000\r\n/);
  assert.match(csv, /money,tds_certificates_pending,,1\r\n/);
  const evil = insightsCsv(computeInsights([{...rows[1], client: '=HYPERLINK("x")'}], {today: TODAY}));
  assert.match(evil, /client,"'=HYPERLINK\(""x""\)"/, 'formula-looking text is neutralised');
});
