// WS-05: ledger kinds, change-order proof, date bounds, revise, deliverables fold, retainers and the
// rate card. Pure: lib/* only, frozen clock, seeded properties.
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fc, freezeClock, tick} from '../support/property.mjs';
import {approve, append} from '../support/chain.mjs';

freezeClock();
const L = await import('../../lib/ledger.ts');
const R = await import('../../lib/retainer.ts');
const C = await import('../../lib/rate-card-core.ts');
const M = await import('../../lib/ledger-math.ts');
const {scopeSchema} = await import('../../lib/scope.ts');
const {coFromLine} = C;

const inr = scopeSchema.parse({title: 'Brand film', client: 'Kavya Studio', deliverables: '', items: [{id: 'film', title: 'Brand film', qty: 1, price: 25000}], exclusions: 'Print', fee: 25000, currency: 'INR', revisions: 2, due: '2026-12-01', notes: '', tax_label: 'GST', tax_pct: 18});
const co1 = {title: 'Extra reel', reason: '', request_quote: '', add_items: [{id: 'reel', title: 'Extra reel', qty: 1, unit: '', price: 7500.5, acceptance: ''}], remove_item_ids: [], fee_delta: 7500.5, days_delta: 0, revisions_delta: 0};

// --------------------------------------------------------------------------- SF-06 rate card

// @covers SF-06
test('U: pctOfMinor is exact half-up (away from zero) integer arithmetic', () => {
  const ref = (minor, pct) => { // exact rational reference with BigInt
    const bp = BigInt(Math.round(pct * 10000)), n = BigInt(minor) * bp, d = 1000000n;
    const q = n < 0n ? -n : n, r = q / d, rem = q % d;
    const v = rem * 2n >= d ? r + 1n : r;
    return Number(n < 0n ? -v : v);
  };
  fc.assert(fc.property(fc.integer({min: -1e12, max: 1e12}), fc.integer({min: -1000000, max: 5000000}).map(x => x / 10000), (minor, pct) => {
    assert.equal(M.pctOfMinor(minor, pct), ref(minor, pct));
    assert.ok(Number.isSafeInteger(M.pctOfMinor(minor, pct)));
  }));
  assert.equal(M.pctOfMinor(250050, 25), 62513); // 62512.5 rounds up
  assert.equal(M.pctOfMinor(-250050, 25), -62513);
  assert.equal(M.pctOfMinor(750050, 18), 135009);
  assert.equal(M.pctOfMinor(1, 50), 1);
  assert.equal(M.pctOfMinor(3, 12.5), 0);
});

// @covers SF-06
test('U: multipliers round in minor units at each step; tax on the subtotal', () => {
  const card = {items: [], multipliers: [{id: 'rush', label: 'Rush delivery', pct: 25}, {id: 'weekend', label: 'Weekend', pct: 10}]};
  const item = {id: 'reel', title: 'Extra reel', unit: 'reel', unit_price_minor: 250050, currency: 'INR', tax_pct: 18, tags: []};
  const line = C.priceLine(item, 1, ['rush'], card);
  assert.deepEqual([line.base_minor, line.adjustments[0].amount_minor, line.subtotal_minor, line.tax.amount_minor, line.total_minor], [250050, 62513, 312563, 56261, 368824]);
  const two = C.priceLine(item, 1, ['rush', 'weekend'], card);
  assert.equal(two.adjustments[1].amount_minor, 31256); // 10% of 312563 = 31256.3
  assert.equal(two.subtotal_minor, 343819);
  // Fractional quantities (hours) round half-up once.
  assert.equal(C.priceLine({...item, unit_price_minor: 333}, 1.5, [], card).base_minor, 500); // 499.5
  // JPY has no minor digits: still integers.
  const jpy = C.priceLine({...item, currency: 'JPY', unit_price_minor: 1001}, 1, ['rush'], card, 10);
  assert.deepEqual([jpy.subtotal_minor, jpy.tax.amount_minor], [1251, 125]);
  fc.assert(fc.property(fc.integer({min: 0, max: 1e9}), fc.integer({min: 1, max: 400}).map(q => q / 4), fc.subarray(['rush', 'weekend']), fc.constantFrom(0, 5, 12, 18, 28), (price, qty, mult, tax) => {
    const l = C.priceLine({...item, unit_price_minor: price}, qty, mult, card, tax);
    for (const v of [l.base_minor, l.subtotal_minor, l.tax.amount_minor, l.total_minor, ...l.adjustments.map(a => a.amount_minor)]) assert.ok(Number.isSafeInteger(v));
    assert.equal(l.subtotal_minor, l.base_minor + l.adjustments.reduce((s, a) => s + a.amount_minor, 0));
    assert.equal(l.total_minor, l.subtotal_minor + l.tax.amount_minor);
    assert.ok(l.subtotal_minor >= l.base_minor);
  }));
  assert.throws(() => C.priceLine(item, 1, ['nope'], card), /Unknown multiplier/);
});

// @covers SF-06
test('U: a rate-card line becomes a valid change-order draft (extra reel ₹2,500 + GST)', () => {
  const card = {items: [{id: 'reel', title: 'Extra reel', unit: 'reel', unit_price_minor: 250000, currency: 'INR', tax_pct: 18, tags: ['video']}], multipliers: C.DEFAULT_MULTIPLIERS};
  assert.equal(C.rateCardSchema.safeParse(card).success, true);
  const line = C.priceLine(card.items[0], 1, [], card, 18);
  assert.deepEqual([line.subtotal_minor, line.tax.amount_minor, line.total_minor], [250000, 45000, 295000]);
  const co = coFromLine(line, 'rc_test');
  assert.equal(co.fee_delta, 2500);
  assert.equal(co.add_items[0].title, 'Extra reel');
  assert.deepEqual(co.rate_card, {item_id: 'reel', qty: 1, unit_price_minor: 250000, multipliers: []});
  assert.equal(L.changeOrderSchema.safeParse(co).success, true);
  assert.equal(L.coTotals(co, inr).total_incl_tax_minor, 295000);
  assert.equal(C.rateItemFor({items: [{...card.items[0], id: 'x', tags: ['item:posts']}]}, 'posts').id, 'x');
  assert.equal(C.searchRateCard(card, 'vid', 'INR').length, 1);
  assert.equal(C.rateCardSchema.safeParse({items: [card.items[0], card.items[0]], multipliers: []}).success, false);
});

// --------------------------------------------------------------------------- H17 proof

// @covers H17
test('U: the CO hash commits to title, deliverables, fee, tax, total incl. tax and days; not to status', async () => {
  const seqd = {...co1, seq: 1};
  const h = await L.coSha256(seqd, inr);
  assert.match(h, /^[a-f0-9]{64}$/);
  assert.equal(await L.coSha256({...seqd, status: 'approved', settled_by: 'x', created: tick(9)}, inr), h);
  for (const change of [{title: 'Extra reel!'}, {fee_delta: 7500.51}, {days_delta: 1}, {add_items: [{...co1.add_items[0], qty: 2}]}, {seq: 2}]) assert.notEqual(await L.coSha256({...seqd, ...change}, inr), h, JSON.stringify(change));
  assert.notEqual(await L.coSha256(seqd, {...inr, tax_pct: 12}), h);
  const t = L.coTotals(co1, inr);
  assert.deepEqual(t, {currency: 'INR', fee_delta_minor: 750050, tax: {label: 'GST', pct: 18, amount_minor: 135009}, total_incl_tax_minor: 885059});
  // Settle payloads recorded before H17 still parse unchanged; the new fields are optional.
  const old = {ref_seq: 1, outcome: 'approved', signer: 'Ada', comment: ''};
  assert.deepEqual(L.settleSchema.parse(old), old);
  assert.equal(L.settleSchema.safeParse({...old, co_sha256: 'x'}).success, false);
});

// --------------------------------------------------------------------------- M8 dates

// @covers M8
test('R: client_input.received and revision_round.feedback_date are bounded by today (+1) and the approval date', () => {
  const s = scopeSchema.parse({...inr, client_inputs: [{id: 'brief', title: 'Brief', due: '2026-10-10'}]});
  const a = L.computeAgreement(s, 1, []);
  const ctx = {today: '2026-10-07', approved_on: '2026-10-01'};
  const input = d => L.checkEntry('client_input', {input_id: 'brief', received: d, shift: true, note: ''}, s, a, 'owner', ctx);
  assert.match(input('2026-10-10'), /future/); // today + 3
  assert.match(input('2026-10-09'), /future/); // tomorrow + 1 (tomorrow+2 days from "today")
  assert.equal(input('2026-10-08'), null); // +1 day tolerance
  assert.match(input('2026-09-30'), /before the scope was approved/);
  const round = d => L.checkEntry('revision_round', {feedback_date: d, note: ''}, s, a, 'owner', ctx);
  assert.match(round('2026-10-09'), /future/);
  assert.equal(round('2026-10-07'), null);
  assert.match(round('2026-09-01'), /before/);
  // Without a context (pure folds and the property generators) dates are not bounded, as before.
  assert.equal(L.checkEntry('revision_round', {feedback_date: '2027-01-01', note: ''}, s, a, 'owner'), null);
  assert.deepEqual(M.entryContext('Asia/Kolkata', '2026-09-30T20:00:00Z'), {today: '2026-10-07', approved_on: '2026-10-01'});
});

// --------------------------------------------------------------------------- LT-08 / LT-14

// @covers LT-08
test('R: a revising change order names an existing CO; its CoView carries revises', async () => {
  const b = await approve(inr);
  const entries = [];
  entries.push(await append(entries, b, 'change_order', co1, 'owner', tick(1)));
  entries.push(await append(entries, b, 'settle', {ref_seq: 1, outcome: 'withdrawn', signer: '', comment: ''}, 'owner', tick(2)));
  const revised = {...co1, fee_delta: 7000, add_items: [{...co1.add_items[0], id: 'reel2', price: 7000}], revises: 1};
  let a = L.computeAgreement(inr, 1, entries);
  assert.equal(L.checkEntry('change_order', revised, inr, a, 'owner'), null);
  assert.match(L.checkEntry('change_order', {...revised, revises: 9}, inr, a, 'owner'), /does not exist/);
  entries.push(await append(entries, b, 'change_order', revised, 'owner', tick(3)));
  a = L.computeAgreement(inr, 1, entries);
  assert.deepEqual(a.change_orders.map(c => [c.seq, c.status, c.revises ?? null]), [[1, 'withdrawn', null], [3, 'proposed', 1]]);
  assert.match(L.describeEntry(entries[2], 'INR'), /revises CO-1/);
});

// @covers LT-14
test('R: an approved CO deliverable is folded into agreement.deliverables; the form nudges a fee without one', async () => {
  const {changeOrderNudges} = await import('../../lib/ledger-form.ts');
  const b = await approve(inr);
  const entries = [];
  entries.push(await append(entries, b, 'change_order', co1, 'owner', tick(1)));
  assert.doesNotMatch(L.computeAgreement(inr, 1, entries).deliverables, /Extra reel/); // pending: not in force
  entries.push(await append(entries, b, 'settle', {ref_seq: 1, outcome: 'approved', signer: 'Ada', comment: ''}, 'client', tick(2)));
  const a = L.computeAgreement(inr, 1, entries);
  assert.deepEqual(a.deliverables.split('\n'), ['Brand film', 'Extra reel [CO-1]']);
  assert.deepEqual(changeOrderNudges({fee_delta: 1000, add_items: []}).length, 1);
  assert.deepEqual(changeOrderNudges({fee_delta: 1000, add_items: co1.add_items}), []);
  assert.deepEqual(changeOrderNudges({fee_delta: -10, add_items: []}), []);
});

// --------------------------------------------------------------------------- new kinds

// @covers H6
test('U: money kinds are cap-exempt; the cap counts only owner-authored non-money kinds', () => {
  for (const k of ['payment', 'refund', 'tds_credit', 'baseline_superseded', 'payment_received', 'excess_payment', 'payment_claim_confirmed']) for (const actor of ['owner', 'system', 'client']) assert.equal(L.countsTowardCap(k, actor), false, k + actor);
  for (const k of ['change_order', 'goodwill', 'revision_round', 'client_input', 'usage', 'period_open', 'delivery_accepted']) assert.equal(L.countsTowardCap(k, 'owner'), true, k);
  assert.equal(L.countsTowardCap('settle', 'client'), false);
  assert.equal(L.paymentSchema.safeParse({provider: 'razorpay', purpose: 'deposit', order_id: 'o', payment_id: 'p', amount: 1, currency: 'INR', order_baseline: 1}).success, true);
});

test('every planned kind is enabled with a strict payload schema and actor rules', async () => {
  for (const k of L.plannedEntryKinds) assert.equal(L.entryKindEnabled(k), true, k);
  const a = L.computeAgreement(inr, 1, []);
  const sup = {from: 1, to: 2, currency: 'INR', received_minor: 300000, refunded_minor: 0, paid_minor: 300000, tds_minor: 0, invoiced_minor: 0, entries_before: 3};
  assert.equal(L.payloadSchemas.baseline_superseded.safeParse(sup).success, true);
  assert.equal(L.payloadSchemas.baseline_superseded.safeParse({...sup, extra: 1}).success, false);
  assert.match(L.checkEntry('baseline_superseded', sup, inr, a, 'owner'), /Only Scopeflow/);
  assert.equal(L.checkEntry('baseline_superseded', sup, inr, a, 'system'), null);
  const tds = L.payloadSchemas.tds_credit.parse({amount_minor: 250000, currency: 'INR', credited: '2026-10-05'});
  assert.equal(L.checkEntry('tds_credit', tds, inr, a, 'owner', {today: '2026-10-07'}), null);
  assert.match(L.checkEntry('tds_credit', {...tds, currency: 'USD'}, inr, a, 'owner'), /INR/);
  assert.match(L.checkEntry('excess_payment', {amount_minor: 1, currency: 'INR', reason: 'overpaid', note: ''}, inr, a, 'owner'), /Only Scopeflow/);
  assert.match(L.checkEntry('delivery_accepted', {accepted: '2026-10-05', deemed: true, item_ids: [], evidence: '', note: ''}, inr, a, 'owner'), /Deemed/);
  assert.match(L.checkEntry('delivery_accepted', {accepted: '2026-10-05', deemed: false, item_ids: ['nope'], evidence: '', note: ''}, inr, a, 'client'), /Unknown deliverable/);
  assert.match(L.checkEntry('usage', {period: '2026-10', item_id: 'film', qty: 1, date: '2026-10-05', note: ''}, inr, a, 'owner'), /not a retainer/);
  const b = await approve(inr);
  const e = await append([], b, 'baseline_superseded', sup, 'system', tick(1));
  assert.match(L.describeEntry(e, 'INR'), /Version 2 replaced version 1: ₹3,000\.00 paid carried forward/);
});

// --------------------------------------------------------------------------- SF-05 retainers

const posts = scopeSchema.parse({title: 'Social retainer', client: 'Kavya Studio', deliverables: '', items: [{id: 'posts', title: 'Instagram posts', qty: 12, unit: 'posts', unit_price: 600}, {id: 'reels', title: 'Reels', qty: 2, unit: 'reels'}], exclusions: 'Paid ads', fee: 30000, currency: 'INR', revisions: 1, due: '', notes: '', tax_label: 'GST', tax_pct: 18, engagement: 'retainer', retainer: {period: 'monthly', quotas: [{item_id: 'posts', qty: 12}, {item_id: 'reels', qty: 2}], carry_over: 'cap'}});

async function retainerLedger(uses, {overagePrice = 60000} = {}) {
  const b = await approve(posts, {project_id: 'p_retainer'});
  const entries = [];
  const add = async (kind, payload, actor = 'owner') => entries.push(await append(entries, b, kind, payload, actor, tick(entries.length + 1)));
  await add('period_open', {period: '2026-10', ...R.periodBounds('2026-10'), quotas: R.openingQuotas(posts, L.computeAgreement(posts, 1, entries).retainer, '2026-10')});
  const cos = [];
  for (const [n, qty] of uses.entries()) {
    const usage = {period: '2026-10', item_id: 'posts', qty, date: `2026-10-${String(n + 1).padStart(2, '0')}`, note: ''};
    const a = L.computeAgreement(posts, 1, entries);
    assert.equal(L.checkEntry('usage', usage, posts, a, 'owner'), null);
    const over = R.overageOf(a.retainer, usage);
    await add('usage', usage);
    if (over > 0) {
      const usageSeq = entries.at(-1).seq;
      await add('change_order', {title: `Overage: ${over} × Instagram posts (2026-10)`, reason: '', request_quote: '', add_items: [{id: `ov_${usageSeq}_posts`, title: 'Instagram posts', qty: over, unit: 'posts', price: over * overagePrice / 100, acceptance: ''}], remove_item_ids: [], fee_delta: over * overagePrice / 100, days_delta: 0, revisions_delta: 0, overage: {period: '2026-10', item_id: 'posts', qty: over, usage_seq: usageSeq}});
      cos.push(entries.at(-1).seq);
    }
  }
  return {b, entries, cos};
}

// @covers SF-05
test('R: quota 12 posts, log 13 → exactly one overage change order for 1 post', async () => {
  const {entries, cos} = await retainerLedger([11, 2]);
  assert.equal(cos.length, 1);
  const a = L.computeAgreement(posts, 1, entries);
  const line = a.retainer.periods[0].lines.find(l => l.item_id === 'posts');
  assert.deepEqual([line.used, line.allowance, line.over, line.left], [13, 12, 1, 0]);
  assert.deepEqual(a.retainer.periods[0].overage_cos.map(o => [o.seq, o.qty, o.status]), [[cos[0], 1, 'proposed']]);
  assert.equal(R.counterLabel({used: 11, allowance: 12, title: 'Instagram posts', unit: 'posts'}), '11/12 posts used');
});

// @covers SF-05
test('P: one overage CO per usage that crosses or extends past the allowance; overage quantities sum to the excess', async () => {
  await fc.assert(fc.asyncProperty(fc.array(fc.integer({min: 1, max: 6}), {minLength: 1, maxLength: 8}), async uses => {
    const {entries, cos} = await retainerLedger(uses);
    const total = uses.reduce((s, x) => s + x, 0);
    const a = L.computeAgreement(posts, 1, entries);
    const ovs = a.change_orders.filter(c => c.overage);
    assert.equal(ovs.length, cos.length);
    assert.equal(ovs.reduce((s, c) => s + c.overage.qty, 0), Math.max(0, total - 12));
    // Each overage CO points at a distinct usage entry.
    assert.equal(new Set(ovs.map(c => c.overage.usage_seq)).size, ovs.length);
    let running = 0, expected = 0;
    for (const u of uses) { if (running + u > 12) expected++; running += u; }
    assert.equal(ovs.length, expected);
  }), {numRuns: 60});
});

// @covers SF-05
test('carry-over (cap): unused quota carries into the next period up to one quota; closed periods refuse usage', async () => {
  const {b, entries} = await retainerLedger([8]);
  const add = async (kind, payload) => entries.push(await append(entries, b, kind, payload, 'owner', tick(entries.length + 1)));
  let a = L.computeAgreement(posts, 1, entries);
  await add('period_close', {period: '2026-10', lines: R.closingLines(a.retainer, '2026-10'), overage_cos: []});
  a = L.computeAgreement(posts, 1, entries);
  assert.match(L.checkEntry('usage', {period: '2026-10', item_id: 'posts', qty: 1, date: '2026-10-20', note: ''}, posts, a, 'owner'), /closed/);
  const q = R.openingQuotas(posts, a.retainer, '2026-11');
  assert.deepEqual(q, [{item_id: 'posts', qty: 12, carried: 4}, {item_id: 'reels', qty: 2, carried: 2}]);
  assert.match(L.checkEntry('period_open', {period: '2026-10', ...R.periodBounds('2026-10'), quotas: q}, posts, a, 'owner'), /already open/);
  assert.deepEqual(R.periodBounds('2028-02'), {starts: '2028-02-01', ends: '2028-02-29'});
  const none = scopeSchema.parse({...posts, retainer: {...posts.retainer, carry_over: 'none'}});
  assert.deepEqual(R.openingQuotas(none, a.retainer, '2026-11').map(x => x.carried), [0, 0]);
});

// --------------------------------------------------------------------------- N1 goodwill totals

test('U: goodwill totals are rounded to the currency decimals (value) and 2 dp (hours)', async () => {
  const goodwill = (value, hours, seq) => ({seq, kind: 'goodwill', baseline_version: 1, actor: 'owner', created: tick(seq), payload: {title: 'Goodwill', value, hours, note: '', visible: true}, payload_hash: '', prev_hash: '', hash: ''});
  const a = L.computeAgreement(inr, 1, [goodwill(0.1, 0.1, 1), goodwill(0.2, 0.2, 2)]);
  assert.equal(a.goodwill_value, 0.3); // not 0.30000000000000004
  assert.equal(a.goodwill_hours, 0.3);
  const jpy = scopeSchema.parse({...inr, currency: 'JPY'});
  assert.equal(L.computeAgreement(jpy, 1, [goodwill(100.4, 0, 1), goodwill(0.2, 0, 2)]).goodwill_value, 101);
});
