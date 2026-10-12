// WS-05 goldens: the change-order scenario fold (live-test scenario 2: ₹25,000 + CO-1 +₹7,500.50
// approved with its content proof, CO-2 +₹1,000 declined → fee ₹32,500.50) and one retainer month
// (12 posts quota, 13 used, overage CO approved) with its statement data. Produced by the real lib
// code on a frozen clock with a fixed signing secret. Regenerate deliberately with UPDATE_GOLDEN=1.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {freezeClock, tick} from '../support/property.mjs';

process.env.SCOPEFLOW_SIGNING_SECRET = 'scopeflow-golden-signing-secret-do-not-use-0123456789';
delete process.env.SCOPEFLOW_SIGNING_SECRET_PREVIOUS;
freezeClock();
const {scopeSchema} = await import('../../lib/scope.ts');
const L = await import('../../lib/ledger.ts');
const R = await import('../../lib/retainer.ts');
const {agreementTotals} = await import('../../lib/agreement-totals.ts');
const {approve, append, serverVerdict} = await import('../support/chain.mjs');

const dir = new URL('./', import.meta.url);
function golden(name, value) {
  const file = new URL(name, dir);
  const text = JSON.stringify(value, null, 2) + '\n';
  if (process.env.UPDATE_GOLDEN === '1' || !existsSync(file)) writeFileSync(file, text);
  assert.equal(text, readFileSync(file, 'utf8'), `${name} changed; run with UPDATE_GOLDEN=1 only if the change is intended`);
}

const film = scopeSchema.parse({title: 'Brand film for Kavya Studio', client: 'Kavya Studio', deliverables: '', items: [{id: 'film', title: 'Brand film', qty: 1, unit: '60 s cut', price: 25000, acceptance: 'Final 4K master delivered'}], exclusions: 'Paid media, print', fee: 25000, currency: 'INR', revisions: 2, due: '2026-12-15', notes: '', tax_label: 'GST', tax_pct: 18});

// @covers H17
test('golden: CO scenario fold (₹32,500.50) with the settle entry carrying co_sha256 and total_incl_tax_minor', async () => {
  const b = await approve(film, {project_id: 'golden-ws05-co', version: 1, signer: 'Ada Client', decided: tick(0)});
  const entries = [];
  const co1 = {title: 'Extra reel', reason: 'Not in the agreed deliverables', request_quote: 'Can you also cut a 15 s reel?', add_items: [{id: 'co_reel', title: '15 s reel', qty: 1, unit: '', price: 7500.5, acceptance: ''}], remove_item_ids: [], fee_delta: 7500.5, days_delta: 0, revisions_delta: 0};
  const co2 = {title: 'Behind-the-scenes stills', reason: '', request_quote: '', add_items: [{id: 'co_bts', title: 'BTS stills', qty: 10, unit: 'photos', price: 1000, acceptance: ''}], remove_item_ids: [], fee_delta: 1000, days_delta: 0, revisions_delta: 0};
  entries.push(await append(entries, b, 'change_order', co1, 'owner', tick(60)));
  entries.push(await append(entries, b, 'change_order', co2, 'owner', tick(90)));
  let a = L.computeAgreement(film, 1, entries);
  const view1 = a.change_orders.find(c => c.seq === 1);
  const proof = {co_sha256: await L.coSha256(view1, film), total_incl_tax_minor: L.coTotals(view1, film).total_incl_tax_minor};
  const settle1 = L.settleSchema.parse({ref_seq: 1, outcome: 'approved', signer: 'Ada Client', comment: '', acknowledged: true, ...proof});
  assert.equal(L.checkEntry('settle', settle1, film, a, 'client'), null);
  entries.push(await append(entries, b, 'settle', settle1, 'client', tick(120)));
  a = L.computeAgreement(film, 1, entries);
  const view2 = a.change_orders.find(c => c.seq === 2);
  const settle2 = L.settleSchema.parse({ref_seq: 2, outcome: 'declined', signer: 'Ada Client', comment: 'Not this month', acknowledged: true, co_sha256: await L.coSha256(view2, film), total_incl_tax_minor: L.coTotals(view2, film).total_incl_tax_minor});
  entries.push(await append(entries, b, 'settle', settle2, 'client', tick(150)));
  a = L.computeAgreement(film, 1, entries);
  // CO-2 cannot be re-decided.
  assert.match(L.checkEntry('settle', {ref_seq: 2, outcome: 'approved', signer: 'Ada Client', comment: ''}, film, a, 'client'), /already been settled/);
  assert.equal(a.fee, 32500.5);
  assert.deepEqual(a.change_orders.map(c => [c.seq, c.status]), [[1, 'approved'], [2, 'declined']]);
  assert.equal(entries[2].payload.co_sha256, proof.co_sha256);
  assert.equal(entries[2].payload.total_incl_tax_minor, 885059);
  const totals = agreementTotals(film, entries);
  assert.deepEqual([totals.fee, totals.tax, totals.total], [3250050, 585009, 3835059]);
  const v = await serverVerdict(b, entries);
  assert.equal(v.chain.intact, true); assert.equal(v.seal, 'valid');
  golden('ws-05-co-fold.golden.json', {anchor: b.anchor, head: entries.at(-1).hash, entries, agreement: a, totals_minor: {fee: totals.fee, tax: totals.tax, total: totals.total}});
});

const retainer = scopeSchema.parse({title: 'Social retainer · Kavya Studio', client: 'Kavya Studio', deliverables: '', items: [{id: 'posts', title: 'Instagram posts', qty: 12, unit: 'posts', unit_price: 600}, {id: 'reels', title: 'Reels', qty: 2, unit: 'reels'}], exclusions: 'Paid ads', fee: 30000, currency: 'INR', revisions: 1, due: '', notes: 'Monthly retainer', tax_label: 'GST', tax_pct: 18, engagement: 'retainer', retainer: {period: 'monthly', quotas: [{item_id: 'posts', qty: 12}, {item_id: 'reels', qty: 2}], carry_over: 'cap', renewal: 'manual'}});

// @covers SF-05
test('golden: one retainer month (12 posts quota, 13 used, overage CO approved) and its statement', async () => {
  const b = await approve(retainer, {project_id: 'golden-ws05-retainer', version: 1, signer: 'Ada Client', decided: tick(0)});
  const entries = [];
  const add = async (kind, payload, actor = 'owner', at = entries.length + 1) => entries.push(await append(entries, b, kind, payload, actor, tick(at * 60)));
  await add('period_open', {period: '2026-10', ...R.periodBounds('2026-10'), quotas: R.openingQuotas(retainer, L.computeAgreement(retainer, 1, entries).retainer, '2026-10')});
  for (const [date, qty, note] of [['2026-10-03', 6, 'Week 1'], ['2026-10-10', 6, 'Week 2'], ['2026-10-14', 1, 'Reel'], ['2026-10-17', 1, 'Festival post']]) {
    const item = note === 'Reel' ? 'reels' : 'posts';
    const usage = {period: '2026-10', item_id: item, qty, date, note};
    const a = L.computeAgreement(retainer, 1, entries);
    assert.equal(L.checkEntry('usage', usage, retainer, a, 'owner'), null);
    const over = R.overageOf(a.retainer, usage);
    await add('usage', usage);
    if (over > 0) {
      const usageSeq = entries.at(-1).seq;
      await add('change_order', {title: `Overage: ${over} × Instagram posts (2026-10)`, reason: 'Usage beyond the 2026-10 quota (12 included).', request_quote: '', add_items: [{id: `ov_${usageSeq}_posts`, title: 'Instagram posts', qty: over, unit: 'posts', price: 600, acceptance: ''}], remove_item_ids: [], fee_delta: 600, days_delta: 0, revisions_delta: 0, overage: {period: '2026-10', item_id: 'posts', qty: over, usage_seq: usageSeq}, rate_card: {item_id: 'post', qty: over, unit_price_minor: 60000, multipliers: []}});
    }
  }
  let a = L.computeAgreement(retainer, 1, entries);
  const ov = a.change_orders.find(c => c.overage);
  await add('settle', {ref_seq: ov.seq, outcome: 'approved', signer: 'Ada Client', comment: '', acknowledged: true, co_sha256: await L.coSha256(ov, retainer), total_incl_tax_minor: L.coTotals(ov, retainer).total_incl_tax_minor}, 'client');
  a = L.computeAgreement(retainer, 1, entries);
  await add('period_close', {period: '2026-10', lines: R.closingLines(a.retainer, '2026-10'), overage_cos: a.retainer.periods[0].overage_cos.map(o => o.seq)});
  a = L.computeAgreement(retainer, 1, entries);
  const statement = R.retainerStatement(retainer, entries, a.change_orders, '2026-10');
  assert.deepEqual(a.retainer.periods[0].lines.map(l => [l.item_id, l.used, l.allowance, l.over]), [['posts', 13, 12, 1], ['reels', 1, 2, 0]]);
  assert.equal(a.change_orders.filter(c => c.overage).length, 1);
  assert.deepEqual([statement.retainer_fee_minor, statement.overage_approved_minor, statement.subtotal_minor, statement.tax.amount_minor, statement.total_incl_tax_minor], [3000000, 60000, 3060000, 550800, 3610800]);
  assert.equal(statement.closed, true);
  const v = await serverVerdict(b, entries);
  assert.equal(v.chain.intact, true); assert.equal(v.seal, 'valid');
  golden('ws-05-retainer.golden.json', {anchor: b.anchor, head: entries.at(-1).hash, entries, retainer: a.retainer, statement, next_period_quotas: R.openingQuotas(retainer, a.retainer, '2026-11')});
});
