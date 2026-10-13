// WS-07: the money the client page shows (LT-01 "Agreement now", M7/SF-23 change-order cards incl.
// tax) and the read-only / link-problem states (H4, H10, LT-10). Pure: no server, frozen clock,
// seeded properties; ledgers built with tests/support/chain.mjs exactly as the server builds them.
// @covers LT-01 M7 SF-23 LT-10 H4 H10
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fc, freezeClock, tick, scopeArb} from '../support/property.mjs';
import {approve, append, buildLedger, opArb} from '../support/chain.mjs';

freezeClock();
const M = await import('../../app/review/[token]/money-view.ts');
const S = await import('../../app/review/[token]/states.ts');
const {agreementTotals} = await import('../../lib/agreement-totals.ts');
const {computeAgreement} = await import('../../lib/ledger.ts');

/** The live-test scenario: ₹25,000 + 18% GST; CO-1 +₹7,500.50 approved, CO-2 +₹1,000 declined. */
const liveScope = {title: 'TEST Brand refresh', client: 'TEST Kaveri Foods', deliverables: '', items: [{id: 'i1', title: 'Logo suite', qty: 1, unit: '', price: null, acceptance: ''}], client_inputs: [], exclusions: '', fee: 25000, currency: 'INR', revisions: 2, due: '', notes: '', tax_label: 'GST', tax_pct: 18};
const co = (title, fee_delta) => ({title, reason: '', request_quote: '', add_items: [], remove_item_ids: [], fee_delta, days_delta: 0, revisions_delta: 0});
async function liveLedger({decide = true} = {}) {
  const b = await approve(liveScope);
  let e = [];
  e = [...e, await append(e, b, 'change_order', co('CO one: landing page', 7500.5), 'owner', tick(1))];
  e = [...e, await append(e, b, 'change_order', co('CO two: extra banner', 1000), 'owner', tick(2))];
  if (decide) {
    e = [...e, await append(e, b, 'settle', {ref_seq: 1, outcome: 'approved', signer: 'TEST Client', comment: ''}, 'client', tick(3))];
    e = [...e, await append(e, b, 'settle', {ref_seq: 2, outcome: 'declined', signer: 'TEST Client', comment: 'Not now'}, 'client', tick(4))];
  }
  return e;
}

// @covers LT-01
test('LT-01: Agreement now after CO-1 approved and CO-2 declined = fee ₹32,500.50, GST ₹5,850.09, total ₹38,350.59', async () => {
  const entries = await liveLedger();
  const now = M.agreementNow(liveScope, entries, 0, 1);
  assert.equal(now.fee, 3250050);
  // integration: WS-01 heads carry the GstHead name next to the label (single undivided GST head here).
  assert.deepEqual(now.heads, [{name: 'GST', label: 'GST', rate: 18, amount: 585009}]);
  assert.equal(now.tax, 585009);
  assert.equal(now.total, 3835059);
  assert.equal(now.balance, 3835059);
  assert.equal(M.agreementNow(liveScope, entries, 10000, 1).balance, 3835059 - 1000000);
  assert.equal(M.agreementNow(liveScope, entries, 50000, 1).balance, 0);
});

// @covers LT-01
test('LT-01: with an intra-state split the card shows CGST ₹2,925.05 + SGST ₹2,925.05 and total ₹38,350.60 (§9.3)', () => {
  // The head split is WS-01's GST engine; the card shows whatever heads agreementTotals() returns.
  const now = M.nowFromTotals({currency: 'INR', fee: 3250050, heads: [{label: 'CGST', rate: 9, amount: 292505}, {label: 'SGST', rate: 9, amount: 292505}], tax: 585010, total: 3835060}, 0, 1);
  assert.deepEqual(now.heads.map(h => h.amount), [292505, 292505]);
  assert.equal(now.fee + now.heads.reduce((s, h) => s + h.amount, 0), now.total);
  assert.equal(now.total, 3835060);
});

// @covers M7 SF-23
test('M7/SF-23: CO-1 card shows +₹7,500.50 + GST ₹1,350.09 = ₹8,850.59 and the total ₹29,500.00 → ₹38,350.59', async () => {
  const pending = await liveLedger({decide: false});
  const a = computeAgreement(liveScope, 1, pending);
  const impact = M.coImpact(liveScope, pending, a.change_orders[0]);
  assert.deepEqual({fee: impact.fee, tax: impact.tax, total: impact.total, before: impact.total_before, after: impact.total_after, label: impact.tax_label}, {fee: 750050, tax: 135009, total: 885059, before: 2950000, after: 3835059, label: 'GST'});
  const decided = await liveLedger();
  const d = computeAgreement(liveScope, 1, decided);
  assert.equal(M.coImpact(liveScope, decided, d.change_orders[0]).total, 885059);
  assert.equal(M.coImpact(liveScope, decided, d.change_orders[1]).total, 118000); // declined CO-2 would have been ₹1,180.00
  // M7: CO +₹10,000 at 18% costs the client ₹11,800 incl. tax.
  const b = await approve(liveScope);
  const one = [await append([], b, 'change_order', co('CO: extra page', 10000), 'owner', tick(5))];
  const ten = computeAgreement(liveScope, 1, one).change_orders[0];
  assert.deepEqual([M.coImpact(liveScope, one, ten).fee, M.coImpact(liveScope, one, ten).tax, M.coImpact(liveScope, one, ten).total], [1000000, 180000, 1180000]);
});

// @covers LT-01 SF-23
test('property: Agreement now equals agreementTotals(), balance is never negative, CO impact adds up', async () => {
  await fc.assert(fc.asyncProperty(scopeArb, fc.constantFrom(0, 5, 12, 18, 28), fc.array(opArb, {maxLength: 10}), fc.integer({min: 0, max: 10_000_000}).map(c => c / 100), async (raw, tax, ops, paid) => {
    const content = {...raw, tax_label: 'GST', tax_pct: tax};
    const b = await approve(content);
    const entries = await buildLedger(b, ops);
    const t = agreementTotals(content, entries);
    const now = M.agreementNow(content, entries, paid);
    assert.equal(now.total, t.total);
    assert.equal(now.fee, t.fee);
    assert.ok(now.balance >= 0);
    assert.equal(now.balance, Math.max(0, t.total - now.paid));
    for (const c of computeAgreement(content, 1, entries).change_orders) {
      const i = M.coImpact(content, entries, c);
      assert.equal(i.fee + i.tax, i.total);
      assert.equal(i.total_after - i.total_before, i.total);
      if (c.status === 'approved') assert.equal(i.total_after, t.total, 'an approved CO is already in the agreement total');
    }
  }), {numRuns: 60});
});

// @covers H4 H10
test('read-only links: revoked/rotated/account-closed responses are read-only; ordinary ones are not', () => {
  assert.deepEqual(S.readonlyOf({scope: {}}), {readonly: false, reason: null, keptUntil: null});
  assert.deepEqual(S.readonlyOf({readonly: true}), {readonly: true, reason: 'revoked', keptUntil: null});
  assert.deepEqual(S.readonlyOf({readonly: true, readonly_reason: 'rotated'}), {readonly: true, reason: 'rotated', keptUntil: null});
  assert.deepEqual(S.readonlyOf({account_closed: true, kept_until: '2034-03-31'}), {readonly: true, reason: 'account_closed', keptUntil: '2034-03-31'});
  assert.equal(S.readonlyOf({readonly: true, readonly_reason: 'account_closed'}).reason, 'account_closed');
  fc.assert(fc.property(fc.anything(), d => { const r = S.readonlyOf(d); assert.equal(typeof r.readonly, 'boolean'); if (!r.readonly) assert.equal(r.reason, null); }));
});

// @covers LT-10
test('link problems: 404 → not found, 410 → expired with the date and sender, 5xx/network → try again', () => {
  assert.deepEqual(S.problemOf({status: 404, data: {error: 'This review link was not found.'}}), {kind: 'not_found', expired: null, sender: null});
  assert.deepEqual(S.problemOf({status: 410, code: 'link_expired', data: {expired: '2026-10-13T20:00:00.000Z', sender: {name: 'Ada Studio', email: 'ada@studio.example'}}}), {kind: 'expired', expired: '2026-10-13T20:00:00.000Z', sender: {name: 'Ada Studio', email: 'ada@studio.example'}});
  assert.equal(S.problemOf({status: 503}).kind, 'unavailable');
  assert.equal(S.problemOf(new TypeError('Failed to fetch')).kind, 'unavailable');
  const t = k => ({'problem.mailSubject': 'New review link, please', 'problem.mailBody': 'Hello & thanks'})[k] ?? k;
  assert.equal(S.askSenderHref(t, null), 'mailto:?subject=New%20review%20link%2C%20please&body=Hello%20%26%20thanks');
  assert.match(S.askSenderHref(t, {name: 'Ada', email: 'ada@studio.example'}), /^mailto:ada@studio\.example\?subject=/);
  // A sender address can never inject extra mailto headers.
  assert.doesNotMatch(S.askSenderHref(t, {name: null, email: 'a@b.example?cc=evil@x.example'}), /\?cc=|&cc=/);
});
