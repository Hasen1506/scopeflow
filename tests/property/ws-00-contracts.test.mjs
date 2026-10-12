// Phase 0 contracts (hark/ws-00-contracts): the shared stubs exist at their final paths and change
// no behaviour. Pure: no server, no network, frozen clock, seeded properties.
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {fc, freezeClock, tick, scopeArb} from '../support/property.mjs';
import {approve, append} from '../support/chain.mjs';

freezeClock();
const L = await import('../../lib/ledger.ts');
const {scopeSchema} = await import('../../lib/scope.ts');
const {totals, schedule} = await import('../../lib/money.ts');
const R = await import('../../lib/razorpay.ts');
const Mi = await import('../../lib/minor.ts');
const {agreementTotals} = await import('../../lib/agreement-totals.ts');
const {moneyState} = await import('../../lib/money-ledger.ts');
const E = await import('../../lib/errors.ts');
const {notify, NOTIFY_EVENTS} = await import('../../lib/notify.ts');
const {currentMode, modeDefaults, MODES} = await import('../../lib/mode.ts');
const O = await import('../../lib/openapi/index.ts');

const PLANNED = ['baseline_superseded', 'tds_credit', 'excess_payment', 'delivery_accepted', 'payment_claim_confirmed', 'period_open', 'usage', 'period_close'];
const ACTIVE = ['change_order', 'settle', 'goodwill', 'revision_round', 'client_input', 'payment', 'payment_received', 'refund'];

// changed by WS-05: the planned kinds are now enabled, each with its payload schema (tests/property/ws-05-ledger.test.mjs covers their rules).
test('EntryKind: the original kinds keep their order; planned kinds are named and enabled', async () => {
  assert.deepEqual(L.entryKinds, [...ACTIVE, ...PLANNED]);
  assert.deepEqual([...L.plannedEntryKinds], PLANNED);
  for (const k of PLANNED) {
    assert.equal(L.entryKindEnabled(k), true, k);
    assert.equal(typeof L.payloadSchemas[k].safeParse, 'function', k);
  }
  for (const k of ACTIVE) assert.equal(L.entryKindEnabled(k), true, k);
  assert.equal(L.entryKindEnabled('toString'), false);
});

test('Scope: content without the new optional fields parses exactly as before (no added keys)', () => {
  fc.assert(fc.property(scopeArb, s => {
    const parsed = scopeSchema.parse(s);
    for (const k of ['client_country', 'engagement', 'retainer', 'tds', 'msmed', 'language']) assert.equal(k in parsed, false, k);
    for (const i of parsed.items) assert.equal('unit_price' in i, false);
    assert.deepEqual(scopeSchema.parse(JSON.parse(JSON.stringify(parsed))), parsed);
  }));
});

test('Scope: the new optional fields are accepted when present and validated', () => {
  const base = {title: 'Fields fixture', client: 'Acme', deliverables: '', items: [{id: 'i1', title: 'Posts', qty: 12, unit_price: 600}], exclusions: '', fee: 7200, currency: 'INR', revisions: 2, due: '', notes: ''};
  const full = {...base, client_country: 'IN', engagement: 'retainer', retainer: {period: 'monthly', quotas: [{item_id: 'i1', qty: 12}], carry_over: 'none'}, tds: {section_2025: '393(1) Sl.6(iii)-professional', legacy_label: '194J(b)', rate_pct: 10, base: 'taxable_value'}, msmed: {agreed_days: 45}, language: 'ta'};
  const parsed = scopeSchema.parse(full);
  assert.equal(parsed.items[0].unit_price, 600);
  for (const k of ['client_country', 'engagement', 'retainer', 'tds', 'msmed', 'language']) assert.deepEqual(parsed[k], full[k], k);
  for (const bad of [{client_country: 'india'}, {engagement: 'hourly'}, {language: 'fr'}, {msmed: {agreed_days: 46}}, {tds: {...full.tds, rate_pct: 101}}, {retainer: {...full.retainer, extra: 1}}])
    assert.equal(scopeSchema.safeParse({...base, ...bad}).success, false, JSON.stringify(bad));
  assert.equal(scopeSchema.safeParse({...base, items: [{id: 'i1', title: 'Posts', unit_price: -1}]}).success, false);
});

test('minor.ts: Phase 0 bodies match today\'s razorpay minor-unit helpers', () => {
  fc.assert(fc.property(fc.integer({min: 0, max: 5_000_000}), fc.constantFrom('INR', 'USD', 'JPY', 'EUR', 'KWD'), (c, ccy) => {
    const amount = c / 100;
    assert.equal(Mi.toMinor(amount, ccy), R.toMinorUnits(amount, ccy));
    assert.equal(Mi.toMinor(String(amount), ccy), R.toMinorUnits(amount, ccy));
    assert.equal(Mi.fromMinor(c, ccy), R.fromMinorUnits(c, ccy));
  }));
  assert.equal(Mi.exponentOf('JPY'), 0); assert.equal(Mi.exponentOf('INR'), 2);
  assert.equal(Mi.sumMinor([1, 2, 3]), 6); assert.equal(Mi.mulPct(10000, 18), 1800);
});

async function ledgerWith(content, {co = 0, payments = [], refunds = []} = {}) {
  const b = await approve(content);
  const entries = [];
  if (co) {
    entries.push(await append(entries, b, 'change_order', {title: 'Extra', reason: '', request_quote: '', add_items: [], remove_item_ids: [], fee_delta: co, days_delta: 0, revisions_delta: 0}, 'owner', tick(entries.length + 1)));
    entries.push(await append(entries, b, 'settle', {ref_seq: entries[0].seq, outcome: 'approved', signer: 'Ada', comment: ''}, 'client', tick(entries.length + 1)));
  }
  for (const amount of payments) entries.push(await append(entries, b, 'payment_received', {amount, method: 'upi', received: '2026-10-01', reference: '', note: ''}, 'owner', tick(entries.length + 1)));
  for (const amount of refunds) entries.push(await append(entries, b, 'refund', {amount, method: 'upi', refunded: '2026-10-02', reference: '', note: ''}, 'owner', tick(entries.length + 1)));
  return {b, entries};
}

test('agreementTotals and moneyState: Phase 0 bodies agree with today\'s totals(), schedule() and paymentsOf()', async () => {
  const cents = fc.integer({min: 1, max: 2_000_000});
  await fc.assert(fc.asyncProperty(cents, fc.constantFrom(0, 5, 18), fc.constantFrom(0, 30, 50), fc.integer({min: 0, max: 500_000}), fc.array(cents, {maxLength: 3}), async (fee, tax, dep, co, pays) => {
    const content = {title: 'Totals fixture', client: 'Acme', deliverables: 'Logo design', exclusions: '', fee: fee / 100, currency: 'INR', revisions: 2, due: '', notes: '', ...(tax ? {tax_pct: tax, tax_label: 'GST'} : {}), ...(dep ? {deposit_pct: dep} : {})};
    const {b, entries} = await ledgerWith(content, {co: co / 100, payments: pays.map(p => p / 100)});
    const agreement = L.computeAgreement(b.content, 1, entries);
    const t = totals(b.content, agreement.fee), signed = totals(b.content);
    const a = agreementTotals(b.content, entries);
    assert.equal(a.fee, Math.round(agreement.fee * 100)); assert.equal(a.tax, Math.round(t.tax * 100)); assert.equal(a.total, Math.round(t.total * 100));
    assert.equal(a.deposit, Math.round(signed.deposit * 100));
    assert.deepEqual(a.heads, tax ? [{label: 'GST', rate: tax, amount: Math.round(t.tax * 100)}] : []);
    assert.deepEqual(a.milestones, schedule(b.content, t.total).map(l => ({...l, amount: Math.round(l.amount * 100)})));
    const ms = moneyState(entries, {baseline_version: 1, currency: 'INR', total: a.total, deposit: a.deposit});
    const paid = L.paymentsOf(entries).paid;
    assert.equal(ms.received, Math.round(paid * 100)); assert.equal(ms.refunded, 0); assert.equal(ms.tds_credited, 0);
    assert.equal(ms.excess, Math.max(0, Math.round(paid * 100) - a.total));
    assert.equal(ms.deposit.covered, a.deposit > 0 && paid + 0.005 >= signed.deposit);
  }), {numRuns: 40});
  const {entries} = await ledgerWith({title: 'Refund fixture', client: 'Acme', deliverables: 'Logo design', exclusions: '', fee: 1000, currency: 'INR', revisions: 2, due: '', notes: ''}, {payments: [600], refunds: [100]});
  const ms = moneyState(entries, {baseline_version: 1, currency: 'INR', total: 100000, deposit: 0});
  assert.deepEqual([ms.received, ms.refunded, ms.by_purpose.recorded, ms.by_purpose.refund], [60000, 10000, 60000, 10000]);
  assert.equal(moneyState(entries, {baseline_version: 2, currency: 'INR', total: 100000, deposit: 0}).received, 0); // Phase 0: per-baseline, as today
});

test('errors.ts: typed errors map to their status codes; anything else is left to failure()', async () => {
  const cases = [[new E.ValidationError({fee: 'Use at most 2 decimals'}), 400], [new E.Forbidden('client_link'), 403], [new E.Conflict('exceeds_uninvoiced'), 409], [new E.RateLimited(30), 429], [new E.Unavailable('signing'), 503]];
  for (const [err, status] of cases) {
    const r = E.toResponse(err);
    assert.equal(r.status, status); assert.equal(r.headers.get('Cache-Control'), 'no-store');
    assert.equal(typeof (await r.json()).error, 'string');
  }
  assert.equal(E.toResponse(new E.RateLimited(2.2)).headers.get('Retry-After'), '3');
  assert.deepEqual((await E.toResponse(new E.ValidationError({fee: 'x'})).json()).fields, {fee: 'x'});
  assert.equal(E.toResponse(new Error('boom')), null);
  assert.equal(E.toResponse('boom'), null);
});

test('notify.ts logs the event only and sends nothing; mode.ts is always freelancer', async () => {
  const info = mock.method(console, 'info', () => {});
  const fetchSpy = mock.method(globalThis, 'fetch', async () => { throw new Error('no network in Phase 0'); });
  try {
    for (const event of NOTIFY_EVENTS) assert.deepEqual(await notify(event, {project_id: 'p1', to: 'client@example.test', data: {secret: 'x'}}), {event, delivered: false, channel: 'log'});
    assert.equal(fetchSpy.mock.callCount(), 0);
    assert.equal(info.mock.callCount(), NOTIFY_EVENTS.length);
    for (const call of info.mock.calls) assert.doesNotMatch(String(call.arguments[0]), /client@example|secret/);
  } finally { info.mock.restore(); fetchSpy.mock.restore(); }
  assert.equal(NOTIFY_EVENTS.length, 8);
  assert.equal(await currentMode('any-owner'), 'freelancer');
  assert.deepEqual([...MODES], ['freelancer', 'agency', 'consumer', 'enterprise']);
  for (const m of MODES) assert.equal(modeDefaults(m).mode, m);
});

test('OpenAPI fragments: ten, all empty in Phase 0; merging keeps order and refuses redefinitions', () => {
  assert.equal(O.fragments.length, 10);
  // changed by WS-05: its fragment (index 4, lib/openapi/ws-05.ts) now documents the periods and rate-card routes.
  for (const [n, f] of O.fragments.entries()) if (n !== 4) { assert.deepEqual(f.paths, {}); assert.deepEqual(f.schemas, {}); }
  const base = {'/b': 1, '/a': 2};
  assert.equal(JSON.stringify(O.mergeFragments(base, f => f.paths, O.fragments.filter((_, n) => n !== 4))), JSON.stringify(base)); // changed by WS-05: its fragment is not empty
  assert.deepEqual(O.mergeFragments(base, f => f.paths, [{paths: {'/c': 3}, schemas: {}}]), {'/b': 1, '/a': 2, '/c': 3});
  assert.throws(() => O.mergeFragments(base, f => f.paths, [{paths: {'/a': 3}, schemas: {}}]), /redefines \/a/);
});

test('slot placeholders: one file per slot, each names its owner and renders null', () => {
  const slots = ['pay-block', 'whatsapp-share', 'data-notice', 'language-picker', 'co-card', 'retainer-counter', 'rate-card-picker', 'tds-field', 'msmed-terms', 'cosigner-editor', 'contact-change', 'payment-settings', 'timezone-select', 'theme-switcher'];
  const dir = new URL('../../app/components/slots/', import.meta.url);
  assert.deepEqual(readdirSync(dir).sort(), slots.map(s => s + '.tsx').sort());
  // changed by WS-05: co-card, retainer-counter and rate-card-picker are implemented (no longer null placeholders).
  const implemented = new Set(['co-card', 'retainer-counter', 'rate-card-picker']);
  for (const s of slots) {
    const src = readFileSync(new URL(s + '.tsx', dir), 'utf8');
    assert.match(src, /^\/\/ Slot: \w+\. Owner: WS-\d\d /m, s);
    if (implemented.has(s)) { assert.match(src, /export default function \w+\(/, s); continue; }
    assert.match(src, /export default function \w+\(_props: \w+Props\) \{\n  return null;\n\}/, s);
  }
});

test('test discovery and the coverage skeleton', () => {
  const runner = readFileSync(new URL('../run-local.mjs', import.meta.url), 'utf8');
  assert.match(runner, /readdirSync\('tests'\)\.filter\(f=>\/\^ws-\.\+\\\.mjs\$\/\.test\(f\)\)\.sort\(\)/);
  assert.match(runner, /'drafts',\.\.\.workstreamSuites\]/);
  const matrix = JSON.parse(readFileSync(new URL('../coverage-matrix.json', import.meta.url), 'utf8')).items;
  assert.equal(matrix.length, 126);
  assert.equal(new Set(matrix.map(i => i.id)).size, 126);
  for (const i of matrix) assert.match(i.primary, /^WS-(0[1-9]|10)$/, i.id);
});
